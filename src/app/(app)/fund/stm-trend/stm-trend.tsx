"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { DataTableToggle, MultiTrendChart, type TrendSeries } from "@/components/charts/charts";
import { StackedBarChart, type StackedBarCategory, type StackedBarSeries } from "@/components/stacked-bar-chart/stacked-bar-chart";
import { formatBaht, formatCompactBaht, formatCount } from "@/lib/number-format";
import { usePersistedFilter } from "@/lib/persisted-filter";
import { THAI_MONTHS_SHORT, todayIso } from "@/lib/thai-date";
import { FY_BACK, fiscalYearOf, parseFiscalYear } from "@/app/api/fund/uc-dashboard/dashboard";
import { GROUPS, OTHER_FUND, fiscalMonths, fundBars, groupOf, groupTrend, type Group, type GroupKey, type StmTrendResponse } from "@/app/api/fund/stm-trend/trend";
import { Notice, Panel, Skeleton, btn, focusRing, formatPct, num, useJson, useUrlParams } from "../_components/ui";
import { FUNDS, periodLabel } from "../stm-import/labels";

const PARAMS = ["fy", "group"] as const;
const DEFAULT_GROUP: GroupKey = "uc-ip";
const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 ${focusRing}`;
const box = "rounded-lg border border-line bg-surface p-3";

const monthTick = (m: string) => `${THAI_MONTHS_SHORT[+m.slice(5, 7) - 1]} ${String(+m.slice(0, 4) + 543).slice(2)}`;
// StackedBarChart จัด tick แกน y เองไม่ได้ จึงส่งค่าเป็นล้านบาท (tick = ล้านบาท) แล้วคูณกลับตอนแสดงใน tooltip/ตาราง (แบบเดียวกับ uc-dashboard)
const fromMillions = (n: number) => formatBaht(n * 1e6);
const Dash = () => <span className="text-muted">–</span>;

// กราฟเส้น: กลุ่มที่ค่ามีความหมาย ; UC OP ไม่อยู่ในอัตราเพราะผู้ป่วยนอก UC ส่วนใหญ่จ่ายแบบเหมาจ่ายรายหัว ไม่ผ่าน STM
const RATE_GROUPS: GroupKey[] = ["uc-ip", "ofc-op", "ofc-ip"];
const IP_GROUPS: GroupKey[] = ["uc-ip", "ofc-ip"];
const ALL_GROUPS = GROUPS.map((g) => g.key);

type Metric = "rate" | "bahtPerRw" | "cmi" | "lag";
const pctText = (n: number) => formatPct(n * 100);
const cmiText = (n: number) => n.toFixed(4);
const daysText = (n: number) => `${formatCount(n)} วัน`;

export function StmTrend({ title }: { title: ReactNode }) {
  usePersistedFilter("fund/stm-trend", PARAMS);
  const p = useUrlParams(PARAMS);
  const currentFy = fiscalYearOf(todayIso());
  const fy = parseFiscalYear(p.fy, currentFy) ?? currentFy;
  const fyOptions = Array.from({ length: FY_BACK + 1 }, (_, i) => currentFy - i);
  const group = groupOf(p.group || DEFAULT_GROUP);
  const { loading, data, error, retry } = useJson<StmTrendResponse>(`/api/fund/stm-trend?fy=${fy}`);

  const months = useMemo(() => fiscalMonths(fy), [fy]);
  const categories = useMemo<StackedBarCategory[]>(() => months.map((m) => ({ key: m, label: monthTick(m), title: periodLabel(`${m}-01`) })), [months]);
  const trends = useMemo(() => (data ? new Map(GROUPS.map((g) => [g.key, groupTrend(data.months, g, months)])) : null), [data, months]);
  const bars = useMemo(() => (data ? fundBars(data.funds, group, months) : null), [data, group, months]);

  let body: ReactNode;
  if (error) {
    body = <Notice title="โหลดข้อมูลไม่สำเร็จ" detail={error} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />;
  } else if (!data || !trends || !bars) {
    body = <Skeleton rows={8} />;
  } else if (data.months.length === 0) {
    body = <Notice title={`ยังไม่มี STM ของปีงบ ${fy}`} action={<Link href="/fund/stm-import" className={btn}>นำเข้า STM</Link>} />;
  } else {
    const t = trends.get(group.key)!;
    const files = data.months.filter((r) => r.scheme === group.scheme && r.patient_type === group.patient_type).reduce((s, r) => s + r.files, 0);
    const imported = GROUPS.filter((g) => trends.get(g.key)!.lagImported).map((g) => g.label);
    const series: StackedBarSeries[] = bars.funds.map((f) => ({
      key: f.key,
      label: f.key === OTHER_FUND ? "อื่นๆ" : (FUNDS[f.key] ?? f.key),
      short: f.key === OTHER_FUND ? "อื่นๆ" : f.key,
      color: `var(${f.color})`,
      note: f.key === OTHER_FUND ? bars.others.join(", ") : undefined,
    }));
    const line = (metric: Metric, keys: GroupKey[]) => keys.map((k) => ({ key: k, label: groupOf(k).label, color: groupOf(k).color, values: trends.get(k)![metric] }));

    body = (
      <div className="flex flex-col gap-8">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="ยอดชดเชยทั้งปีงบ" sub={`${formatCount(files)} ไฟล์ STM`}>
            {t.total.paid === null ? <Dash /> : <CompactBaht value={t.total.paid} />}
          </Kpi>
          {group.key !== "uc-op" && <Kpi label="อัตราได้รับชดเชย" sub="ชดเชย ÷ เรียกเก็บ">{t.total.rate === null ? <Dash /> : <Big>{pctText(t.total.rate)}</Big>}</Kpi>}
          {group.patient_type === "IP" && (
            <>
              <Kpi label="บาทต่อ AdjRW" sub="ค่ารักษาตาม DRG ÷ AdjRW">{t.total.bahtPerRw === null ? <Dash /> : <Big unit="บาท">{formatBaht(t.total.bahtPerRw)}</Big>}</Kpi>
              <Kpi label="CMI" sub="AdjRW เฉลี่ยต่อราย">{t.total.cmi === null ? <Dash /> : <Big>{cmiText(t.total.cmi)}</Big>}</Kpi>
            </>
          )}
        </dl>

        <Panel title={`ยอดชดเชยรายเดือนตามกองทุน · ${group.label}`} aside={<span className="text-sm text-muted">แกน: ล้านบาท</span>}>
          <div className={box}>
            {series.length === 0 ? (
              <Notice title={`ไม่มี STM ของ ${group.label} ในปีงบ ${fy}`} />
            ) : (
              <StackedBarChart
                label={`ยอดชดเชยรายเดือนตามกองทุน ${group.label} ปีงบ ${fy} (บาท)`}
                categoryHeader="เดือนบริการ"
                categories={categories}
                series={series}
                values={bars.values.map((row) => row.map((v) => v / 1e6))}
                format={fromMillions}
                height={300}
              />
            )}
          </div>
        </Panel>

        <div className="grid gap-8 xl:grid-cols-2">
          <TrendPanel
            title="อัตราได้รับชดเชย"
            note="ไม่รวม UC OP เพราะผู้ป่วยนอก UC ส่วนใหญ่จ่ายแบบเหมาจ่ายรายหัว ไม่ผ่าน STM"
            categories={categories}
            series={line("rate", RATE_GROUPS)}
            tickFormat={(n) => `${Math.round(n * 100)}%`}
            valueFormat={pctText}
            unit="% ของยอดเรียกเก็บ"
            fy={fy}
          />
          <TrendPanel title="บาทต่อ AdjRW" categories={categories} series={line("bahtPerRw", IP_GROUPS)} tickFormat={formatCount} valueFormat={formatBaht} unit="บาท" fy={fy} />
          <TrendPanel title="CMI" categories={categories} series={line("cmi", IP_GROUPS)} tickFormat={(n) => n.toFixed(2)} valueFormat={cmiText} unit="AdjRW เฉลี่ยต่อราย" fy={fy} />
          <TrendPanel
            title="ระยะเวลาถึงวันที่ STM งวดแรก"
            note="นับจากวันสิ้นเดือนบริการ"
            warning={imported.length > 0 ? `วันที่ STM ของ ${imported.join(", ")} เป็นวันที่บันทึกตอนนำเข้าย้อนหลัง ระยะเวลาจึงยังไม่ใช่ค่าจริง` : undefined}
            categories={categories}
            series={line("lag", ALL_GROUPS)}
            tickFormat={formatCount}
            valueFormat={daysText}
            unit="วัน"
            fy={fy}
          />
        </div>
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
          <GroupPicker value={group} onChange={(g) => p.set({ group: g === DEFAULT_GROUP ? null : g })} />
        </div>
      </div>
      <div className="mt-6" aria-busy={loading}>
        {body}
      </div>
    </>
  );
}

/** native radio: ลูกศรเลื่อนตัวเลือกได้เองตามมาตรฐาน */
function GroupPicker({ value, onChange }: { value: Group; onChange: (g: GroupKey) => void }) {
  return (
    <fieldset className="flex h-9 items-center gap-0.5 rounded-md border border-line bg-surface px-0.5">
      <legend className="sr-only">กลุ่ม</legend>
      {GROUPS.map((g) => (
        <label key={g.key} className="relative">
          <input type="radio" name="stm-group" value={g.key} checked={value.key === g.key} onChange={() => onChange(g.key)} className="peer sr-only" />
          <span className="flex h-8 cursor-pointer items-center rounded-md px-3 whitespace-nowrap text-muted peer-checked:bg-accent-soft peer-checked:font-medium peer-checked:text-accent-text peer-focus-visible:ring-2 peer-focus-visible:ring-ring hover:bg-hover hover:text-foreground">
            {g.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function Kpi({ label, sub, children }: { label: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-line bg-surface p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-2 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">{children}</dd>
      <dd className="mt-1 text-xs text-muted">{sub}</dd>
    </div>
  );
}

function Big({ unit, children }: { unit?: string; children: ReactNode }) {
  return (
    <>
      <span className="text-kpi font-semibold tracking-tight">{children}</span>
      {unit && <span className="text-sm text-muted">{unit}</span>}
    </>
  );
}

/** "216.26 ล้านบาท": ตัวเลขเป็น text-kpi หน่วยเล็ก ค่าเต็มตอน hover */
function CompactBaht({ value }: { value: number }) {
  const s = formatCompactBaht(value);
  const i = s.lastIndexOf(" ");
  return (
    <span title={`${formatBaht(value)} บาท`} className="contents">
      <Big unit={s.slice(i + 1)}>{s.slice(0, i)}</Big>
    </span>
  );
}

function TrendPanel({
  title, note, warning, categories, series, tickFormat, valueFormat, unit, fy,
}: {
  title: string;
  note?: string;
  warning?: string;
  categories: StackedBarCategory[];
  series: TrendSeries[];
  tickFormat: (n: number) => string;
  valueFormat: (n: number) => string;
  unit: string;
  fy: number;
}) {
  return (
    <Panel title={title}>
      <div className={box}>
        {note && <p className="mb-3 text-xs text-muted">{note}</p>}
        {warning && (
          <p className="mb-3 flex items-start gap-2 rounded-md border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {warning}
          </p>
        )}
        <MultiTrendChart categories={categories} series={series} tickFormat={tickFormat} valueFormat={valueFormat} unit={unit} ariaLabel={`${title}รายเดือน ปีงบ ${fy}`} />
        <DataTableToggle caption={`${title}รายเดือน ปีงบ ${fy} (${unit})`}>
          <thead>
            <tr>
              <th scope="col" className="text-left">เดือนบริการ</th>
              {series.map((s) => (
                <th key={s.key} scope="col" className="text-right">{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((c, i) => (
              <tr key={c.key}>
                <th scope="row">{c.title}</th>
                {series.map((s) => (
                  <td key={s.key} className={num}>{s.values[i] === null ? <Dash /> : valueFormat(s.values[i]!)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </DataTableToggle>
      </div>
    </Panel>
  );
}
