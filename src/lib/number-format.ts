// รูปแบบตัวเลขที่แสดงให้ผู้ใช้ (th-TH) ใช้ได้ทั้ง server และ client
// ค่าติดลบใช้เครื่องหมายลบ U+2212 (−) ไม่ใช้วงเล็บ ไม่ใช้ ฿ / K / M / พัน

const MINUS = "−";
const baht = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const upTo2 = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });

const signed = (n: number, fmt: (abs: number) => string) => {
  const s = fmt(Math.abs(n));
  // ปัดแล้วเป็นศูนย์ (เช่น -0.001) ไม่ต้องมีเครื่องหมายลบ
  return n < 0 && /[1-9]/.test(s) ? `${MINUS}${s}` : s;
};

/** เงินบาท 2 ตำแหน่ง ไม่มีหน่วย (หน่วยอยู่ที่หัวคอลัมน์): 1234567.5 -> "1,234,567.50", -1234 -> "−1,234.00" */
export const formatBaht = (n: number) => signed(n, (a) => baht.format(a));

/** จำนวนนับ: 12345 -> "12,345" */
export const formatCount = (n: number) => count.format(n);

/** เงินแบบย่อสำหรับ KPI/dashboard (แสดงค่าเต็มด้วย formatBaht ตอน hover): >= 1 ล้าน "2.38 ล้านบาท" นอกนั้น "723,036 บาท" */
export function formatCompactBaht(n: number): string {
  return Math.abs(n) >= 1e6
    ? `${signed(n, (a) => baht.format(a / 1e6))} ล้านบาท`
    : `${signed(n, (a) => count.format(Math.round(a)))} บาท`;
}

/** ค่าบนแกนกราฟที่ชื่อแกนเป็น "ล้านบาท": 1500000 -> "1.5", 250000 -> "0.25" (ไม่มีหน่วย) */
export const formatMillions = (n: number) => signed(n, (a) => upTo2.format(a / 1e6));
