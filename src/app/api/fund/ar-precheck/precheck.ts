// กระทบยอดค่ารักษา (ใบสั่งยา opitemrece) กับข้อมูลสรุป (vn_stat/an_stat) และยอดตั้งหนี้ ก่อนลงลูกหนี้
// pure ไม่มี import จึงรันทดสอบด้วย node ได้ตรง (precheck.test.mjs)

export type PrecheckType = "opd" | "ipd";
/** ค่าเดียวต่อราย ตามลำดับการตรวจ (ข้อแรกที่ไม่ผ่าน) */
export type PrecheckStatus =
  | "no_stat" | "stale_slip" | "admitted" | "overdue_lock" | "pending_lock"
  | "total" | "stale_stat" | "split" | "keyed_after" | "debt" | "unlocked" | "unpaid" | "ok";
export const STATUS_LABEL: Record<PrecheckStatus, string> = {
  no_stat: "ไม่มีข้อมูลสรุป",
  stale_slip: "ใบลูกหนี้ค้างหลัง admit",
  admitted: "admit แล้ว ตรวจที่ผู้ป่วยใน",
  overdue_lock: "ค้างล็อกเกินกำหนด",
  pending_lock: "ยังไม่ล็อกรายการ",
  total: "ค่าใช้จ่ายไม่ตรง",
  stale_stat: "ยอดสรุป HOSxP ไม่อัปเดต",
  split: "แยกชำระ/ลูกหนี้ไม่ตรง",
  keyed_after: "คีย์รายการหลังออกใบ",
  debt: "ใบลูกหนี้ไม่ตรง",
  unlocked: "ยังไม่ปิดการเงิน",
  unpaid: "ค้างชำระ",
  ok: "ตรง",
};
/** สถานะที่ยังไม่ต้องแก้: ตรง หรือรอขั้นตอนปกติของ HOSxP (นับ "ไม่ตรง" และ only=mismatch จากนี้ที่เดียว) */
const SETTLED = new Set<PrecheckStatus>(["ok", "admitted", "pending_lock"]);
export const isMismatch = (s: PrecheckStatus) => !SETTLED.has(s);
export const lockLabel = (financeLock: string | null) => (financeLock === "Y" ? "ล็อกแล้ว" : "ยังไม่ล็อก");

/** HOSxP ล็อกรายการ OPD ทุกวันราว 16.00 น. จึงให้เวลา 3 วันทำการ (จ.–ศ.) นับวันหลังวันรับบริการถึงวันนี้
 *  เกินกำหนดเมื่อนับได้เกิน 3 เช่น รับบริการ ศ. 13 พ.ย. วันนี้ พ. 18 พ.ย. นับ จ. อ. พ. = 3 ยังไม่เกิน, พฤ. 19 = 4 เกิน
 *  shortcut: ไม่หักวันหยุดราชการ (ไม่มีตารางวันหยุด) ช่วงสงกรานต์/ปีใหม่จะขึ้นเกินกำหนดเร็วไป ; ถ้ามีตารางวันหยุดค่อยหักออก */
export function lockOverdue(date: string, today: string): boolean {
  const end = Date.parse(today);
  let n = 0;
  for (let t = Date.parse(date) + 86_400_000; t <= end && n <= 3; t += 86_400_000) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n > 3;
}
export const ADMIT_LABEL = { yes: "admit แล้ว", no: "ไม่ admit" } as const;

// ค่าจาก mysql2/pg (decimal/numeric) มาเป็น string
type Num = number | string | null | undefined;

