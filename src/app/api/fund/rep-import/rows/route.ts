import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { escapeLike, insightQuery } from "@/lib/db";
import { parseColumnFilters, parseGridQuery, type GridPage } from "@/lib/grid-query";
import { columnFilterWhere, loadFacet, type ColumnFilterDefs, type SqlValue } from "@/lib/column-filter-sql";
import { xlsxResponse } from "@/lib/xlsx";
import { REP_FILTER_LABEL } from "../../_lib/rep";

/** แถว REP ของไฟล์หนึ่งไฟล์ (modal รายละเอียดไฟล์ใน /fund/rep-import) ; numeric ของ pg มาเป็น string */
export type RepLineRow = {
  tran_id: string;
  rep_no: string;
  patient_type: string | null;
  /** VN (OP: seq_no) หรือ AN (IP) null = REP ไม่มีเลข (เช่น OPLGO_APPEAL บางแถว) */
  ref: string | null;
  hn: string | null;
  admit_at: string | null;
  discharge_at: string | null;
  scheme: string;
  main_inscl: string | null;
  claim_total: string | null;
  compensation: string;
  adjrw: string | null;
  status: "pass" | "c" | "deny";
  error_codes: string[];
  /** ยอดที่ STM จ่ายรายนี้ (ทุกไฟล์รวมอุทธรณ์/เรียกคืน) null = ยังไม่พบใน STM */
  stm_paid: string | null;
  stm_docs: string | null;
};

const REF = "CASE WHEN r.patient_type = 'IP' THEN NULLIF(r.an, '') ELSE NULLIF(r.seq_no, '') END";
const COMP = "COALESCE(r.net_nhso, 0) + COALESCE(r.net_affiliation, 0)";
// สูตรเดียวกับ latestRepSql (_lib/rep.ts)
const STATUS = "CASE WHEN cardinality(r.error_codes) = 0 THEN 'pass' WHEN 'DENY' = ANY(r.error_codes) THEN 'deny' ELSE 'c' END";
// sort key (allowlist) -> expr
const SORT: Record<string, string> = {
  ref: REF, hn: "r.hn", tran_id: "r.tran_id::bigint", rep_no: "r.rep_no", admit_at: "r.admit_at", discharge_at: "r.discharge_at",
  claim_total: "r.claim_total", compensation: COMP, adjrw: "r.adjrw",
};
const SORTABLE = Object.keys(SORT);
const FILTER_DEFS: ColumnFilterDefs = {
  status: { expr: STATUS, labels: REP_FILTER_LABEL },
  rep_no: { expr: "r.rep_no" },
  main_inscl: { expr: "r.main_inscl" },
};
const FROM = "FROM rep_row r";
// $1 = rep_file_id, $2 = คำค้น (null หรือ LIKE pattern)
const WHERE = "WHERE r.rep_file_id = $1 AND ($2::text IS NULL OR r.tran_id LIKE $2 OR r.seq_no LIKE $2 OR r.an LIKE $2 OR r.hn LIKE $2)";
// STM ที่จ่ายรายนี้: UC จับด้วย tran_id, csmbs (OFC/BMT/BKK ไม่มี tran_id) ด้วย (rep_no, VN/AN) ; scheme เดียวกันเสมอเพราะ tran_id ชนข้าม scheme
const STM = `LEFT JOIN LATERAL (
  SELECT SUM(x.paid) AS stm_paid, string_agg(DISTINCT x.doc_no, ', ') AS stm_docs FROM (
    SELECT s.paid_total AS paid, f.doc_no FROM stm_row s JOIN stm_file f ON f.id = s.stm_file_id
    WHERE s.tran_id = p.tran_id AND f.scheme = p.scheme
    UNION ALL
    SELECT s.paid_total, f.doc_no FROM stm_row s JOIN stm_file f ON f.id = s.stm_file_id
    WHERE p.scheme <> 'UCS' AND s.tran_id IS NULL AND s.rep_no = p.rep_no AND f.scheme = p.scheme
      AND ((p.patient_type = 'IP' AND s.an = p.an) OR (p.patient_type <> 'IP' AND s.seq_no = p.seq_no))
  ) x) m ON true`;

