"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useDateRange } from "@/components/date-range-filter/date-range-filter";
import { formatBaht, formatCompactBaht, formatCount, formatMillions } from "@/lib/number-format";
import { THAI_MONTHS_SHORT, formatThaiDate, parseIsoDate } from "@/lib/thai-date";
import { RankedBarChart, type RankedItem } from "@/components/charts/charts";
import { Money, Notice, Panel, btn, formatPct, num, pct, useJson } from "../_components/ui";
import { STATUS } from "../_components/claim-status";
import type { ClaimOverviewResponse, ClaimStatus, ClaimTotals } from "@/app/api/fund/types";
import { StackedBarChart, type StackSeries } from "./stacked-bar";

const FUND_LIMIT = 8; // เกินนี้รวมเป็น "อื่นๆ"
const DEP_LIMIT = 10;
const OTHER = "อื่นๆ";

const notClosed = (t: ClaimTotals) => ({ visits: t.authen_only.visits + t.none.visits, amount: t.authen_only.amount + t.none.amount });
const closeRate = (t: ClaimTotals) => pct(t.closed.visits, t.visits);
const rangeText = (start: string, end: string) => (start === end ? formatThaiDate(start) : `${formatThaiDate(start)} – ${formatThaiDate(end)}`);

function dayLabel(iso: string) {
  const p = parseIsoDate(iso);
  return p ? `${p[2]} ${THAI_MONTHS_SHORT[p[1] - 1]}` : iso;
}

const box = "rounded-lg border border-line bg-surface";

/* ---------- เปลี่ยนแปลงเทียบช่วงก่อน ---------- */

