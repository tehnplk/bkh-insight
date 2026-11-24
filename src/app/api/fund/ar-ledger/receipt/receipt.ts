// รับเงินที่ไม่ได้มาจาก STM (บันทึกจาก modal รายละเอียดใน /fund/ar-ledger) แบบ pure ทดสอบด้วย node ได้ตรง (receipt.test.mjs) ยอดเป็นสตางค์

/**
 * แถวที่จะลง (สตางค์, ติดลบ = ลดหนี้): settle = ยอดที่รับ, diff = ส่วนที่เหลือเมื่อติ๊กปิดส่วนต่าง (0 = ไม่ลง)
 * รับได้ไม่เกินคงเหลือ (ไม่มีกรณีรับเกิน) ; คงเหลือ ≤ 0 = ไม่มีหนี้ให้รับ
 */
export function planReceipt(balance: number, amount: number, close: boolean): { settle: number; diff: number } | { error: string } {
  if (balance <= 0) return { error: "หนี้นี้ไม่มีคงเหลือแล้ว" };
  if (amount <= 0) return { error: "จำนวนเงินต้องมากกว่า 0" };
  if (amount > balance) return { error: `รับได้ไม่เกินคงเหลือ ${(balance / 100).toFixed(2)} บาท` };
  return { settle: -amount, diff: close && balance > amount ? amount - balance : 0 };
}
