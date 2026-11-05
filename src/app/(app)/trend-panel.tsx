import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { hisQuery } from "@/lib/db";
import { addDaysIso, hipdataGroupOf, hipdataLabel, NO_HIPDATA, todayTh } from "@/app/api/visit/opd-visit/opd-visit";
import { loadPttypeOptions } from "@/app/api/visit/opd-visit/pttype-options";
import { HomeFilters } from "./home-filters";
import {
  addMonthsIso,
  bucketLabel,
  bucketTitle,
  MAX_PTTYPES,
  monthEnd,
  monthStart,
  parseBy,
  parseMetric,
  parsePttypes,
  pickDate,
  pttypeGroups,
  pttypeInSql,
  rangeError,
  first,
  type TrendBy,
} from "./home-params";
import { TrendChart, type TrendBucket, type TrendData, type TrendSeries } from "./trend-chart";

/**
 * สีของกลุ่มสิทธิผูกกับรหัส hipdata (ไม่ใช่ลำดับตามยอด) กรองแล้วสีไม่เปลี่ยน เรียงตามยอด visit ทั้งปีของโรงพยาบาล
 * ลำดับเดียวกับ --chart-1..7 ซึ่งผ่านการตรวจ CVD ของคู่ที่ติดกัน กลุ่มอื่น (และไม่ระบุ) รวมเป็น "อื่นๆ" สีกลาง
 */
const SERIES_GROUPS = ["UCS", "OFC", "SSS", "LGO", "CSH", "INS", "NRD"];
const OTHER = "other";

// ผลรวมต่อวัน/เดือน × กลุ่มสิทธิ: ขับจาก ovst.ix_vstdate แล้ว eq_ref pttype, pttype_coverage_group, vn_stat ด้วย PK (เหมือนตารางสรุป)
//   bucket ของเดือนใช้ DATE_FORMAT ใน SELECT/GROUP BY เท่านั้น WHERE ยังเป็นช่วง vstdate ตรงๆ จึงใช้ index ได้
//   วัดจริง: 31 วัน ~0.4 วินาที, 6 เดือน ~1.7 วินาที (12 เดือน ~3.3 วินาที จึงจำกัดที่ MAX_SPAN_MONTHS)
//   bucket เป็น identifier ไม่ใช่ค่า จึงเลือกจาก allowlist สองแบบนี้เท่านั้น
const BUCKET_SQL: Record<TrendBy, string> = { day: "o.vstdate", month: "DATE_FORMAT(o.vstdate, '%Y-%m')" };
function trendSql(by: TrendBy, pttypeCount: number) {
  return `
  SELECT ${BUCKET_SQL[by]} AS bucket, t.hipdata_code AS hipdata, g.pttype_coverage_group_name AS hipdataName,
    COUNT(*) AS visits, COALESCE(SUM(v.income), 0) AS income
  FROM ovst o FORCE INDEX (ix_vstdate)
  LEFT JOIN pttype t ON t.pttype = o.pttype
  LEFT JOIN pttype_coverage_group g ON g.pttype_coverage_group_code = t.hipdata_code
  LEFT JOIN vn_stat v ON v.vn = o.vn
  WHERE o.vstdate BETWEEN ? AND ? ${pttypeInSql(pttypeCount)}
  GROUP BY bucket, t.hipdata_code, g.pttype_coverage_group_name`;
}

/** ทุกวัน/เดือนในช่วง รวมวันที่ไม่มีผู้รับบริการ (แท่งว่างบนแกน) */
function buckets(by: TrendBy, from: string, to: string, today: string): TrendBucket[] {
  const out: TrendBucket[] = [];
  if (by === "day") {
    for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push({ key: d, label: bucketLabel(d, by), title: bucketTitle(d, by), from: d, to: d });
  } else {
    for (let m = monthStart(from); m <= to; m = addMonthsIso(m, 1)) {
      const key = m.slice(0, 7);
      const end = monthEnd(m);
      out.push({ key, label: bucketLabel(key, by), title: bucketTitle(key, by), from: m, to: end < today ? end : today });
    }
  }
  return out;
}

