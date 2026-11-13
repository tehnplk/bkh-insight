// OPD แยกรายสิทธิ: ชนิดข้อมูลและการแปลงแถว his แบบ pure
// ไม่มี import ค่า จึงใช้ได้ทั้ง route, หน้า (client) และ admissions.test.mjs
import type { GridPage } from "@/lib/grid-query";

/** ช่วงวันรับบริการยาวสุด: เท่าหน้าอื่น (31) เพราะ 16 แฟ้มของผู้ป่วยนอกอ่าน opitemrece ตามช่วงวันที่ */
export const OPD_MAX_DAYS = 31;
/** ดู/ตรวจ 16 แฟ้มได้สูงสุดต่อครั้ง */
export const MAX_EXPORT_VNS = 500;

/** สถานะปิดสิทธิ (หลักเดียวกับ /fund/claim-status): closed ปิดแล้ว, authen_only มีแค่ authen, none ยังไม่มีทั้งคู่ */
export type ClaimStatus = "closed" | "authen_only" | "none";

/** แถวจาก SQL รายการ (his) ตัวเลข DECIMAL อาจมาเป็น string */
export type RawVisit = {
  vn: string;
  hn: string;
  patient_name: string | null;
  vstdate: string | null;
  vsttime: string | null;
  dep_code: string | null;
  dep_name: string | null;
  pttype: string | null;
  pttype_name: string | null;
  pdx: string | null;
  pdx_name: string | null;
  /** ovstost.name สถานะใน HOSxP */
  ovst_status: string | null;
  /** ovstost.export_code รหัสจำหน่ายมาตรฐาน (TYPEOUT 43 แฟ้ม) */
  ovst_export: string | null;
  income: number | string | null;
  uc_money: number | string | null;
  auth_code: string | null;
  close_code: string | null;
  claim_status: ClaimStatus;
  rcpt_no: string | null;
};

export type VisitRow = {
  vn: string;
  hn: string;
  patient_name: string;
  vstdate: string | null;
  /** เวลามา HH:MM */
  vsttime: string | null;
  dep_name: string | null;
  pttype: string | null;
  pttype_name: string | null;
  /** กองทุน (pttype.hipdata_code) */
  fund: string;
  pdx: string | null;
  pdx_name: string | null;
  /** สถานะผู้ป่วย (การจำหน่าย) เช่น กลับบ้าน, ส่งต่อ, Admit, ยังไม่จำหน่าย */
  ovst_status: string | null;
  /** ชื่อสถานะใน HOSxP (ovstost.name) ไว้แสดงเป็นรายละเอียด */
  ovst_status_detail: string | null;
  income: number;
  uc_money: number;
  /** เลข authen (PP) จาก visit */
  auth_code: string | null;
  /** เลขปิดสิทธิ (ยืนยันกับ สปสช. หรือ EP) */
  close_code: string | null;
  claim_status: ClaimStatus;
  /** เลขที่ใบเสร็จ (rcpt_print ที่ไม่ถูกยกเลิก) หลายใบคั่นด้วย ", " ไม่มีการจ่ายเงิน = null */
  rcpt_no: string | null;
};

export type VisitsPage = GridPage<VisitRow>;

/** ovstost.export_code -> สถานะการจำหน่าย (รหัส TYPEOUT 43 แฟ้ม) */
const DISCHARGE: Record<string, string> = { "1": "กลับบ้าน", "2": "Admit", "3": "ส่งต่อ", "4": "เสียชีวิต", "7": "ปฏิเสธการรักษา", "8": "หนีกลับ" };

/** code 1 รวมสถานะคิวที่ยังไม่จบ (รอผลตรวจ/รอพบแพทย์/รอรับยา) จึงแยกเป็น "ยังไม่จำหน่าย" ; ไม่บันทึกสถานะ = null */
export function dischargeLabel(code: string | null, name: string | null): string | null {
  if (!code && !name) return null;
  if (code === "1" && name?.startsWith("รอ")) return "ยังไม่จำหน่าย";
  return (code && DISCHARGE[code]) || name;
}

const num = (v: number | string | null) => (v == null || v === "" ? null : Number(v));

/** fundOf = กองทุนของ pttype */
export function buildRows(raws: RawVisit[], fundOf: (pttype: string | null) => string): VisitRow[] {
  return raws.map((r) => ({
    vn: r.vn,
    hn: r.hn,
    patient_name: (r.patient_name ?? "").trim(),
    vstdate: r.vstdate,
    vsttime: r.vsttime?.slice(0, 5) || null,
    dep_name: r.dep_name || (r.dep_code && r.dep_code !== "UNKNOWN" ? r.dep_code : null),
    pttype: r.pttype,
    pttype_name: r.pttype_name,
    fund: fundOf(r.pttype),
    pdx: r.pdx?.trim() || null,
    pdx_name: r.pdx_name || null,
    ovst_status: dischargeLabel(r.ovst_export, r.ovst_status),
    ovst_status_detail: r.ovst_status || null,
    income: num(r.income) ?? 0,
    uc_money: num(r.uc_money) ?? 0,
    auth_code: r.auth_code?.trim() || null,
    close_code: r.close_code?.trim() || null,
    claim_status: r.claim_status,
    // เลขที่ใบเสร็จแสดงแบบ เล่ม/เลขที่ (HOSxP เก็บ "421:123")
    rcpt_no: r.rcpt_no?.replaceAll(":", "/") || null,
  }));
}
