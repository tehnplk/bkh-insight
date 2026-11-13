import type { NextRequest } from "next/server";
import { escapeLike, hisQuery, insightQuery } from "@/lib/db";
import { parseGridQuery } from "@/lib/grid-query";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import { FULL_NAME_SQL, UNKNOWN_FUND, UNKNOWN_NAME, badRequest, inList, isAuthed, loadLookups, unauthorized } from "../_lib/fund";
import { chunks } from "../rep-import/detail/file-detail";
import { fiscalYearOf } from "../uc-dashboard/dashboard";
import {
  STATUS_LABEL, fillBuckets, parseFilters,
  type ClaimErrorRow, type ClaimErrorsResponse, type CodeSummary,
} from "./claim-errors";

// รายการที่ REP ล่าสุด (tran_id มากสุด) ยังติด C หรือ Deny ต่อ VN (seq_no) / AN; แถวไม่มีทั้งสองใช้ (hn, admit_at) แทนและไม่อยู่ใน rows
// $1 type, $2 status, $3 code, $4 fy ค.ศ., $5 q (LIKE), $6 funds text[] — SQL ผ่าน prove-query กับฐาน insight แล้ว
const CTE = `WITH latest AS (
  SELECT 'OP'::text AS type, r.seq_no AS key, r.tran_id, r.rep_no, r.rep_file_id, r.hn, r.admit_at, r.discharge_at,
         r.claim_total, r.error_codes, r.deny, r.main_inscl, r.sub_inscl
  FROM rep_row r
  WHERE r.patient_type = 'OP' AND r.seq_no IS NOT NULL AND cardinality(r.error_codes) > 0
    AND ($1::text IS NULL OR $1::text = 'OP')
    AND NOT EXISTS (SELECT 1 FROM rep_row n WHERE n.seq_no = r.seq_no AND n.patient_type = 'OP' AND n.tran_id::bigint > r.tran_id::bigint)
  UNION ALL
  SELECT 'IP'::text, r.an, r.tran_id, r.rep_no, r.rep_file_id, r.hn, r.admit_at, r.discharge_at,
         r.claim_total, r.error_codes, r.deny, r.main_inscl, r.sub_inscl
  FROM rep_row r
  WHERE r.patient_type = 'IP' AND r.an IS NOT NULL AND cardinality(r.error_codes) > 0
    AND ($1::text IS NULL OR $1::text = 'IP')
    AND NOT EXISTS (SELECT 1 FROM rep_row n WHERE n.an = r.an AND n.patient_type = 'IP' AND n.tran_id::bigint > r.tran_id::bigint)
  UNION ALL
  SELECT r.patient_type, NULL::text, r.tran_id, r.rep_no, r.rep_file_id, r.hn, r.admit_at, r.discharge_at,
         r.claim_total, r.error_codes, r.deny, r.main_inscl, r.sub_inscl
  FROM rep_row r
  WHERE COALESCE(r.seq_no, r.an) IS NULL AND cardinality(r.error_codes) > 0
    AND ($1::text IS NULL OR $1::text = r.patient_type)
    AND NOT EXISTS (SELECT 1 FROM rep_row n WHERE n.hn = r.hn AND n.admit_at = r.admit_at AND n.patient_type = r.patient_type AND n.tran_id::bigint > r.tran_id::bigint)
), pending AS (
  SELECT l.type, l.key, l.tran_id, l.hn, l.rep_no, f.file_date AS rep_date, l.claim_total, l.sub_inscl,
         COALESCE(NULLIF(TRIM(l.main_inscl), ''), 'UNKNOWN') AS fund,
         CASE WHEN l.type = 'IP' THEN l.discharge_at ELSE l.admit_at END AS service_at,
         CASE WHEN 'DENY' = ANY(l.error_codes) THEN 'deny' ELSE 'c' END AS status,
         CASE WHEN 'DENY' = ANY(l.error_codes)
              THEN ARRAY(SELECT DISTINCT e.v FROM jsonb_each_text(l.deny) AS e(k, v) WHERE e.v <> 'C' ORDER BY e.v)
              ELSE l.error_codes END AS codes
  FROM latest l JOIN rep_file f ON f.id = l.rep_file_id
), item AS (
  SELECT p.*, (now() AT TIME ZONE 'Asia/Bangkok')::date - p.rep_date AS age_rep_days,
         (now() AT TIME ZONE 'Asia/Bangkok')::date - p.service_at::date AS age_service_days,
         EXTRACT(YEAR FROM p.service_at)::int + (EXTRACT(MONTH FROM p.service_at) >= 10)::int AS fy
  FROM pending p
), filtered AS (
  SELECT * FROM item
  WHERE ($2::text IS NULL OR status = $2::text)
    AND ($3::text IS NULL OR $3::text = ANY(codes))
    AND ($4::int IS NULL OR fy = $4::int)
    AND ($5::text IS NULL OR key LIKE $5::text OR hn LIKE $5::text OR rep_no LIKE $5::text OR tran_id LIKE $5::text)
    AND ($6::text[] IS NULL OR fund = ANY($6::text[]))
)`;

