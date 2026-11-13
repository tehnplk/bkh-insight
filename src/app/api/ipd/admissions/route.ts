import type { NextRequest } from "next/server";
import { escapeLike, hisQuery, insightQuery } from "@/lib/db";
import { parseGridQuery } from "@/lib/grid-query";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import {
  FULL_NAME_SQL, activePttypes, badRequest, effectiveCodes, fundOf, inList, isAuthed, loadLookups, parseCodes, parseRange, unauthorized,
} from "@/app/api/fund/_lib/fund";
import { ADJRW_RATES, IPD_MAX_DAYS, REP_FUND, buildRows, type AdmissionRow, type AdmissionsPage, type RawAdmission, type RawRep } from "./admissions";

// key ที่ DataGrid ส่งเป็น sort -> SQL (allowlist จึงต่อเข้า ORDER BY ได้)
const SORT_SQL = {
  an: "i.an", hn: "i.hn", regdate: "i.regdate", dchdate: "i.dchdate", ward_name: "ward_name", dchstts_name: "i.dchstts", dch_reason: "i.dchtype", los_days: "los_days",
  income: "s.income", uc_money: "s.uc_money", pdx: "s.pdx",
  rw: "i.rw", adjrw: "i.adjrw", days_since_dch: "days_since_dch", pttype_name: "pttype_name",
  ipt_summary_status_id: "i.ipt_summary_status_id", finance_lock: "i.finance_lock",
} as const;
type SortKey = keyof typeof SORT_SQL;
const SORTABLE = Object.keys(SORT_SQL) as SortKey[];
// shortcut: Excel ดึงไม่เกินนี้ (ทุกสิทธิช่วง 90 วันราว 2,100 ราย) ถ้าเกินจริงให้แบ่งดึงเป็นชุด
const XLSX_MAX = 10_000;

// Authen Code = visit_pttype.auth_code ของ visit ที่รับไว้นอน (สิทธิเดียวกับ admission ก่อน) Claim Code = ipt_pttype.claim_code (แถวแรก กันแถวซ้ำเมื่อมีหลายสิทธิ) สถานะจำหน่ายจาก dchstts เหตุผลการจำหน่ายจาก dchtype
// PDx จาก an_stat.pdx (ตรงกับ iptdiag diagtype 1 ทุก AN ของปีงบ 2569) ชื่อโรคจาก icd101 (PK จึงไม่ทำให้แถวซ้ำ)
const SELECT = `SELECT i.an, i.hn,
       ${FULL_NAME_SQL} AS patient_name,
       i.regdate, i.dchdate, i.dchstts, d.name AS dchstts_name, COALESCE(dt.name, i.dchtype) AS dch_reason, w.name AS ward_name,
       DATEDIFF(i.dchdate, i.regdate) AS los_days,
       s.income, s.uc_money,
       i.pttype, t.name AS pttype_name,
       (SELECT NULLIF(TRIM(vp.auth_code), '') FROM visit_pttype vp WHERE vp.vn = i.vn ORDER BY vp.pttype = i.pttype DESC, vp.pttype LIMIT 1) AS auth_code,
       (SELECT NULLIF(TRIM(ip.claim_code), '') FROM ipt_pttype ip WHERE ip.an = i.an ORDER BY ip.ipt_pttype_id LIMIT 1) AS claim_code,
       i.finance_lock, i.ipt_summary_status_id, ss.ipt_summary_status_name AS summary_status_name,
       s.pdx, c.name AS pdx_name,
       i.drg, i.rw, i.adjrw,
       DATEDIFF(CAST(? AS DATE), i.dchdate) AS days_since_dch
FROM ipt i
LEFT JOIN patient p ON p.hn = i.hn
LEFT JOIN ward w ON w.ward = i.ward
LEFT JOIN dchstts d ON d.dchstts = i.dchstts
LEFT JOIN dchtype dt ON dt.dchtype = i.dchtype
LEFT JOIN an_stat s ON s.an = i.an
LEFT JOIN icd101 c ON c.code = s.pdx
LEFT JOIN pttype t ON t.pttype = i.pttype
LEFT JOIN ipt_summary_status ss ON ss.ipt_summary_status_id = i.ipt_summary_status_id`;

