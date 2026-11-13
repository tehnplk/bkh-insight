// รูปแบบไฟล์ .txt ของ 16 แฟ้ม (pure ไม่มี import) ใช้ได้ทั้ง server (route ส่งออก) และ client (สร้าง zip ใน browser)
// ตัวคั่น | หัวคอลัมน์บรรทัดแรก CRLF ตามโค้ดของ รพ. ที่ส่ง FDH จริง (ยังไม่มีสเปกทางการเรื่องรูปแบบไฟล์)

type Cell = string | number | null | undefined;
export type FileRow = Record<string, Cell>;

/** ค่าหนึ่งช่องของไฟล์ txt: null = ว่าง, | CR LF เป็นช่องว่าง, ตัด " ทิ้ง */
const cell = (v: Cell) => (v == null ? "" : String(v).replace(/[|\r\n]/g, " ").replace(/"/g, ""));

/** ไฟล์ 16 แฟ้ม: บรรทัดแรกเป็นหัวคอลัมน์ คั่นด้วย | ทุกบรรทัดจบด้วย CRLF */
export const toTxt = (columns: string[], rows: FileRow[]) =>
  [columns.join("|"), ...rows.map((r) => columns.map((c) => cell(r[c])).join("|"))].map((l) => `${l}\r\n`).join("");
