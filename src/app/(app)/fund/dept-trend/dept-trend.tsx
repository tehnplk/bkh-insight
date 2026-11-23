"use client";

import { useMemo, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { DataTableToggle, MultiTrendChart, type TrendSeries } from "@/components/charts/charts";
import { MultiSelect } from "@/components/multi-select/multi-select";
import { formatBaht, formatCount, formatMillions } from "@/lib/number-format";
import { usePersistedFilter } from "@/lib/persisted-filter";
import { THAI_MONTHS, THAI_MONTHS_SHORT, formatThaiDate, todayIso } from "@/lib/thai-date";
import { FY_BACK, fiscalYearOf, parseFiscalYear } from "@/app/api/fund/uc-dashboard/dashboard";
import {
  DEFAULT_FUNDS, MAX_DEPS, METRICS, METRIC_LABEL, assignSlots, hospitalValues, parseSlots, partialMonth, selectedTotal, summarize, topDeps, valuesByDep,
  type DepSummary, type DeptTrendResponse, type Metric,
} from "@/app/api/fund/dept-trend/trend";
import { Notice, Panel, Skeleton, btn, focusRing, num, useJson, useUrlParams } from "../_components/ui";

// deps = ช่องสีของแผนกที่เลือก (ดู parseSlots) ไม่ส่ง = 5 อันดับแรก ; funds ไม่ส่ง = OFC+LGO, "all" = ทุกกองทุน
// ทั้งปีงบโหลดครั้งเดียว เปลี่ยนแผนก/กองทุน/ตัวชี้วัดคำนวณในหน้า ไม่ยิง API ใหม่
const PARAMS = ["fy", "deps", "funds", "metric"] as const;
const PERSIST = ["deps", "funds", "metric"] as const;
const ALL_FUNDS = "all";
const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 ${focusRing}`;
const box = "rounded-lg border border-line bg-surface";

const beYear = (m: string) => +m.slice(0, 4) + 543;
const monthShort = (m: string) => THAI_MONTHS_SHORT[+m.slice(5, 7) - 1];
const monthLong = (m: string) => `${THAI_MONTHS[+m.slice(5, 7) - 1]} ${beYear(m)}`;
const monthMid = (m: string) => `${monthShort(m)} ${String(beYear(m)).slice(2)}`;

/** "14:05 น." ถ้าเป็นวันนี้ ไม่งั้นนำหน้าด้วยวันที่ พ.ศ. (เวลาไทย UTC+7 ไม่มี DST) */
function thaiTime(iso: string) {
  const t = new Date(Date.parse(iso) + 7 * 3_600_000).toISOString();
  const day = t.slice(0, 10);
  return `${day === todayIso() ? "" : `${formatThaiDate(day)} `}${t.slice(11, 16)} น.`;
}

/** ส่วนต่างมีเครื่องหมายเสมอ (+ / − U+2212) */
const delta = (n: number, f: (abs: number) => string) => (n > 0 ? `+${f(n)}` : n < 0 ? `−${f(-n)}` : f(0));
const Dash = () => <span className="text-muted">–</span>;

export function DeptTrend({ title }: { title: ReactNode }) {
  usePersistedFilter("fund/dept-trend", PERSIST);
  const p = useUrlParams(PARAMS);
  const currentFy = fiscalYearOf(todayIso());
  const fy = parseFiscalYear(p.fy, currentFy) ?? currentFy;
  const fyOptions = Array.from({ length: FY_BACK + 1 }, (_, i) => currentFy - i);
  const metric: Metric = (METRICS as readonly string[]).includes(p.metric) ? (p.metric as Metric) : "claim";
  const { loading, data, error, retry } = useJson<DeptTrendResponse>(`/api/fund/dept-trend?fy=${fy}`);

  const money = metric !== "visits";
  const fmt = money ? formatBaht : formatCount;

  const view = useMemo(() => {
    if (!data) return null;
    const funds = p.funds === ALL_FUNDS ? [] : p.funds ? p.funds.split(",") : DEFAULT_FUNDS;
    const months = data.months.slice(0, data.loaded);
    const fundSet = funds.length ? new Set(funds) : null;
    const byDep = valuesByDep(data.rows, months, fundSet, metric);
    const activeDeps = data.deps.filter((d) => d.active);
    const slots = p.deps ? parseSlots(p.deps) : topDeps(byDep, new Set(activeDeps.map((d) => d.code)));
    const names = new Map(data.deps.map((d) => [d.code, d.name]));
    const series: (TrendSeries & { summary: DepSummary })[] = slots.flatMap((code, i) => {
      if (!code) return [];
      const values = byDep.get(code) ?? months.map(() => 0);
      return [{
        key: code,
        label: names.get(code) ?? code,
        color: `--chart-${i + 1}`,
        values: data.months.map((_, j) => (j < data.loaded ? values[j] : null)),
        summary: summarize(values, data.complete),
      }];
    });
    return {
      funds,
      months,
      slots,
      series,
      total: selectedTotal(series.map((s) => byDep.get(s.key) ?? months.map(() => 0)), data.complete),
      hospital: summarize(hospitalValues(byDep, months), data.complete),
      overrideNames: names.get(data.override_dep) ?? data.override_dep,
      depGroups: [{ value: "deps", label: "แผนก", options: activeDeps.map((d) => ({ value: d.code, label: d.name })) }],
      fundGroups: [{ value: "funds", label: "กองทุน", options: data.funds.map((f) => ({ value: f.code, label: f.name === f.code ? f.code : `${f.code} ${f.name}` })) }],
    };
  }, [data, p.deps, p.funds, metric]);

  // เดือนปัจจุบันยังไม่จบ: บอกจำนวนวันที่มีข้อมูลทุกจุดที่แสดงเดือนนั้น (แกน x สั้นตามเดิม)
  const partial = useMemo(() => (data ? partialMonth(data) : null), [data]);
  const withDays = (m: string, text: string) => (m === partial?.month ? `${text} (ข้อมูล ${partial.days} วัน)` : text);
  const categories = useMemo(
    () => data?.months.map((m) => ({ label: monthShort(m), title: m === partial?.month ? `${monthLong(m)} (ข้อมูล ${partial.days} วัน)` : monthLong(m) })) ?? [],
    [data, partial],
  );

  let body: ReactNode;
  if (error) {
    body = <Notice title="โหลดข้อมูลไม่สำเร็จ" detail={error} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />;
  } else if (!data || !view) {
    body = <Skeleton rows={8} />;
  } else if (view.series.length === 0) {
    body = <Notice title="ไม่มีค่าใช้จ่ายของกองทุนที่เลือกในปีงบนี้" detail={`ปีงบ ${fy}`} />;
  } else {
    const label = METRIC_LABEL[metric];
    const unitHeader = money ? "บาท" : "ครั้ง";
    // เทียบเดือนล่าสุดที่มีข้อมูล (เดือนนี้แม้ยังไม่จบ) กับเดือนก่อนหน้า
    const lastMonth = view.months[view.months.length - 1];
    const lastHead = lastMonth === partial?.month ? `${monthMid(lastMonth)} (ข้อมูล ${partial.days} วัน, ${unitHeader})` : `${monthMid(lastMonth)} (${unitHeader})`;
    const vsLabel = view.months.length > 1 ? `เทียบ ${monthMid(view.months[view.months.length - 2])}` : "เทียบเดือนก่อน";
    body = (
      <div className="flex flex-col gap-8">
        <Panel title={`${label}รายเดือน · ปีงบ ${fy}`} aside={<Freshness computedAt={data.computed_at} live={data.live} onRefreshed={retry} />}>
          <div className={`${box} p-3`}>
            <MultiTrendChart
              categories={categories}
              series={view.series}
              tickFormat={money ? formatMillions : formatCount}
              valueFormat={fmt}
              unit={money ? "ล้านบาท" : "ครั้ง"}
              ariaLabel={`${label}รายเดือนตามแผนก ปีงบ ${fy}`}
            />
            <DataTableToggle caption={`${label}รายเดือนตามแผนก ปีงบ ${fy} (${unitHeader})`}>
              <thead>
                <tr>
                  <th scope="col" className="text-left">แผนก</th>
                  {view.months.map((m) => (
                    <th key={m} scope="col" className="text-right">{withDays(m, monthMid(m))}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.series.map((s) => (
                  <tr key={s.key}>
                    <th scope="row">{s.label}</th>
                    {view.months.map((m, j) => (
                      <td key={m}>{fmt(s.values[j] ?? 0)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </DataTableToggle>
          </div>
        </Panel>

        <Panel title="สรุปตามแผนก">
          <div className={`${box} overflow-x-auto`}>
            <table className="w-full border-collapse text-sm">
              <thead className="bg-surface-sunken text-muted">
                <tr className="[&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_th]:whitespace-nowrap">
                  <th scope="col" className="text-left">แผนก</th>
                  <th scope="col" className="text-right">รวมปีงบ ({unitHeader})</th>
                  <th scope="col" className="text-right">เฉลี่ยต่อเดือน ({unitHeader})</th>
                  <th scope="col" className="text-right">{lastHead}</th>
                  <th scope="col" className="text-right">{vsLabel} ({unitHeader})</th>
                  <th scope="col" className="text-right">{vsLabel} (%)</th>
                </tr>
              </thead>
              <tbody>
                {view.series.map((s) => (
                  <SummaryRow key={s.key} label={s.label} color={s.color} summary={s.summary} fmt={fmt} />
                ))}
              </tbody>
              <tfoot>
                {view.series.length > 1 && <SummaryRow label="รวมแผนกที่เลือก" summary={view.total} fmt={fmt} strong />}
                <SummaryRow label="ทั้งโรงพยาบาล" summary={view.hospital} fmt={fmt} strong />
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">
            {view.overrideNames && `visit ที่ส่งเข้า ${view.overrideNames} นับทั้ง visit ที่แผนกนั้น ไม่นับที่แผนกหลัก · `}
            ไม่รวม visit ที่ admit · เฉลี่ยนับเฉพาะเดือนที่จบแล้ว
            {partial && ` · ${monthMid(partial.month)} ยังไม่จบเดือน ยอดจึงต่ำกว่าเดือนเต็มได้`}
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {title}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">ปีงบ</span>
            <select value={fy} onChange={(e) => p.set({ fy: +e.target.value === currentFy ? null : e.target.value })} className={SELECT_CLASS}>
              {fyOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <MultiSelect
            label="แผนก"
            groups={view?.depGroups ?? []}
            value={view?.slots.filter(Boolean) ?? []}
            onChange={(v) => p.set({ deps: assignSlots(view?.slots ?? [], v).join(",") || null })}
            allLabel="5 อันดับแรก"
            max={MAX_DEPS}
          />
          <MultiSelect
            label="กองทุน"
            groups={view?.fundGroups ?? []}
            value={view?.funds ?? []}
            onChange={(v) => p.set({ funds: v.length ? v.join(",") : ALL_FUNDS })}
            allLabel="ทุกกองทุน"
          />
          <Segmented label="ตัวชี้วัด" options={METRICS} labels={METRIC_LABEL} value={metric} onChange={(m) => p.set({ metric: m === "claim" ? null : m })} />
        </div>
      </div>
      <div className="mt-6" aria-busy={loading}>
        {body}
      </div>
    </>
  );
}

function Segmented<T extends string>({ label, options, labels, value, onChange }: { label: string; options: readonly T[]; labels: Record<T, string>; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={`h-7 rounded px-2.5 ${focusRing} ${value === o ? "bg-accent-soft font-medium text-accent-text" : "text-muted hover:bg-hover hover:text-foreground"}`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

/** summary null = ไม่มียอด แสดงขีดทุกช่อง */
function SummaryRow({ label, color, summary, fmt, strong }: { label: string; color?: string; summary: DepSummary | null; fmt: (n: number) => string; strong?: boolean }) {
  const cell = `${num} px-3 py-2`;
  const s: Record<keyof DepSummary, number | null> = summary ?? { total: null, avg: null, last: null, prev: null, diff: null, pct: null };
  return (
    <tr className={`border-t border-line ${strong ? "font-semibold" : ""}`}>
      <th scope="row" className={`min-w-48 px-3 py-2 text-left ${strong ? "font-semibold" : "font-normal"}`}>
        <span className="flex items-center gap-2">
          {color && <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: `var(${color})` }} />}
          {label}
        </span>
      </th>
      <td className={cell}>{s.total === null ? <Dash /> : fmt(s.total)}</td>
      <td className={cell}>{s.avg === null ? <Dash /> : fmt(s.avg)}</td>
      <td className={cell}>{s.last === null ? <Dash /> : fmt(s.last)}</td>
      <td className={cell}>{s.diff === null ? <Dash /> : delta(s.diff, fmt)}</td>
      <td className={cell}>{s.pct === null ? <Dash /> : `${delta(s.pct, (a) => a.toFixed(1))}%`}</td>
    </tr>
  );
}

/** เวลาที่ดึงจาก HOSxP + ปุ่มดึงใหม่ (ล้าง cache เดือนนี้/เดือนก่อน แล้วโหลดใหม่) ปีงบที่จบแล้วไม่มีปุ่ม */
function Freshness({ computedAt, live, onRefreshed }: { computedAt: string; live: boolean; onRefreshed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/fund/dept-trend", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `ดึงข้อมูลไม่สำเร็จ (HTTP ${res.status})`);
      onRefreshed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-muted tabular-nums">ข้อมูล ณ {thaiTime(computedAt)}</span>
      {live && (
        <button type="button" onClick={refresh} disabled={busy} className={`${btn} gap-1.5 disabled:cursor-wait disabled:opacity-60`}>
          <RefreshCw aria-hidden="true" className={`size-4 ${busy ? "motion-safe:animate-spin" : ""}`} />
          {busy ? "กำลังดึง…" : "ดึงใหม่"}
        </button>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