// จำนวนแถว + CMI + ยอดตาม AdjRW ของทั้งชุดที่ตรงตัวกรอง (ไม่ใช่แค่หน้าปัจจุบัน) CMI = ผลรวม AdjRW / จำนวนรายที่มี AdjRW
// อัตราตามวันจำหน่ายจาก ADJRW_RATES (ส่งเป็น parameter) จำหน่ายก่อนอัตราเก่าสุด CASE ได้ NULL จึงไม่ถูกนับ
const RATE_CASE = `CASE ${ADJRW_RATES.map(() => "WHEN i.dchdate >= ? THEN ?").join(" ")} END`;
const RATE_PARAMS = ADJRW_RATES.flatMap((r) => [r.from, r.rate]);
const COUNT_SELECT = `SELECT COUNT(*) AS total, SUM(i.adjrw) AS adjrw_sum, COUNT(i.adjrw) AS adjrw_n,
       SUM(i.adjrw * ${RATE_CASE}) AS adjrw_amount, COUNT(i.adjrw * ${RATE_CASE}) AS adjrw_amount_n
FROM ipt i LEFT JOIN patient p ON p.hn = i.hn`;
type CountRow = { total: number; adjrw_sum: number | string | null; adjrw_n: number; adjrw_amount: number | string | null; adjrw_amount_n: number };

const REP_SQL = `SELECT DISTINCT ON (r.an)
       r.an, r.rep_no, f.file_date AS rep_date,
       CASE WHEN cardinality(r.error_codes) = 0 THEN 'pass'
            WHEN 'DENY' = ANY(r.error_codes) THEN 'deny'
            ELSE 'c' END AS status,
       CASE WHEN cardinality(r.error_codes) = 0 THEN ARRAY[]::text[]
            WHEN 'DENY' = ANY(r.error_codes)
              THEN ARRAY(SELECT DISTINCT e.v FROM jsonb_each_text(r.deny) AS e(k, v) WHERE e.v <> 'C' ORDER BY e.v)
            ELSE r.error_codes END AS codes
FROM rep_row r
JOIN rep_file f ON f.id = r.rep_file_id
WHERE r.patient_type = 'IP' AND r.an = ANY($1::text[])
ORDER BY r.an, r.tran_id::bigint DESC`;

type XlsxRow = AdmissionRow & Record<"fund_label" | "finance_lock_label" | "rep_label", string>;
const REP_LABEL = { pass: "ผ่าน", c: "ติด C", deny: "Deny" } as const;
const XLSX_COLUMNS: XlsxColumn<XlsxRow>[] = [
  { key: "an", header: "AN", width: 12 },
  { key: "hn", header: "HN", width: 10 },
  { key: "patient_name", header: "ชื่อ-สกุล", width: 28 },
  { key: "fund_label", header: "กองทุน", width: 8 },
  { key: "pttype_name", header: "สิทธิ", width: 28 },
  { key: "auth_code", header: "Authen Code", width: 16 },
  { key: "claim_code", header: "Claim Code", width: 16 },
  { key: "regdate", header: "วันที่ admit", width: 12 },
  { key: "dchdate", header: "วันที่จำหน่าย", width: 12 },
  { key: "dchstts_name", header: "สถานะการจำหน่าย", width: 18 },
  { key: "dch_reason", header: "เหตุผลการจำหน่าย", width: 14 },
  { key: "ward_name", header: "หอผู้ป่วย", width: 20 },
  { key: "los_days", header: "วันนอน", width: 8, type: "count" },
  { key: "days_since_dch", header: "หลังจำหน่าย (วัน)", width: 10, type: "count" },
  { key: "summary_status_name", header: "สรุปชาร์ต", width: 16 },
  { key: "pdx", header: "PDx", width: 8 },
  { key: "pdx_name", header: "ชื่อโรคหลัก", width: 36 },
  { key: "drg", header: "DRG", width: 8 },
  { key: "rw", header: "RW", width: 8 },
  { key: "adjrw", header: "AdjRW", width: 8 },
  { key: "adjrw_amount", header: "ยอดคำนวณเงิน (บาท)", width: 14, type: "money" },
  { key: "finance_lock_label", header: "ปิดสิทธิการเงิน", width: 12 },
  { key: "rep_label", header: "สถานะ REP (UCS)", width: 24 },
  { key: "income", header: "มูลค่า (บาท)", width: 14, type: "money" },
  { key: "uc_money", header: "ลูกหนี้สิทธิ (บาท)", width: 14, type: "money" },
];

