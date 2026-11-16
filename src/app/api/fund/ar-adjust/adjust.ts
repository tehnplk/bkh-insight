// pure ไม่มี import จึงรันทดสอบด้วย node ได้ตรง (adjust.test.mjs)

const cents = (v: string | number) => Math.round(Number(v) * 100);

/** คำขอลดหนี้ที่จะทำให้คงเหลือติดลบ (เพิ่มหนี้ หรือยอดติดลบอยู่แล้วแต่ขอเพิ่มกลับ ไม่ถือว่าเกิน) */
export const overReduces = (balance: string | number, amount: string | number) => cents(amount) < 0 && cents(balance) + cents(amount) < 0;

/** อนุมัติหลายรายการได้ครั้งละไม่เกินนี้ (ใบค้างหลัง admit ราว 140 รายต่อเดือน) */
export const MAX_DECIDE_IDS = 200;
