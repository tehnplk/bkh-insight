import type { NextRequest } from "next/server";
import { escapeLike, hisQuery, insightQuery } from "@/lib/db";
import { facetRows, parseColumnFilters, parseGridQuery } from "@/lib/grid-query";
import { columnFilterWhere, loadFacet, type ColumnFilterDefs, type SqlValue } from "@/lib/column-filter-sql";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import {
  FULL_NAME_SQL, activePttypes, fundSql, badRequest, depSql, effectiveCodes, fundOf, inList, isAuthed, fundFilterDef, loadDepartments, loadLookups, parseCodes, parseRange, unauthorized,
  type Lookups,
} from "@/app/api/fund/_lib/fund";
import { CLAIM_JOINS, STATUS_SQL } from "@/app/api/fund/_lib/claim";
import { REP_FILTER_LABEL, latestRepSql, loadRepFilterValues, repLabel } from "@/app/api/fund/_lib/rep";
import { loadSubfunds, subfundText } from "@/app/api/fund/_lib/subfund";
import { subfundFilterLabel, subfundFilterValues } from "@/app/api/admin/ar-funds/rules";
import type { RepCand } from "@/app/api/ipd/admissions/admissions";
import { loadSrmCache } from "@/app/api/opd/right-check/cache";
import { fromCache, srmText } from "@/app/api/opd/right-check/srm";
import { OPD_MAX_DAYS, buildRows, dischargeLabel, type RawOpRep, type RawVisit, type VisitRow, type VisitsPage } from "./admissions";

// key ที่ DataGrid ส่งเป็น sort -> SQL (allowlist จึงต่อเข้า ORDER BY ได้)
const SORT_SQL = {
  vn: "o.vn", hn: "o.hn", vstdate: "o.vstdate", vsttime: "o.vsttime", dep_name: "dep_name", pttype_name: "pttype_name", pdx: "vs.pdx", ovst_status: "os.export_code",
  income: "vs.income", uc_money: "vs.uc_money",
} as const;
type SortKey = keyof typeof SORT_SQL;
const SORTABLE = Object.keys(SORT_SQL) as SortKey[];
// shortcut: Excel ดึงไม่เกินนี้ (ทุกสิทธิ 31 วันราว 18,000 visit) ถ้าเกินจริงให้แบ่งดึงเป็นชุด
const XLSX_MAX = 30_000;

// เลขที่ใบเสร็จ: rcpt_print (index vn) เฉพาะ status OK (ABORT = ยกเลิก) visit จ่ายหลายใบคั่นด้วย ", "
// visit ผู้ป่วยนอก (ไม่ใช่ visit ที่ถูกรับไว้นอน ซึ่งไปอยู่หน้า IPD) PDx/มูลค่าจาก vn_stat ชื่อโรคจาก icd101 (PK)
// authen/เลขปิดสิทธิ/สถานะปิดสิทธิ ใช้หลักเดียวกับ /fund/claim-status (CLAIM_JOINS: c = nhso_confirm_privilege, vp = visit_pttype)
// เลขปิดสิทธิ: OFC = Approval Code จาก EDC ตัวล่าสุด (ตัวท้ายของ ovst_seq.edc_approve_list_text) ไม่ fallback
// สูตรเดียวกับ PERMITNO ของ fdh/files/sql.ts ; สิทธิอื่น = ยืนยันกับ สปสช. แล้ว (ไม่ถูกยกเลิก) หรือ EP
// ใช้ทั้งแสดงผล สถานะ ตัวกรอง unclosed และ facet codes (prove-query ผ่านแล้ว)
const IS_OFC_SQL = `${fundSql("t")} = 'OFC'`;
const APPROVE_CODE_SQL = `NULLIF(SUBSTRING_INDEX(sq.edc_approve_list_text, ',', -1), '')`;
const CLOSE_CODE_SQL = `IF(${IS_OFC_SQL}, ${APPROVE_CODE_SQL},
         COALESCE(IF(c.nhso_status = 'Y' AND c.nhso_cancel_datetime IS NULL, NULLIF(c.nhso_authen_code, ''), NULL),
                  IF(vp.auth_code LIKE 'EP%', vp.auth_code, NULL)))`;
