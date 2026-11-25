// IP แยกรายสิทธิ: ชนิดข้อมูลและการรวมผล his (admission) กับ insight (REP) แบบ pure
// ไม่มี import ค่า จึงใช้ได้ทั้ง route, หน้า (client) และ admissions.test.mjs
import type { GridPage } from "@/lib/grid-query";
import type { SubFund } from "@/app/api/admin/ar-funds/rules";
import type { ClaimCounts, ClaimInfo } from "@/app/api/fdh/claim-batch/claim";

/** กองทุนที่เบิกผ่าน REP e-Claim: ไม่พบ REP = "ยังไม่มี REP" ; กองทุนอื่นแสดงเฉพาะเมื่อพบ REP */
export const REP_FUND = "UCS";
/** หลังจำหน่ายเกินจำนวนวันนี้และยังไม่มี REP = ตัวชี้ให้ตาม ไม่ได้แปลว่าผิด */
export const OVERDUE_DAYS = 30;
/** PDx ว่างหลังจำหน่ายไม่เกินจำนวนวันนี้ยังอยู่ในช่วงสรุปชาร์ต เกินแล้ว = ขาด */
export const PDX_SUMMARY_DAYS = 7;
/** PDx ว่าง: "pending" = จำหน่ายแล้ว 0–7 วัน (รอสรุป), "late" = เกิน 7 วันหรือไม่มีวันจำหน่าย (ขาด) */
export const pdxMissing = (daysSinceDch: number | null) =>
  daysSinceDch != null && daysSinceDch <= PDX_SUMMARY_DAYS ? "pending" : "late";

/** สิทธิ UC (pttype.hipdata_code) ที่คิดยอดตาม AdjRW ; สิทธิอื่นไม่คิดยอด */
export const UC_HIPDATA = ["UCS", "WEL", "DIS"] as const;
/**
 * อัตราบาทต่อ AdjRW ของสิทธิ UC ตามวันจำหน่าย (เกณฑ์จังหวัด ผู้ใช้อนุมัติ 25 พ.ย. 2569) เรียงจากใหม่ไปเก่า ใช้ตัวแรกที่ dchdate >= from
 * outProvince = hospmain ของ ipt_pttype แถวแรกอยู่ต่างจังหวัด (ไม่มี/ไม่พบใน hospcode = normal) ; จำหน่ายก่อนอัตราเก่าสุด = ไม่มีอัตรา
 * แหล่งเดียวของทั้ง rateFor (รายแถว) และ rateCase (ยอดรวมใน SQL)
 */
export const ADJRW_RATES = [
  { from: "2026-09-16", normal: 5100, outProvince: 9680 },
  { from: "2025-10-01", normal: 3505.14, outProvince: 9600 },
] as const;

export const isUcFund = (fund: string) => (UC_HIPDATA as readonly string[]).includes(fund);

export function rateFor(dchdate: string | null, isUc: boolean, outProv: boolean) {
  if (!dchdate || !isUc) return null;
  const r = ADJRW_RATES.find((x) => dchdate.slice(0, 10) >= x.from);
  return r ? (outProv ? r.outProvince : r.normal) : null;
}

/** CASE อัตราของ SQL จาก UC_HIPDATA/ADJRW_RATES (params เรียงตาม ? ใน sql) ; outProv = expr 0/1 ; สิทธิอื่น/ไม่มีอัตรา = NULL */
export function rateCase(outProv: string) {
  return {
    sql: `CASE WHEN t.hipdata_code IN (${UC_HIPDATA.map(() => "?").join(", ")}) THEN
  CASE ${ADJRW_RATES.map(() => `WHEN i.dchdate >= ? THEN IF(${outProv}, ?, ?)`).join(" ")} END
END`,
    params: [...UC_HIPDATA, ...ADJRW_RATES.flatMap((r) => [r.from, r.outProvince, r.normal])],
  };
}

