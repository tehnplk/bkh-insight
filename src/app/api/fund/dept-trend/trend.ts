// แนวโน้มค่าใช้จ่ายตามแผนก (/fund/dept-trend) แบบ pure
// ไม่มี import ค่า จึงใช้ได้ทั้ง route, หน้า (client) และ trend.test.mjs

export const METRICS = ["claim", "income", "visits"] as const;
export type Metric = (typeof METRICS)[number];
export const METRIC_LABEL: Record<Metric, string> = { claim: "ลูกหนี้สิทธิ", income: "มูลค่ารวม", visits: "จำนวนครั้ง" };
/** แผนกที่เลือกได้สูงสุด = จำนวนสี categorical (--chart-1..7) */
export const MAX_DEPS = 7;
/** แผนกเริ่มต้นเมื่อไม่มี deps (ลำดับ = ช่องสี) : 053 คลินิกพรีเมียม, 027 กายภาพบำบัด */
export const DEFAULT_DEPS = ["053", "027"];
export const DEFAULT_FUNDS = ["OFC", "LGO"];
/** ผลรวมต่อ (เดือน, แผนก, กองทุน) */
export type TrendRow = { month: string; dep: string; fund: string; visits: number; income: number; claim: number };
/** แถวจาก SQL รายเดือน ต่อ (แผนก, pttype) */
export type RawRow = { dep: string; pttype: string | null; visits: number; income: number; claim: number };

/** response ของ GET /api/fund/dept-trend?fy=<ปีงบ พ.ศ.> */
export type DeptTrendResponse = {
  fy: number;
  /** 12 เดือนของปีงบ YYYY-MM (ต.ค.→ก.ย.) */
  months: string[];
  /** จำนวนเดือนแรกที่มีข้อมูลแล้ว (เดือนหลังจากนี้ยังไม่ถึง) */
  loaded: number;
  /** จำนวนเดือนแรกที่จบเดือนแล้ว (เดือนปัจจุบันยังไม่ครบ) */
  complete: number;
  /** วันสุดท้ายที่มีข้อมูล ISO */
  through: string;
  /** มีเดือนที่ cache สั้น (เดือนนี้/เดือนก่อน) ปุ่มดึงใหม่จึงมีผล */
  live: boolean;
  rows: TrendRow[];
  deps: { code: string; name: string; active: boolean }[];
  funds: { code: string; name: string }[];
  /** เวลาที่ดึงจาก HOSxP ของเดือนที่เก่าที่สุดในกลุ่มที่ยังเปลี่ยนได้ (ISO UTC) */
  computed_at: string;
  /** แผนกที่นับทั้ง visit แทน main_dep เมื่อ visit มีคิวของแผนกนี้ (SVC_OVERRIDE_DEP ใน fund.ts) */
  override_dep: string;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const round2 = (n: number) => Math.round(n * 100) / 100;

/** เดือนก่อนหน้าของ YYYY-MM */
export function prevMonth(month: string): string {
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
}

/** 12 เดือนของปีงบ พ.ศ. (ปีงบ 2569 = 2025-10..2026-09) */
export function fiscalMonths(fy: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((9 + i) % 12) + 1;
    return `${m >= 10 ? fy - 544 : fy - 543}-${pad2(m)}`;
  });
}

export type MonthRange = { month: string; start: string; end: string; live: boolean; complete: boolean };

/**
 * ช่วงวันของแต่ละเดือนในปีงบที่เริ่มแล้ว (เดือนปัจจุบันตัดที่วันนี้)
 * live = เดือนนี้หรือเดือนก่อน (ยังลงค่าใช้จ่ายย้อนหลังได้ cache สั้น) ; complete = จบเดือนก่อนวันนี้
 */
export function monthRanges(fy: number, today: string): MonthRange[] {
  const cur = today.slice(0, 7);
  const prev = prevMonth(cur);
  return fiscalMonths(fy)
    .filter((m) => m <= cur)
    .map((month) => {
      const last = `${month}-${pad2(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate())}`;
      return { month, start: `${month}-01`, end: last < today ? last : today, live: month >= prev, complete: last < today };
    });
}

/** เดือนที่ยังไม่จบ (เดือนปัจจุบัน) กับจำนวนวันที่มีข้อมูล (through = วันนี้) ; ทุกเดือนจบแล้ว = null */
export function partialMonth(r: Pick<DeptTrendResponse, "months" | "loaded" | "complete" | "through">): { month: string; days: number } | null {
  return r.loaded > r.complete ? { month: r.months[r.loaded - 1], days: +r.through.slice(8, 10) } : null;
}

