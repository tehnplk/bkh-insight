import type { NextRequest } from "next/server";
import { escapeLike, hisQuery } from "@/lib/db";
import { parseGridQuery } from "@/lib/grid-query";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import {
  FULL_NAME_SQL, activePttypes, badRequest, depSql, effectiveCodes, fundOf, inList, isAuthed, loadDepartments, loadLookups, parseCodes, parseRange, unauthorized,
} from "@/app/api/fund/_lib/fund";
import { CLAIM_JOINS, STATUS_SQL } from "@/app/api/fund/_lib/claim";
import { OPD_MAX_DAYS, buildRows, type RawVisit, type VisitRow, type VisitsPage } from "./admissions";

// key ที่ DataGrid ส่งเป็น sort -> SQL (allowlist จึงต่อเข้า ORDER BY ได้)
const SORT_SQL = {
  vn: "o.vn", hn: "o.hn", vstdate: "o.vstdate", vsttime: "o.vsttime", dep_name: "dep_name", pttype_name: "pttype_name", pdx: "vs.pdx",
  income: "vs.income", uc_money: "vs.uc_money",
} as const;
type SortKey = keyof typeof SORT_SQL;
const SORTABLE = Object.keys(SORT_SQL) as SortKey[];
// shortcut: Excel ดึงไม่เกินนี้ (ทุกสิทธิ 31 วันราว 18,000 visit) ถ้าเกินจริงให้แบ่งดึงเป็นชุด
const XLSX_MAX = 30_000;

// เลขที่ใบเสร็จ: rcpt_print (index vn) เฉพาะ status OK (ABORT = ยกเลิก) visit จ่ายหลายใบคั่นด้วย ", "
// visit ผู้ป่วยนอก (ไม่ใช่ visit ที่ถูกรับไว้นอน ซึ่งไปอยู่หน้า IPD) PDx/มูลค่าจาก vn_stat ชื่อโรคจาก icd101 (PK)
// authen/เลขปิดสิทธิ/สถานะปิดสิทธิ ใช้หลักเดียวกับ /fund/claim-status (CLAIM_JOINS: c = nhso_confirm_privilege, vp = visit_pttype)
// เลขปิดสิทธิ: ยืนยันกับ สปสช. แล้ว (ไม่ถูกยกเลิก) หรือ EP ; ใช้ทั้งแสดงผลและตัวกรอง unclosed
const CLOSE_CODE_SQL = `COALESCE(IF(c.nhso_status = 'Y' AND c.nhso_cancel_datetime IS NULL, NULLIF(c.nhso_authen_code, ''), NULL),
         IF(vp.auth_code LIKE 'EP%', vp.auth_code, NULL))`;
const SELECT = `SELECT o.vn, o.hn, ${FULL_NAME_SQL} AS patient_name, o.vstdate, o.vsttime,
       ${depSql("o")} AS dep_code, k.department AS dep_name,
       o.pttype, t.name AS pttype_name, vs.pdx, cd.name AS pdx_name, vs.income, vs.uc_money,
       COALESCE(IF(vp.auth_code LIKE 'PP%', vp.auth_code, NULL), (SELECT s2.claim_code FROM nhso_smartcard_agent s2
         WHERE s2.vn = o.vn AND s2.claim_code LIKE 'PP%' ORDER BY s2.nhso_smartcard_agent_id DESC LIMIT 1)) AS auth_code,
       ${CLOSE_CODE_SQL} AS close_code,
       ${STATUS_SQL} AS claim_status,
       (SELECT GROUP_CONCAT(r.rcpno ORDER BY r.finance_number SEPARATOR ', ') FROM rcpt_print r
         WHERE r.vn = o.vn AND r.status = 'OK') AS rcpt_no
FROM ovst o
LEFT JOIN patient p ON p.hn = o.hn
LEFT JOIN vn_stat vs ON vs.vn = o.vn
LEFT JOIN icd101 cd ON cd.code = vs.pdx
LEFT JOIN pttype t ON t.pttype = o.pttype
LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
${CLAIM_JOINS}`;