/** แถวจาก SQL รายการ (his) ตัวเลข DECIMAL อาจมาเป็น string */
export type RawAdmission = {
  an: string;
  hn: string;
  patient_name: string | null;
  /** patient.sex '1' ชาย '2' หญิง ; age_* อายุ ณ วัน admit (ไม่มีวันเกิด = null) */
  sex: string | null;
  age_y: number | null;
  age_m: number | null;
  age_d: number | null;
  regdate: string | null;
  dchdate: string | null;
  dchstts: string | null;
  dchstts_name: string | null;
  dchtype: string | null;
  dch_reason: string | null;
  ward: string | null;
  ward_name: string | null;
  los_days: number | string | null;
  income: number | string | null;
  uc_money: number | string | null;
  pttype: string | null;
  pttype_name: string | null;
  auth_code: string | null;
  claim_code: string | null;
  finance_lock: string | null;
  ipt_summary_status_id: number | string | null;
  summary_status_name: string | null;
  pdx: string | null;
  pdx_name: string | null;
  drg: string | null;
  rw: number | string | null;
  adjrw: number | string | null;
  /** 1 = hospmain ของ ipt_pttype แถวแรกอยู่ต่างจังหวัด */
  out_prov: number | string | null;
  days_since_dch: number | string | null;
};

export type RepStatus = "pass" | "c" | "deny";
/** แถวจาก SQL REP (insight) */
export type RawRep = { an: string; rep_no: string | null; rep_date: string | null; status: RepStatus; codes: string[] };
/** REP ล่าสุดของแถว (ใช้ทั้ง OPD และ IPD) */
export type RepInfo = Omit<RawRep, "an">;

export type AdmissionRow = {
  an: string;
  hn: string;
  patient_name: string;
  /** เพศ + อายุ ณ วัน admit เช่น "ชาย 25ปี 10ด 15ว" ; route เติมด้วย sexAgeText เพราะไฟล์นี้ import ค่าไม่ได้ */
  sex_age?: string | null;
  regdate: string | null;
  dchdate: string | null;
  /** สถานะการจำหน่าย (dchstts.name) */
  dchstts_name: string | null;
  /** รหัสประเภทการจำหน่าย (ipt.dchtype) 04 = By Transfer */
  dchtype: string | null;
  /** เหตุผลการจำหน่าย = ประเภทการจำหน่าย (ipt.dchtype + ชื่อจากตาราง dchtype ตรงกับ DISCHT ของแฟ้ม IPD) */
  dch_reason: string | null;
  /** ward ที่จำหน่าย (ipt.ward) ชื่อจากตาราง ward */
  ward: string | null;
  ward_name: string | null;
  los_days: number | null;
  income: number;
  uc_money: number;
  pttype: string | null;
  pttype_name: string | null;
  /** Authen Code จาก visit ที่รับไว้นอน (visit_pttype.auth_code) */
  auth_code: string | null;
  /** Claim Code ของ admission (ipt_pttype.claim_code) */
  claim_code: string | null;
  /** กองทุน (pttype.hipdata_code) */
  fund: string;
  finance_lock: boolean;
  summary_status_name: string | null;
  pdx: string | null;
  pdx_name: string | null;
  drg: string | null;
  rw: number | null;
  adjrw: number | null;
  /** AdjRW × อัตราตามวันจำหน่าย (ADJRW_RATES) เฉพาะสิทธิ UC ; null = ไม่ใช่ UC ไม่มี AdjRW หรือไม่มีอัตรา */
  adjrw_amount: number | null;
  days_since_dch: number | null;
  /** undefined = ไม่มีสถานะ REP (กองทุนอื่นที่ไม่พบ REP หรือโหลด insight ไม่ได้), null = ยังไม่มี REP */
  rep?: RepInfo | null;
  overdue: boolean;
  /** กองทุนย่อยที่เข้าเกณฑ์ (ว่าง = ไม่เข้ากองทุนใด, undefined = โหลดไม่ได้) */
  subfunds?: SubFund[];
  /** สถานะส่งเคลม (ไม่มี = กองทุนที่ไม่ต้องส่ง/ไม่มีลูกหนี้สิทธิและไม่มีหลักฐาน หรือโหลดไม่ได้) */
  claim?: ClaimInfo;
};

