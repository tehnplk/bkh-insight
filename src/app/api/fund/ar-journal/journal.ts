// สร้างรายการสมุดรายวัน Dr/Cr จากยอดรวมของ ar_ledger ในงวด แบบ pure ทดสอบด้วย node ได้ตรง (journal.test.mjs)
//   ตั้งหนี้/ปรับปรุง/ยกเลิก/กลับรายการ (HOSxP และ manual): บวก Dr ลูกหนี้ / Cr รายได้ ; ลบ กลับข้าง
//   รับชำระ (STM): ลบ Dr เงินฝากธนาคาร / Cr ลูกหนี้ ; บวก (เรียกคืน) กลับข้าง
//   ส่วนต่าง (STM): ลบ = ได้รับต่ำกว่า Dr บัญชีส่วนต่างต่ำกว่า / Cr ลูกหนี้ ; บวก = ได้รับสูงกว่า Dr ลูกหนี้ / Cr บัญชีส่วนต่างสูงกว่า

/** ยอดรวมของ ar_ledger ต่อ (บัญชี, kind, เครื่องหมาย) พร้อมบัญชีคู่จาก ar_account */
export type JournalGroup = {
  account_code: string | null;
  account_name: string | null;
  kind: string;
  revenue_code: string | null;
  diff_under_code: string | null;
  diff_over_code: string | null;
  n: number;
  amount: string | number;
};
/** code = null คือยังไม่กำหนดบัญชี (ต้องให้งานบัญชีกำหนดที่ /admin/ar-accounts) */
export type JournalLine = { kind: string; dr_code: string | null; dr_name: string; cr_code: string | null; cr_name: string; n: number; amount: number };

export const CASH_NAME = "เงินฝากธนาคาร";
const KIND_TEXT: Record<string, string> = { set: "ตั้งหนี้", adjust: "ปรับปรุง", cancel: "ยกเลิก", reverse: "กลับรายการ", settle: "รับชำระ", diff: "ส่วนต่าง" };

export function journalLines(groups: JournalGroup[]): JournalLine[] {
  const out = new Map<string, JournalLine>();
  for (const g of groups) {
    const cents = Math.round(Number(g.amount) * 100);
    if (!cents) continue;
    const ar = { code: g.account_code, name: g.account_name ?? "ลูกหนี้ไม่ระบุบัญชี" };
    let other: { code: string | null; name: string };
    if (g.kind === "settle") other = { code: null, name: CASH_NAME };
    else if (g.kind === "diff") other = cents < 0 ? { code: g.diff_under_code, name: "ส่วนต่างได้รับต่ำกว่าลูกหนี้" } : { code: g.diff_over_code, name: "ส่วนต่างได้รับสูงกว่าลูกหนี้" };
    else other = { code: g.revenue_code, name: "รายได้" };
    const [dr, cr] = cents > 0 ? [ar, other] : [other, ar];
    const kind = KIND_TEXT[g.kind] ?? g.kind;
    const key = `${kind}|${dr.code}|${dr.name}|${cr.code}|${cr.name}`;
    const line = out.get(key) ?? { kind, dr_code: dr.code, dr_name: dr.name, cr_code: cr.code, cr_name: cr.name, n: 0, amount: 0 };
    line.n += g.n;
    line.amount = Math.round(line.amount * 100 + Math.abs(cents)) / 100;
    out.set(key, line);
  }
  const order = Object.values(KIND_TEXT);
  const LAST = "\uffff"; // บัญชีที่ยังไม่กำหนดเรียงท้าย
  return [...out.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.dr_code ?? LAST).localeCompare(b.dr_code ?? LAST) || (a.cr_code ?? LAST).localeCompare(b.cr_code ?? LAST));
}
