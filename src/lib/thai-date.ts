// วันที่ที่แสดงให้ผู้ใช้เป็นภาษาไทย พ.ศ. เสมอ ส่วนค่าใน URL/API/DB เป็น ISO ค.ศ. (YYYY-MM-DD)
// คำนวณจากตัวเลขเอง ไม่ผ่าน Date/Intl จึงไม่เพี้ยนตาม timezone และ server กับ client ได้ผลเดียวกัน

export const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
export const THAI_MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "YYYY-MM-DD" หรือ datetime ที่ขึ้นต้นด้วยวันที่ ("2026-11-03 08:15:00") -> [ปี ค.ศ., เดือน 1-12, วัน] */
export function parseIsoDate(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * แสดงวันที่เป็นไทย พ.ศ.
 * - "short" (ค่าเริ่มต้น): 4 พ.ย. 2569 ใช้ทั่วไป ทั้งตาราง ปุ่ม และ filter
 * - "long": 4 พฤศจิกายน 2569 ใช้กับ aria-label หรือหัวข้อ
 * ค่าว่างหรือรูปแบบผิดคืน ""
 */
export function formatThaiDate(iso: string | null | undefined, style: "short" | "long" = "short"): string {
  const p = iso ? parseIsoDate(iso) : null;
  if (!p) return "";
  const [y, m, d] = p;
  return `${d} ${(style === "long" ? THAI_MONTHS : THAI_MONTHS_SHORT)[m - 1]} ${y + 543}`;
}

/** วันนี้ตามเวลาไทย เป็น YYYY-MM-DD (ค.ศ.) */
export const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