const XLSX_COLUMNS: XlsxColumn<VisitRow>[] = [
  { key: "vn", header: "VN", width: 14 },
  { key: "hn", header: "HN", width: 10 },
  { key: "patient_name", header: "ชื่อ-สกุล", width: 28 },
  { key: "fund", header: "กองทุน", width: 8 },
  { key: "pttype_name", header: "สิทธิ", width: 28 },
  { key: "auth_code", header: "Authen", width: 16 },
  { key: "close_code", header: "ปิดสิทธิ", width: 16 },
  { key: "vstdate", header: "วันที่มา", width: 12 },
  { key: "vsttime", header: "เวลา", width: 8 },
  { key: "dep_name", header: "แผนก", width: 22 },
  { key: "pdx", header: "PDx", width: 8 },
  { key: "pdx_name", header: "ชื่อโรคหลัก", width: 36 },
  { key: "rcpt_no", header: "เลขที่ใบเสร็จ", width: 16 },
  { key: "income", header: "มูลค่า (บาท)", width: 14, type: "money" },
  { key: "uc_money", header: "ลูกหนี้สิทธิ (บาท)", width: 14, type: "money" },
];

/** GET ?start&end[&pttypes=89,77][&deps=053][&unclosed=1] + พารามิเตอร์ DataGrid: visit ผู้ป่วยนอกในช่วงวันรับบริการ ไม่ส่ง = ทุกสิทธิ/ทุกแผนก */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params, OPD_MAX_DAYS);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const rawPttypes = parseCodes(params.get("pttypes"));
  if (rawPttypes === "invalid") return badRequest("pttypes ไม่ถูกต้อง");
  const rawDeps = parseCodes(params.get("deps"));
  if (rawDeps === "invalid") return badRequest("deps ไม่ถูกต้อง");
  // unclosed=1: เฉพาะ visit ที่ยังไม่มีเลขปิดสิทธิ (ช่อง "ไม่พบเลขปิดสิทธิ")
  const unclosed = params.get("unclosed") === "1";
  const grid = parseGridQuery<SortKey>(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const xlsx = format === "xlsx";

  const [lk, deps] = await Promise.all([loadLookups(), rawDeps ? loadDepartments() : null]);
  // เลือกครบทุกค่าที่เปิดใช้ = ไม่กรอง (ชุดเดียวกับตัวเลือกของหน้า)
  const pttypes = effectiveCodes(rawPttypes, activePttypes(lk));
  const depCodes = deps && effectiveCodes(rawDeps, deps.filter((d) => d.active).map((d) => d.code));
  const like = `%${escapeLike(q)}%`;
  const where = `WHERE o.vstdate BETWEEN ? AND ? AND (o.an IS NULL OR o.an = '')${pttypes ? ` AND ${inList("o.pttype", pttypes.length)}` : ""}${depCodes ? ` AND ${inList(depSql("o"), depCodes.length)}` : ""}${q ? ` AND (o.vn LIKE ? OR o.hn LIKE ? OR ${FULL_NAME_SQL} LIKE ?)` : ""}${unclosed ? ` AND ${CLOSE_CODE_SQL} IS NULL` : ""}`;
  const whereParams = [start, end, ...(pttypes ?? []), ...(depCodes ?? []), ...(q ? [like, like, like] : [])];
  const order = `${SORT_SQL[sort ?? "vstdate"]} ${(sort ? dir : "desc") === "desc" ? "DESC" : "ASC"}, o.vn`;
  const [limit, offset] = xlsx ? [XLSX_MAX, 0] : [pageSize, (page - 1) * pageSize];

  try {
    const [raws, count] = await Promise.all([
      hisQuery<RawVisit>(`${SELECT}\n${where}\nORDER BY ${order}\nLIMIT ? OFFSET ?`, [...whereParams, limit, offset]),
      xlsx ? null : hisQuery<{ total: number }>(`SELECT COUNT(*) AS total FROM ovst o LEFT JOIN patient p ON p.hn = o.hn ${unclosed ? CLAIM_JOINS : ""} ${where}`, whereParams),
    ]);
    const rows = buildRows(raws, (pttype) => fundOf(lk, pttype));
    if (xlsx) {
      return xlsxResponse(`opd-admissions-${start}_${end}.xlsx`, XLSX_COLUMNS, rows);
    }
    const body: VisitsPage = { rows, total: Number(count?.[0]?.total ?? 0) };
    return Response.json(body);
  } catch (e) {
    console.error("opd/admissions", e);
    return Response.json({ error: `อ่านข้อมูลไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
