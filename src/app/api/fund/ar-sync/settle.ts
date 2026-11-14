// ตัดหนี้ด้วย STM แบบ pure (import แค่ type) ทดสอบด้วย node ได้ตรง (settle.test.mjs) ยอดคิดเป็นสตางค์
// หลัก (ผู้ใช้เลือก 14 พ.ย. 2569): ตัดเฉพาะบัญชีที่ settles_by_stm และปิดหนี้ทั้งก้อน = settle (ยอดที่จ่าย) + diff (ส่วนต่างให้คงเหลือ 0)
import type { Entry, RefState } from "./ledger";

/** แถว STM ที่ยังไม่ได้ตัด (paid_total ≠ 0) vn/an จาก stm_row หรือจาก rep_row ด้วย tran_id */
export type StmLine = { id: string; patient_type: "OP" | "IP"; vn: string | null; an: string | null; paid_total: string | number; transfer_date: string };
/** หนี้ที่ตัดได้ (แถว set ของบัญชี settles_by_stm) balance = สตางค์ รวมทุก source ของหนี้ (HOSxP + stm + manual) */
export type DebtState = RefState;
export type SettleEntry = Omit<Entry, "source" | "kind"> & { source: "stm"; kind: "settle" | "diff"; stm_row_id: string };

const cents = (v: string | number) => Math.round(Number(v) * 100);
const baht = (c: number) => (c / 100).toFixed(2);
export const debtKey = (pt: "OP" | "IP", vnOrAn: string) => `${pt}:${vnOrAn}`;

/**
 * แต่ละแถว STM: หาหนี้ของ VN (OP) หรือ AN (IP) แบ่งยอดที่จ่ายให้หนี้ที่คงเหลือมากก่อน ส่วนเกินลงหนี้สุดท้าย แล้วปิดทุกหนี้ด้วย diff
 * หนี้ที่ปิดแล้ว (คงเหลือ 0) ได้เงินเพิ่มจาก STM งวดหลัง = settle + diff บวก (ได้รับสูงกว่า) ยอดหนี้ยังเป็น 0
 * debts ถูกแก้ balance ในตัว ให้แถว STM ถัดไปของหนี้เดียวกันในรอบเดียวกันเห็นยอดล่าสุด
 */
export function planSettle(lines: StmLine[], debts: Map<string, DebtState[]>): { entries: SettleEntry[]; unmatched: number } {
  const entries: SettleEntry[] = [];
  let unmatched = 0;
  for (const line of lines) {
    const id = line.patient_type === "OP" ? line.vn : line.an;
    const list = id ? debts.get(debtKey(line.patient_type, id)) : undefined;
    if (!list?.length) {
      unmatched++;
      continue;
    }
    let remaining = cents(line.paid_total);
    const sorted = [...list].sort((a, b) => b.balance - a.balance || a.ref.localeCompare(b.ref));
    sorted.forEach((d, i) => {
      const alloc = i === sorted.length - 1 ? remaining : Math.min(Math.max(d.balance, 0), remaining);
      remaining -= alloc;
      const row = (kind: "settle" | "diff", amount: number, note: string): SettleEntry => ({
        source: "stm", kind, ref: d.ref, vn: d.vn, an: d.an, patient_type: d.patient_type, ref_date: d.ref_date, entry_date: line.transfer_date,
        pttype: d.pttype, hipdata_code: d.hipdata_code, hospmain: d.hospmain, hospmain_chwpart: d.hospmain_chwpart, account_code: d.account_code,
        amount: baht(amount), note, stm_row_id: line.id,
      });
      if (alloc !== 0) entries.push(row("settle", -alloc, "รับชำระตาม STM"));
      const diff = -(d.balance - alloc);
      if (diff !== 0) entries.push(row("diff", diff, diff < 0 ? "ได้รับต่ำกว่าลูกหนี้" : "ได้รับสูงกว่าลูกหนี้"));
      d.balance = 0;
    });
  }
  return { entries, unmatched };
}