const AUTH_CODE_SQL = `COALESCE(IF(vp.auth_code LIKE 'PP%', vp.auth_code, NULL), (SELECT s2.claim_code FROM nhso_smartcard_agent s2
         WHERE s2.vn = o.vn AND s2.claim_code LIKE 'PP%' ORDER BY s2.nhso_smartcard_agent_id DESC LIMIT 1))`;
const CLAIM_STATUS_SQL = `IF(${IS_OFC_SQL},
         CASE WHEN ${APPROVE_CODE_SQL} IS NOT NULL THEN 'closed' WHEN ${AUTH_CODE_SQL} IS NOT NULL THEN 'authen_only' ELSE 'none' END,
         ${STATUS_SQL})`;
const RCPT_SQL = `(SELECT GROUP_CONCAT(r.rcpno ORDER BY r.finance_number SEPARATOR ', ') FROM rcpt_print r
         WHERE r.vn = o.vn AND r.status = 'OK')`;
const FROM = `FROM ovst o
LEFT JOIN patient p ON p.hn = o.hn
LEFT JOIN vn_stat vs ON vs.vn = o.vn
LEFT JOIN icd101 cd ON cd.code = vs.pdx
LEFT JOIN ovstost os ON os.ovstost = o.ovstost
LEFT JOIN pttype t ON t.pttype = o.pttype
LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
LEFT JOIN ovst_seq sq ON sq.vn = o.vn
${CLAIM_JOINS}`;
const SELECT = `SELECT o.vn, o.hn, ${FULL_NAME_SQL} AS patient_name, o.vstdate, o.vsttime,
       ${depSql("o")} AS dep_code, k.department AS dep_name,
       o.pttype, t.name AS pttype_name, vp.hospmain, vp.hospsub, vs.pdx, cd.name AS pdx_name, os.name AS ovst_status, os.export_code AS ovst_export, vs.income, vs.uc_money,
       ${AUTH_CODE_SQL} AS auth_code,
       ${CLOSE_CODE_SQL} AS close_code,
       ${CLAIM_STATUS_SQL} AS claim_status,
       ${RCPT_SQL} AS rcpt_no
${FROM}`;

// ตัวกรองหัวคอลัมน์: key = id คอลัมน์ของหน้า -> SQL ของค่า (allowlist) และชื่อที่แสดง
// fund/ovst_status เป็นค่าที่คำนวณในโค้ด (pttype -> กองทุน, ovstost -> สถานะการจำหน่าย) จึงกรองผ่านรหัสต้นทาง
const CODES_LABEL: Record<string, string> = {
  YY: "มี Authen และเลขปิดสิทธิ",
  YN: "มี Authen ไม่พบเลขปิดสิทธิ",
  NY: "ไม่พบ Authen มีเลขปิดสิทธิ",
  NN: "ไม่พบ Authen และเลขปิดสิทธิ",
};
/** ตัวกรองหัวคอลัมน์ (allowlist): ค่าที่คำนวณในโค้ดต้องใช้ lookup จึงสร้างต่อ request */
function filterDefs(lk: Lookups, statusOf: Map<string, string>): ColumnFilterDefs {
  return {
    vn: { expr: "o.vn" },
    hn: { expr: "o.hn" },
    patient_name: { expr: FULL_NAME_SQL },
    fund: fundFilterDef(lk, "o.pttype"),
    pttype_name: { expr: "o.pttype", label: "t.name" },
    hospmain: { expr: "vp.hospmain" },
    codes: { expr: `CONCAT(IF(${AUTH_CODE_SQL} IS NULL, 'N', 'Y'), IF(${CLOSE_CODE_SQL} IS NULL, 'N', 'Y'))`, labels: CODES_LABEL },
    vstdate: { expr: "DATE_FORMAT(o.vstdate, '%Y-%m-%d')" },
    vsttime: { expr: "TIME_FORMAT(o.vsttime, '%H:%i')" },
    dep_name: { expr: depSql("o"), label: "k.department" },
    pdx: { expr: "vs.pdx", label: "cd.name" },
    // สถานะการจำหน่ายคำนวณจาก ovstost (export_code + ชื่อ) จึงกรองผ่านรหัส ovstost
    ovst_status: {
      expr: "o.ovstost",
      value: (raw) => (raw && statusOf.get(raw)) || "",
      where: (values, ph, start) => {
        const set = new Set(values);
        const codes = [...statusOf].filter(([, label]) => label && set.has(label)).map(([code]) => code);
        const ors = codes.length ? [`o.ovstost IN (${codes.map((_, i) => ph(start + i)).join(", ")})`] : [];
        if (set.has("")) ors.push("o.ovstost IS NULL OR os.ovstost IS NULL");
        return { sql: ors.length ? `(${ors.join(" OR ")})` : "1 = 0", params: codes };
      },
    },
    rcpt_no: { expr: RCPT_SQL, display: (v) => v.replaceAll(":", "/") },
  };
}
// rep (สถานะ REP) อยู่ insight และ subfund (กองทุนย่อย) คำนวณในโค้ด จึงไม่อยู่ใน filterDefs: route จัดค่าในโค้ดแล้วกรองด้วย VN ที่ตรง
const FILTERABLE = ["vn", "hn", "patient_name", "fund", "hospmain", "pttype_name", "codes", "vstdate", "vsttime", "dep_name", "pdx", "ovst_status", "rcpt_no", "rep", "subfund"] as const;
type FilterKey = (typeof FILTERABLE)[number];

