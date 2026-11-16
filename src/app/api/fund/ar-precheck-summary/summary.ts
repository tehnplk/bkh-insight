// สรุปค่ารักษาก่อนตั้งหนี้ต่อประเภทผู้ป่วยและกลุ่มสิทธิ แบบ pure (ไม่มี import ค่า) รันทดสอบด้วย node ได้ตรง (summary.test.mjs)

/** หนึ่งราย (visit/admission) ที่ route แปลงจาก buildRows ของ ar-precheck แล้ว ; income/paid_money/rcpt_money null = ไม่มีข้อมูลสรุป */
export type SummaryLine = {
  fund: string;
  fund_name: string;
  rx_total: number;
  rx_pay: number;
  income: number | null;
  paid_money: number | null;
  rcpt_money: number | null;
  /** PPFS: รายการลูกหนี้สิทธิ (paidst 02) หมวดส่งเสริมป้องกัน (income 21) ; IPD = 0 */
  pp: number;
  /** สถานะของ ar-precheck ที่ต้องแก้ (isMismatch) */
  mismatch: boolean;
};

export type SummaryTotals = {
  count: number;
  rx_total: number;
  rx_pay: number;
  income: number;
  paid_money: number;
  rcpt_money: number;
  pp: number;
  /** ลูกหนี้ = ค่าใช้จ่ายทั้งหมด (สรุป) − ชำระเงินแล้ว − PPFS จึงรวมส่วนชำระเองที่ยังค้าง */
  debt: number;
  mismatch: number;
};
export type SummaryPanel = { total: SummaryTotals; funds: (SummaryTotals & { fund: string; fund_name: string })[] };
/** response ของ GET /api/fund/ar-precheck-summary */
export type SummaryResponse = { opd: SummaryPanel; ipd: SummaryPanel };

const MONEY = ["rx_total", "rx_pay", "income", "paid_money", "rcpt_money", "pp"] as const;
/** รวมเป็นสตางค์ กันทศนิยมลอยตัว */
const cents = (v: number | null) => Math.round((v ?? 0) * 100);

function totals(lines: SummaryLine[]): SummaryTotals {
  const c = Object.fromEntries(MONEY.map((k) => [k, 0])) as Record<(typeof MONEY)[number], number>;
  let mismatch = 0;
  for (const l of lines) {
    for (const k of MONEY) c[k] += cents(l[k]);
    if (l.mismatch) mismatch++;
  }
  const debt = c.income - c.rcpt_money - c.pp;
  const baht = Object.fromEntries(MONEY.map((k) => [k, c[k] / 100])) as Record<(typeof MONEY)[number], number>;
  return { count: lines.length, ...baht, debt: debt / 100, mismatch };
}

/** ยอดรวมและแยกกลุ่มสิทธิ เรียงตามรหัส (UNKNOWN ท้ายสุด) */
export function summarizePanel(lines: SummaryLine[]): SummaryPanel {
  const groups = new Map<string, SummaryLine[]>();
  for (const l of lines) {
    const g = groups.get(l.fund);
    if (g) g.push(l);
    else groups.set(l.fund, [l]);
  }
  const funds = [...groups]
    .map(([fund, g]) => ({ fund, fund_name: g[0].fund_name, ...totals(g) }))
    .sort((a, b) => Number(a.fund === "UNKNOWN") - Number(b.fund === "UNKNOWN") || a.fund.localeCompare(b.fund));
  return { total: totals(lines), funds };
}
