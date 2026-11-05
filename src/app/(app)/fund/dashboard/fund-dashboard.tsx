"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CalendarX, CircleAlert, Minus } from "lucide-react";
import { useDateRange } from "@/components/date-range-filter/date-range-filter";
import { formatBaht, formatCompactBaht, formatCount, formatMillions } from "@/lib/number-format";
import { THAI_MONTHS_SHORT, formatThaiDate, parseIsoDate } from "@/lib/thai-date";
import type { FundDashboardResponse } from "@/app/api/fund/types";
import { RankedBarChart, TrendChart, type RankedItem, type TrendPoint } from "./charts";

const FUND_LIMIT = 8; // เกินนี้รวมเป็น "อื่นๆ"
const CATEGORY_LIMIT = 8;
const MATRIX_CATEGORY_LIMIT = 5;
const OTHER = "อื่นๆ";

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btn = `inline-flex h-8 items-center rounded-md border border-line px-3 text-sm hover:bg-hover ${focusRing}`;
const link = `rounded-sm hover:underline underline-offset-2 ${focusRing}`;

/* ---------- วันที่ ---------- */

const DAY_MS = 86_400_000;
const toUtc = (iso: string) => {
  const [y, m, d] = parseIsoDate(iso) ?? [1970, 1, 1];
  return Date.UTC(y, m - 1, d);
};
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** ช่วงก่อนหน้าที่ยาวเท่ากัน (ตรงกับที่ API คำนวณ previous) */
function previousRange(start: string, end: string) {
  const len = Math.round((toUtc(end) - toUtc(start)) / DAY_MS) + 1;
  const prevEnd = toUtc(start) - DAY_MS;
  return { start: toIso(prevEnd - (len - 1) * DAY_MS), end: toIso(prevEnd) };
}

const rangeText = (start: string, end: string) =>
  start === end ? formatThaiDate(start) : `${formatThaiDate(start)} – ${formatThaiDate(end)}`;

/** ป้ายแกน x: "4 พ.ย." (ช่วงข้ามปีต่อท้ายปี พ.ศ. 2 หลัก) */
function dayLabel(iso: string, withYear: boolean) {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  const [y, m, d] = p;
  return `${d} ${THAI_MONTHS_SHORT[m - 1]}${withYear ? ` ${String(y + 543).slice(2)}` : ""}`;
}

const drillHref = (start: string, end: string, extra: Record<string, string>) =>
  `/fund/opd-fund?${new URLSearchParams({ start, end, ...extra })}`;

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const pctText = (n: number) => `${n.toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`;

/* ---------- data ---------- */

type Result = { key: string; data?: FundDashboardResponse; error?: string };

