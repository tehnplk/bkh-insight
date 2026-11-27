// สร้างรายการสมุดรายวัน Dr/Cr จากยอดรวมของ ar_ledger ในงวด แบบ pure ทดสอบด้วย node ได้ตรง (journal.test.mjs)
//   ตั้งหนี้/ปรับปรุง/ยกเลิก/กลับรายการ (HOSxP และ manual): บวก Dr ลูกหนี้ / Cr รายได้ ; ลบ กลับข้าง
//   รับชำระ (STM, รับเงิน): ลบ Dr เงินฝากธนาคาร / Cr ลูกหนี้ ; บวก (เรียกคืน) กลับข้าง
//   รับชำระด้วยเงินรับล่วงหน้าบัตรต่างด้าว (source fwf): Dr 2103010103.502 / Cr ลูกหนี้ เป็นกติกาต่อ source ไม่ใช่ต่อบัญชี (หนี้ .501 จ่ายเงินสดก็ได้)
//   ตัดด้วยเงินเหมาจ่าย (source capitation, บัญชีจากชุด ar_capitation_batch): settle Dr clear_code (รายได้เหมาจ่าย .214/.217) / Cr ลูกหนี้ ;
//     diff Dr clear_short_code (ส่วนต่างที่สูงกว่าเหมาจ่าย .229/.257) / Cr ลูกหนี้
//   ส่วนต่าง (STM), ชื่อบัญชีตามผังบัญชี สธ. มองจากค่ารักษาที่เรียกเก็บ: ลบ = ได้รับต่ำกว่า Dr ส่วนต่างค่ารักษาที่สูงกว่าข้อตกลง / Cr ลูกหนี้ ; บวก = ได้รับสูงกว่า Dr ลูกหนี้ / Cr ส่วนต่างค่ารักษาที่ต่ำกว่าข้อตกลง
//   ส่วนต่างตามเพดาน/สัดส่วนของกติกาบัญชี (kind diff ของ source rcpt_debt/ipt): ลบ Dr ส่วนต่างที่สูงกว่าข้อตกลง / Cr ลูกหนี้ ; บวก (ยกเลิก/กลับรายการ) กลับข้างในบัญชีเดียวกัน
//   เงินโอนที่ได้รับ (kind transfer จาก ar_transfer ไม่ใช่ ar_ledger ; amount ส่งมาติดลบ = รับ): Dr เงินฝากธนาคาร / Cr account_code (รายได้เมื่อขึ้นต้น 4, ทุนเมื่อขึ้นต้น 3 เช่น PRIOR_YEAR_ACCOUNT ของงบปีก่อน) ; บวก (ถูกหักคืน) กลับข้าง
//     ยกเว้นบัญชีลูกหนี้ที่ settles_by_stm: ไม่ลงบัญชี เพราะเงินก้อนเดียวกันลง Dr เงินฝาก / Cr ลูกหนี้ แล้วตอนตัดรายตัวด้วย STM (ตาม GL ของการเงิน)
//   ส่วนต่างตอนรับเงิน (diff ของ stm/manual) ของหนี้ที่บริการปีงบก่อนปีงบที่ลงบัญชี (prior_year จาก SQL): บัญชีคู่ PRIOR_DIFF_ACCOUNT ทั้งสองทิศ
//     ตาม GL (GL เคยลง Dr 3102010102.103 ฝั่งขาดหนึ่งใบ เราใช้ .102 อย่างเดียว) ชนิด equity ยกมาข้ามปีงบ ไม่ปิด 1 ต.ค.
import { PRIOR_YEAR_ACCOUNT } from "../ar-transfer/transfer";

/** ยอดรวมของ ar_ledger ต่อ (บัญชี, kind, เครื่องหมาย) พร้อมบัญชีคู่จาก ar_account */
export type JournalGroup = {
  account_code: string | null;
  account_name: string | null;
  kind: string;
  /** source ของแถว ar_ledger (ไม่ส่ง = ไม่ใช่ fwf/capitation) */
  source?: string;
  /** บัญชีของชุดตัดหนี้เหมาจ่าย (source capitation เท่านั้น) */
  clear_code?: string | null;
  clear_short_code?: string | null;
  /** diff ของ stm/manual ที่ ref_date (วันบริการ) อยู่ปีงบก่อนปีงบของ entry_date (คำนวณใน SQL) */
  prior_year?: boolean | null;
  /** ar_account.settles_by_stm ของ account_code (ใช้กับ kind transfer) */
  settles_by_stm?: boolean | null;
  revenue_code: string | null;
  diff_under_code: string | null;
  diff_over_code: string | null;
  n: number;
  amount: string | number;
};
/** ชนิดบัญชีของแต่ละข้าง (งบทดลองใช้แยกบัญชีจริงกับบัญชีรายได้/ส่วนต่างที่ปิดทุกสิ้นปีงบ) */
export type AccountType = "ar" | "cash" | "pool" | "revenue" | "diff_under" | "diff_over" | "equity";
/** code = null คือยังไม่กำหนดบัญชี (ต้องให้งานบัญชีกำหนดที่ /admin/ar-accounts) */
export type JournalLine = {
  kind: string; dr_type: AccountType; dr_code: string | null; dr_name: string; cr_type: AccountType; cr_code: string | null; cr_name: string; n: number; amount: number;
};