/** good: ทิศที่ดี ("up" มูลค่า/อัตราปิด, "down" ยอดค้าง) / unit "%" = % เปลี่ยน, "จุด" = ผลต่างของอัตรา (percentage point) */
function Change({ current, previous, good = "up", unit = "%" }: { current: number; previous: number | null; good?: "up" | "down"; unit?: "%" | "จุด" }) {
  if (previous === null || (unit === "%" && previous === 0)) return <span className="text-muted">–</span>;
  const diff = unit === "%" ? ((current - previous) / previous) * 100 : current - previous;
  const flat = Math.abs(diff) < 0.05;
  const up = diff > 0;
  const Arrow = flat ? Minus : up ? ArrowUp : ArrowDown;
  const tone = flat ? "text-muted" : up === (good === "up") ? "text-success" : "text-danger";
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium tabular-nums ${tone}`}>
      <Arrow aria-hidden="true" className="size-3" />
      <span className="sr-only">{flat ? "เท่าเดิม" : up ? "เพิ่มขึ้น" : "ลดลง"}</span>
      {unit === "%" ? formatPct(Math.abs(diff)) : `${Math.abs(diff).toFixed(1)} จุด`}
    </span>
  );
}

/* ---------- KPI ---------- */

function Kpi({ label, value, full, sub, change, tone }: { label: string; value: string; full?: string; sub?: string; change: ReactNode; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-4 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`text-title ${tone ?? ""}`} title={full}>
        {full ? (
          <>
            <span aria-hidden="true">{value}</span>
            <span className="sr-only">{full}</span>
          </>
        ) : (
          value
        )}
      </dd>
      {sub && <dd className="text-xs text-muted tabular-nums">{sub}</dd>}
      <dd className="flex items-center gap-1 text-xs text-muted">
        {change}
        <span>จากช่วงก่อน</span>
      </dd>
    </div>
  );
}

function KpiRow({ data }: { data: ClaimOverviewResponse }) {
  const { totals: t, previous: p } = data;
  const risk = notClosed(t);
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
      <Kpi
        label="มูลค่ารวม"
        value={formatCompactBaht(t.amount)}
        full={`${formatBaht(t.amount)} บาท`}
        sub={`${formatCount(t.visits)} visit`}
        change={<Change current={t.amount} previous={p?.amount ?? null} />}
      />
      <Kpi
        label="ปิดสิทธิแล้ว"
        value={`${formatPct(closeRate(t))} ของ visit`}
        sub={`${formatCount(t.closed.visits)} visit · ${formatCompactBaht(t.closed.amount)}`}
        change={<Change current={closeRate(t)} previous={p ? closeRate(p) : null} unit="จุด" />}
      />
      <Kpi
        label="ยังไม่ปิดสิทธิ"
        value={formatCompactBaht(risk.amount)}
        full={`${formatBaht(risk.amount)} บาท`}
        sub={`${formatCount(risk.visits)} visit`}
        tone="text-warning"
        change={<Change current={risk.amount} previous={p ? notClosed(p).amount : null} good="down" />}
      />
      <Kpi
        label="มี authen แต่ยังไม่ปิด"
        value={`${formatCount(t.authen_only.visits)} visit`}
        sub={formatCompactBaht(t.authen_only.amount)}
        change={<Change current={t.authen_only.visits} previous={p?.authen_only.visits ?? null} good="down" />}
      />
    </dl>
  );
}

/* ---------- ตามกองทุน / แผนก ---------- */

type Group = ClaimTotals & { code: string | null; name: string };

function fold<T extends ClaimTotals>(rows: T[], limit: number, toGroup: (r: T) => Group): Group[] {
  // แถวที่ช่วงนี้ไม่มี visit (มีแค่ช่วงก่อน) ไม่ต้องแสดงในกราฟ ตารางเทียบช่วงก่อนยังแสดงอยู่
  const all = rows.filter((r) => r.visits > 0).map(toGroup);
  if (all.length <= limit) return all;
  const tail = all.slice(limit - 1);
  const sum = (f: (g: Group) => number) => tail.reduce((s, g) => s + f(g), 0);
  const part = (k: ClaimStatus) => ({ visits: sum((g) => g[k].visits), amount: sum((g) => g[k].amount) });
  return [
    ...all.slice(0, limit - 1),
    { code: null, name: OTHER, visits: sum((g) => g.visits), amount: sum((g) => g.amount), closed: part("closed"), authen_only: part("authen_only"), none: part("none") },
  ];
}

const STATUS_KEYS: ClaimStatus[] = ["closed", "authen_only", "none"];

function FundStatus({ data, onSelect }: { data: ClaimOverviewResponse; onSelect: (code: string) => void }) {
  const funds = useMemo(() => fold(data.by_fund, FUND_LIMIT, (f) => ({ ...f, code: f.fund_code, name: f.fund_name || f.fund_code })), [data]);
  const series = useMemo<StackSeries[]>(
    () => STATUS_KEYS.map((k) => ({ label: STATUS[k].label, color: STATUS[k].color, values: funds.map((f) => f[k].amount) })),
    [funds],
  );
  const endLabels = useMemo(() => funds.map((f) => `${formatCompactBaht(f.amount)} · ปิด ${formatPct(pct(f.closed.amount, f.amount))}`), [funds]);
  const tooltipTitle = useCallback((i: number) => funds[i]?.name ?? "", [funds]);
  const tooltipLabel = useCallback(
    (d: number, i: number) => {
      const s = funds[i]?.[STATUS_KEYS[d]];
      return s ? `${STATUS[STATUS_KEYS[d]].label} ${formatBaht(s.amount)} บาท (${formatCount(s.visits)} visit)` : "";
    },
    [funds],
  );
  const tooltipFooter = useCallback((i: number) => (funds[i] ? `ปิดสิทธิแล้ว ${formatPct(pct(funds[i].closed.amount, funds[i].amount))} ของมูลค่า` : ""), [funds]);
  const select = useCallback((i: number) => funds[i]?.code && onSelect(funds[i].code), [funds, onSelect]);

  return (
    <Panel title="สถานะการเคลมตามกองทุน">
      <div className={`${box} p-3`}>
        <StackedBarChart
          horizontal
          labels={funds.map((f) => f.name)}
          series={series}
          endLabels={endLabels}
          ariaLabel="มูลค่าตามสถานะการเคลมแยกกองทุน"
          tooltipTitle={tooltipTitle}
          tooltipLabel={tooltipLabel}
          tooltipFooter={tooltipFooter}
          onSelect={select}
        />
      </div>
    </Panel>
  );
}

function FundCompare({ data }: { data: ClaimOverviewResponse }) {
  const th = "px-3 py-2 text-sm font-medium text-muted whitespace-nowrap";
  const td = `px-3 py-2 ${num}`;
  const t = data.totals;
  const p = data.previous;
  return (
    <Panel title="เทียบช่วงก่อนหน้ารายกองทุน">
      <div className={`${box} overflow-x-auto`}>
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={`${th} text-left`}>กองทุน</th>
              <th scope="col" className={`${th} text-right`}>มูลค่า (บาท)</th>
              <th scope="col" className={`${th} text-right`}>ช่วงก่อน (บาท)</th>
              <th scope="col" className={`${th} text-right`}>เปลี่ยนแปลง</th>
              <th scope="col" className={`${th} text-right`}>visit</th>
              <th scope="col" className={`${th} text-right`}>ช่วงก่อน</th>
            </tr>
          </thead>
          <tbody>
            {data.by_fund.map((f) => (
              <tr key={f.fund_code} className="border-b border-line last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-medium whitespace-nowrap">{f.fund_name || f.fund_code}</th>
                <td className={td}><Money value={f.amount} /></td>
                <td className={`${td} text-muted`}><Money value={f.prev_amount} /></td>
                <td className={td}><Change current={f.amount} previous={f.prev_amount} /></td>
                <td className={td}>{formatCount(f.visits)}</td>
                <td className={`${td} text-muted`}>{formatCount(f.prev_visits)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-surface-sunken font-medium">
              <th scope="row" className="px-3 py-2 text-left">รวม</th>
              <td className={td}><Money value={t.amount} /></td>
              <td className={`${td} text-muted`}><Money value={p?.amount} /></td>
              <td className={td}><Change current={t.amount} previous={p?.amount ?? null} /></td>
              <td className={td}>{formatCount(t.visits)}</td>
              <td className={`${td} text-muted`}>{p ? formatCount(p.visits) : <span className="text-muted">–</span>}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

function DepartmentBars({ data, onSelect }: { data: ClaimOverviewResponse; onSelect: (code: string) => void }) {
  const deps = useMemo(() => fold(data.by_department, DEP_LIMIT, (d) => ({ ...d, code: d.dep_code, name: d.dep_name || d.dep_code })), [data]);
  const items = useMemo<RankedItem[]>(
    () =>
      deps.map((d) => ({
        // ตัดรหัสนำหน้า ("027-") ในกราฟ ป้ายจะได้ไม่ถูกตัดบนจอแคบ ชื่อเต็มอยู่ใน chip และรายการ
        label: d.name.replace(/^\d+-/, ""),
        value: d.amount,
        valueText: `${formatCompactBaht(d.amount)} · ปิด ${formatPct(closeRate(d))}`,
        tooltip: `${formatBaht(d.amount)} บาท · ปิดสิทธิแล้ว ${formatCount(d.closed.visits)}/${formatCount(d.visits)} visit (${formatPct(closeRate(d))})`,
        // href ใช้บอก RankedBarChart ว่าแถวนี้กดได้ (อื่นๆ กดไม่ได้)
        href: d.code ? `?dep=${encodeURIComponent(d.code)}` : undefined,
      })),
    [deps],
  );
  const select = useCallback((it: RankedItem) => {
    const code = deps[items.indexOf(it)]?.code;
    if (code) onSelect(code);
  }, [deps, items, onSelect]);
  return (
    <Panel title="มูลค่าตามแผนก">
      <div className={`${box} p-3`}>
        <RankedBarChart items={items} ariaLabel="มูลค่าและอัตราปิดสิทธิตามแผนก" onSelect={select} />
      </div>
    </Panel>
  );
}

/** แกนมูลค่าใช้ "ล้านบาท" เสมอ ยกเว้นค่าสูงสุดต่ำกว่า 50,000 บาท (tick เล็กกว่า 0.01 ล้าน ป้ายจะซ้ำ) ใช้ "บาท" จำนวนเต็ม (กฎเดียวกับหน้าภาพรวมกองทุน) */
const MILLION_AXIS_MIN = 50_000;

function DailyTrend({ data }: { data: ClaimOverviewResponse }) {
  const daily = data.daily;
  const series = useMemo<StackSeries[]>(
    () => [
      { label: STATUS.closed.label, color: STATUS.closed.color, values: daily.map((d) => d.closed.amount) },
      { label: "ยังไม่ปิดสิทธิ", color: STATUS.authen_only.color, values: daily.map((d) => notClosed(d).amount) },
    ],
    [daily],
  );
  const millions = Math.max(0, ...daily.map((d) => d.amount)) >= MILLION_AXIS_MIN;
  const tooltipTitle = useCallback((i: number) => formatThaiDate(daily[i]?.date), [daily]);
  const tooltipLabel = useCallback(
    (s: number, i: number) => {
      const d = daily[i];
      if (!d) return "";
      return s === 0 ? `${STATUS.closed.label} ${formatBaht(d.closed.amount)} บาท` : `ยังไม่ปิดสิทธิ ${formatBaht(notClosed(d).amount)} บาท`;
    },
    [daily],
  );
  const tooltipFooter = useCallback((i: number) => (daily[i] ? `รวม ${formatBaht(daily[i].amount)} บาท` : ""), [daily]);

  return (
    <Panel title="แนวโน้มรายวัน">
      <div className={`${box} p-3`}>
        <StackedBarChart
          labels={daily.map((d) => dayLabel(d.date))}
          series={series}
          unit={millions ? "ล้านบาท" : "บาท"}
          tickFormat={millions ? formatMillions : formatCount}
          ariaLabel={`มูลค่ารายวันตามการปิดสิทธิ ${rangeText(data.start, data.end)}`}
          tooltipTitle={tooltipTitle}
          tooltipLabel={tooltipLabel}
          tooltipFooter={tooltipFooter}
        />
        <table className="sr-only">
          <caption>มูลค่ารายวัน (บาท)</caption>
          <thead>
            <tr>
              <th scope="col">วันที่</th>
              <th scope="col">ปิดสิทธิแล้ว</th>
              <th scope="col">ยังไม่ปิดสิทธิ</th>
              <th scope="col">รวม</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date}>
                <th scope="row">{formatThaiDate(d.date)}</th>
                <td>{formatBaht(d.closed.amount)}</td>
                <td>{formatBaht(notClosed(d).amount)}</td>
                <td>{formatBaht(d.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ---------- page body ---------- */

export function ClaimOverview() {
  const { start, end } = useDateRange();
  const router = useRouter();
  const { loading, data, error, retry } = useJson<ClaimOverviewResponse>(`/api/fund/claim-overview?${new URLSearchParams({ start, end })}`);

  // กดกองทุน/แผนกในกราฟ = ไปรายการที่ยังไม่ปิดสิทธิของกองทุน/แผนกนั้น ช่วงวันที่เดียวกัน
  const selectFund = useCallback((fund: string) => router.push(`/fund/claim-status?${new URLSearchParams({ start, end, fund })}`), [router, start, end]);
  const selectDep = useCallback((dep: string) => router.push(`/fund/claim-status?${new URLSearchParams({ start, end, dep })}`), [router, start, end]);

  let summary: ReactNode;
  if (error) {
    summary = (
      <div role="alert">
        <Notice title="โหลดข้อมูลไม่สำเร็จ" detail={error} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
      </div>
    );
  } else if (!data) {
    summary = <SummarySkeleton />;
  } else if (data.totals.visits === 0) {
    summary = <Notice title="ไม่มีการรับบริการในช่วงนี้" detail={rangeText(data.start, data.end)} />;
  } else {
    summary = (
      <div className={`flex flex-col gap-8 transition-opacity duration-200 ${loading ? "opacity-60" : ""}`}>
        <KpiRow data={data} />
        <FundStatus data={data} onSelect={selectFund} />
        <FundCompare data={data} />
        <div className="grid gap-8 lg:grid-cols-2">
          <DepartmentBars data={data} onSelect={selectDep} />
          <DailyTrend data={data} />
        </div>
      </div>
    );
  }

  return (
    <div aria-busy={loading}>{summary}</div>
  );
}

export function SummarySkeleton() {
  const block = "animate-pulse rounded-lg bg-surface-sunken";
  return (
    <div aria-busy="true" aria-label="กำลังโหลด" className="flex flex-col gap-8">
      <div className={`${block} h-24`} />
      <div className={`${block} h-72`} />
      <div className={`${block} h-48`} />
      <div className="grid gap-8 lg:grid-cols-2">
        <div className={`${block} h-72`} />
        <div className={`${block} h-72`} />
      </div>
    </div>
  );
}
