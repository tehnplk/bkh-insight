import type { NextRequest } from "next/server";
import { escapeLike, insightQuery } from "@/lib/db";
import { parseColumnFilters, parseGridQuery, type GridPage } from "@/lib/grid-query";
import { columnFilterWhere, loadFacet, type ColumnFilterDefs, type SqlValue } from "@/lib/column-filter-sql";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { badRequest, isAuthed, unauthorized } from "../../_lib/fund";
import { KIND_LABEL, monthRange, type Kind, type PatientType } from "../../ar-sync/ledger";

/** แถวของ /api/fund/ar-ledger/entries */
export type LedgerEntry = {
  id: string;
  entry_date: string;
  kind: Kind;
  ref: string;
  vn: string | null;
  an: string | null;
  patient_type: PatientType;
  ref_date: string | null;
  pttype: string | null;
  hipdata_code: string | null;
  hospmain: string | null;
  amount: string; // numeric มาเป็น string
  note: string | null;
};

const SORTABLE = ["entry_date", "kind", "ref", "vn", "an", "patient_type", "ref_date", "pttype", "hipdata_code", "hospmain", "amount"] as const;
const ACCOUNT = /^\d{10}\.\d{3,5}$/;
// $1..$2 ช่วงเดือน, $3 บัญชี (null = ไม่ระบุบัญชี), $4 คำค้น (null หรือ LIKE pattern)
const WHERE = `WHERE entry_date BETWEEN $1 AND $2 AND account_code IS NOT DISTINCT FROM $3
  AND ($4::text IS NULL OR ref ILIKE $4 OR vn ILIKE $4 OR an ILIKE $4 OR pttype ILIKE $4 OR hipdata_code ILIKE $4 OR hospmain ILIKE $4)`;

// ตัวกรองหัวคอลัมน์ (allowlist) บน ar_ledger
const FILTER_DEFS: ColumnFilterDefs = {
  entry_date: { expr: "to_char(entry_date, 'YYYY-MM-DD')" },
  kind: { expr: "kind", labels: KIND_LABEL },
  patient_type: { expr: "patient_type" },
  vn: { expr: "COALESCE(vn, an)" },
  ref: { expr: "ref" },
  ref_date: { expr: "to_char(ref_date, 'YYYY-MM-DD')" },
  pttype: { expr: "pttype" },
  hipdata_code: { expr: "hipdata_code" },
  hospmain: { expr: "hospmain" },
  note: { expr: "note" },
};
const FILTERABLE = Object.keys(FILTER_DEFS);

// รายการในเดือนของบัญชีเดียว ?month=YYYY-MM&account=<รหัสบัญชี|none>
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = monthRange(params.get("month") ?? "", todayIso());
  if (!range) return badRequest("month ต้องเป็น YYYY-MM ตั้งแต่ 2025-10 ถึงเดือนปัจจุบัน");
  const accountRaw = params.get("account") ?? "";
  if (accountRaw !== "none" && !ACCOUNT.test(accountRaw)) return badRequest("account ต้องเป็นรหัสบัญชี หรือ none");
  const account = accountRaw === "none" ? null : accountRaw;
  const grid = parseGridQuery(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters(params, FILTERABLE);
  if (!cf.ok) return badRequest(cf.error);
  const { filters, facet, facetQ } = cf.query;
  const base = [range.from, range.to, account, q ? `%${escapeLike(q)}%` : null] as SqlValue[];
  const cfw = columnFilterWhere(FILTER_DEFS, filters, facet, "pg", base.length + 1);
  const where = `${WHERE}${cfw.parts.map((p) => ` AND ${p}`).join("")}`;
  const args = [...base, ...cfw.params];
  if (facet) return Response.json(await loadFacet(insightQuery, FILTER_DEFS, facet, facetQ, "FROM ar_ledger", { sql: where, params: args }, "pg"));
  // sort มาจาก allowlist จึงใช้เป็นชื่อคอลัมน์ได้
  const select = `SELECT id, entry_date, kind, ref, vn, an, patient_type, ref_date, pttype, hipdata_code, hospmain, amount, note
FROM ar_ledger ${where}
ORDER BY ${sort ?? "entry_date"} ${dir === "desc" ? "DESC" : "ASC"} NULLS LAST, id`;

  if (format === "xlsx") {
    const rows = (await insightQuery<LedgerEntry>(select, args)).map((r) => ({ ...r, kind_label: KIND_LABEL[r.kind] }));
    return xlsxResponse<(typeof rows)[number]>(`ar-ledger-${accountRaw}-${params.get("month")}.xlsx`, [
      { key: "entry_date", header: "วันที่ลงบัญชี", width: 12 },
      { key: "kind_label", header: "ประเภท", width: 12 },
      { key: "ref", header: "เลขอ้างอิง", width: 14 },
      { key: "vn", header: "VN", width: 14 },
      { key: "an", header: "AN", width: 12 },
      { key: "patient_type", header: "OP/IP", width: 8 },
      { key: "ref_date", header: "วันที่ตั้งหนี้/จำหน่าย", width: 14 },
      { key: "pttype", header: "สิทธิ", width: 8 },
      { key: "hipdata_code", header: "กองทุน", width: 10 },
      { key: "hospmain", header: "หน่วยบริการประจำ", width: 12 },
      { key: "amount", header: "จำนวนเงิน (บาท)", width: 14, type: "money" },
      { key: "note", header: "เหตุผล", width: 36 },
    ], rows);
  }

  const [rows, [{ total, amount }]] = await Promise.all([
    insightQuery<LedgerEntry>(`${select}
LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, pageSize, (page - 1) * pageSize]),
    insightQuery<{ total: number; amount: string | null }>(`SELECT count(*)::int AS total, SUM(amount) AS amount FROM ar_ledger ${where}`, args),
  ]);
  const body: GridPage<LedgerEntry> & { summary: { amount: number } } = { rows, total, summary: { amount: Number(amount ?? 0) } };
  return Response.json(body);
}
