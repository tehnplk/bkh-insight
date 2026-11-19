// รูปแบบไฟล์ .txt ของ 16 แฟ้ม (pure ไม่มี import) ใช้ได้ทั้ง server (route ส่งออก) และ client (สร้าง zip ใน browser)
// ตัวคั่น | หัวคอลัมน์บรรทัดแรก (= "TXT แบบมีหัวคอลัมน์" / API v2 data_hub/16_files) CRLF
// วันที่ YYYYMMDD เวลา HHmm ตามคู่มือ FDH v3.0 (FDH ปฏิเสธ "รูปแบบ DOB ในแฟ้ม PAT ไม่ถูกต้อง(1994-03-16)")

/** Excel ของ modal 16 แฟ้ม (/api/fdh/files/xlsx) ได้รวมทุก sheet ไม่เกินนี้ ; modal ปิดปุ่มเมื่อเกิน (zip ยังใช้ได้) */
export const XLSX_MAX_ROWS = 100_000;
/** body ของ xlsx ต้องต่ำกว่า proxyClientMaxBodySize (32mb ใน next.config.ts) ไม่งั้น proxy ตัด body เงียบ */
export const XLSX_MAX_BODY = 30 * 1024 * 1024;

type Cell = string | number | null | undefined;
export type FileRow = Record<string, Cell>;

/** ค่าหนึ่งช่องของไฟล์ txt: null = ว่าง, วันที่ YYYY-MM-DD → YYYYMMDD (SQL คงขีดไว้ให้หน้าพรีวิว/ตรวจ C/e-Claim), | CR LF เป็นช่องว่าง, ตัด " ทิ้ง */
const cell = (v: Cell) =>
  v == null ? "" : String(v).replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1$2$3").replace(/[|\r\n]/g, " ").replace(/"/g, "");

/** ไฟล์ 16 แฟ้ม: บรรทัดแรกเป็นหัวคอลัมน์ คั่นด้วย | ทุกบรรทัดจบด้วย CRLF */
export const toTxt = (columns: string[], rows: FileRow[]) =>
  [columns.join("|"), ...rows.map((r) => columns.map((c) => cell(r[c])).join("|"))].map((l) => `${l}\r\n`).join("");
