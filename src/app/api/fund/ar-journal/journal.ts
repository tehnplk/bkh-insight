// สร้างรายการสมุดรายวัน Dr/Cr จากยอดรวมของ ar_ledger ในงวด แบบ pure ทดสอบด้วย node ได้ตรง (journal.test.mjs)
//   ตั้งหนี้/ปรับปรุง/ยกเลิก/กลับรายการ (HOSxP และ manual): บวก Dr ลูกหนี้ / Cr รายได้ ; ลบ กลับข้าง
//   รับชำระ (STM, รับเงิน): ลบ Dr เงินฝากธนาคาร / Cr ลูกหนี้ ; บวก (เรียกคืน) กลับข้าง
//   รับชำระด้วยเงินรับล่วงหน้าบัตรต่างด้าว (source fwf): Dr 2103010103.502 / Cr ลูกหนี้ เป็นกติกาต่อ source ไม่ใช่ต่อบัญชี (หนี้ .501 จ่ายเงินสดก็ได้)
//   ส่วนต่าง (STM), ชื่อบัญชีตามผังบัญชี สธ. มองจากค่ารักษาที่เรียกเก็บ: ลบ = ได้รับต่ำกว่า Dr ส่วนต่างค่ารักษาที่สูงกว่าข้อตกลง / Cr ลูกหนี้ ; บวก = ได้รับสูงกว่า Dr ลูกหนี้ / Cr ส่วนต่างค่ารักษาที่ต่ำกว่าข้อตกลง

/** ยอดรวมของ ar_ledger ต่อ (บัญชี, kind, เครื่องหมาย) พร้อมบัญชีคู่จาก ar_account */
export type JournalGroup = {
  account_code: string | null;
  account_name: string | null;
  kind: string;
  /** source ของแถว ar_ledger (ไม่ส่ง = ไม่ใช่ fwf) */
  source?: string;
  revenue_code: string | null;
  diff_under_code: string | null;
  diff_over_code: string | null;
  n: number;
  amount: string | number;
};
/** ชนิดบัญชีของแต่ละข้าง (งบทดลองใช้แยกบัญชีจริงกับบัญชีรายได้/ส่วนต่างที่ปิดทุกสิ้นปีงบ) */
export type AccountType = "ar" | "cash" | "pool" | "revenue" | "diff_under" | "diff_over";
/** code = null คือยังไม่กำหนดบัญชี (ต้องให้งานบัญชีกำหนดที่ /admin/ar-accounts) */
export type JournalLine = {
  kind: string; dr_type: AccountType; dr_code: string | null; dr_name: string; cr_type: AccountType; cr_code: string | null; cr_name: string; n: number; amount: number;
};

export const CASH_NAME = "เงินฝากธนาคาร";
/** เงินรับล่วงหน้าบัตรประกันสุขภาพต่างด้าว (บัญชีงบดุล ไม่ปิดสิ้นปีงบ) */
export const POOL_ACCOUNT = { code: "2103010103.502", name: "รายได้ค่ารักษาแรงงานต่างด้าวรับล่วงหน้า" } as const;
const KIND_TEXT: Record<string, string> = { set: "ตั้งหนี้", adjust: "ปรับปรุง", cancel: "ยกเลิก", reverse: "กลับรายการ", settle: "รับชำระ", diff: "ส่วนต่าง" };

export function journalLines(groups: JournalGroup[]): JournalLine[] {
  const out = new Map<string, JournalLine>();
  for (const g of groups) {
    const cents = Math.round(Number(g.amount) * 100);
    if (!cents) continue;
    const ar = { type: "ar" as const, code: g.account_code, name: g.account_name ?? "ลูกหนี้ไม่ระบุบัญชี" };
    let other: { type: AccountType; code: string | null; name: string };
    if (g.kind === "settle") other = g.source === "fwf" ? { type: "pool", ...POOL_ACCOUNT } : { type: "cash", code: null, name: CASH_NAME };
    else if (g.kind === "diff")
      other = cents < 0 ? { type: "diff_under", code: g.diff_under_code, name: "ส่วนต่างค่ารักษาที่สูงกว่าข้อตกลง" } : { type: "diff_over", code: g.diff_over_code, name: "ส่วนต่างค่ารักษาที่ต่ำกว่าข้อตกลง" };
    else other = { type: "revenue", code: g.revenue_code, name: "รายได้" };
    const [dr, cr] = cents > 0 ? [ar, other] : [other, ar];
    const kind = KIND_TEXT[g.kind] ?? g.kind;
    const key = `${kind}|${dr.code}|${dr.name}|${cr.code}|${cr.name}`;
    const line = out.get(key) ?? { kind, dr_type: dr.type, dr_code: dr.code, dr_name: dr.name, cr_type: cr.type, cr_code: cr.code, cr_name: cr.name, n: 0, amount: 0 };
    line.n += g.n;
    line.amount = Math.round(line.amount * 100 + Math.abs(cents)) / 100;
    out.set(key, line);
  }
  const order = Object.values(KIND_TEXT);
  const LAST = "\uffff"; // บัญชีที่ยังไม่กำหนดเรียงท้าย
  return [...out.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.dr_code ?? LAST).localeCompare(b.dr_code ?? LAST) || (a.cr_code ?? LAST).localeCompare(b.cr_code ?? LAST));
}