/** GET ?start&end[&pttypes=89,77][&wards=01,02] + พารามิเตอร์ DataGrid: admission ที่จำหน่ายในช่วง ไม่ส่ง = ทุกสิทธิ/ทุก ward */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params, IPD_MAX_DAYS);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const rawPttypes = parseCodes(params.get("pttypes"));
  if (rawPttypes === "invalid") return badRequest("pttypes ไม่ถูกต้อง");
  const wards = parseCodes(params.get("wards"));
  if (wards === "invalid") return badRequest("wards ไม่ถูกต้อง");
  const grid = parseGridQuery<SortKey>(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const xlsx = format === "xlsx";

  const lk = await loadLookups();
  // เลือกครบทุกสิทธิที่เปิดใช้ = ไม่กรอง (ชุดเดียวกับตัวเลือกของหน้า)
  const pttypes = effectiveCodes(rawPttypes, activePttypes(lk));
  const like = `%${escapeLike(q)}%`;
  const where = `WHERE i.dchdate BETWEEN ? AND ?${pttypes ? ` AND ${inList("i.pttype", pttypes.length)}` : ""}${wards ? ` AND ${inList("i.ward", wards.length)}` : ""}${q ? ` AND (i.an LIKE ? OR i.hn LIKE ? OR ${FULL_NAME_SQL} LIKE ?)` : ""}`;
  const whereParams = [start, end, ...(pttypes ?? []), ...(wards ?? []), ...(q ? [like, like, like] : [])];
  const order = `${SORT_SQL[sort ?? "dchdate"]} ${(sort ? dir : "desc") === "desc" ? "DESC" : "ASC"}, i.an`;
  const [limit, offset] = xlsx ? [XLSX_MAX, 0] : [pageSize, (page - 1) * pageSize];

  try {
    const [raws, count] = await Promise.all([
      hisQuery<RawAdmission>(`${SELECT}\n${where}\nORDER BY ${order}\nLIMIT ? OFFSET ?`, [todayIso(), ...whereParams, limit, offset]),
      xlsx ? null : hisQuery<CountRow>(`${COUNT_SELECT} ${where}`, [...RATE_PARAMS, ...RATE_PARAMS, ...whereParams]),
    ]);

    const toFund = (pttype: string | null) => fundOf(lk, pttype);
    // REP มีเฉพาะผู้ป่วยใน UCS: ยิงเฉพาะ AN ของแถว UCS
    const ucsAns = raws.filter((r) => toFund(r.pttype) === REP_FUND).map((r) => r.an).filter(Boolean);
    let reps: RawRep[] | undefined = [];
    let repError = false;
    if (ucsAns.length) {
      try {
        reps = await insightQuery<RawRep>(REP_SQL, [ucsAns]);
      } catch (e) {
        console.error("ipd/admissions rep", e);
        reps = undefined;
        repError = true;
      }
    }
    const rows = buildRows(raws, reps, toFund);

    if (xlsx) {
      const out: XlsxRow[] = rows.map((r) => ({
        ...r,
        fund_label: r.fund,
        finance_lock_label: r.finance_lock ? "ปิดแล้ว" : "ยังไม่ปิด",
        rep_label: r.fund !== REP_FUND || repError ? "" : r.rep ? [REP_LABEL[r.rep.status], ...r.rep.codes].join(" ") : "ยังไม่มี REP",
      }));
      return xlsxResponse(`ipd-admissions-${start}_${end}.xlsx`, XLSX_COLUMNS, out);
    }
    const c = count?.[0];
    const adjrwN = Number(c?.adjrw_n ?? 0);
    const body: AdmissionsPage = {
      rows,
      total: Number(c?.total ?? 0),
      adjrw_sum: Number(c?.adjrw_sum ?? 0),
      adjrw_n: adjrwN,
      cmi: adjrwN ? Number(c?.adjrw_sum ?? 0) / adjrwN : null,
      adjrw_amount: Math.round(Number(c?.adjrw_amount ?? 0) * 100) / 100,
      adjrw_amount_n: Number(c?.adjrw_amount_n ?? 0),
      rep_error: repError,
    };
    return Response.json(body);
  } catch (e) {
    console.error("ipd/admissions", e);
    return Response.json({ error: `อ่านข้อมูลไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