/** หนึ่งราย: OPD = visit (key = vn), IPD = admission ที่จำหน่ายในช่วง (key = an) */
export type PrecheckSource = {
  key: string;
  vn: string | null;
  an: string | null;
  hn: string;
  patient_name: string;
  /** OPD = วันรับบริการ, IPD = วันจำหน่าย */
  date: string;
  regdate: string | null;
  pttype: string | null;
  pttype_name: string;
  fund: string;
  fund_name: string;
  has_stat: boolean | number | string;
  income: Num;
  paid_money: Num;
  rcpt_money: Num;
  uc_money: Num;
  /** OPD: SUM(rcpt_debt.amount) ที่ไม่ ABORT */
  debt_amount: Num;
  /** OPD: ovst.finance_lock, IPD: ipt.finance_lock ('Y' = ล็อกแล้ว) */
  finance_lock: string | null;
};
export type RxSum = { key: string; n_items: Num; rx_total: Num; rx_pay: Num; rx_debt: Num };
export type Booked = { key: string; booked: Num };

export type PrecheckRow = Omit<PrecheckSource, "has_stat" | "income" | "paid_money" | "rcpt_money" | "uc_money" | "debt_amount"> & {
  admit: keyof typeof ADMIT_LABEL;
  n_items: number;
  rx_total: number;
  rx_pay: number;
  rx_debt: number;
  income: number | null;
  paid_money: number | null;
  rcpt_money: number | null;
  uc_money: number | null;
  /** ตั้งหนี้แล้วใน HOSxP: OPD = ใบลูกหนี้, IPD = uc_money เมื่อปิดการเงินแล้ว ไม่งั้น 0 */
  debt: number;
  /** ลงสมุดลูกหนี้แล้ว null = อ่าน insight ไม่ได้ */
  booked: number | null;
  diff_total: number | null;
  diff_debt: number | null;
  status: PrecheckStatus;
};

/** เทียบเป็นสตางค์ กันทศนิยมลอยตัว (0.1 + 0.2) */
const cents = (v: Num) => Math.round(Number(v ?? 0) * 100);
const baht = (c: number) => c / 100;

/** booked = null คืออ่านสมุดลูกหนี้ไม่ได้ (ทุกแถวเป็น null) ไม่มีแถวในสมุด = 0 ; today = วันนี้เวลาไทย ISO */
export function buildRows(type: PrecheckType, sources: PrecheckSource[], rx: RxSum[], booked: Booked[] | null, today: string): PrecheckRow[] {
  const rxBy = new Map(rx.map((r) => [r.key, r]));
  const bookedBy = booked && new Map(booked.map((b) => [b.key, cents(b.booked)]));
  return sources.map(({ has_stat, income, paid_money, rcpt_money, uc_money, debt_amount, ...s }) => {
    const x = rxBy.get(s.key);
    const total = cents(x?.rx_total), pay = cents(x?.rx_pay), rxDebt = cents(x?.rx_debt);
    const stat = Boolean(Number(has_stat));
    const inc = cents(income), paid = cents(paid_money), rcpt = cents(rcpt_money), uc = cents(uc_money);
    const locked = s.finance_lock === "Y";
    const opd = type === "opd";
    const debt = opd ? cents(debt_amount) : locked ? uc : 0;
    const nItems = Number(x?.n_items ?? 0);
    const status: PrecheckStatus =
      !stat ? "no_stat"
      // HOSxP ย้ายรายการไป AN ตอน admit แต่ไม่ยกเลิกใบลูกหนี้ OPD ที่ออกก่อน admit
      : opd && s.an ? (debt > 0 && nItems === 0 ? "stale_slip" : "admitted")
      : opd && !locked ? (lockOverdue(s.date, today) ? "overdue_lock" : "pending_lock")
      : total !== inc ? "total"
      // ใบลูกหนี้ตรงกับรายการ paidst 02 แล้ว แต่ vn_stat.uc_money ยังเป็นยอดเดิม
      : opd && debt === rxDebt && uc !== rxDebt ? "stale_stat"
      : pay !== paid || rxDebt !== uc ? "split"
      : opd && debt < rxDebt ? "keyed_after"
      : opd && debt > rxDebt ? "debt"
      : !locked ? "unlocked"
      : paid - rcpt > 0 ? "unpaid"
      : "ok";
    const b = bookedBy ? (bookedBy.get(s.key) ?? 0) : null;
    return {
      ...s,
      admit: s.an ? "yes" : "no",
      n_items: nItems,
      rx_total: baht(total),
      rx_pay: baht(pay),
      rx_debt: baht(rxDebt),
      income: stat ? baht(inc) : null,
      paid_money: stat ? baht(paid) : null,
      rcpt_money: stat ? baht(rcpt) : null,
      uc_money: stat ? baht(uc) : null,
      debt: baht(debt),
      booked: b == null ? null : baht(b),
      diff_total: stat ? baht(total - inc) : null,
      diff_debt: stat ? baht(uc - debt) : null,
      status,
    };
  });
}