async function loadTrend(by: TrendBy, from: string, to: string, pttypes: string[], today: string): Promise<TrendData> {
  const qFrom = by === "month" ? monthStart(from) : from;
  const qTo = by === "month" ? monthEnd(to) : to;
  const rows = await hisQuery<{
    bucket: string;
    hipdata: string | null;
    hipdataName: string | null;
    visits: number | string;
    income: number | string;
  }>(trendSql(by, pttypes.length), [qFrom, qTo, ...pttypes]);

  const cats = buckets(by, qFrom, qTo, today);
  const index = new Map(cats.map((c, i) => [c.key, i]));
  // series ที่มีข้อมูลเท่านั้น เรียงตาม slot สี, "อื่นๆ" ท้ายสุด (บนสุดของแท่ง)
  const named = new Map<string, string>();
  const others = new Map<string, string>();
  for (const r of rows) {
    const g = hipdataGroupOf(r.hipdata);
    (SERIES_GROUPS.includes(g) ? named : others).set(g, hipdataLabel(g, r.hipdataName));
  }
  const series: TrendSeries[] = SERIES_GROUPS.flatMap((g, i) =>
    named.has(g) ? [{ key: g, label: named.get(g)!, short: g, color: `var(--chart-${i + 1})`, group: g }] : [],
  );
  if (others.size) {
    // เรียงรหัสให้คงที่ ไม่ระบุ (none) ไว้ท้าย
    const codes = [...others.keys()].sort((x, y) => (x === NO_HIPDATA ? 1 : y === NO_HIPDATA ? -1 : x.localeCompare(y)));
    series.push({ key: OTHER, label: "อื่นๆ", note: codes.map((c) => others.get(c)!.split(" ")[0]).join(", "), color: "var(--chart-other)", group: null });
  }
  const col = new Map(series.map((s, i) => [s.key, i]));
  const visits = cats.map(() => series.map(() => 0));
  const income = cats.map(() => series.map(() => 0));
  for (const r of rows) {
    const c = index.get(r.bucket);
    const g = hipdataGroupOf(r.hipdata);
    const s = col.get(SERIES_GROUPS.includes(g) ? g : OTHER);
    if (c === undefined || s === undefined) continue;
    visits[c][s] += Number(r.visits);
    income[c][s] += Number(r.income);
  }
  return { by, buckets: cats, series, visits, income };
}

type Params = Record<string, string | string[] | undefined>;

export async function TrendPanel({ sp }: { sp: Params }) {
  await connection(); // อ่าน HIS ตอน request ไม่ใช่ตอน build
  // proxy.ts กั้นหน้าแล้ว แต่ส่วนที่อ่าน HIS เช็ค session เองซ้ำ
  if (!(await auth())) redirect("/login?callbackUrl=/");

  const today = todayTh();
  const by = parseBy(first(sp.by));
  const metric = parseMetric(first(sp.metric));
  const from = pickDate(sp.from, today);
  const to = pickDate(sp.to, today);
  const pttypes = parsePttypes(sp.pttype);
  const invalid = rangeError(from, to, by) || (pttypes.length > MAX_PTTYPES ? `เลือกสิทธิได้ไม่เกิน ${MAX_PTTYPES} รายการ` : "");

  const optionsPromise = loadPttypeOptions();
  let data: TrendData | null = null;
  let loadError = "";
  if (!invalid) {
    try {
      data = await loadTrend(by, from, to, pttypes, today);
    } catch (e) {
      // ไม่แสดงข้อความดิบของ driver (อาจมี host/user)
      console.error("trend query failed", (e as { code?: string }).code ?? e);
      loadError = "อ่านข้อมูลจาก HIS ไม่สำเร็จ ลองโหลดหน้าใหม่อีกครั้ง";
    }
  }
  const error = invalid || loadError;
  const options = await optionsPromise;

  return (
    <>
      <HomeFilters from={from} to={to} pttypes={pttypes} pttypeGroups={pttypeGroups(options.pttypes, options.groups, pttypes)} by={by} today={today} />
      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-danger">
          {error}
        </p>
      ) : !data?.series.length ? (
        <p className="mt-4 text-muted">
          {pttypes.length ? "ไม่มีผู้รับบริการของสิทธิที่เลือกในช่วงนี้" : "ไม่มีผู้รับบริการในช่วงนี้"}
        </p>
      ) : (
        <TrendChart data={data} metric={metric} linkable={pttypes.length === 0} today={today} />
      )}
    </>
  );
}