const SQL_CODES = `${CTE}
SELECT c.code, e.kind, e.description, count(*) AS n, sum(f.claim_total) AS amount,
       round(avg(f.age_service_days)) AS avg_age, max(f.age_service_days) AS max_age
FROM filtered f
CROSS JOIN LATERAL unnest(f.codes) AS c(code)
LEFT JOIN rep_error_code e ON e.code = c.code
WHERE f.key IS NOT NULL
GROUP BY c.code, e.kind, e.description
ORDER BY n DESC, c.code`;
const SQL_BUCKETS = `${CTE}
SELECT CASE WHEN age_service_days <= 30 THEN 1 WHEN age_service_days <= 60 THEN 2 WHEN age_service_days <= 90 THEN 3 ELSE 4 END AS bucket,
       count(*) AS n, sum(claim_total) AS amount
FROM filtered WHERE key IS NOT NULL GROUP BY 1 ORDER BY 1`;
const SQL_TOTALS = `${CTE}
SELECT count(*) AS total, sum(claim_total) AS amount,
       count(*) FILTER (WHERE status = 'c') AS c_count, count(*) FILTER (WHERE status = 'deny') AS deny_count,
       count(*) FILTER (WHERE type = 'OP') AS op_count, count(*) FILTER (WHERE type = 'IP') AS ip_count
FROM filtered WHERE key IS NOT NULL`;
const SQL_FUNDS = `${CTE}
SELECT fund, count(*) AS n, sum(claim_total) AS amount
FROM filtered WHERE key IS NOT NULL GROUP BY fund ORDER BY n DESC, fund`;
const SQL_ORPHAN = `${CTE}
SELECT count(*) AS n, sum(claim_total) AS amount,
       count(*) FILTER (WHERE status = 'c') AS c_count, count(*) FILTER (WHERE status = 'deny') AS deny_count
FROM filtered WHERE key IS NULL`;

// allowlist: id คอลัมน์ของ grid = ชื่อคอลัมน์ใน filtered (ไม่ให้ sort ตาม codes)
const SORTABLE = [
  "type", "key", "hn", "rep_no", "rep_date", "service_at", "fy", "fund", "sub_inscl", "status", "claim_total", "age_rep_days", "age_service_days",
] as const;
const XLSX_LIMIT = 100_000;
const NAME_BATCH = 1000;

type Num = string | number | null;
type DbRow = Omit<ClaimErrorRow, "fund_name" | "full_name" | "claim_total"> & { claim_total: Num };

/** ชื่อ-สกุลจาก his (patient.hn UNIQUE) ทีละชุด ไม่ขนาน ไม่มี HN = ไม่ query; HN ที่ไม่พบไม่อยู่ใน Map */
async function loadNames(hns: (string | null)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const batch of chunks([...new Set(hns.filter((h): h is string => !!h))], NAME_BATCH)) {
    const rows = await hisQuery<{ hn: string; full_name: string | null }>(
      `SELECT p.hn, ${FULL_NAME_SQL} AS full_name FROM patient p WHERE ${inList("p.hn", batch.length)}`,
      batch,
    );
    for (const r of rows) if (r.full_name) out.set(r.hn, r.full_name);
  }
  return out;
}

const n = (v: Num) => Number(v ?? 0);