export const CASH_NAME = "เงินฝากธนาคาร";
/** ส่วนต่างของหนี้ปีงบก่อนที่รับเงิน/ปิดส่วนต่างในปีงบนี้ */
export const PRIOR_DIFF_ACCOUNT = { code: "3102010102.102", name: "ผลสะสมจากการแก้ไขข้อผิดพลาด - รายได้" } as const;
/** เงินรับล่วงหน้าบัตรประกันสุขภาพต่างด้าว (บัญชีงบดุล ไม่ปิดสิ้นปีงบ) */
export const POOL_ACCOUNT = { code: "2103010103.502", name: "รายได้ค่ารักษาแรงงานต่างด้าวรับล่วงหน้า" } as const;
const CAP_SHORT_NAME = "ส่วนต่างค่ารักษาที่สูงกว่าเหมาจ่ายรายหัว";
const KIND_TEXT: Record<string, string> = { set: "ตั้งหนี้", adjust: "ปรับปรุง", cancel: "ยกเลิก", reverse: "กลับรายการ", settle: "รับชำระ", diff: "ส่วนต่าง", transfer: "รับเงินโอน" };

export function journalLines(groups: JournalGroup[]): JournalLine[] {
  const out = new Map<string, JournalLine>();
  for (const g of groups) {
    const cents = Math.round(Number(g.amount) * 100);
    const transfer = g.kind === "transfer";
    if (!cents || (transfer && g.settles_by_stm)) continue; // เงินโอนเข้าลูกหนี้ที่ตัดด้วย STM ลงผ่าน settle ของ STM แล้ว ลงซ้ำ = นับเงินสองครั้ง
    const ar: { type: AccountType; code: string | null; name: string } = transfer
      ? g.account_code?.startsWith("3")
        ? { type: "equity", code: g.account_code, name: g.account_name ?? PRIOR_YEAR_ACCOUNT.name } // บัญชีทุนของเงินโอนมีแค่ PRIOR_YEAR_ACCOUNT (ไม่อยู่ใน ar_account)
        : { type: g.account_code?.startsWith("4") ? "revenue" : "ar", code: g.account_code, name: g.account_name ?? "รายได้" }
      : { type: "ar", code: g.account_code, name: g.account_name ?? "ลูกหนี้ไม่ระบุบัญชี" };
    let other: { type: AccountType; code: string | null; name: string };
    const cap = g.source === "capitation";
    if (transfer) other = { type: "cash", code: null, name: CASH_NAME };
    else if (cap && g.kind === "settle") other = { type: "revenue", code: g.clear_code ?? null, name: "รายได้" };
    else if (cap && g.kind === "diff") other = { type: "diff_under", code: g.clear_short_code ?? null, name: CAP_SHORT_NAME };
    else if (g.kind === "diff" && g.prior_year) other = { type: "equity", ...PRIOR_DIFF_ACCOUNT };
    else if (g.kind === "settle") other = g.source === "fwf" ? { type: "pool", ...POOL_ACCOUNT } : { type: "cash", code: null, name: CASH_NAME };
    // diff ของ source HOSxP = เพดาน/สัดส่วนของกติกาบัญชี: บวกคือกลับรายการส่วนต่างเดิม จึงลงบัญชี diff_under ข้างเดียวกันเสมอ
    else if (g.kind === "diff")
      other = cents < 0 || g.source === "rcpt_debt" || g.source === "ipt" ? { type: "diff_under", code: g.diff_under_code, name: "ส่วนต่างค่ารักษาที่สูงกว่าข้อตกลง" } : { type: "diff_over", code: g.diff_over_code, name: "ส่วนต่างค่ารักษาที่ต่ำกว่าข้อตกลง" };
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
