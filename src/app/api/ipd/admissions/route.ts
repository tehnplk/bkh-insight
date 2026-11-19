import type { NextRequest } from "next/server";
import { escapeLike, hisQuery, insightQuery } from "@/lib/db";
import { facetRows, parseColumnFilters, parseGridQuery } from "@/lib/grid-query";
import { columnFilterWhere, loadFacet, type ColumnFilterDefs, type SqlValue } from "@/lib/column-filter-sql";
import { todayIso } from "@/lib/thai-date";
import { dxGroupSql, parseDx } from "@/lib/dx-groups";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import {
  FULL_NAME_SQL, activePttypes, badRequest, effectiveCodes, fundFilterDef, fundOf, inList, isAuthed, loadLookups, parseCodes, parseRange, unauthorized,
  type Lookups,
} from "@/app/api/fund/_lib/fund";
import { REP_FILTER_LABEL, latestRepSql, loadRepFilterValues, repLabel } from "@/app/api/fund/_lib/rep";
import { loadSubfunds, subfundText } from "@/app/api/fund/_lib/subfund";
import { subfundFilterLabel, subfundFilterValues } from "@/app/api/admin/ar-funds/rules";
import { CLAIM_LABEL, claimCounts, claimText } from "@/app/api/fdh/claim-batch/claim";
import { loadClaims, type ClaimCand } from "@/app/api/fdh/claim-batch/load";
import { ADJRW_RATES, IPD_MAX_DAYS, buildRows, type AdmissionRow, type AdmissionsPage, type RawAdmission, type RawRep, type RepCand } from "./admissions";

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
const FROM = `FROM ipt i
LEFT JOIN patient p ON p.hn = i.hn
LEFT JOIN ward w ON w.ward = i.ward
LEFT JOIN dchstts d ON d.dchstts = i.dchstts
LEFT JOIN dchtype dt ON dt.dchtype = i.dchtype
LEFT JOIN an_stat s ON s.an = i.an
LEFT JOIN icd101 c ON c.code = s.pdx
LEFT JOIN pttype t ON t.pttype = i.pttype
LEFT JOIN ipt_summary_status ss ON ss.ipt_summary_status_id = i.ipt_summary_status_id`;
const AUTH_SQL = "(SELECT NULLIF(TRIM(vp.auth_code), '') FROM visit_pttype vp WHERE vp.vn = i.vn ORDER BY vp.pttype = i.pttype DESC, vp.pttype LIMIT 1)";
const CLAIM_SQL = "(SELECT NULLIF(TRIM(ip.claim_code), '') FROM ipt_pttype ip WHERE ip.an = i.an ORDER BY ip.ipt_pttype_id LIMIT 1)";
const SELECT = `SELECT i.an, i.hn,
       ${FULL_NAME_SQL} AS patient_name,
       i.regdate, i.dchdate, i.dchstts, d.name AS dchstts_name, i.dchtype, COALESCE(dt.name, i.dchtype) AS dch_reason, i.ward, w.name AS ward_name,
       DATEDIFF(i.dchdate, i.regdate) AS los_days,
       s.income, s.uc_money,
       i.pttype, t.name AS pttype_name,
       ${AUTH_SQL} AS auth_code,
       ${CLAIM_SQL} AS claim_code,
       i.finance_lock, i.ipt_summary_status_id, ss.ipt_summary_status_name AS summary_status_name,
       s.pdx, c.name AS pdx_name,
       i.drg, i.rw, i.adjrw,
       DATEDIFF(CAST(? AS DATE), i.dchdate) AS days_since_dch
${FROM}`;

// จำนวนแถว + CMI + ยอดตาม AdjRW ของทั้งชุดที่ตรงตัวกรอง (ไม่ใช่แค่หน้าปัจจุบัน) CMI = ผลรวม AdjRW / จำนวนรายที่มี AdjRW
// อัตราตามวันจำหน่ายจาก ADJRW_RATES (ส่งเป็น parameter) จำหน่ายก่อนอัตราเก่าสุด CASE ได้ NULL จึงไม่ถูกนับ
const RATE_CASE = `CASE ${ADJRW_RATES.map(() => "WHEN i.dchdate >= ? THEN ?").join(" ")} END`;
const RATE_PARAMS = ADJRW_RATES.flatMap((r) => [r.from, r.rate]);
const COUNT_SELECT = `SELECT COUNT(*) AS total, SUM(i.adjrw) AS adjrw_sum, COUNT(i.adjrw) AS adjrw_n,
       SUM(i.adjrw * ${RATE_CASE}) AS adjrw_amount, COUNT(i.adjrw * ${RATE_CASE}) AS adjrw_amount_n,
       SUM(s.pdx IS NULL OR s.pdx = '') AS no_pdx
${FROM}`;
type CountRow = { total: number; adjrw_sum: number | string | null; adjrw_n: number; adjrw_amount: number | string | null; adjrw_amount_n: number; no_pdx: number | string | null };