const XLSX_COLUMNS: XlsxColumn<ClaimErrorRow & { status_label: string; codes_text: string; fund_label: string }>[] = [
  { key: "type", header: "OP/IP", width: 7 },
  { key: "key", header: "VN/AN", width: 14 },
  { key: "hn", header: "HN", width: 10 },
  { key: "full_name", header: "ชื่อ-สกุล", width: 28 },
  { key: "service_at", header: "วันที่รับบริการ/จำหน่าย", width: 20 },
  { key: "fy", header: "ปีงบ", width: 7 },
  { key: "fund_label", header: "กองทุน", width: 10 },
  { key: "sub_inscl", header: "สิทธิย่อย", width: 9 },
  { key: "rep_no", header: "REP", width: 14 },
  { key: "rep_date", header: "วันที่ REP", width: 12 },
  { key: "status_label", header: "สถานะ", width: 8 },
  { key: "codes_text", header: "รหัส", width: 16 },
  { key: "claim_total", header: "ยอดเรียกเก็บ (บาท)", width: 16, type: "money" },
  { key: "age_service_days", header: "ค้าง (วัน)", width: 10, type: "count" },
  { key: "age_rep_days", header: "นับจาก REP (วัน)", width: 14, type: "count" },
];

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const today = todayIso();
  const parsed = parseFilters(params, fiscalYearOf(today));
  if (!parsed.ok) return badRequest(parsed.error);
  const grid = parseGridQuery(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const f = parsed.filters;
  const base = [f.type, f.status, f.code, f.fyCe, q ? `%${escapeLike(q)}%` : null, f.funds];
  // sort ผ่าน allowlist แล้ว ไม่มี sort = ค้างนานสุดก่อน
  const order = sort ? `${sort} ${dir === "desc" ? "DESC" : "ASC"}` : "age_service_days DESC";
  const xlsx = format === "xlsx";
  const listSql = `${CTE}
SELECT type, key, hn, rep_no, rep_date, service_at, fy, fund, sub_inscl, status, codes, claim_total, age_rep_days, age_service_days
FROM filtered WHERE key IS NOT NULL
ORDER BY ${order} NULLS LAST, key
LIMIT $7::int OFFSET $8::int`;
  const list = insightQuery<DbRow>(listSql, [...base, xlsx ? XLSX_LIMIT : pageSize, xlsx ? 0 : (page - 1) * pageSize]);
  // ชื่อกองทุนมาจาก his: ต่อ his ไม่ได้ก็ยังแสดงคิวได้ด้วยรหัส
  const lookups = loadLookups().catch(() => null);
  const fundName = async () => {
    const lk = await lookups;
    return (code: string) => (lk ? lk.fundName(code) : code === UNKNOWN_FUND ? UNKNOWN_NAME : code);
  };
  // ชื่อรอแค่ rows ของ Query A ไม่รอ query สรุป; ต่อ his ไม่ได้ก็ยังแสดงคิวได้ (ชื่อเป็น –)
  const named = list.then(async (rows) => ({ rows, names: await loadNames(rows.map((r) => r.hn)).catch(() => new Map<string, string>()) }));
  const toRow = (name: (c: string) => string, names: Map<string, string>) => (r: DbRow): ClaimErrorRow => ({
    ...r, fy: r.fy + 543, fund_name: name(r.fund), full_name: (r.hn && names.get(r.hn)) || null,
    claim_total: r.claim_total == null ? null : Number(r.claim_total),
  });

  if (xlsx) {
    const [{ rows, names }, name] = await Promise.all([named, fundName()]);
    const out = rows.map(toRow(name, names)).map((r) => ({
      ...r,
      status_label: STATUS_LABEL[r.status],
      codes_text: r.codes.join(", "),
      fund_label: r.fund === UNKNOWN_FUND ? UNKNOWN_NAME : r.fund,
    }));
    return xlsxResponse(`claim-errors-${today}.xlsx`, XLSX_COLUMNS, out);
  }

  const [{ rows, names }, codes, buckets, [t], funds, [o], name] = await Promise.all([
    named,
    insightQuery<Omit<CodeSummary, "n" | "amount" | "avg_age" | "max_age"> & Record<"n" | "amount" | "avg_age" | "max_age", Num>>(SQL_CODES, base),
    insightQuery<{ bucket: number; n: Num; amount: Num }>(SQL_BUCKETS, base),
    insightQuery<Record<"total" | "amount" | "c_count" | "deny_count" | "op_count" | "ip_count", Num>>(SQL_TOTALS, base),
    // ไม่กรองกองทุน ตัวเลือกจึงไม่หายเมื่อเลือกแล้ว
    insightQuery<{ fund: string; n: Num; amount: Num }>(SQL_FUNDS, [...base.slice(0, 5), null]),
    insightQuery<Record<"n" | "amount", Num>>(SQL_ORPHAN, base),
    fundName(),
  ]);
  const body: ClaimErrorsResponse = {
    rows: rows.map(toRow(name, names)),
    total: n(t.total),
    totals: { n: n(t.total), amount: n(t.amount), c: n(t.c_count), deny: n(t.deny_count), op: n(t.op_count), ip: n(t.ip_count) },
    buckets: fillBuckets(buckets),
    codes: codes.map((c) => ({ ...c, n: n(c.n), amount: n(c.amount), avg_age: n(c.avg_age), max_age: n(c.max_age) })),
    funds: funds.map((x) => ({ fund: x.fund, name: name(x.fund), n: n(x.n), amount: n(x.amount) })),
    orphan: { n: n(o.n), amount: n(o.amount) },
  };
  return Response.json(body);
}
