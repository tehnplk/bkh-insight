// รายการค่าใช้จ่ายของลูกหนี้หนึ่งราย (modal ใน /fund/uc-debtor) แบบ pure มีแค่ import type จึงรันทดสอบด้วย node ได้ตรง (items.test.mjs)
import type { CategoryAmount, VisitItem } from "../../types";

/** paidst ของ opitemrece ที่เป็นลูกหนี้สิทธิ (ส่วนที่รวมเป็น uc_money) */
export const DEBTOR_PAIDST = "02";

/** ป้ายของรายการที่ไม่ใช่ลูกหนี้สิทธิ null = ไม่ได้ตั้ง paidst */
export const PAIDST_LABEL: Record<string, { label: string; title: string }> = {
  "00": { label: "ค้างชำระ", title: "ค้างชำระ" },
  "01": { label: "ชำระเอง", title: "ชำระเอง เบิกได้" },
  "03": { label: "ชำระเอง", title: "ชำระเอง เบิกไม่ได้" },
  "04": { label: "ส่วนลด", title: "ส่วนลด" },
};

export type DebtorItem = VisitItem & { paidst: string | null };

/** response ของ /api/fund/uc-debtor/items categories เรียงตาม amount มากไปน้อย */
export type DebtorItemsResponse = {
  /** ยอดรายการ paidst 02 */
  debtor: number;
  /** ยอดรายการ paidst อื่นหรือ null */
  other: number;
  total: number;
  categories: (CategoryAmount & { items: DebtorItem[] })[];
};

/** แถวจาก hisQuery (SUM/DECIMAL อาจมาเป็น string) */
export type ItemRow = {
  income: string; icode: string; name: string | null; unitprice: number | string; paidst: string | null;
  qty: number | string; amount: number | string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** จัดหมวดตาม income (แบบเดียวกับ /api/fund/opd-fund/visit-items) และรวมยอดตาม paidst */
export function groupDebtorItems(rows: ItemRow[], incomeName: (code: string) => string): DebtorItemsResponse {
  const cats = new Map<string, { amount: number; items: DebtorItem[] }>();
  let debtor = 0, total = 0;
  for (const r of rows) {
    const amount = Number(r.amount);
    total += amount;
    if (r.paidst === DEBTOR_PAIDST) debtor += amount;
    let c = cats.get(r.income);
    if (!c) cats.set(r.income, (c = { amount: 0, items: [] }));
    c.amount += amount;
    c.items.push({
      icode: r.icode, name: r.name ?? r.icode, qty: Number(r.qty), unitprice: round2(Number(r.unitprice)),
      amount: round2(amount), paidst: r.paidst,
    });
  }
  return {
    debtor: round2(debtor),
    other: round2(total - debtor),
    total: round2(total),
    categories: [...cats]
      .map(([income_code, c]) => ({ income_code, income_name: incomeName(income_code), amount: round2(c.amount), items: c.items }))
      .sort((a, b) => b.amount - a.amount),
  };
}