export type PrecheckTotals = {
  count: number;
  rx_total: number;
  rx_pay: number;
  income: number;
  paid_money: number;
  rcpt_money: number;
  uc_money: number;
  debt: number;
  booked: number | null;
  /** รายที่ต้องแก้ (isMismatch) */
  mismatch: number;
  diff_total: number;
  diff_debt: number;
};
export type PrecheckSummary = { total: PrecheckTotals; funds: (PrecheckTotals & { fund: string; fund_name: string })[] };
/** response ของ /api/fund/ar-precheck (GridPage + สรุป) ledger_error = อ่านสมุดลูกหนี้ไม่ได้ */
export type PrecheckPage = { rows: PrecheckRow[]; total: number; summary: PrecheckSummary; ledger_error: string | null };

const MONEY = ["rx_total", "rx_pay", "income", "paid_money", "rcpt_money", "uc_money", "debt", "diff_total", "diff_debt"] as const;

function totals(rows: PrecheckRow[], ledgerOk: boolean): PrecheckTotals {
  const sum = Object.fromEntries(MONEY.map((k) => [k, 0])) as Record<(typeof MONEY)[number], number>;
  let booked = 0, mismatch = 0;
  for (const r of rows) {
    for (const k of MONEY) sum[k] += cents(r[k]);
    booked += cents(r.booked);
    if (isMismatch(r.status)) mismatch++;
  }
  for (const k of MONEY) sum[k] = baht(sum[k]);
  return { count: rows.length, ...sum, booked: ledgerOk ? baht(booked) : null, mismatch };
}

/** ยอดรวมและแยกกองทุน (เรียงจำนวนรายมากไปน้อย) */
export function summarize(rows: PrecheckRow[]): PrecheckSummary {
  const ledgerOk = rows.every((r) => r.booked != null);
  const groups = new Map<string, PrecheckRow[]>();
  for (const r of rows) {
    const g = groups.get(r.fund);
    if (g) g.push(r);
    else groups.set(r.fund, [r]);
  }
  const funds = [...groups]
    .map(([fund, g]) => ({ fund, fund_name: g[0].fund_name, ...totals(g, ledgerOk) }))
    .sort((a, b) => b.count - a.count || a.fund.localeCompare(b.fund));
  return { total: totals(rows, ledgerOk), funds };
}

/** ค้นหา VN/AN/HN/ชื่อ แบบมีคำนั้นอยู่ */
export const matches = (r: PrecheckRow, q: string) => [r.vn, r.an, r.hn, r.patient_name].some((v) => v?.includes(q));

export type SortKey = keyof PrecheckRow;
/** เรียงตามคอลัมน์ ค่าว่างอยู่ท้ายทั้งสองทิศ แล้วเรียงตามวันที่และ key ให้ผลคงที่ */
export function sortRows(rows: PrecheckRow[], key: SortKey, dir: "asc" | "desc"): PrecheckRow[] {
  const sign = dir === "desc" ? -1 : 1;
  const value = (r: PrecheckRow) => (key === "status" ? STATUS_LABEL[r.status] : key === "admit" ? r.an : r[key]);
  return rows.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if ((x == null) !== (y == null)) return x == null ? 1 : -1;
    const c =
      x == null || y == null ? 0
      : typeof x === "number" && typeof y === "number" ? x - y
      : String(x).localeCompare(String(y), "th", { numeric: true });
    return sign * c || a.date.localeCompare(b.date) || a.key.localeCompare(b.key);
  });
}