/** รวมแถว (แผนก, pttype) ของแต่ละเดือนเป็น (เดือน, แผนก, กองทุน) */
export function aggregate(months: { month: string; rows: RawRow[] }[], fundOf: (pttype: string | null) => string): TrendRow[] {
  const out = new Map<string, TrendRow>();
  for (const { month, rows } of months) {
    for (const r of rows) {
      const fund = fundOf(r.pttype);
      const k = `${month}|${r.dep}|${fund}`;
      const t = out.get(k) ?? { month, dep: r.dep, fund, visits: 0, income: 0, claim: 0 };
      t.visits += r.visits;
      t.income += r.income;
      t.claim += r.claim;
      out.set(k, t);
    }
  }
  return [...out.values()].map((t) => ({ ...t, income: round2(t.income), claim: round2(t.claim) }));
}

/** ค่ารายเดือนต่อแผนกของกองทุนที่เลือก (funds null = ทุกกองทุน) ยาวเท่า months เดือนที่ไม่มีแถว = 0 */
export function valuesByDep(rows: TrendRow[], months: string[], funds: Set<string> | null, metric: Metric): Map<string, number[]> {
  const idx = new Map(months.map((m, i) => [m, i]));
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const i = idx.get(r.month);
    if (i === undefined || (funds && !funds.has(r.fund))) continue;
    let v = out.get(r.dep);
    if (!v) out.set(r.dep, (v = months.map(() => 0)));
    v[i] = round2(v[i] + r[metric]);
  }
  return out;
}

const sum = (v: number[]) => round2(v.reduce((s, x) => s + x, 0));

/** ผลรวมทุกแผนกต่อเดือน = ยอดทั้งโรงพยาบาล (1 visit อยู่แผนกเดียว) */
export function hospitalValues(byDep: Map<string, number[]>, months: string[]): number[] {
  return months.map((_, j) => round2([...byDep.values()].reduce((s, v) => s + v[j], 0)));
}

/**
 * ตำแหน่งสีของแผนกที่เลือก (ช่อง i = --chart-(i+1)) ใน URL เป็น "a,,c" ช่องว่าง = ช่องที่เอาออกแล้ว
 * แผนกที่ยังเลือกอยู่คงช่องเดิม แผนกใหม่ลงช่องว่างแรก สีจึงผูกกับแผนกไม่เปลี่ยนตามการเลือก
 */
export function parseSlots(raw: string): string[] {
  return raw ? raw.split(",").slice(0, MAX_DEPS).map((s) => s.trim()) : [];
}

export function assignSlots(slots: string[], selected: string[]): string[] {
  const want = new Set(selected);
  const next = slots.map((s) => (want.has(s) ? s : ""));
  for (const dep of selected) {
    if (next.includes(dep)) continue;
    const free = next.indexOf("");
    if (free >= 0) next[free] = dep;
    else if (next.length < MAX_DEPS) next.push(dep);
  }
  while (next.length && !next.at(-1)) next.pop();
  return next;
}

export type DepSummary = {
  total: number;
  /** เฉลี่ยต่อเดือนที่จบแล้ว ; ยังไม่มีเดือนที่จบ = null */
  avg: number | null;
  /** เดือนล่าสุดที่มีข้อมูล (รวมเดือนที่ยังไม่จบ) และเดือนก่อนหน้า ; ไม่มีในปีงบนี้ = null */
  last: number | null;
  prev: number | null;
  diff: number | null;
  /** % เทียบเดือนก่อน ; เดือนก่อนเป็น 0 = null */
  pct: number | null;
};

/** รวมแผนกที่เลือก (values ต่อแผนก ยาวเท่ากัน) ; ไม่ได้เลือก = null */
export function selectedTotal(values: number[][], complete: number): DepSummary | null {
  if (!values.length) return null;
  return summarize(values[0].map((_, j) => round2(values.reduce((s, v) => s + v[j], 0))), complete);
}

/** สรุปของค่ารายเดือน values (เฉพาะเดือนที่มีข้อมูล) โดย complete = จำนวนเดือนแรกที่จบแล้ว (ใช้กับเฉลี่ยเท่านั้น) */
export function summarize(values: number[], complete: number): DepSummary {
  const done = values.slice(0, complete);
  const last = values.length ? values[values.length - 1] : null;
  const prev = values.length > 1 ? values[values.length - 2] : null;
  const diff = last !== null && prev !== null ? round2(last - prev) : null;
  return {
    total: sum(values),
    avg: done.length ? round2(sum(done) / done.length) : null,
    last,
    prev,
    diff,
    pct: diff !== null && prev ? (diff / prev) * 100 : null,
  };
}
