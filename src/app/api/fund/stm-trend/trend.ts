// แนวโน้ม STM รายเดือน (/fund/stm-trend) แบบ pure
// ไม่มี import ค่า จึงใช้ได้ทั้ง route, หน้า (client) และ trend.test.mjs

/** แถว query 1: ยอดชดเชยต่อ (เดือนบริการ, scheme, OP/IP, กองทุน) ; fund คือ key ใน stm_summary.amounts (fund "IP" ของ UC ไม่ใช่ patient_type) */
export type FundRow = { period_month: string; scheme: string; patient_type: string; fund: string; amount: number };
/** แถว query 2: ตัวชี้วัดต่อ (เดือนบริการ, scheme, OP/IP) เดือนที่ไม่มีไฟล์ไม่มีแถว */
export type MetricRow = {
  period_month: string;
  scheme: string;
  patient_type: string;
  files: number;
  paid_all: number | null;
  claim_normal: number | null;
  /** UC OP เท่านั้น (กลุ่มอื่น null): ยอดเรียกเก็บ/ชดเชย section normal ของรายที่ REP ระบุกองทุน (ไม่ใช่เหมาจ่ายรายหัว) */
  claim_claimable: number | null;
  paid_claimable: number | null;
  cases: number | null;
  rw_all: number | null;
  rw_drg: number | null;
  drg_amount: number | null;
  first_run_no: number;
  lag_first_days: number | null;
  lag_avg_days: number | null;
  lag_max_days: number | null;
};
/** response ของ GET /api/fund/stm-trend?fy=<ปีงบ พ.ศ.> */
export type StmTrendResponse = { fy: number; funds: FundRow[]; months: MetricRow[] };

/** สีผูกกับกลุ่ม ใช้เหมือนกันทุกกราฟเส้น */
export const GROUPS = [
  { key: "uc-op", scheme: "UCS", patient_type: "OP", label: "UC OP", color: "--chart-2" },
  { key: "uc-ip", scheme: "UCS", patient_type: "IP", label: "UC IP", color: "--chart-1" },
  { key: "ofc-op", scheme: "OFC", patient_type: "OP", label: "OFC OP", color: "--chart-3" },
  { key: "ofc-ip", scheme: "OFC", patient_type: "IP", label: "OFC IP", color: "--chart-4" },
] as const;
export type Group = (typeof GROUPS)[number];
export type GroupKey = Group["key"];
export const groupOf = (key: string): Group => GROUPS.find((g) => g.key === key) ?? GROUPS[0];

const OFC_FUNDS = ["CARE", "DRUG", "INST", "ROOM", "TRANSPORT"] as const;
/** ลำดับ = สี --chart-1.. ของกองทุนต่อกลุ่ม (UC OP กับ UC IP กองทุนหลักต่างกัน) ; key อื่นรวมเป็น OTHER_FUND (--chart-other) */
export const FUND_ORDER: Record<GroupKey, readonly string[]> = {
  "uc-op": ["INST", "PP", "AE", "HC_DRUG", "AE_DRUG", "OP", "PALLIATIVE"],
  "uc-ip": ["IP", "DMIS", "INST", "AE", "PP", "HC_DRUG", "AE_DRUG"],
  "ofc-op": OFC_FUNDS,
  "ofc-ip": OFC_FUNDS,
};
export const OTHER_FUND = "OTHER";

const pad2 = (n: number) => String(n).padStart(2, "0");
const div = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? a / b : null);
const sumOf = (v: (number | null)[]) => v.reduce<number>((s, x) => s + (x ?? 0), 0);

/** 12 เดือนของปีงบ พ.ศ. YYYY-MM (ปีงบ 2569 = 2025-10..2026-09) */
export function fiscalMonths(fy: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((9 + i) % 12) + 1;
    return `${m >= 10 ? fy - 544 : fy - 543}-${pad2(m)}`;
  });
}

const inGroup = (g: Group) => (r: { scheme: string; patient_type: string }) => r.scheme === g.scheme && r.patient_type === g.patient_type;

/** ยอดต่อ (เดือน|กองทุน) ของกลุ่ม: กองทุนที่มียอดในปีงบ เรียงตาม FUND_ORDER แล้ว "อื่นๆ" ; ค่าติดลบคงไว้ */
function fundCells(rows: FundRow[], g: Group) {
  const order = FUND_ORDER[g.key];
  const bucket = (fund: string) => (order.includes(fund) ? fund : OTHER_FUND);
  const totals = new Map<string, number>();
  const cell = new Map<string, number>();
  const others = new Set<string>();
  for (const r of rows.filter(inGroup(g))) {
    const f = bucket(r.fund);
    if (f === OTHER_FUND && r.amount !== 0) others.add(r.fund);
    const k = `${r.period_month.slice(0, 7)}|${f}`;
    cell.set(k, (cell.get(k) ?? 0) + r.amount);
    totals.set(f, (totals.get(f) ?? 0) + Math.abs(r.amount));
  }
  const funds = [...order, OTHER_FUND]
    .filter((f) => (totals.get(f) ?? 0) > 0)
    .map((f) => ({ key: f, color: f === OTHER_FUND ? "--chart-other" : `--chart-${order.indexOf(f) + 1}` }));
  return { funds, cell, others: [...others].sort() };
}

/**
 * กองทุนของกลุ่มเป็น series ของกราฟแท่งซ้อน
 * values[เดือน][series] เดือนที่ไม่มีไฟล์ = 0 (แท่งว่าง)
 */
