// ใช้ร่วมกันระหว่าง route กับหน้า /quality/pending (ไม่มี server-only)
import { addDaysIso, isIsoDate, spanDays } from "../../visit/opd-visit/opd-visit";

/**
 * หมวดของรายการค้าง เป็นทั้ง allowlist ของ ?kind= และตัวเลือกของแท็บ (ไม่ส่ง = ตัวแรก)
 * ผู้ป่วยนอกยังไม่ลงรหัสวินิจฉัยไม่ได้ทำ: ตรวจกับ HIS แล้ว visit ที่ไม่มี ovstdiag diagtype 1 มีแค่ของวันนี้ (ยังตรวจไม่จบ)
 */
export const PENDING_KINDS = [
  { value: "overdue-discharge", label: "ค้างจำหน่าย" },
  { value: "ipd-no-dx", label: "ยังไม่ลงรหัสวินิจฉัยหลัก" },
] as const;
export type PendingKind = (typeof PENDING_KINDS)[number]["value"];
export const DEFAULT_KIND: PendingKind = "overdue-discharge";
export const isPendingKind = (s: string): s is PendingKind => PENDING_KINDS.some((k) => k.value === s);

/** ค้างจำหน่าย: รับเข้ามาเกินกี่วัน (?days=) */
export const DEFAULT_DAYS = 30;
export const MIN_DAYS = 1;
export const MAX_DAYS = 365;
export const DAY_OPTIONS = [3, 7, 14, 30, 60, 90, 180, 365] as const;
/** จำนวนเต็ม MIN_DAYS-MAX_DAYS ไม่ถูกต้องคืน null */
export function parseDays(raw: string | null): number | null {
  if (raw === null || raw === "") return DEFAULT_DAYS;
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= MIN_DAYS && n <= MAX_DAYS ? n : null;
}

/** ยังไม่ลงรหัส: ช่วงวันจำหน่ายยาวสุด (นับรวมสองฝั่ง) และช่วงเริ่มต้น = 30 วันล่าสุดถึงวันนี้ */
export const MAX_DCH_SPAN_DAYS = 366;
export const DEFAULT_DCH_SPAN_DAYS = 30;
export const defaultDchFrom = (today: string) => addDaysIso(today, -(DEFAULT_DCH_SPAN_DAYS - 1));
export function dchRangeError(from: string, to: string): string | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD";
  if (from > to) return "วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด";
  if (spanDays(from, to) > MAX_DCH_SPAN_DAYS) return `ช่วงวันที่ต้องไม่เกิน ${MAX_DCH_SPAN_DAYS} วัน`;
  return null;
}

/** 1 แถวต่อ an ใช้ร่วมกันทั้งสองหมวด */
export type PendingRow = {
  an: string;
  hn: string;
  name: string;
  /** ชื่อตึก (ward.name) null = ไม่ได้ระบุ ward */
  ward: string | null;
  /** ค้างจำหน่าย: แพทย์ผู้รับ / ยังไม่ลงรหัส: แพทย์ผู้จำหน่าย (ไม่มีใช้แพทย์ผู้รับ) */
  doctor: string | null;
  /** วันรับ YYYY-MM-DD (ค.ศ.) */
  regdate: string;
  /** วันจำหน่าย YYYY-MM-DD (ค.ศ.) null ในหมวดค้างจำหน่าย */
  dchdate: string | null;
  /** วันที่ค้าง: นับจากวันรับ (ค้างจำหน่าย) หรือจากวันจำหน่าย (ยังไม่ลงรหัส) ถึงวันนี้ */
  days: number;
};

/** ผลรวมตาม filter ของหมวด ไม่ขึ้นกับคำค้นหา */
export type PendingSummary = {
  count: number;
  /** ยังไม่ลงรหัส: จำนวนผู้จำหน่ายทั้งหมดในช่วง (ตัวหาร) ค้างจำหน่ายเป็น null */
  of: number | null;
  /** เรียงจากมากไปน้อย ward null = ไม่ได้ระบุ ward */
  byWard: { ward: string | null; count: number }[];
};