export type AdmissionsPage = GridPage<AdmissionRow> & {
  /** ผลรวม AdjRW และจำนวนรายที่มี AdjRW ของทั้งชุดที่ตรงตัวกรอง */
  adjrw_sum: number;
  adjrw_n: number;
  /** Case Mix Index = adjrw_sum / adjrw_n (null = ไม่มีรายที่มี AdjRW) */
  cmi: number | null;
  /** ผลรวม AdjRW × อัตรา และจำนวนรายที่คำนวณได้ (adjrw_n − adjrw_amount_n = รายที่ไม่ใช่ UC หรือจำหน่ายก่อนอัตราเก่าสุด) */
  adjrw_amount: number;
  adjrw_amount_n: number;
  /** จำนวนรายที่ไม่มี PDx (an_stat.pdx ว่าง/NULL ตรงกับตัวกรองหัวคอลัมน์ pdx = [""]) */
  no_pdx: number;
  /** จำนวนรายของทั้งชุดที่ตรงตัวกรองที่มี REP แล้ว (ผ่าน/ติด C/Deny) null = โหลดไม่ได้ */
  rep_sent: number | null;
  /** โหลดสถานะ REP จาก insight ไม่ได้ */
  rep_error: boolean;
  /** โหลดกองทุนย่อยไม่ได้ */
  subfund_error: boolean;
  /** โหลดสถานะเคลมไม่ได้ */
  claim_error: boolean;
  /** จำนวนรายของปุ่ม "ยังไม่ส่ง"/"เกินกำหนด" ของทั้งชุดที่ตรงตัวกรองอื่น null = โหลดไม่ได้ */
  claim_counts: ClaimCounts | null;
};

const num = (v: number | string | null) => (v == null || v === "" ? null : Number(v));

/** reps: undefined = ไม่ได้ดู REP ; fundOf = กองทุนของ pttype */
export function buildRows(raws: RawAdmission[], reps: RawRep[] | undefined, fundOf: (pttype: string | null) => string): AdmissionRow[] {
  const repByAn = reps && new Map(reps.map(({ an, ...r }) => [an, r]));
  return raws.map((r) => {
    const fund = fundOf(r.pttype);
    // พบ REP แสดงทุกกองทุน ; ไม่พบ = ยังไม่มี REP เฉพาะ REP_FUND
    const rep = repByAn?.get(r.an) ?? (repByAn && fund === REP_FUND ? null : undefined);
    const days = num(r.days_since_dch);
    const adjrw = num(r.adjrw);
    const rate = rateFor(r.dchdate, isUcFund(fund), Number(r.out_prov) === 1);
    return {
      an: r.an,
      hn: r.hn,
      patient_name: (r.patient_name ?? "").trim(),
      regdate: r.regdate,
      dchdate: r.dchdate,
      dchstts_name: r.dchstts_name || (r.dchstts ? r.dchstts : null),
      dchtype: r.dchtype?.trim() || null,
      dch_reason: r.dch_reason?.trim() || null,
      ward: r.ward,
      ward_name: r.ward_name,
      los_days: num(r.los_days),
      income: num(r.income) ?? 0,
      uc_money: num(r.uc_money) ?? 0,
      pttype: r.pttype,
      pttype_name: r.pttype_name,
      auth_code: r.auth_code?.trim() || null,
      claim_code: r.claim_code?.trim() || null,
      fund,
      finance_lock: r.finance_lock === "Y",
      summary_status_name: r.summary_status_name,
      pdx: r.pdx || null,
      pdx_name: r.pdx_name || null,
      drg: r.drg || null,
      rw: num(r.rw),
      adjrw,
      adjrw_amount: adjrw != null && rate != null ? Math.round(adjrw * rate * 100) / 100 : null,
      days_since_dch: days,
      ...(rep !== undefined && { rep }),
      // ไม่มีสถานะ REP (rep undefined) ดูจากจำนวนวันอย่างเดียว
      overdue: days != null && days > OVERDUE_DAYS && !rep,
    };
  });
}