const REP_SQL = latestRepSql("an", "an", "IP");
// "เรียกเก็บแล้ว" = AN ที่มี REP IP อย่างน้อยหนึ่งแถว (ทุกสถานะ เท่ากับผ่าน + ติด C + Deny ของตัวกรอง rep) ; 90 วัน ~2,400 AN ใช้ rep_row_an_idx ~12 ms
const REP_SENT_SQL = "SELECT COUNT(DISTINCT an)::int AS n FROM rep_row WHERE patient_type = 'IP' AND an = ANY($1::text[])";

// ตัวกรองหัวคอลัมน์ (allowlist) ; RW/AdjRW/เงินเป็นตัวเลขต่อเนื่อง จึงไม่มีตัวกรอง
// rep (สถานะ REP) อยู่ insight และ subfund (กองทุนย่อย) คำนวณในโค้ด จึงไม่อยู่ใน filterDefs: route จัดค่าในโค้ดแล้วกรองด้วย AN ที่ตรง
const CODES_LABEL: Record<string, string> = {
  YY: "มี Authen และ Claim Code",
  YN: "มี Authen ไม่มี Claim Code",
  NY: "ไม่มี Authen มี Claim Code",
  NN: "ไม่มี Authen และ Claim Code",
};
function filterDefs(lk: Lookups): ColumnFilterDefs {
  return {
    an: { expr: "i.an" },
    hn: { expr: "i.hn" },
    patient_name: { expr: FULL_NAME_SQL },
    fund: fundFilterDef(lk, "i.pttype"),
    pttype_name: { expr: "i.pttype", label: "t.name" },
    codes: { expr: `CONCAT(IF(${AUTH_SQL} IS NULL, 'N', 'Y'), IF(${CLAIM_SQL} IS NULL, 'N', 'Y'))`, labels: CODES_LABEL },
    regdate: { expr: "DATE_FORMAT(i.regdate, '%Y-%m-%d')" },
    dchdate: { expr: "DATE_FORMAT(i.dchdate, '%Y-%m-%d')" },
    dchstts_name: { expr: "i.dchstts", label: "d.name" },
    dch_reason: { expr: "i.dchtype", label: "dt.name" },
    ward_name: { expr: "i.ward", label: "w.name" },
    los_days: { expr: "DATEDIFF(i.dchdate, i.regdate)" },
    // server ฐานเป็นเวลาไทย (+07) CURDATE() จึงตรงกับวันนี้ที่ใช้ในรายการ
    days_since_dch: { expr: "DATEDIFF(CURDATE(), i.dchdate)" },
    ipt_summary_status_id: { expr: "i.ipt_summary_status_id", label: "ss.ipt_summary_status_name" },
    pdx: { expr: "s.pdx", label: "c.name" },
    drg: { expr: "i.drg" },
    finance_lock: { expr: "IF(i.finance_lock = 'Y', 'Y', 'N')", labels: { Y: "ปิดแล้ว", N: "ยังไม่ปิด" } },
  };
}
const FILTERABLE = [
  "an", "hn", "patient_name", "fund", "pttype_name", "codes", "regdate", "dchdate", "dchstts_name", "dch_reason", "ward_name",
  "los_days", "days_since_dch", "ipt_summary_status_id", "pdx", "drg", "finance_lock", "rep", "subfund", "claim",
] as const;
type FilterKey = (typeof FILTERABLE)[number];
/** ตัวกรองที่จัดค่าในโค้ดแล้วกรองด้วย AN ที่ตรง (ไม่อยู่ใน filterDefs) */
const KEY_FILTERS = ["rep", "subfund", "claim"] as const;
const KEY_LABEL = { rep: "สถานะ REP", subfund: "กองทุนย่อย", claim: "สถานะเคลม" } as const;

/** ผู้สมัครของสถานะเคลม: IP ปิดสิทธิแล้ว = ปิดสิทธิการเงิน (finance_lock) ; fdh_claim_status ไม่ใช้กับผู้ป่วยใน */
type ClaimRaw = { k: string; pttype: string | null; dchdate: string | null; uc_money: number | string | null; finance_lock: string | null };
const CLAIM_CAND_SQL = "SELECT i.an AS k, i.pttype, i.dchdate, s.uc_money, i.finance_lock";
const claimCand = (r: ClaimRaw, fund: string): ClaimCand => ({
  k: r.k, fund, date: r.dchdate, amount: Number(r.uc_money ?? 0), closed: r.finance_lock === "Y",
});

