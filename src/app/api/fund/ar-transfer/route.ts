import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { insightExecute, insightQuery } from "@/lib/db";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type GridPage, type RowGetters } from "@/lib/grid-query";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { LEDGER_START } from "../ar-sync/ledger";
import { closedThrough } from "../ar-trial-balance/trial-balance";
import { loadAccounts, loadFunds, loadRows, parseFy, type TransferRow } from "./data";
import { MAX_NOTE, SOURCE_LABEL, STATUS_LABEL, parseTransferInput, parseTransferPatch } from "./transfer";

/** response ของ GET /api/fund/ar-transfer?fy= (สัญญา DataGrid) */
export type ArTransferPage = GridPage<TransferRow>;

const INSERT_SQL = `INSERT INTO ar_transfer (source, transfer_date, ref_doc_no, account_code, amount, note, created_by)
VALUES ('manual', $1, $2, $3, $4, $5, $6) RETURNING id::text AS id`;

const SORTABLE = ["transfer_date", "ref_doc_no", "fund_name", "account_code", "amount", "source", "status"] as const;
const FILTER_GET = {
  account_code: (r) => r.account_code,
  fund_name: (r) => r.fund_name ?? "",
  source: (r) => r.source,
  status: (r) => r.status,
} satisfies RowGetters<TransferRow, string>;
type FilterKey = keyof typeof FILTER_GET;
const FILTERABLE = Object.keys(FILTER_GET) as FilterKey[];
const LABELS: Partial<Record<FilterKey, Record<string, string>>> = { source: SOURCE_LABEL, status: STATUS_LABEL };

const fail = (error: string, status = 400) => Response.json({ error }, { status });
const closedMsg = (through: string) => `งวดถึงเดือน ${through} ปิดแล้ว แก้หรือเพิ่มรายการในงวดที่ปิดไม่ได้`;

function sortRows(rows: TransferRow[], sort: (typeof SORTABLE)[number], dir: "asc" | "desc") {
  const sign = dir === "desc" ? -1 : 1;
  return rows.toSorted((a, b) => {
    const x = a[sort], y = b[sort];
    if (x === y) return sign * (Number(a.id) - Number(b.id));
    if (x === null) return 1; // ว่างไว้ท้ายเสมอ
    if (y === null) return -1;
    return sign * (typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y)));
  });
}

const matches = (r: TransferRow, q: string) =>
  [r.ref_doc_no, r.fund_name, r.note, r.account_code, r.account_name].some((v) => v?.toLowerCase().includes(q.toLowerCase()));

export async function GET(request: NextRequest) {
  if (!(await auth())) return fail("unauthorized", 401);
  const params = request.nextUrl.searchParams;
  const fy = parseFy(params);
  if (fy === null) return fail("fy ไม่ถูกต้อง");
  const grid = parseGridQuery(params, SORTABLE);
  if (!grid.ok) return fail(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters<FilterKey>(params, FILTERABLE);
  if (!cf.ok) return fail(cf.error);
  const { filters, facet, facetQ } = cf.query;

  const all = (await loadRows(fy, await loadAccounts(await loadFunds()))).filter((r) => !q || matches(r, q));
  if (facet) {
    const labels = LABELS[facet];
    return Response.json(facetRows(filterRows(all, filters, FILTER_GET, facet), FILTER_GET[facet], facetQ, labels ? (v) => labels[v] ?? v : undefined));
  }
  const rows = sortRows(filterRows(all, filters, FILTER_GET), sort ?? "transfer_date", sort ? dir : "desc");

  if (format === "xlsx") {
    return xlsxResponse(
      `ar-transfer-${fy}.xlsx`,
      [
        { key: "transfer_date", header: "วันที่โอน", width: 12 },
        { key: "ref_doc_no", header: "เลขที่เอกสาร", width: 28 },
        { key: "fund_name", header: "กองทุน", width: 40 },
        { key: "account_code", header: "รหัสบัญชี", width: 16 },
        { key: "account_name", header: "ชื่อบัญชี", width: 32 },
        { key: "amount", header: "จำนวนเงิน (บาท)", width: 16, type: "money" },
        { key: "smt_amount", header: "ยอดจาก SMT (บาท)", width: 16, type: "money" },
        { key: "source_label", header: "ที่มา", width: 10 },
        { key: "note", header: "หมายเหตุ", width: 30 },
        { key: "status_label", header: "สถานะ", width: 10 },
      ],
      rows.map((r) => ({ ...r, source_label: SOURCE_LABEL[r.source], status_label: STATUS_LABEL[r.status] })),
    );
  }
  const body: ArTransferPage = { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
  return Response.json(body);
}

/** เพิ่มเอง { transfer_date, ref_doc_no?, account_code, amount, note? } (ผู้ที่ login ทุกคน) */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return fail("unauthorized", 401);
  const b = await request.json().catch(() => null);
  const input = parseTransferInput(b, LEDGER_START, todayIso());
  if ("error" in input) return fail(input.error);
  const ref = typeof b?.ref_doc_no === "string" ? b.ref_doc_no.trim() : "";
  if (ref.length > MAX_NOTE) return fail(`เลขที่เอกสารยาวได้ไม่เกิน ${MAX_NOTE} ตัวอักษร`);
  const through = await closedThrough(insightQuery);
  if (through && input.transfer_date.slice(0, 7) <= through) return fail(closedMsg(through), 409);
  const [row] = await insightQuery<{ id: string }>(INSERT_SQL, [input.transfer_date, ref || null, input.account_code, input.amount, input.note, session.user.name ?? "ไม่ทราบชื่อ"]);
  return Response.json(row);
}

/** แก้ { id, action: "edit", transfer_date, account_code, amount, note } (smt_amount คงเดิม) หรือยกเลิก { id, action: "cancel", reason } */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return fail("unauthorized", 401);
  const body = parseTransferPatch(await request.json().catch(() => null), LEDGER_START, todayIso());
  if ("error" in body) return fail(body.error);
  const name = session.user.name ?? "ไม่ทราบชื่อ";
  const [[cur], through] = await Promise.all([
    insightQuery<{ transfer_date: string; cancelled: boolean }>("SELECT transfer_date, cancelled_at IS NOT NULL AS cancelled FROM ar_transfer WHERE id = $1", [body.id]),
    closedThrough(insightQuery),
  ]);
  if (!cur || cur.cancelled) return fail("ไม่พบรายการนี้ หรือยกเลิกไปแล้ว", 404);
  const dates = body.action === "edit" ? [cur.transfer_date, body.transfer_date] : [cur.transfer_date];
  if (through && dates.some((d) => d.slice(0, 7) <= through)) return fail(closedMsg(through), 409);

  const { rowCount } =
    body.action === "edit"
      ? await insightExecute(
          "UPDATE ar_transfer SET transfer_date = $2, account_code = $3, amount = $4, note = $5, updated_by = $6, updated_at = now() WHERE id = $1 AND cancelled_at IS NULL",
          [body.id, body.transfer_date, body.account_code, body.amount, body.note, name],
        )
      : await insightExecute(
          "UPDATE ar_transfer SET cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 WHERE id = $1 AND cancelled_at IS NULL",
          [body.id, name, body.reason],
        );
  if (!rowCount) return fail("ไม่พบรายการนี้ หรือยกเลิกไปแล้ว", 404);
  return Response.json({ id: body.id });
}