// REP ล่าสุดต่อ VN (seq_no = ovst.vn) ตรวจกับฐานจริงแล้ว: ใช้ rep_row_seq_no_idx, 30,000 VN ราว 0.3 วินาที
const REP_SQL = latestRepSql("seq_no", "vn", "OP");

type XlsxRow = VisitRow & Record<"rep_no" | "rep_label" | "subfund_label" | "srm_right" | "srm_hcode" | "srm_status", string>;
const XLSX_COLUMNS: XlsxColumn<XlsxRow>[] = [
  { key: "vn", header: "VN", width: 14 },
  { key: "hn", header: "HN", width: 10 },
  { key: "patient_name", header: "ชื่อ-สกุล", width: 28 },
  { key: "fund", header: "กองทุน", width: 8 },
  { key: "hospmain", header: "HCODE(HIS)", width: 10 },
  { key: "srm_right", header: "สิทธิ(SRM)", width: 28 },
  { key: "srm_hcode", header: "HCODE(SRM)", width: 12 },
  { key: "srm_status", header: "ผลตรวจสิทธิ", width: 14 },
  { key: "pttype_name", header: "สิทธิ(HIS)", width: 28 },
  { key: "auth_code", header: "Authen", width: 16 },
  { key: "close_code", header: "ปิดสิทธิ/Approval Code", width: 16 },
  { key: "vstdate", header: "วันที่มา", width: 12 },
  { key: "vsttime", header: "เวลา", width: 8 },
  { key: "dep_name", header: "แผนก", width: 22 },
  { key: "pdx", header: "PDx", width: 8 },
  { key: "pdx_name", header: "ชื่อโรคหลัก", width: 36 },
  { key: "ovst_status", header: "สถานะผู้ป่วย", width: 18 },
  { key: "rcpt_no", header: "เลขที่ใบเสร็จ", width: 16 },
  { key: "rep_no", header: "เลขที่ REP", width: 14 },
  { key: "rep_label", header: "สถานะ REP", width: 24 },
  { key: "subfund_label", header: "กองทุนย่อย", width: 36 },
  { key: "income", header: "มูลค่า (บาท)", width: 14, type: "money" },
  { key: "uc_money", header: "ลูกหนี้สิทธิ (บาท)", width: 14, type: "money" },
];