type XlsxRow = AdmissionRow & Record<"fund_label" | "finance_lock_label" | "claim_label" | "rep_no" | "rep_label" | "subfund_label", string>;
const XLSX_COLUMNS: XlsxColumn<XlsxRow>[] = [
  { key: "an", header: "AN", width: 12 },
  { key: "hn", header: "HN", width: 10 },
  { key: "patient_name", header: "ชื่อ-สกุล", width: 28 },
  { key: "ward_name", header: "Ward", width: 20 },
  { key: "fund_label", header: "กองทุน", width: 8 },
  { key: "pttype_name", header: "สิทธิ", width: 28 },
  { key: "auth_code", header: "Authen Code", width: 16 },
  { key: "claim_code", header: "Claim Code", width: 16 },
  { key: "regdate", header: "วันที่ admit", width: 12 },
  { key: "dchdate", header: "วันที่จำหน่าย", width: 12 },
  { key: "dchstts_name", header: "สถานะการจำหน่าย", width: 18 },
  { key: "dch_reason", header: "เหตุผลการจำหน่าย", width: 14 },
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
  { key: "claim_label", header: "สถานะเคลม", width: 30 },
  { key: "rep_no", header: "เลขที่ REP", width: 14 },
  { key: "rep_label", header: "สถานะ REP", width: 24 },
  { key: "subfund_label", header: "กองทุนย่อย", width: 36 },
  { key: "income", header: "มูลค่า (บาท)", width: 14, type: "money" },
  { key: "uc_money", header: "ลูกหนี้สิทธิ (บาท)", width: 14, type: "money" },
];

