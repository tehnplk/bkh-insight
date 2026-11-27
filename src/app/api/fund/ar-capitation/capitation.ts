// ตัดหนี้เหมาจ่ายสิ้นเดือน (/fund/ar-capitation) แบบ pure (ไม่มี import ค่า) ทดสอบด้วย node ได้ตรง (capitation.test.mjs) ยอดคิดเป็นสตางค์
// หนี้ .201/.209 ที่คงเหลือ ตั้งหนี้ในปีงบถึงสิ้นเดือน เรียงวันที่ตั้งหนี้แล้ว ref ตัดเท่าที่ pool เหลือ ส่วนที่ไม่พอลง diff ทันที หนี้ทุกรายจึงเหลือ 0

type Num = string | number;
const cents = (v: Num | null | undefined) => Math.round(Number(v ?? 0) * 100);
const baht = (c: number) => (c / 100).toFixed(2);

/** แถว set ของหนี้ + คงเหลือทุก source */
export type CapDebt = {
  ref: string; vn: string | null; an: string | null; patient_type: "OP" | "IP"; ref_date: string | null; pttype: string | null; hipdata_code: string | null;
  hospmain: string | null; hospmain_chwpart: string | null; hospmain_type: string | null; account_code: string | null; balance: Num;
};
export type CapRow = { patient_type: "OP" | "IP"; ref: string; vn: string | null; an: string | null; ref_date: string; balance: number; settle: number; diff: number };
/** แถวที่จะลง ar_ledger (source capitation) amount เป็นบาท string ติดลบ */
export type CapEntry = Omit<CapDebt, "balance"> & { source: "capitation"; kind: "settle" | "diff"; entry_date: string; amount: string; note: string };
export type CapTotals = { n: number; balance: number; settle: number; diff: number; settle_n: number; diff_n: number };
export type CapPlan = { pool_before: number; pool_after: number; rows: CapRow[]; entries: CapEntry[]; totals: CapTotals };

/** ปีงบเริ่ม 1 ต.ค. : ต้นปีงบของเดือน YYYY-MM */
export const fyStartOf = (month: string) => `${+month.slice(0, 4) - (+month.slice(5, 7) >= 10 ? 0 : 1)}-10-01`;

/** pool คงเหลือ = รับโอนในปีงบถึงสิ้นเดือน − ที่ตัดไปแล้วในปีงบ (ทุกเดือน ตัดย้อนเดือนจึงใช้ pool ซ้ำไม่ได้) ไม่ติดลบ */
export const poolAvailable = (received: Num, used: Num) => Math.max(0, cents(received) - cents(used)) / 100;

/**
 * เหตุที่ยืนยันตัดหนี้ของ (เดือน, บัญชี) ไม่ได้ (null = ได้) ; เดือนที่ปิดงวดแล้วไม่ตัด เพราะรายได้/ส่วนต่างของงวดที่ปิดต้องไม่เปลี่ยน
 * มีเงินโอนเข้า clear_code ที่รอออกใบเสร็จ (โอนถึงสิ้นเดือน) = pool ยังไม่ครบ ตัดตอนนี้หนี้จะลงส่วนต่างทั้งที่มีเงินแล้ว
 */
export function capBlock(x: {
  ended: boolean; month: string; through: string | null; code: string; clear_code: string; clear_short_code: string | null;
  pending_n: number; entries: number;
}): string | null {
  if (!x.ended) return "ยืนยันได้เมื่อจบเดือนแล้ว";
  if (x.through && x.month <= x.through) return `งวดถึงเดือน ${x.through} ปิดแล้ว ตัดหนี้ของเดือนที่ปิดไม่ได้`;
  // นับรายการ ไม่ใช่ยอด: ยอดรอรับติดลบ (ถูกหัก) ก็ทำให้ pool ไม่ตรง
  if (x.pending_n > 0) return `มีเงินโอนเข้า ${x.clear_code} รอออกใบเสร็จ ${x.pending_n} รายการ ลงรับที่หน้าเงินโอนที่ได้รับก่อนตัดหนี้`;
  if (!x.clear_short_code) return `ยังไม่กำหนดบัญชีส่วนต่างของ ${x.code}`;
  if (!x.entries) return "ไม่มีหนี้คงเหลือที่ต้องตัด";
  return null;
}

/** แผนตัดหนี้: หนี้ balance > 0 ที่ from ≤ ref_date ≤ end ตัด min(คงเหลือ, pool) ที่เหลือลง diff ; entry_date = end */
export function planCapitation(debts: CapDebt[], pool: Num, from: string, end: string): CapPlan {
  let left = Math.max(0, cents(pool));
  const before = left;
  const rows: CapRow[] = [], entries: CapEntry[] = [];
  const sorted = debts
    .map((d) => ({ d, bal: cents(d.balance) }))
    .filter((x) => x.bal > 0 && x.d.ref_date && x.d.ref_date >= from && x.d.ref_date <= end)
    .sort((a, b) => a.d.ref_date!.localeCompare(b.d.ref_date!) || a.d.ref.localeCompare(b.d.ref));
  for (const { d, bal } of sorted) {
    const settle = Math.min(bal, left);
    const diff = bal - settle;
    left -= settle;
    rows.push({ patient_type: d.patient_type, ref: d.ref, vn: d.vn, an: d.an, ref_date: d.ref_date!, balance: bal / 100, settle: settle / 100, diff: diff / 100 });
    const { balance, ...base } = d;
    void balance;
    if (settle) entries.push({ ...base, source: "capitation", kind: "settle", entry_date: end, amount: baht(-settle), note: "ตัดด้วยเงินเหมาจ่าย" });
    if (diff) entries.push({ ...base, source: "capitation", kind: "diff", entry_date: end, amount: baht(-diff), note: "เงินเหมาจ่ายไม่พอ ลงส่วนต่าง" });
  }
  const sum = (k: "balance" | "settle" | "diff") => rows.reduce((s, r) => s + cents(r[k]), 0) / 100;
  return {
    pool_before: before / 100, pool_after: left / 100, rows, entries,
    totals: { n: rows.length, balance: sum("balance"), settle: sum("settle"), diff: sum("diff"), settle_n: rows.filter((r) => r.settle > 0).length, diff_n: rows.filter((r) => r.diff > 0).length },
  };
}
