import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { insightQuery } from "@/lib/db";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type GridPage, type RowGetters } from "@/lib/grid-query";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { LEDGER_START } from "../ar-sync/ledger";
import { locked } from "../ar-sync/sync";
import { closedThrough } from "../ar-trial-balance/trial-balance";
import { closedMsg, loadAccounts, loadFunds, loadRows, parseFy, receiptLock, type TransferRow } from "./data";
import { MAX_NOTE, SOURCE_LABEL, STATUS_LABEL, parseReceiptFields, parseTransferInput, parseTransferPatch } from "./transfer";

/** response ของ GET /api/fund/ar-transfer?fy= (สัญญา DataGrid) */
export type ArTransferPage = GridPage<TransferRow>;

// $7/$8 = ใบเสร็จ (NULL = รอออกใบเสร็จ) ; ผู้ลงรับ = ผู้เพิ่ม
const INSERT_SQL = `INSERT INTO ar_transfer (source, transfer_date, ref_doc_no, account_code, amount, note, created_by, receipt_no, receipt_date, received_by, received_at)
VALUES ('manual', $1, $2, $3, $4, $5, $6, $7, $8::date, CASE WHEN $8::date IS NULL THEN NULL ELSE $6 END, CASE WHEN $8::date IS NULL THEN NULL ELSE now() END)
RETURNING id::text AS id`;
const CURRENT_SQL = `SELECT transfer_date, account_code, amount, receipt_date FROM ar_transfer WHERE id = $1 AND cancelled_at IS NULL FOR UPDATE`;

const SORTABLE = ["transfer_date", "ref_doc_no", "fund_name", "account_code", "amount", "source", "status", "receipt_no", "receipt_date"] as const;
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
class PatchError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

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
  [r.ref_doc_no, r.fund_name, r.note, r.account_code, r.account_name, r.receipt_no].some((v) => v?.toLowerCase().includes(q.toLowerCase()));

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
        { key: "batch", header: "ชุดโอน", width: 10 },
        { key: "ref_doc_no", header: "เลขที่เอกสาร", width: 28 },
        { key: "fund_name", header: "กองทุน", width: 40 },
        { key: "budget_year", header: "งบปี (พ.ศ.)", width: 10 },
        { key: "account_code", header: "รหัสบัญชี", width: 16 },
        { key: "account_name", header: "ชื่อบัญชี", width: 32 },
        { key: "amount", header: "จำนวนเงิน (บาท)", width: 16, type: "money" },
        { key: "smt_amount", header: "ยอดจาก SMT (บาท)", width: 16, type: "money" },
        { key: "source_label", header: "ที่มา", width: 10 },
        { key: "note", header: "หมายเหตุ", width: 30 },
        { key: "status_label", header: "สถานะ", width: 14 },
        { key: "receipt_no", header: "เลขที่ใบเสร็จ", width: 14 },
        { key: "receipt_date", header: "วันที่ใบเสร็จ", width: 12 },
      ],
      rows.map((r) => ({ ...r, source_label: SOURCE_LABEL[r.source], status_label: STATUS_LABEL[r.status] })),
    );
  }
  const body: ArTransferPage = { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
  return Response.json(body);
}

/** เพิ่มเอง { transfer_date, ref_doc_no?, account_code, amount, note?, receipt_no?, receipt_date? } (ผู้ที่ login ทุกคน) ไม่กรอกเลขที่ใบเสร็จ = รอออกใบเสร็จ */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return fail("unauthorized", 401);
  const b = await request.json().catch(() => null);
  const today = todayIso();
  const input = parseTransferInput(b, LEDGER_START, today);
  if ("error" in input) return fail(input.error);
  const ref = typeof b?.ref_doc_no === "string" ? b.ref_doc_no.trim() : "";
  if (ref.length > MAX_NOTE) return fail(`เลขที่เอกสารยาวได้ไม่เกิน ${MAX_NOTE} ตัวอักษร`);
  const receipt = typeof b?.receipt_no === "string" && b.receipt_no.trim() ? parseReceiptFields(b, input.transfer_date, today) : null;
  if (receipt && "error" in receipt) return fail(receipt.error);
  if (receipt) {
    const through = await closedThrough(insightQuery);
    if (through && receipt.receipt_date.slice(0, 7) <= through) return fail(closedMsg(through), 409);
  }
  const [row] = await insightQuery<{ id: string }>(INSERT_SQL, [
    input.transfer_date, ref || null, input.account_code, input.amount, input.note, session.user.name ?? "ไม่ทราบชื่อ", receipt?.receipt_no ?? null, receipt?.receipt_date ?? null,
  ]);
  return Response.json(row);
}

/**
 * แก้ { id, action: "edit", transfer_date, account_code, amount, note } (smt_amount คงเดิม) หรือยกเลิก { id, action: "cancel", reason }
 * แถวรอออกใบเสร็จยังไม่ลงบัญชี แก้ได้เสมอ ; แถวที่รับแล้ว: ยกเลิก หรือแก้ยอด/บัญชี ต้องผ่าน receiptLock (งวดปิดของวันที่ใบเสร็จ, ใช้ตัดหนี้เหมาจ่ายแล้ว)
 */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return fail("unauthorized", 401);
  const body = parseTransferPatch(await request.json().catch(() => null), LEDGER_START, todayIso());
  if ("error" in body) return fail(body.error);
  const name = session.user.name ?? "ไม่ทราบชื่อ";
  try {
    await locked(async (tx) => {
      const [cur] = await tx<{ transfer_date: string; account_code: string; amount: string; receipt_date: string | null }>(CURRENT_SQL, [body.id]);
      if (!cur) throw new PatchError("ไม่พบรายการนี้ หรือยกเลิกไปแล้ว", 404);
      if (cur.receipt_date) {
        if (body.action === "edit" && body.transfer_date > cur.receipt_date) throw new PatchError("วันที่โอนต้องไม่หลังวันที่ใบเสร็จ", 400);
        const money = body.action === "cancel" || body.account_code !== cur.account_code || body.amount !== Number(cur.amount);
        const why = money ? await receiptLock(tx, { account_code: cur.account_code, receipt_date: cur.receipt_date }, await closedThrough(tx)) : null;
        if (why) throw new PatchError(why, 409);
      }
      if (body.action === "edit") {
        await tx(
          "UPDATE ar_transfer SET transfer_date = $2, account_code = $3, amount = $4, note = $5, updated_by = $6, updated_at = now() WHERE id = $1 AND cancelled_at IS NULL",
          [body.id, body.transfer_date, body.account_code, body.amount, body.note, name],
        );
      } else {
        await tx("UPDATE ar_transfer SET cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 WHERE id = $1 AND cancelled_at IS NULL", [body.id, name, body.reason]);
      }
    });
  } catch (e) {
    if (e instanceof PatchError) return fail(e.message, e.status);
    throw e;
  }
  return Response.json({ id: body.id });
}