/** แถวผู้สมัครของตัวกรองหัวคอลัมน์ REP: key (VN/AN) + สิทธิ จาก his */
export type RepCand = { k: string; pttype: string | null };
/**
 * ค่าตัวกรองหัวคอลัมน์ REP ต่อแถว (สูตรเดียวกับ rep ของ buildRows): สถานะ REP ล่าสุด (pass/c/deny),
 * none = ยังไม่มี REP (เฉพาะ REP_FUND), "" = ไม่มีสถานะ (กองทุนอื่นที่ไม่พบ REP แสดงขีด)
 */
export function repFilterValues(cands: RepCand[], statusOf: Map<string, RepStatus>, fundOf: (pttype: string | null) => string) {
  return cands.map((c) => ({ k: c.k, v: statusOf.get(c.k) ?? (fundOf(c.pttype) === REP_FUND ? "none" : "") }));
}

/** รายละเอียด admission (modal) */
export type DiagRow = { diagtype: string; diagtype_name: string | null; icd10: string; icd_name: string | null; doctor_name: string | null };
export type OperRow = {
  icd9: string; icd_name: string | null; opdate: string | null; optime: string | null;
  enddate: string | null; endtime: string | null; doctor_name: string | null;
};
export type AdmissionDetail = { diags: DiagRow[]; opers: OperRow[] };

/** ค่า AdjRW หนึ่งช่อง: ว่าง = null, ไม่ใช่ตัวเลขหรือนอก 0–100 = NaN (ipt.adjrw จริงอยู่ราว 0–8) */
export function adjrwValue(s: string | null | undefined) {
  const t = (s ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : NaN;
}
/** ตัวกรองช่วง AdjRW (`adjrw_min`/`adjrw_max` รวมขอบ ใส่ช่องเดียวได้) ใช้ทั้ง route และช่องกรอกของหน้า ; ค่าผิดหรือ min > max = "invalid" */
export function parseAdjrw(min: string | null | undefined, max: string | null | undefined) {
  const lo = adjrwValue(min);
  const hi = adjrwValue(max);
  if (Number.isNaN(lo) || Number.isNaN(hi) || (lo != null && hi != null && lo > hi)) return "invalid" as const;
  return { min: lo, max: hi };
}

/** ช่วงวันจำหน่ายยาวสุดที่หน้านี้ยอม (หน้าอื่น 31 วัน) ยาวได้เพราะ query ไม่อ่าน opitemrece ตามช่วงวันที่ ใช้ทั้งหน้าและ API */
export const IPD_MAX_DAYS = 90;

/** AN ต่อ request ของ 16 แฟ้ม (ดู/ตรวจ/ส่งออก): จำกัดขนาด IN list ของ his และเวลาที่ opitemrece ถูกอ่าน modal แบ่งชุดเอง */
export const MAX_EXPORT_ANS = 1000;
/** เลือกส่ง FDH ได้รวมสูงสุด (~28 MB ข้อความใน browser) modal ยิงทีละชุด MAX_EXPORT_ANS */
export const MAX_SELECT_ANS = 2000;

/** ข้อมูล 16 แฟ้มของ AN ที่เลือก (POST /api/ipd/fdh-export format "json") ค่าแต่ละช่องตามที่ SQL ของแฟ้มคืน */
export type FdhPreview = { files: { file: string; columns: string[]; rows: Record<string, string | number | null | undefined>[] }[] };
