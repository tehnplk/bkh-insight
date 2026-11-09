// สรุปภาพรวมลูกหนี้ UC ทั้งปีงบ จากแถวที่จับคู่ REP แล้ว (mergeDebtors ใน uc-debtor/debtor.ts) แบบ pure
// มีแค่ import type จึงรันทดสอบด้วย node ได้ตรง (dashboard.test.mjs)
import type { DebtorMatch, DebtorStatus } from "../uc-debtor/debtor";

/** tag ของ cache ภาพรวมทั้งหน้า ล้างหลังนำเข้า REP สำเร็จ (/api/fund/rep-import) */
export const UC_DASHBOARD_TAG = "uc-dashboard";
/** ปีงบที่เลือกได้ย้อนหลังจากปีงบปัจจุบัน */
export const FY_BACK = 4;

export type DashRow = { key: string; date: string; debtor: number } & DebtorMatch;
export type Amount = { count: number; debtor: number; comp: number };
export type Totals = Record<DebtorStatus | "total", Amount>;
export type MonthRow = { month: string; opd: Totals; ipd: Totals };
export const AGING_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
export type AgingRow = { bucket: (typeof AGING_BUCKETS)[number]; opd: Amount; ipd: Amount };
type CodeUse = { count: number; debtor: number; last: string };
export type ErrorRank = { code: string; count: number; debtor: number; opd: CodeUse; ipd: CodeUse };
export type ErrorInfo = { kind: string | null; description: string | null; fix: string | null };

/** response ของ /api/fund/uc-dashboard */
export type UcDashboard = {
  /** ปีงบ พ.ศ. */
  fy: number;
  fyOptions: number[];
  /** ช่วงของปีงบ ISO ค.ศ. end ไม่เกินวันนี้ */
  start: string;
  end: string;
  today: string;
  /** เวลาที่คำนวณ (cache อยู่ได้ราว 1 ชั่วโมง) */
  generatedAt: string;
  /** ปีงบนี้มีแถว REP อย่างน้อยหนึ่งแถว */
  hasRep: boolean;
  totals: { opd: Totals; ipd: Totals };
  months: MonthRow[];
  aging: AgingRow[];
  /** 10 อันดับรหัส error ตามยอดลูกหนี้ visit ที่มีหลายรหัสนับในทุกรหัส */
  errors: (ErrorRank & ErrorInfo)[];
  /** ชดเชยรายกองทุนจาก fund_amounts (ไม่รวม base rate) */
  funds: { key: string; amount: number }[];
  /** ชดเชยต้นสังกัด SUM(net_affiliation) */
  affiliation: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const pad2 = (n: number) => String(n).padStart(2, "0");
const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** ปีงบ พ.ศ. ของวันที่ ISO: ต.ค.–ธ.ค. เป็นปีงบถัดไป (1 ต.ค. 2568 = ปีงบ 2569) */
export function fiscalYearOf(iso: string): number {
  const y = +iso.slice(0, 4);
  return (+iso.slice(5, 7) >= 10 ? y + 1 : y) + 543;
}

/** ปีงบ 2569 = 2025-10-01..2026-09-30 ปีงบปัจจุบันจบที่วันนี้ */
export function fiscalYearRange(fy: number, today: string): { start: string; end: string } {
  const end = `${fy - 543}-09-30`;
  return { start: `${fy - 544}-10-01`, end: end < today ? end : today };
}

/** fy ต้องเป็นปี พ.ศ. 4 หลัก อยู่ในช่วง FY_BACK ปีก่อนถึงปีงบปัจจุบัน */
export function parseFiscalYear(raw: string, currentFy: number): number | null {
  if (!/^\d{4}$/.test(raw)) return null;
  const fy = Number(raw);
  return fy >= currentFy - FY_BACK && fy <= currentFy ? fy : null;
}

/** เดือนของปีงบ ต.ค.→ก.ย. รูปแบบ YYYY-MM */
export function fiscalMonths(fy: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((9 + i) % 12) + 1;
    return `${m >= 10 ? fy - 544 : fy - 543}-${pad2(m)}`;
  });
}

const amount = (): Amount => ({ count: 0, debtor: 0, comp: 0 });
const totals = (): Totals => ({ paid: amount(), error: amount(), none: amount(), total: amount() });
const codeUse = (): CodeUse => ({ count: 0, debtor: 0, last: "" });

function add(a: Amount, r: DashRow) {
  a.count++;
  a.debtor += r.debtor;
  a.comp += r.compensation ?? 0;
}

function bucketOf(date: string, today: string): AgingRow["bucket"] {
  const days = (utc(today) - utc(date)) / DAY_MS;
  return days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
}

/** ปัดเงินทุกช่องเป็น 2 ตำแหน่งหลังรวมเสร็จ (รวมทีละแถวแล้วปัดทีเดียว ไม่สะสมเศษปัด) */
function roundAll<T>(v: T): T {
  if (typeof v === "number") return round2(v) as T;
  if (Array.isArray(v)) return v.map(roundAll) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundAll(x)])) as T;
  return v;
}

export function aggregate(rows: { opd: DashRow[]; ipd: DashRow[] }, fy: number, today: string) {
  const sum = { opd: totals(), ipd: totals() };
  const months = new Map(fiscalMonths(fy).map((m) => [m, { month: m, opd: totals(), ipd: totals() }]));
  const aging = new Map(AGING_BUCKETS.map((b) => [b, { bucket: b, opd: amount(), ipd: amount() }]));
  const codes = new Map<string, { opd: CodeUse; ipd: CodeUse }>();

  for (const type of ["opd", "ipd"] as const) {
    for (const r of rows[type]) {
      add(sum[type][r.status], r);
      add(sum[type].total, r);
      const m = months.get(r.date.slice(0, 7));
      if (m) {
        add(m[type][r.status], r);
        add(m[type].total, r);
      }
      if (r.status === "none") add(aging.get(bucketOf(r.date, today))![type], r);
      if (r.status === "error") {
        for (const code of new Set(r.error_codes)) {
          let c = codes.get(code);
          if (!c) codes.set(code, (c = { opd: codeUse(), ipd: codeUse() }));
          const u = c[type];
          u.count++;
          u.debtor += r.debtor;
          if (r.date > u.last) u.last = r.date;
        }
      }
    }
  }

  const errors: ErrorRank[] = [...codes]
    .map(([code, c]) => ({ code, count: c.opd.count + c.ipd.count, debtor: c.opd.debtor + c.ipd.debtor, ...c }))
    .sort((a, b) => b.debtor - a.debtor || b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, 10);

  return roundAll({ totals: sum, months: [...months.values()], aging: [...aging.values()], errors });
}