export async function GET(request: NextRequest) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const id = params.get("id") ?? "";
  if (!/^[1-9]\d{0,17}$/.test(id)) return Response.json({ error: "id ต้องเป็นจำนวนเต็มบวก" }, { status: 400 });
  const parsed = parseGridQuery(params, SORTABLE);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = parsed.query;
  const cf = parseColumnFilters(params, Object.keys(FILTER_DEFS));
  if (!cf.ok) return Response.json({ error: cf.error }, { status: 400 });

  const cfw = columnFilterWhere(FILTER_DEFS, cf.query.filters, cf.query.facet, "pg", 3);
  const where = `${WHERE}${cfw.parts.map((p) => ` AND ${p}`).join("")}`;
  const args: (SqlValue | null)[] = [id, q ? `%${escapeLike(q)}%` : null, ...cfw.params];
  if (cf.query.facet) {
    return Response.json(await loadFacet(insightQuery, FILTER_DEFS, cf.query.facet, cf.query.facetQ, FROM, { sql: where, params: args as SqlValue[] }, "pg"));
  }

  // sort มาจาก allowlist ; ord คงลำดับไว้ให้ query นอกที่หา STM เฉพาะแถวในหน้า
  const order = `${sort ? `${SORT[sort]} ${dir === "desc" ? "DESC" : "ASC"} NULLS LAST, ` : ""}r.rep_no, r.tran_id::bigint`;
  const xlsx = format === "xlsx";
  const n = args.length;
  const select = `SELECT p.*, m.stm_paid, m.stm_docs FROM (
  SELECT r.tran_id, r.rep_no, r.patient_type, ${REF} AS ref, r.hn, r.admit_at, r.discharge_at, r.scheme, r.main_inscl,
    r.claim_total, ${COMP} AS compensation, r.adjrw, ${STATUS} AS status, r.error_codes, r.an, r.seq_no,
    row_number() OVER (ORDER BY ${order}) AS ord
  ${FROM}
  ${where}
  ORDER BY ord${xlsx ? "" : ` LIMIT $${n + 1} OFFSET $${n + 2}`}
) p
${STM}
ORDER BY p.ord`;

  if (xlsx) {
    const rows = await insightQuery<RepLineRow>(select, args);
    return xlsxResponse(`rep-${id}-rows.xlsx`, [
      { key: "tran_id", header: "TRAN_ID", width: 14 },
      { key: "rep_no", header: "REP No.", width: 14 },
      { key: "ref", header: "VN/AN", width: 14 },
      { key: "hn", header: "HN", width: 12 },
      { key: "admit_at", header: "วันเข้ารักษา", width: 20 },
      { key: "discharge_at", header: "วันจำหน่าย", width: 20 },
      { key: "main_inscl", header: "สิทธิ", width: 8 },
      { key: "status", header: "สถานะ", width: 10 },
      { key: "error_codes", header: "Error Code", width: 24 },
      { key: "claim_total", header: "เรียกเก็บ (บาท)", width: 16, type: "money" },
      { key: "compensation", header: "ชดเชยสุทธิ (บาท)", width: 16, type: "money" },
      { key: "adjrw", header: "AdjRW", width: 10 },
      { key: "stm_paid", header: "STM จ่าย (บาท)", width: 16, type: "money" },
      { key: "stm_docs", header: "ไฟล์ STM", width: 30 },
    ], rows.map((r) => ({ ...r, status: REP_FILTER_LABEL[r.status], error_codes: r.error_codes.join(", ") })));
  }

  const [rows, [{ total }]] = await Promise.all([
    insightQuery<RepLineRow>(select, [...args, pageSize, (page - 1) * pageSize]),
    insightQuery<{ total: number }>(`SELECT count(*)::int AS total ${FROM}\n${where}`, args),
  ]);
  const body: GridPage<RepLineRow> = { rows, total };
  return Response.json(body);
}