/**
 * GET ?start&end[&pttypes=89,77][&deps=053][&unclosed=1][&cf={...}] + พารามิเตอร์ DataGrid: visit ผู้ป่วยนอกในช่วงวันรับบริการ
 * &facet=<คอลัมน์>[&facetQ=] -> ค่าที่ไม่ซ้ำของคอลัมน์ (ตัวกรองหัวคอลัมน์)
 */
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
  const cf = parseColumnFilters<FilterKey>(params, FILTERABLE);
  if (!cf.ok) return badRequest(cf.error);
  const { filters, facet, facetQ } = cf.query;
  const xlsx = format === "xlsx";

  try {
    const needStatus = !!filters.ovst_status || facet === "ovst_status";
    const [lk, deps, ovstost] = await Promise.all([
      loadLookups(),
      rawDeps ? loadDepartments() : null,
      needStatus ? hisQuery<{ code: string; name: string | null; export_code: string | null }>("SELECT ovstost AS code, name, export_code FROM ovstost") : [],
    ]);
    // เลือกครบทุกค่าที่เปิดใช้ = ไม่กรอง (ชุดเดียวกับตัวเลือกของหน้า)
    const pttypes = effectiveCodes(rawPttypes, activePttypes(lk));
    const depCodes = deps && effectiveCodes(rawDeps, deps.filter((d) => d.active).map((d) => d.code));
    const defs = filterDefs(lk, new Map(ovstost.map((s) => [s.code, dischargeLabel(s.export_code, s.name) ?? ""])));
    const toFund = (pttype: string | null) => fundOf(lk, pttype);
    /** VN ที่สถานะ REP / กองทุนย่อย ตรงตัวกรองหัวคอลัมน์ rep / subfund (null = ไม่กรอง) */
    let repVns: string[] | null = null;
    let subVns: string[] | null = null;

    /** WHERE ตามตัวกรองทั้งหมด ยกเว้นตัวกรองหัวคอลัมน์ของ except (ใช้ตอนหาค่า facet ของคอลัมน์นั้น) */
    const whereFor = (except: FilterKey | null) => {
      const parts = ["o.vstdate BETWEEN ? AND ?", "(o.an IS NULL OR o.an = '')"];
      const args: SqlValue[] = [start, end];
      if (pttypes) {
        parts.push(inList("o.pttype", pttypes.length));
        args.push(...pttypes);
      }
      if (depCodes) {
        parts.push(inList(depSql("o"), depCodes.length));
        args.push(...depCodes);
      }
      if (q) {
        const like = `%${escapeLike(q)}%`;
        parts.push(`(o.vn LIKE ? OR o.hn LIKE ? OR ${FULL_NAME_SQL} LIKE ?)`);
        args.push(like, like, like);
      }
      if (unclosed) parts.push(`${CLOSE_CODE_SQL} IS NULL`);
      for (const [key, vns] of [["rep", repVns], ["subfund", subVns]] as const)
        if (vns && except !== key) {
          parts.push(vns.length ? inList("o.vn", vns.length) : "1 = 0");
          args.push(...vns);
        }
      const cfw = columnFilterWhere(defs, { ...filters, rep: undefined, subfund: undefined }, except);
      return { sql: `WHERE ${[...parts, ...cfw.parts].join("\n  AND ")}`, params: [...args, ...cfw.params] };
    };

    // ตัวกรอง/facet ของ REP และกองทุนย่อย: ไม่ใช้ = ไม่มี query เพิ่ม ; ใช้ = จัดค่าของทุก visit ที่ผ่านตัวกรองอื่น (31 วันราว 18,000 VN)
    // VN ที่ตรงส่งเป็น IN ของ his (MariaDB แปลง IN ยาวเป็นตารางค่าแล้ว eq_ref ด้วย ix_vn_unique ตรวจแล้ว)
    // กองทุนย่อยเกิน 1,000 VN อ่าน opitemrece ตามช่วงวัน (ix_vstdate) ครั้งเดียว ~0.5 วินาที/31 วัน
    // ตัวที่เป็น facet ทำทีหลัง จึงได้ค่าตามตัวกรองอีกตัวด้วย
    const keyFilters = {
      rep: async () => {
        const w = whereFor("rep");
        const vals = await loadRepFilterValues(await hisQuery<RepCand>(`SELECT o.vn AS k, o.pttype ${FROM}\n${w.sql}`, w.params), REP_SQL, "vn", toFund);
        if (facet === "rep") return facetRows(vals, (r) => r.v, facetQ, (v) => REP_FILTER_LABEL[v] ?? v);
        const sel = new Set(filters.rep);
        repVns = vals.filter((r) => sel.has(r.v)).map((r) => r.k);
      },
      subfund: async () => {
        const w = whereFor("subfund");
        const keys = (await hisQuery<{ k: string }>(`SELECT o.vn AS k ${FROM}\n${w.sql}`, w.params)).map((r) => r.k);
        const vals = subfundFilterValues(keys, await loadSubfunds("OP", keys, lk, { range: { start, end } }));
        if (facet === "subfund") return facetRows(vals, (r) => r.v, facetQ, subfundFilterLabel);
        const sel = new Set(filters.subfund);
        subVns = [...new Set(vals.filter((r) => sel.has(r.v)).map((r) => r.k))];
      },
    };
    for (const key of facet === "rep" ? (["subfund", "rep"] as const) : (["rep", "subfund"] as const))
      if (filters[key] || facet === key) {
        const page = await keyFilters[key]();
        if (page) return Response.json(page);
      }
    if (facet) return Response.json(await loadFacet(hisQuery, defs, facet, facetQ, FROM, whereFor(facet)));

    const { sql: where, params: args } = whereFor(null);
    const order = `${SORT_SQL[sort ?? "vstdate"]} ${(sort ? dir : "desc") === "desc" ? "DESC" : "ASC"}, o.vn`;
    const [limit, offset] = xlsx ? [XLSX_MAX, 0] : [pageSize, (page - 1) * pageSize];
    const [raws, count] = await Promise.all([
      hisQuery<RawVisit>(`${SELECT}\n${where}\nORDER BY ${order}\nLIMIT ? OFFSET ?`, [...args, limit, offset]),
      xlsx ? null : hisQuery<{ total: number }>(`SELECT COUNT(*) AS total ${FROM}\n${where}`, args),
    ]);
    // ดู REP ทุก VN ไม่กรองกองทุน ; อ่าน insight ไม่ได้ = ไม่มีสถานะ REP แต่รายการยังแสดง
    const vns = raws.map((r) => r.vn).filter(Boolean);
    let reps: RawOpRep[] | undefined = [];
    let repError = false;
    if (vns.length) {
      try {
        reps = await insightQuery<RawOpRep>(REP_SQL, [vns]);
      } catch (e) {
        console.error("opd/admissions rep", e);
        reps = undefined;
        repError = true;
      }
    }
    // กองทุนย่อย: อ่านไม่ได้ = คอลัมน์ว่าง แต่รายการยังแสดง
    const subfunds = await loadSubfunds("OP", vns, lk, { range: { start, end }, names: !xlsx }).catch((e) => {
      console.error("opd/admissions subfund", e);
      return undefined;
    });
    // ผลตรวจสิทธิ สปสช. ที่บันทึกไว้ไม่เกิน 24 ชั่วโมง: อ่านไม่ได้ = คอลัมน์ว่าง แต่รายการยังแสดง
    const rights = await loadSrmCache(raws.map((r) => r.hn)).catch((e) => {
      console.error("opd/admissions srm", e instanceof Error ? e.message : e);
      return undefined;
    });
    const rows = buildRows(raws, reps, toFund).map((r) => {
      const c = rights?.get(r.hn);
      const his = { vn: r.vn, hn: r.hn, name: r.patient_name, fund: r.fund, pttype_name: r.pttype_name, hospmain: r.hospmain, hospsub: r.hospsub };
      return { ...r, subfunds: subfunds && (subfunds.get(r.vn) ?? []), ...(c && { right: fromCache(his, c) }) };
    });
    if (xlsx) {
      const out: XlsxRow[] = rows.map((r) => ({
        ...r,
        rep_no: r.rep?.rep_no ?? "",
        rep_label: repLabel(r.rep),
        subfund_label: subfundText(r.subfunds),
        ...srmText(r.right),
      }));
      return xlsxResponse(`opd-admissions-${start}_${end}.xlsx`, XLSX_COLUMNS, out);
    }
    const body: VisitsPage = { rows, total: Number(count?.[0]?.total ?? 0), rep_error: repError, subfund_error: !subfunds };
    return Response.json(body);
  } catch (e) {
    console.error("opd/admissions", e);
    return Response.json({ error: `อ่านข้อมูลไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