/** GET ?start&end[&pttypes=89,77][&wards=01,02][&dx=malnutrition[&dxpos=pdx|sdx]] + พารามิเตอร์ DataGrid: admission ที่จำหน่ายในช่วง ไม่ส่ง = ทุกสิทธิ/ทุก ward/ทุกโรค */
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
  const dxSel = parseDx(params.get("dx"), params.get("dxpos"));
  if (dxSel === "invalid") return badRequest("dx หรือ dxpos ไม่ถูกต้อง");
  // มีรหัสในกลุ่มที่เลือก (OR ข้ามกลุ่ม) ตามตำแหน่งรหัส ; alias dg เพราะ d ใช้กับ dchstts ใน FROM
  const dx = dxSel && dxGroupSql({ icd10: "dg.icd10", diagtype: "dg.diagtype" }, dxSel.keys, dxSel.pos);
  const grid = parseGridQuery<SortKey>(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters<FilterKey>(params, FILTERABLE);
  if (!cf.ok) return badRequest(cf.error);
  const { filters, facet, facetQ } = cf.query;
  const xlsx = format === "xlsx";

  const lk = await loadLookups();
  // เลือกครบทุกสิทธิที่เปิดใช้ = ไม่กรอง (ชุดเดียวกับตัวเลือกของหน้า)
  const pttypes = effectiveCodes(rawPttypes, activePttypes(lk));
  const defs = filterDefs(lk);
  const toFund = (pttype: string | null) => fundOf(lk, pttype);
  /** AN ที่สถานะ REP / กองทุนย่อย ตรงตัวกรองหัวคอลัมน์ rep / subfund (null = ไม่กรอง) */
  let repAns: string[] | null = null;
  let subAns: string[] | null = null;
  let claimAns: string[] | null = null;
  /** ค่าตัวกรอง claim ของทุก AN ที่ผ่านตัวกรองอื่น ใช้ทั้งตัวกรองและจำนวนในแถบสรุป */
  const claimVals: { vals: { k: string; v: string }[] | null } = { vals: null };
  /** WHERE ตามตัวกรองทั้งหมด ยกเว้นตัวกรองหัวคอลัมน์ของ except (ใช้ตอนหาค่า facet) */
  const whereFor = (except: FilterKey | null) => {
    const like = `%${escapeLike(q)}%`;
    const base = `WHERE i.dchdate BETWEEN ? AND ?${pttypes ? ` AND ${inList("i.pttype", pttypes.length)}` : ""}${wards ? ` AND ${inList("i.ward", wards.length)}` : ""}${dx ? ` AND EXISTS (SELECT 1 FROM iptdiag dg WHERE dg.an = i.an AND ${dx.sql})` : ""}${q ? ` AND (i.an LIKE ? OR i.hn LIKE ? OR ${FULL_NAME_SQL} LIKE ?)` : ""}`;
    const lists = ([["rep", repAns], ["subfund", subAns], ["claim", claimAns]] as const).filter(([k, v]) => v && except !== k).map(([, v]) => v as string[]);
    const cfw = columnFilterWhere(defs, { ...filters, rep: undefined, subfund: undefined, claim: undefined }, except);
    const parts = [...lists.map((l) => (l.length ? inList("i.an", l.length) : "1 = 0")), ...cfw.parts];
    const params: SqlValue[] = [start, end, ...(pttypes ?? []), ...(wards ?? []), ...(dx?.params ?? []), ...(q ? [like, like, like] : []), ...lists.flat(), ...cfw.params];
    return { sql: parts.length ? `${base}\n  AND ${parts.join("\n  AND ")}` : base, params };
  };
  // ตัวกรอง/facet ของ REP และกองทุนย่อย: ไม่ใช้ = ไม่มี query เพิ่ม ; ใช้ = จัดค่าของทุก AN ที่ผ่านตัวกรองอื่น (90 วันราว 2,400 AN)
  // กองทุนย่อยอ่าน opitemrece ตาม AN (ix_an) ชุดละ 1,000 ; ตัวที่เป็น facet ทำทีหลัง จึงได้ค่าตามตัวกรองอีกตัวด้วย
  const keyFilters = {
    rep: async () => {
      const w = whereFor("rep");
      const vals = await loadRepFilterValues(await hisQuery<RepCand>(`SELECT i.an AS k, i.pttype ${FROM}\n${w.sql}`, w.params), REP_SQL, "an", toFund);
      if (facet === "rep") return facetRows(vals, (r) => r.v, facetQ, (v) => REP_FILTER_LABEL[v] ?? v);
      const sel = new Set(filters.rep);
      repAns = vals.filter((r) => sel.has(r.v)).map((r) => r.k);
    },
    subfund: async () => {
      const w = whereFor("subfund");
      const keys = (await hisQuery<{ k: string }>(`SELECT i.an AS k ${FROM}\n${w.sql}`, w.params)).map((r) => r.k);
      const vals = subfundFilterValues(keys, await loadSubfunds("IP", keys, lk));
      if (facet === "subfund") return facetRows(vals, (r) => r.v, facetQ, subfundFilterLabel);
      const sel = new Set(filters.subfund);
      subAns = [...new Set(vals.filter((r) => sel.has(r.v)).map((r) => r.k))];
    },
    claim: async () => {
      const vals = await loadClaimVals();
      if (facet === "claim") return facetRows(vals, (r) => r.v, facetQ, (v) => CLAIM_LABEL[v as keyof typeof CLAIM_LABEL] ?? v);
      const sel = new Set(filters.claim);
      claimAns = vals.filter((r) => sel.has(r.v)).map((r) => r.k);
    },
  };
  /** สถานะเคลมของทุก AN ที่ผ่านตัวกรองอื่น (90 วันราว 2,400 AN) */
  const loadClaimVals = async () => {
    const w = whereFor("claim");
    const cands = await hisQuery<ClaimRaw>(`${CLAIM_CAND_SQL} ${FROM}\n${w.sql}`, w.params);
    const claims = await loadClaims("IP", cands.map((c) => claimCand(c, toFund(c.pttype))), REP_SQL, "an");
    return (claimVals.vals = cands.map((c) => ({ k: c.k, v: claims.get(c.k)?.status ?? "" })));
  };
  // ตัวที่เป็น facet ทำทีหลังสุด จึงได้ค่าตามตัวกรองตัวอื่นด้วย
  for (const key of [...KEY_FILTERS.filter((k) => k !== facet), ...KEY_FILTERS.filter((k) => k === facet)])
    if (filters[key] || facet === key) {
      try {
        const page = await keyFilters[key]();
        if (page) return Response.json(page);
      } catch (e) {
        console.error(`ipd/admissions ${key} filter`, e);
        return Response.json({ error: `อ่าน${KEY_LABEL[key]}ไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
      }
    }
  if (facet) {
    try {
      return Response.json(await loadFacet(hisQuery, defs, facet, facetQ, FROM, whereFor(facet)));
    } catch (e) {
      console.error("ipd/admissions facet", e);
      return Response.json({ error: `อ่านรายการไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
    }
  }
  const { sql: where, params: whereParams } = whereFor(null);
  const order = `${SORT_SQL[sort ?? "dchdate"]} ${(sort ? dir : "desc") === "desc" ? "DESC" : "ASC"}, i.an`;
  const [limit, offset] = xlsx ? [XLSX_MAX, 0] : [pageSize, (page - 1) * pageSize];

  // ทั้งชุดที่ตรงตัวกรอง (ไม่ใช่แค่หน้านี้) ; อ่านไม่ได้ = null แสดง "–" ไม่ทำให้หน้าล้ม
  const repSent = xlsx
    ? null
    : hisQuery<{ k: string }>(`SELECT i.an AS k ${FROM}\n${where}`, whereParams)
        .then(async (keys) => (keys.length ? (await insightQuery<{ n: number }>(REP_SENT_SQL, [keys.map((r) => r.k)]))[0].n : 0))
        .catch((e) => {
          console.error("ipd/admissions rep_sent", e);
          return null;
        });
  // ปุ่ม "ยังไม่ส่ง"/"เกินกำหนด" นับทั้งชุดที่ตรงตัวกรองอื่น (ใช้ผลของตัวกรอง claim ถ้าคำนวณแล้ว) ; อ่านไม่ได้ = null
  const claimCount = xlsx
    ? null
    : (claimVals.vals ? Promise.resolve(claimVals.vals) : loadClaimVals()).then(claimCounts).catch((e) => {
        console.error("ipd/admissions claim_counts", e);
        return null;
      });
  try {
    const [raws, count] = await Promise.all([
      hisQuery<RawAdmission>(`${SELECT}\n${where}\nORDER BY ${order}\nLIMIT ? OFFSET ?`, [todayIso(), ...whereParams, limit, offset]),
      xlsx ? null : hisQuery<CountRow>(`${COUNT_SELECT} ${where}`, [...RATE_PARAMS, ...RATE_PARAMS, ...whereParams]),
    ]);

    // ดู REP ทุก AN ไม่กรองกองทุน (กองทุนอื่นนำเข้า REP ภายหลังได้)
    const ans = raws.map((r) => r.an).filter(Boolean);
    let reps: RawRep[] | undefined = [];
    let repError = false;
    if (ans.length) {
      try {
        reps = await insightQuery<RawRep>(REP_SQL, [ans]);
      } catch (e) {
        console.error("ipd/admissions rep", e);
        reps = undefined;
        repError = true;
      }
    }
    // กองทุนย่อย: อ่านไม่ได้ = คอลัมน์ว่าง แต่รายการยังแสดง
    const subfunds = await loadSubfunds("IP", ans, lk, { names: !xlsx }).catch((e) => {
      console.error("ipd/admissions subfund", e);
      return undefined;
    });
    const built = buildRows(raws, reps, toFund);
    // สถานะเคลม: ใช้ REP ที่โหลดแล้ว ; อ่าน insight ไม่ได้ = คอลัมน์ว่าง แต่รายการยังแสดง
    const claims = await loadClaims(
      "IP", raws.map((r, i) => claimCand({ ...r, k: r.an }, built[i].fund)), REP_SQL, "an",
      // REP โหลดไม่ได้ = ให้ loadClaims อ่านเอง (ไม่งั้นรายที่มี REP จะขึ้นยังไม่ส่ง)
      reps && new Map(built.flatMap((r) => (r.rep ? [[r.an, r.rep] as const] : []))),
    ).catch((e) => {
      console.error("ipd/admissions claim", e);
      return undefined;
    });
    const rows = built.map((r) => {
      const claim = claims?.get(r.an);
      return { ...r, subfunds: subfunds && (subfunds.get(r.an) ?? []), ...(claim && { claim }) };
    });

    if (xlsx) {
      const out: XlsxRow[] = rows.map((r) => ({
        ...r,
        fund_label: r.fund,
        finance_lock_label: r.finance_lock ? "ปิดแล้ว" : "ยังไม่ปิด",
        claim_label: claimText(r.claim),
        rep_no: r.rep?.rep_no ?? "",
        rep_label: repLabel(r.rep),
        subfund_label: subfundText(r.subfunds),
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
      no_pdx: Number(c?.no_pdx ?? 0),
      rep_sent: await repSent,
      rep_error: repError,
      subfund_error: !subfunds,
      claim_error: !claims,
      claim_counts: await claimCount,
    };
    return Response.json(body);
  } catch (e) {
    console.error("ipd/admissions", e);
    return Response.json({ error: `อ่านข้อมูลไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