function useDashboard(start: string, end: string) {
  const [nonce, setNonce] = useState(0);
  const key = `${start}|${end}|${nonce}`;
  const [res, setRes] = useState<Result | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/fund/dashboard?${new URLSearchParams({ start, end })}`, { signal: ac.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? `เซิร์ฟเวอร์ตอบกลับ HTTP ${r.status}`);
        setRes({ key, data: body as FundDashboardResponse });
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        const message = e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ";
        setRes((prev) => ({ key, data: prev?.data, error: message }));
      });
    return () => ac.abort();
  }, [key, start, end]);

  const settled = res?.key === key;
  return {
    data: res?.data,
    error: settled ? res?.error : undefined,
    loading: !settled,
    retry: () => setNonce((n) => n + 1),
  };
}

/* ---------- layout pieces ---------- */

function Section({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-title">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const box = "rounded-lg border border-line bg-surface";

function Notice({ icon, title, detail, action }: { icon: ReactNode; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className={`${box} flex flex-col items-center px-4 py-12 text-center text-sm`}>
      <span className="text-muted">{icon}</span>
      <p className="mt-2 font-medium">{title}</p>
      {detail && <p className="mt-1 text-muted">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------- KPI ---------- */

function Delta({ current, previous, period }: { current: number; previous: number | null; period: string }) {
  if (previous === null || previous === 0) {
    return (
      <p className="flex items-center gap-1 text-xs text-muted">
        <Minus aria-hidden className="size-3" />
        {previous === null ? "ไม่มีข้อมูลช่วงก่อน" : "ช่วงก่อนเป็น 0"}
      </p>
    );
  }
  const change = ((current - previous) / previous) * 100;
  const flat = Math.abs(change) < 0.05;
  const up = change > 0;
  const Arrow = flat ? Minus : up ? ArrowUp : ArrowDown;
  const tone = flat ? "text-muted" : up ? "text-success" : "text-danger";
  return (
    <p className="flex items-center gap-1 text-xs text-muted" title={`เทียบ ${period}`}>
      <span className={`inline-flex items-center gap-0.5 font-medium tabular-nums ${tone}`}>
        <Arrow aria-hidden className="size-3" />
        <span className="sr-only">{flat ? "เท่าเดิม" : up ? "เพิ่มขึ้น" : "ลดลง"}</span>
        {pctText(Math.abs(change))}
      </span>
      <span>จากช่วงก่อน</span>
    </p>
  );
}

function Kpi({ label, value, full, delta }: { label: string; value: string; full?: string; delta: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-4 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-title" title={full}>
        {full ? (
          <>
            <span aria-hidden="true">{value}</span>
            <span className="sr-only">{full}</span>
          </>
        ) : (
          value
        )}
      </dd>
      <dd>{delta}</dd>
    </div>
  );
}

function KpiRow({ data }: { data: FundDashboardResponse }) {
  const { totals, previous } = data;
  const prev = previousRange(data.start, data.end);
  const period = rangeText(prev.start, prev.end);
  const prevAvg = previous ? (previous.visits > 0 ? previous.amount / previous.visits : 0) : null;
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
      <Kpi
        label="มูลค่ารวม"
        value={formatCompactBaht(totals.amount)}
        full={`${formatBaht(totals.amount)} บาท`}
        delta={<Delta current={totals.amount} previous={previous?.amount ?? null} period={period} />}
      />
      <Kpi
        label="จำนวน visit"
        value={formatCount(totals.visits)}
        delta={<Delta current={totals.visits} previous={previous?.visits ?? null} period={period} />}
      />
      <Kpi
        label="ผู้ป่วย (คน)"
        value={formatCount(totals.patients)}
        delta={<p className="text-xs text-muted">ไม่ซ้ำคน</p>}
      />
      <Kpi
        label="เฉลี่ยต่อ visit"
        value={formatCompactBaht(totals.avg_per_visit)}
        full={`${formatBaht(totals.avg_per_visit)} บาท`}
        delta={<Delta current={totals.avg_per_visit} previous={prevAvg} period={period} />}
      />
    </dl>
  );
}

/* ---------- แนวโน้มรายวัน ---------- */

type Metric = "amount" | "visits";
const METRICS: { id: Metric; label: string }[] = [
  { id: "amount", label: "มูลค่า" },
  { id: "visits", label: "จำนวน visit" },
];
const visitTick = (n: number) => formatCount(n);
const bahtTick = (n: number) => formatCount(n);
/**
 * แกนมูลค่าใช้หน่วย "ล้านบาท" เสมอ (formatMillions ทศนิยมไม่เกิน 2 ตำแหน่ง)
 * ยกเว้นค่าสูงสุดต่ำกว่า 50,000 บาท ซึ่งระยะ tick เล็กกว่า 0.01 ล้าน จนป้ายซ้ำกัน จึงใช้ "บาท" จำนวนเต็ม
 */
const MILLION_AXIS_MIN = 50_000;

function DailyTrend({ data }: { data: FundDashboardResponse }) {
  const [metric, setMetric] = useState<Metric>("amount");
  const daily = data.daily;
  const multiYear = data.start.slice(0, 4) !== data.end.slice(0, 4);
  const points = useMemo<TrendPoint[]>(
    () =>
      daily.map((d) => ({
        label: dayLabel(d.date, multiYear),
        title: formatThaiDate(d.date),
        value: d[metric],
        valueText: metric === "amount" ? `${formatBaht(d.amount)} บาท` : `${formatCount(d.visits)} visit`,
      })),
    [daily, metric, multiYear],
  );
  const metricLabel = METRICS.find((m) => m.id === metric)!.label;
  const millions = Math.max(0, ...daily.map((d) => d.amount)) >= MILLION_AXIS_MIN;
  const unit = metric === "visits" ? "visit" : millions ? "ล้านบาท" : "บาท";
  const tickFormat = metric === "visits" ? visitTick : millions ? formatMillions : bahtTick;

  return (
    <Section
      id="fund-trend"
      title="แนวโน้มรายวัน"
      aside={
        <div role="radiogroup" aria-label="ตัวชี้วัด" className="flex rounded-md border border-line p-0.5 text-sm">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={metric === m.id}
              onClick={() => setMetric(m.id)}
              className={`h-7 rounded px-2.5 ${focusRing} ${
                metric === m.id ? "bg-accent-soft font-medium text-accent-text" : "text-muted hover:bg-hover hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      }
    >
      <div className={`${box} p-3`}>
        <TrendChart
          points={points}
          tickFormat={tickFormat}
          unit={unit}
          ariaLabel={`${metricLabel}รายวัน ${rangeText(data.start, data.end)}`}
        />
        <table className="sr-only">
          <caption>{`${metricLabel}รายวัน`}</caption>
          <thead>
            <tr>
              <th scope="col">วันที่</th>
              <th scope="col">มูลค่า (บาท)</th>
              <th scope="col">จำนวน visit</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date}>
                <th scope="row">{formatThaiDate(d.date)}</th>
                <td>{formatBaht(d.amount)}</td>
                <td>{formatCount(d.visits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/* ---------- กองทุน / หมวด ---------- */

type Fund = { code: string | null; name: string; visits: number; amount: number };
type Category = { code: string | null; name: string; amount: number };

function foldFunds(data: FundDashboardResponse): Fund[] {
  const all = data.by_fund.map((f) => ({ code: f.fund_code, name: f.fund_name || f.fund_code, visits: f.visits, amount: f.amount }));
  if (all.length <= FUND_LIMIT) return all;
  const head = all.slice(0, FUND_LIMIT - 1);
  const tail = all.slice(FUND_LIMIT - 1);
  return [
    ...head,
    { code: null, name: OTHER, visits: tail.reduce((s, f) => s + f.visits, 0), amount: tail.reduce((s, f) => s + f.amount, 0) },
  ];
}

function foldCategories(data: FundDashboardResponse, limit: number): Category[] {
  const all = data.by_category.map((c) => ({ code: c.income_code, name: c.income_name || c.income_code, amount: c.amount }));
  if (all.length <= limit) return all;
  const tail = all.slice(limit - 1);
  return [...all.slice(0, limit - 1), { code: null, name: OTHER, amount: tail.reduce((s, c) => s + c.amount, 0) }];
}

function FundBars({ data, funds }: { data: FundDashboardResponse; funds: Fund[] }) {
  const router = useRouter();
  const total = data.totals.amount;
  const items = useMemo<RankedItem[]>(
    () =>
      funds.map((f) => ({
        label: f.name,
        value: f.amount,
        valueText: `${formatCompactBaht(f.amount)} · ${pctText(pct(f.amount, total))}`,
        tooltip: `${formatBaht(f.amount)} บาท · ${formatCount(f.visits)} visit`,
        href: f.code ? drillHref(data.start, data.end, { fund: f.code }) : undefined,
      })),
    [funds, total, data.start, data.end],
  );
  const onSelect = useCallback((it: RankedItem) => it.href && router.push(it.href), [router]);
  return (
    <Section id="fund-by-fund" title="มูลค่าตามกองทุน">
      <div className={`${box} p-3`}>
        <RankedBarChart items={items} ariaLabel="มูลค่าตามกองทุน" onSelect={onSelect} />
      </div>
    </Section>
  );
}

function CategoryBars({ data }: { data: FundDashboardResponse }) {
  const router = useRouter();
  const total = data.totals.amount;
  const items = useMemo<RankedItem[]>(
    () =>
      foldCategories(data, CATEGORY_LIMIT).map((c) => ({
        label: c.name,
        value: c.amount,
        valueText: `${formatCompactBaht(c.amount)} · ${pctText(pct(c.amount, total))}`,
        tooltip: `${formatBaht(c.amount)} บาท`,
        href: c.code ? drillHref(data.start, data.end, { income: c.code }) : undefined,
      })),
    [data, total],
  );
  const onSelect = useCallback((it: RankedItem) => it.href && router.push(it.href), [router]);
  return (
    <Section id="fund-by-category" title="หมวดค่าใช้จ่าย">
      <div className={`${box} p-3`}>
        <RankedBarChart items={items} ariaLabel="มูลค่าตามหมวดค่าใช้จ่าย" onSelect={onSelect} />
      </div>
    </Section>
  );
}

/** ตารางกองทุน × หมวด: ตัวเลขทุกช่องของสองกราฟด้านบน + ลิงก์ไปหน้ารายการ สีพื้นช่องเข้มตามมูลค่า */
function FundCategoryMatrix({ data, funds }: { data: FundDashboardResponse; funds: Fund[] }) {
  const cats = foldCategories(data, MATRIX_CATEGORY_LIMIT + 1);
  const named = new Set(cats.flatMap((c) => (c.code ? [c.code] : [])));
  const namedFunds = new Set(funds.flatMap((f) => (f.code ? [f.code] : [])));

  // cell[fundKey][catKey]; null code = อื่นๆ
  const cell = new Map<string, number>();
  const k = (f: string | null, c: string | null) => `${f ?? "\0"}|${c ?? "\0"}`;
  for (const fc of data.fund_category) {
    const f = namedFunds.has(fc.fund_code) ? fc.fund_code : null;
    const c = named.has(fc.income_code) ? fc.income_code : null;
    cell.set(k(f, c), (cell.get(k(f, c)) ?? 0) + fc.amount);
  }
  const max = Math.max(0, ...cell.values());
  const shade = (v: number) =>
    v > 0 && max > 0 ? { backgroundColor: `color-mix(in oklab, var(--accent) ${Math.round((v / max) * 40)}%, transparent)` } : undefined;

  const th = "px-3 py-2 text-left text-sm font-medium text-muted whitespace-nowrap";
  const td = "px-3 py-2 text-right whitespace-nowrap";

  return (
    <Section id="fund-matrix" title="มูลค่าแยกกองทุนและหมวด (บาท)">
      <div className={`${box} overflow-x-auto`}>
        <table className="w-full border-collapse text-sm tabular-nums">
          <caption className="sr-only">มูลค่า (บาท) แยกตามกองทุนและหมวดค่าใช้จ่าย</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={`${th} sticky left-0 bg-surface`}>
                กองทุน
              </th>
              {cats.map((c) => (
                <th key={c.code ?? OTHER} scope="col" className={`${th} max-w-36 truncate text-right`} title={c.name}>
                  {c.name}
                </th>
              ))}
              <th scope="col" className={`${th} text-right`}>
                รวม
              </th>
            </tr>
          </thead>
          <tbody>
            {funds.map((f) => (
              <tr key={f.code ?? OTHER} className="border-b border-line last:border-0">
                <th scope="row" className="sticky left-0 max-w-48 truncate bg-surface px-3 py-2 text-left font-medium">
                  {f.code ? (
                    <Link href={drillHref(data.start, data.end, { fund: f.code })} className={link} title={f.name}>
                      {f.name}
                    </Link>
                  ) : (
                    f.name
                  )}
                </th>
                {cats.map((c) => {
                  const raw = cell.get(k(f.code, c.code));
                  const v = raw ?? 0;
                  const text = raw === undefined ? <span className="text-muted">–</span> : formatBaht(raw);
                  return (
                    <td key={c.code ?? OTHER} className={td} style={shade(v)}>
                      {raw !== undefined && f.code && c.code ? (
                        <Link href={drillHref(data.start, data.end, { fund: f.code, income: c.code })} className={link}>
                          {text}
                        </Link>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
                <td className={`${td} font-medium`}>
                  {formatBaht(f.amount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-surface-sunken">
              <th scope="row" className="sticky left-0 bg-surface-sunken px-3 py-2 text-left font-medium">
                รวม
              </th>
              {cats.map((c) => (
                <td key={c.code ?? OTHER} className={`${td} font-medium`}>
                  {formatBaht(c.amount)}
                </td>
              ))}
              <td className={`${td} font-semibold`}>
                {formatBaht(data.totals.amount)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>
  );
}

/* ---------- 10 อันดับ ---------- */

function TopItems({ data }: { data: FundDashboardResponse }) {
  const th = "px-3 py-2 text-sm font-medium text-muted whitespace-nowrap";
  return (
    <Section id="fund-top-items" title="รายการมูลค่าสูงสุด 10 อันดับ">
      {data.top_items.length === 0 ? (
        <p className={`${box} px-4 py-6 text-center text-sm text-muted`}>ไม่มีรายการ</p>
      ) : (
        <div className={`${box} overflow-x-auto`}>
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={`${th} w-8 text-right`}>
                  <span className="sr-only">อันดับ</span>#
                </th>
                <th scope="col" className={`${th} text-left`}>
                  รายการ
                </th>
                <th scope="col" className={`${th} text-left max-sm:hidden`}>
                  หมวด
                </th>
                <th scope="col" className={`${th} text-right max-sm:hidden`}>
                  จำนวน
                </th>
                <th scope="col" className={`${th} text-right`}>
                  มูลค่า (บาท)
                </th>
              </tr>
            </thead>
            <tbody>
              {data.top_items.map((it, i) => (
                <tr key={it.icode} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 text-right text-muted">{i + 1}</td>
                  <td className="px-3 py-2 break-words">
                    <span className="block">{it.name}</span>
                    <span className="block text-xs text-muted sm:hidden">
                      {it.income_name} · จำนวน {formatCount(it.qty)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted max-sm:hidden">{it.income_name}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap max-sm:hidden">{formatCount(it.qty)}</td>
                  <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{formatBaht(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ---------- page body ---------- */

export function FundDashboardSkeleton() {
  const block = "animate-pulse rounded-lg bg-surface-sunken";
  return (
    <div aria-busy="true" aria-label="กำลังโหลด" className="flex flex-col gap-6">
      <div className={`${block} h-24`} />
      <div className={`${block} h-72`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className={`${block} h-64`} />
        <div className={`${block} h-64`} />
      </div>
      <div className={`${block} h-56`} />
    </div>
  );
}

export function FundDashboard() {
  const { start, end } = useDateRange();
  const { data, error, loading, retry } = useDashboard(start, end);

  if (error) {
    return (
      <div role="alert">
        <Notice
          icon={<CircleAlert aria-hidden className="size-5" />}
          title="โหลดข้อมูลไม่สำเร็จ"
          detail={error}
          action={
            <button type="button" className={btn} onClick={retry}>
              ลองอีกครั้ง
            </button>
          }
        />
      </div>
    );
  }
  if (!data) return <FundDashboardSkeleton />;

  // ระหว่างโหลดช่วงใหม่ คงผลเดิมไว้แบบจางลง ไม่กระพริบเป็น skeleton
  return (
    <div aria-busy={loading} className={`transition-opacity duration-200 ${loading ? "opacity-60" : ""}`}>
      {data.totals.visits === 0 ? (
        <Notice
          icon={<CalendarX aria-hidden className="size-5" />}
          title="ไม่มีการรับบริการในช่วงนี้"
          detail={rangeText(data.start, data.end)}
        />
      ) : (
        <Body data={data} />
      )}
    </div>
  );
}

function Body({ data }: { data: FundDashboardResponse }) {
  const funds = useMemo(() => foldFunds(data), [data]);
  return (
    <div className="flex flex-col gap-6">
      <KpiRow data={data} />
      <DailyTrend data={data} />
      <div className="grid gap-6 lg:grid-cols-2">
        <FundBars data={data} funds={funds} />
        <CategoryBars data={data} />
      </div>
      <FundCategoryMatrix data={data} funds={funds} />
      <TopItems data={data} />
    </div>
  );
}
