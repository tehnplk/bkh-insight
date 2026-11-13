// IPD แยกรายสิทธิ: ชนิดข้อมูลและการรวมผล his (admission) กับ insight (REP) แบบ pure
// ไม่มี import ค่า จึงใช้ได้ทั้ง route, หน้า (client) และ admissions.test.mjs
import type { GridPage } from "@/lib/grid-query";

/** REP ของผู้ป่วยในมีเฉพาะกองทุนนี้ (ตรวจกับฐานจริงแล้ว) แถวกองทุนอื่นจึงไม่มีสถานะ REP */
export const REP_FUND = "UCS";
/** หลังจำหน่ายเกินจำนวนวันนี้และยังไม่มี REP = ตัวชี้ให้ตาม ไม่ได้แปลว่าผิด */
export const OVERDUE_DAYS = 30;

/**
 * อัตราบาทต่อ AdjRW ตามวันจำหน่าย (ผู้ใช้กำหนด 13 พ.ย. 2569) เรียงจากใหม่ไปเก่า ใช้ตัวแรกที่ dchdate >= from
 * จำหน่ายก่อนอัตราเก่าสุด = ไม่มีอัตรา (ไม่คำนวณยอด) ; route ใช้รายการเดียวกันสร้าง CASE ของยอดรวม
 */
export const ADJRW_RATES = [
  { from: "2026-10-01", rate: 5119 },
  { from: "2025-10-01", rate: 3505.14 },
] as const;

export const rateFor = (dchdate: string | null) => (dchdate ? (ADJRW_RATES.find((r) => dchdate.slice(0, 10) >= r.from)?.rate ?? null) : null);

/** แถวจาก SQL รายการ (his) ตัวเลข DECIMAL อาจมาเป็น string */
export type RawAdmission = {
  an: string;
  hn: string;
  patient_name: string | null;
  regdate: string | null;
  dchdate: string | null;
  dchstts: string | null;
  dchstts_name: string | null;
  dch_reason: string | null;
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
  days_since_dch: number | string | null;
};

export type RepStatus = "pass" | "c" | "deny";
/** แถวจาก SQL REP (insight) */
export type RawRep = { an: string; rep_no: string | null; rep_date: string | null; status: RepStatus; codes: string[] };

export type AdmissionRow = {
  an: string;
  hn: string;
  patient_name: string;
  regdate: string | null;
  dchdate: string | null;
  /** สถานะการจำหน่าย (dchstts.name) */
  dchstts_name: string | null;
  /** เหตุผลการจำหน่าย = ประเภทการจำหน่าย (ipt.dchtype + ชื่อจากตาราง dchtype ตรงกับ DISCHT ของแฟ้ม IPD) */
  dch_reason: string | null;
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
  /** AdjRW × อัตราตามวันจำหน่าย (ADJRW_RATES) null = ไม่มี AdjRW หรือไม่มีอัตรา */
  adjrw_amount: number | null;
  days_since_dch: number | null;
  /** undefined = ไม่มีสถานะ REP (กองทุนอื่น หรือโหลด insight ไม่ได้), null = ยังไม่มี REP */
  rep?: Omit<RawRep, "an"> | null;
  overdue: boolean;
};

export type AdmissionsPage = GridPage<AdmissionRow> & {
  /** ผลรวม AdjRW และจำนวนรายที่มี AdjRW ของทั้งชุดที่ตรงตัวกรอง */
  adjrw_sum: number;
  adjrw_n: number;
  /** Case Mix Index = adjrw_sum / adjrw_n (null = ไม่มีรายที่มี AdjRW) */
  cmi: number | null;
  /** ผลรวม AdjRW × อัตรา และจำนวนรายที่คำนวณได้ (น้อยกว่า adjrw_n เมื่อมีรายที่จำหน่ายก่อนอัตราเก่าสุด) */
  adjrw_amount: number;
  adjrw_amount_n: number;
  /** โหลดสถานะ REP จาก insight ไม่ได้ */
  rep_error: boolean;
};

const num = (v: number | string | null) => (v == null || v === "" ? null : Number(v));

/** reps: undefined = ไม่ได้ดู REP ; fundOf = กองทุนของ pttype */
export function buildRows(raws: RawAdmission[], reps: RawRep[] | undefined, fundOf: (pttype: string | null) => string): AdmissionRow[] {
  const repByAn = reps && new Map(reps.map(({ an, ...r }) => [an, r]));
  return raws.map((r) => {
    const fund = fundOf(r.pttype);
    const rep = fund === REP_FUND && repByAn ? (repByAn.get(r.an) ?? null) : undefined;
    const days = num(r.days_since_dch);
    const adjrw = num(r.adjrw);
    const rate = rateFor(r.dchdate);
    return {
      an: r.an,
      hn: r.hn,
      patient_name: (r.patient_name ?? "").trim(),
      regdate: r.regdate,
      dchdate: r.dchdate,
      dchstts_name: r.dchstts_name || (r.dchstts ? r.dchstts : null),
      dch_reason: r.dch_reason?.trim() || null,
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
      // แถว UCS ที่โหลด REP ไม่ได้ (rep undefined) ดูจากจำนวนวันอย่างเดียว เหมือนกองทุนที่ไม่มี REP
      overdue: days != null && days > OVERDUE_DAYS && !rep,
    };
  });
}

/** รายละเอียด admission (modal) */
export type DiagRow = { diagtype: string; diagtype_name: string | null; icd10: string; icd_name: string | null; doctor_name: string | null };
export type OperRow = {
  icd9: string; icd_name: string | null; opdate: string | null; optime: string | null;
  enddate: string | null; endtime: string | null; doctor_name: string | null;
};
export type AdmissionDetail = { diags: DiagRow[]; opers: OperRow[] };

/** ช่วงวันจำหน่ายยาวสุดที่หน้านี้ยอม (หน้าอื่น 31 วัน) ยาวได้เพราะ query ไม่อ่าน opitemrece ตามช่วงวันที่ ใช้ทั้งหน้าและ API */
export const IPD_MAX_DAYS = 90;

/** ส่งออก 16 แฟ้ม (zip) ได้สูงสุดต่อครั้ง: จำกัดขนาด IN list ของ his และเวลาที่ opitemrece ถูกอ่าน */
export const MAX_EXPORT_ANS = 500;

/** ข้อมูล 16 แฟ้มของ AN ที่เลือก (POST /api/ipd/fdh-export format "json") ค่าแต่ละช่องตามที่ SQL ของแฟ้มคืน */
export type FdhPreview = { files: { file: string; columns: string[]; rows: Record<string, string | number | null | undefined>[] }[] };