export function fundBars(rows: FundRow[], g: Group, months: string[]): { funds: { key: string; color: string }[]; values: number[][]; others: string[] } {
  const { funds, cell, others } = fundCells(rows, g);
  // แท่งซ้อนรับค่าติดลบไม่ได้ (ยอดหักคืนของเดือน) จึงตัดเป็น 0 ; ยอดรวมของ KPI ใช้ paid_all
  const values = months.map((m) => funds.map((f) => Math.max(0, cell.get(`${m}|${f.key}`) ?? 0)));
  return { funds, values, others };
}

export type FundTable = {
  /** ลำดับเดียวกับ series ของ fundBars ; values ตามลำดับ months, null = กลุ่มไม่มีไฟล์ STM เดือนนั้น ; share = สัดส่วนของยอดรวมปีงบ (0–1) */
  funds: { key: string; values: (number | null)[]; total: number; share: number | null }[];
  /** แถวรวม = ผลรวมทุกกองทุน (paid_total ก่อนหัก) */
  total: { values: (number | null)[]; total: number };
  others: string[];
};

/** ตารางสรุปรายกองทุนของกลุ่ม: ค่าจริง (ติดลบได้ ไม่ตัดเหมือนแท่ง) ; เดือนที่มีไฟล์แต่กองทุนไม่มียอด = 0 */
export function fundTable(data: { funds: FundRow[]; months: MetricRow[] }, g: Group, months: string[]): FundTable {
  const { funds, cell, others } = fundCells(data.funds, g);
  const has = new Set(data.months.filter(inGroup(g)).map((r) => r.period_month.slice(0, 7)));
  const rows = funds.map((f) => {
    const values = months.map((m) => (has.has(m) ? (cell.get(`${m}|${f.key}`) ?? 0) : null));
    return { key: f.key, values, total: sumOf(values) };
  });
  const values = months.map((m, i) => (has.has(m) ? sumOf(rows.map((r) => r.values[i])) : null));
  const total = sumOf(values);
  return { funds: rows.map((r) => ({ ...r, share: total ? r.total / total : null })), total: { values, total }, others };
}

export type GroupTrend = {
  group: Group;
  /** ค่าต่อเดือนตามลำดับ months ; null = ไม่มีไฟล์หรือหารไม่ได้ */
  paid: (number | null)[];
  rate: (number | null)[];
  bahtPerRw: (number | null)[];
  cmi: (number | null)[];
  lag: (number | null)[];
  /** ทั้งปีงบ: ผลรวมก่อนหาร (ไม่ใช่ค่าเฉลี่ยของรายเดือน) */
  total: { paid: number | null; rate: number | null; bahtPerRw: number | null; cmi: number | null };
  /** วันที่ STM งวดแรกของทุกเดือนอยู่ในสัปดาห์เดียวกัน = วันที่ที่ใส่ตอนนำเข้าย้อนหลัง ไม่ใช่วันโอนจริง */
  lagImported: boolean;
};

/** วันสิ้นเดือน + n วัน เป็น epoch วัน (UTC) */
const transferDay = (ym: string, lag: number) => Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0) / 86_400_000 + lag;
/** เกณฑ์ว่าวันที่ STM เป็นวันนำเข้า: อย่างน้อยกี่เดือน และวันที่ห่างกันไม่เกินกี่วัน */
const IMPORTED_MIN_MONTHS = 3;
const IMPORTED_SPAN_DAYS = 7;

export function groupTrend(rows: MetricRow[], g: Group, months: string[]): GroupTrend {
  const byMonth = new Map(rows.filter(inGroup(g)).map((r) => [r.period_month.slice(0, 7), r]));
  const at = months.map((m) => byMonth.get(m) ?? null);
  const pick = (f: (r: MetricRow) => number | null) => at.map((r) => (r ? f(r) : null));
  const present = at.filter((r): r is MetricRow => r !== null);
  const total = (k: keyof MetricRow, filter?: (r: MetricRow) => boolean) =>
    present.some((r) => r[k] != null) ? sumOf(present.filter(filter ?? (() => true)).map((r) => r[k] as number | null)) : null;
  // UC OP: อัตราเทียบเฉพาะรายที่ REP ระบุกองทุน เพราะ claim ทั้ง visit ส่วนใหญ่เป็นเหมาจ่ายรายหัวที่ STM จ่าย 0
  const [paidKey, claimKey] = g.key === "uc-op" ? (["paid_claimable", "claim_claimable"] as const) : (["paid_all", "claim_normal"] as const);
  const days = months.flatMap((m, i) => (at[i]?.lag_first_days != null ? [transferDay(m, at[i]!.lag_first_days!)] : []));
  return {
    group: g,
    paid: pick((r) => r.paid_all),
    rate: pick((r) => div(r[paidKey], r[claimKey])),
    bahtPerRw: pick((r) => div(r.drg_amount, r.rw_drg)),
    cmi: pick((r) => div(r.rw_all, r.cases)),
    lag: pick((r) => r.lag_first_days),
    total: {
      paid: total("paid_all"),
      // อัตราทั้งปีหารเฉพาะเดือนที่มียอดเรียกเก็บ กันเดือนที่ไม่มี claim ทำให้อัตราสูงเกินจริง
      rate: div(total(paidKey, (r) => !!r[claimKey]), total(claimKey)),
      bahtPerRw: div(total("drg_amount"), total("rw_drg")),
      cmi: div(total("rw_all"), total("cases")),
    },
    lagImported: days.length >= IMPORTED_MIN_MONTHS && Math.max(...days) - Math.min(...days) <= IMPORTED_SPAN_DAYS,
  };
}
