"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { ArrowDown, ArrowUp, BedDouble, CalendarX, CircleAlert, House, Minus, Siren, Stethoscope, UserPlus, Users } from "lucide-react";
import { useDateRange } from "@/components/date-range-filter/date-range-filter";
import { DataTableToggle, DonutChart, RankedBarChart, type DonutSegment, type RankedItem } from "@/components/charts/charts";
import { StackedBarChart, type StackedBarCategory, type StackedBarSeries } from "@/components/stacked-bar-chart/stacked-bar-chart";
import { formatCount } from "@/lib/number-format";
import { THAI_MONTHS_SHORT, formatThaiDate, parseIsoDate, todayIso } from "@/lib/thai-date";
import { AGE_GROUPS, type Compare, type CountRow, type HomeOverviewResponse } from "@/app/api/home/overview/types";

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btn = `inline-flex h-8 items-center rounded-md border border-line px-3 text-sm hover:bg-hover ${focusRing}`;
/** การ์ดลอยบนพื้น bg-background ของหน้า: ไม่มีเส้นขอบหนา ใช้เงาอ่อน + hairline จางให้ยังเห็นขอบในธีมมืด */
const card = "rounded-2xl bg-surface shadow-sm ring-1 ring-line/60";

const rangeText = (start: string, end: string) =>
  start === end ? formatThaiDate(start) : `${formatThaiDate(start)} – ${formatThaiDate(end)}`;
const pctText = (n: number) => `${n.toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`;
const share = (part: number, whole: number) => pctText(whole > 0 ? (part / whole) * 100 : 0);
const pad2 = (n: number) => String(n).padStart(2, "0");

/** ป้ายแกน x: "4 พ.ย." (ช่วงข้ามปีต่อท้ายปี พ.ศ. 2 หลัก) */
function dayLabel(iso: string, withYear: boolean) {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  const [y, m, d] = p;
  return `${d} ${THAI_MONTHS_SHORT[m - 1]}${withYear ? ` ${String(y + 543).slice(2)}` : ""}`;
}

/** ตัวเลขเด่นในข้อความสรุปมุมขวาของการ์ด */
const Num = ({ children }: { children: ReactNode }) => <span className="font-semibold text-foreground tabular-nums">{children}</span>;

/* ---------- data ---------- */

type Result = { key: string; data?: HomeOverviewResponse; error?: string };

function useOverview(start: string, end: string) {
  const [nonce, setNonce] = useState(0);
  const key = `${start}|${end}|${nonce}`;
  const [res, setRes] = useState<Result | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/home/overview?${new URLSearchParams({ start, end })}`, { signal: ac.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? `เซิร์ฟเวอร์ตอบกลับ HTTP ${r.status}`);
        setRes({ key, data: body as HomeOverviewResponse });
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

/** ward จริง (นับเตียง) แยกจาก Home ward ที่ผู้ป่วยเกินจำนวน "เตียง" ได้ */
function census(data: HomeOverviewResponse) {
  const wards = data.wards.filter((w) => !w.homeCare);
  const home = data.wards.filter((w) => w.homeCare);
  return {
    wards,
    home,
    occupied: wards.reduce((s, w) => s + w.admitted, 0),
    beds: wards.reduce((s, w) => s + w.beds, 0),
  };
}

/* ---------- layout pieces ---------- */

function Card({ id, title, sub, aside, className = "", children }: { id: string; title: string; sub?: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`${card} min-w-0 p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={id} className="text-title">
            {title}
          </h2>
          {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
        </div>
        {aside && <p className="text-sm text-muted">{aside}</p>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Notice({ icon, title, detail, action, className = "" }: { icon: ReactNode; title: string; detail?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={`${card} flex flex-col items-center justify-center px-4 py-12 text-center text-sm ${className}`}>
      <span className="text-muted">{icon}</span>
      <p className="mt-2 font-medium">{title}</p>
      {detail && <p className="mt-1 text-muted">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------- KPI ---------- */

/** สีชิปไอคอนตามกลุ่มงาน (ไม่ใช่ดี/แย่): ผู้ป่วยนอก, ผู้ป่วยใน, ฉุกเฉิน */
const CHIP = {
  opd: "bg-accent-soft text-accent-text",
  ipd: "bg-[color-mix(in_oklab,var(--chart-1)_14%,var(--surface))] text-(--chart-1)",
  er: "bg-danger-soft text-danger",
};

function Kpi({ label, icon: Icon, tone, value, unit, sub }: { label: string; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; tone: keyof typeof CHIP; value: string; unit?: string; sub: ReactNode }) {
  return (
    <div className={`${card} relative flex min-w-0 flex-col p-4`}>
      <span aria-hidden="true" className={`absolute top-4 right-4 grid size-9 place-items-center rounded-lg ${CHIP[tone]}`}>
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <dt className="min-h-9 pr-11 text-sm text-muted">{label}</dt>
      <dd className="mt-2 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
        <span className="text-kpi font-semibold tracking-tight">{value}</span>
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </dd>
      <dd className="mt-auto pt-1.5 text-sm">{sub}</dd>
    </div>
  );
}

/**
 * จำนวนคน/ครั้งเป็นภาระงาน ไม่มีทิศที่ "ดีกว่า" จึงไม่ใช้สี success/danger
 * ดูวันนี้วันเดียว: วันนี้ยังไม่จบวัน เทียบ % กับเมื่อวานทั้งวันจะติดลบเสมอ จึงแสดงยอดเมื่อวานแทน
 */
function Delta({ value, today, period }: { value: Compare; today: boolean; period: string }) {
  if (today) return <span className="text-muted tabular-nums">เมื่อวาน {formatCount(value.prev)}</span>;
  if (value.prev === 0) {
    return (
      <span className="text-muted" title={`ช่วงก่อน (${period}) เป็น 0`}>
        <span aria-hidden="true">–</span>
        <span className="sr-only">ช่วงก่อนเป็น 0</span>
      </span>
    );
  }
  const change = ((value.cur - value.prev) / value.prev) * 100;
  const flat = Math.abs(change) < 0.05;
  const Arrow = flat ? Minus : change > 0 ? ArrowUp : ArrowDown;
  return (
    <span className="flex items-center gap-1 text-muted" title={`เทียบ ${period}: ${formatCount(value.prev)}`}>
      <span className="inline-flex items-center gap-0.5 font-medium text-foreground tabular-nums">
        <Arrow aria-hidden className="size-3" />
        <span className="sr-only">{flat ? "เท่าเดิม" : change > 0 ? "เพิ่มขึ้น" : "ลดลง"}</span>
        {pctText(Math.abs(change))}
      </span>
      <span>จากช่วงก่อน</span>
    </span>
  );
}

/** อัตราครองเตียงที่ถือว่าตึง (เตือน) */
const OCCUPANCY_WARN = 90;

function KpiRow({ data }: { data: HomeOverviewResponse }) {
  const today = data.start === data.end && data.end === todayIso();
  const period = rangeText(data.prevStart, data.prevEnd);
  const { home, occupied, beds } = census(data);
  const occupancy = beds > 0 ? (occupied / beds) * 100 : null;
  const delta = (v: Compare) => <Delta value={v} today={today} period={period} />;
  return (
    <dl className={`grid grid-cols-2 gap-4 md:grid-cols-3 ${home.length ? "xl:grid-cols-6" : "xl:grid-cols-5"}`}>
      <Kpi label="ผู้รับบริการ" icon={Users} tone="opd" value={formatCount(data.kpi.patients.cur)} unit="คน" sub={delta(data.kpi.patients)} />
      <Kpi label="visit ผู้ป่วยนอก" icon={Stethoscope} tone="opd" value={formatCount(data.kpi.visits.cur)} unit="ครั้ง" sub={delta(data.kpi.visits)} />
      <Kpi label="ฉุกเฉิน" icon={Siren} tone="er" value={formatCount(data.kpi.er.cur)} unit="ครั้ง" sub={delta(data.kpi.er)} />
      <Kpi label="รับใหม่ผู้ป่วยใน" icon={UserPlus} tone="ipd" value={formatCount(data.kpi.admissions.cur)} unit="คน" sub={delta(data.kpi.admissions)} />
      <Kpi
        label="ผู้ป่วยในขณะนี้"
        icon={BedDouble}
        tone="ipd"
        value={formatCount(occupied)}
        unit={`/ ${formatCount(beds)} เตียง`}
        sub={
          occupancy === null ? (
            <span className="text-muted">–</span>
          ) : (
            <span className={`tabular-nums ${occupancy >= OCCUPANCY_WARN ? "font-medium text-warning" : "text-muted"}`}>ครองเตียง {pctText(occupancy)}</span>
          )
        }
      />
      {home.length > 0 && (
        <Kpi
          label={home.map((w) => w.name).join(", ")}
          icon={House}
          tone="ipd"
          value={formatCount(home.reduce((s, w) => s + w.admitted, 0))}
          unit="คน"
          sub={<span className="text-muted">ไม่นับในอัตราครองเตียง</span>}
        />
      )}
    </dl>
  );
}

/* ---------- ผู้ป่วยในขณะนี้ตาม ward: donut + ตาราง (ตารางเป็นทั้ง legend และข้อมูลสำหรับ screen reader) ---------- */

// shortcut: ward ที่ 8 ขึ้นไปใช้สีกลาง --chart-other ร่วมกัน ถ้า ward เปิดใช้เกิน 7 ให้รวมเป็น "อื่นๆ" ใน donut
const wardColor = (i: number) => (i < 7 ? `--chart-${i + 1}` : "--chart-other");

function Census({ data }: { data: HomeOverviewResponse }) {
  const { wards, occupied } = census(data);
  const segments = useMemo<DonutSegment[]>(
    () => wards.map((w, i) => ({ label: w.name, value: w.admitted, color: wardColor(i), valueText: `${formatCount(w.admitted)} คน · ${share(w.admitted, occupied)}` })),
    [wards, occupied],
  );
  return (
    <Card id="home-census" title="ผู้ป่วยในตามหอผู้ป่วย" sub="ขณะนี้ · หน่วย: คน">
      <DonutChart
        segments={segments}
        ariaLabel="ผู้ป่วยในขณะนี้ตามหอผู้ป่วย"
        center={
          <>
            <span className="block text-kpi font-semibold tabular-nums">{formatCount(occupied)}</span>
            <span className="block text-sm text-muted">คนนอนอยู่</span>
          </>
        }
      />
      <table className="mt-4 w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">ผู้ป่วยในขณะนี้ จำนวนเตียง และอัตราครองเตียงตามหอผู้ป่วย</caption>
        <thead className="text-xs text-muted">
          <tr>
            <th scope="col" className="pb-1.5 text-left font-medium">หอผู้ป่วย</th>
            <th scope="col" className="pb-1.5 pl-3 text-right font-medium whitespace-nowrap">คน</th>
            <th scope="col" className="pb-1.5 pl-3 text-right font-medium whitespace-nowrap">เตียง</th>
            <th scope="col" className="pb-1.5 pl-3 text-right font-medium whitespace-nowrap">ครองเตียง</th>
          </tr>
        </thead>
        <tbody>
          {wards.map((w, i) => {
            const pct = w.beds > 0 ? (w.admitted / w.beds) * 100 : null;
            return (
              <tr key={w.code} className="border-t border-line">
                <th scope="row" className="w-full max-w-0 py-1.5 text-left font-normal">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: `var(${wardColor(i)})` }} />
                    <span className="truncate" title={w.name}>
                      {w.name}
                    </span>
                  </span>
                </th>
                <td className={`py-1.5 pl-3 text-right ${w.admitted ? "font-medium" : "text-muted"}`}>{formatCount(w.admitted)}</td>
                <td className="py-1.5 pl-3 text-right text-muted">{formatCount(w.beds)}</td>
                <td className={`py-1.5 pl-3 text-right ${pct !== null && pct >= OCCUPANCY_WARN ? "font-medium text-warning" : "text-muted"}`}>
                  {pct === null ? "–" : pctText(pct)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/* ---------- visit รายวัน / ช่วงเวลา ---------- */

// แท่งรวม = visit ทั้งหมดของวัน: ล่าง = visit แรกของแต่ละคน (= จำนวนคน) บน = visit ที่เกินมาของคนเดิมในวันเดียวกัน
const DAILY_SERIES: StackedBarSeries[] = [
  { key: "patients", label: "ผู้ป่วย (คน)", color: "var(--chart-1)" },
  { key: "repeat", label: "visit ซ้ำในวันเดียวกัน", short: "visit ซ้ำ", color: "var(--chart-2)" },
];

function DailyTrend({ data, className }: { data: HomeOverviewResponse; className?: string }) {
  const { categories, values } = useMemo(() => {
    const multiYear = data.start.slice(0, 4) !== data.end.slice(0, 4);
    return {
      categories: data.daily.map<StackedBarCategory>((d) => ({ key: d.date, label: dayLabel(d.date, multiYear), title: formatThaiDate(d.date) })),
      values: data.daily.map((d) => [d.patients, Math.max(0, d.visits - d.patients)]),
    };
  }, [data]);
  return (
    <Card
      id="home-trend"
      title="visit รายวัน"
      sub={`${rangeText(data.start, data.end)} · หน่วย: visit`}
      aside={
        <>
          รวม <Num>{formatCount(data.kpi.visits.cur)}</Num> visit
        </>
      }
      className={className}
    >
      <StackedBarChart
        label={`visit รายวัน ${rangeText(data.start, data.end)}`}
        categoryHeader="วันที่"
        categories={categories}
        series={DAILY_SERIES}
        values={values}
        format={formatCount}
        integer
        height={380}
      />
    </Card>
  );
}

const HOURS: StackedBarCategory[] = Array.from({ length: 24 }, (_, h) => ({
  key: String(h),
  label: String(h),
  title: `${pad2(h)}:00–${pad2(h)}:59 น.`,
}));
const HOUR_SERIES = [{ key: "visits", label: "visit", color: "var(--accent)" }];

function Hourly({ data, className, tall }: { data: HomeOverviewResponse; className?: string; tall?: boolean }) {
  const values = useMemo(() => data.hourly.map((v) => [v]), [data.hourly]);
  const peak = data.hourly.indexOf(Math.max(...data.hourly));
  return (
    <Card
      id="home-hourly"
      title="ช่วงเวลาที่มารับบริการ"
      sub={`${rangeText(data.start, data.end)} · หน่วย: visit`}
      aside={
        <>
          สูงสุด <Num>{pad2(peak)}:00 น.</Num> · {formatCount(data.hourly[peak])} visit
        </>
      }
      className={className}
    >
      <StackedBarChart
        label={`visit ตามชั่วโมง ${rangeText(data.start, data.end)}`}
        categoryHeader="ช่วงเวลา"
        categories={HOURS}
        series={HOUR_SERIES}
        values={values}
        format={formatCount}
        integer
        height={tall ? 380 : 240}
      />
    </Card>
  );
}

/* ---------- แผนก / กองทุน ---------- */

const listHref = (path: string, data: HomeOverviewResponse, extra: Record<string, string>) =>
  `${path}?${new URLSearchParams({ ...extra, start: data.start, end: data.end })}`;

function useRankedSelect() {
  const router = useRouter();
  return useCallback((it: RankedItem) => it.href && router.push(it.href), [router]);
}

function CountTable({ caption, header, rows, total, other }: { caption: string; header: string; rows: CountRow[]; total: number; other?: { label: string; visits: number } }) {
  return (
    <DataTableToggle caption={caption}>
      <thead>
        <tr>
          <th scope="col" className="text-left">{header}</th>
          <th scope="col" className="text-right">visit</th>
          <th scope="col" className="text-right">สัดส่วน</th>
          <th scope="col" className="text-right">ผู้ป่วย (คน)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.code}>
            <th scope="row">{r.name}</th>
            <td>{formatCount(r.visits)}</td>
            <td>{share(r.visits, total)}</td>
            <td>{formatCount(r.patients)}</td>
          </tr>
        ))}
        {other && (
          <tr>
            <th scope="row">{other.label}</th>
            <td>{formatCount(other.visits)}</td>
            <td>{share(other.visits, total)}</td>
            <td className="text-muted">–</td>
          </tr>
        )}
      </tbody>
    </DataTableToggle>
  );
}

function Departments({ data }: { data: HomeOverviewResponse }) {
  const onSelect = useRankedSelect();
  const total = data.kpi.visits.cur;
  const { items, other } = useMemo(() => {
    const o = data.otherDepartments;
    const other = o ? { label: `อื่นๆ (${formatCount(o.count)} แผนก)`, visits: o.visits } : undefined;
    const items: RankedItem[] = data.departments.map((d) => ({
      label: d.name,
      value: d.visits,
      valueText: `${formatCount(d.visits)} · ${share(d.visits, total)}`,
      tooltip: `${formatCount(d.visits)} visit · ${formatCount(d.patients)} คน`,
      href: listHref("/fund/opd-department", data, { dep: d.code }),
    }));
    // "อื่นๆ" มีแค่ visit (รวมจำนวนคนข้ามแผนกไม่ได้) และไม่มี link
    if (other) items.push({ label: other.label, value: other.visits, valueText: `${formatCount(other.visits)} · ${share(other.visits, total)}`, tooltip: `${formatCount(other.visits)} visit` });
    return { items, other };
  }, [data, total]);
  return (
    <Card
      id="home-departments"
      title="visit ตามแผนก"
      sub={`${rangeText(data.start, data.end)} · หน่วย: visit`}
      aside={
        <>
          <Num>{formatCount(data.departments.length + (data.otherDepartments?.count ?? 0))}</Num> แผนก
        </>
      }
    >
      <RankedBarChart items={items} ariaLabel="visit ตามแผนก" onSelect={onSelect} />
      <CountTable caption="visit และผู้ป่วยตามแผนก" header="แผนก" rows={data.departments} total={total} other={other} />
    </Card>
  );
}

function Funds({ data }: { data: HomeOverviewResponse }) {
  const onSelect = useRankedSelect();
  const total = data.kpi.visits.cur;
  const items = useMemo<RankedItem[]>(
    () =>
      data.funds.map((f) => ({
        label: f.name,
        value: f.visits,
        valueText: `${formatCount(f.visits)} · ${share(f.visits, total)}`,
        tooltip: `${formatCount(f.visits)} visit · ${formatCount(f.patients)} คน`,
        href: listHref("/fund/opd-fund", data, { fund: f.code }),
      })),
    [data, total],
  );
  return (
    <Card
      id="home-funds"
      title="visit ตามกองทุน"
      sub={`${rangeText(data.start, data.end)} · หน่วย: visit`}
      aside={
        <>
          <Num>{formatCount(data.funds.length)}</Num> กองทุน
        </>
      }
    >
      <RankedBarChart items={items} ariaLabel="visit ตามกองทุน" onSelect={onSelect} />
      <CountTable caption="visit และผู้ป่วยตามกองทุน" header="กองทุน" rows={data.funds} total={total} />
    </Card>
  );
}

/* ---------- พีระมิดเพศ-อายุ: ตาราง HTML ที่มีแท่ง จึงอ่านด้วย screen reader ได้โดยไม่ต้องมีตารางแยก ---------- */

function Pyramid({ data, className }: { data: HomeOverviewResponse; className?: string }) {
  const { male, female, unknownSex } = data.pyramid;
  const max = Math.max(1, ...male, ...female);
  const sum = [...male, ...female].reduce((s, n) => s + n, unknownSex);
  // ตัวเลขติดปลายแท่ง: แท่งกว้างได้เต็มช่องลบที่ของตัวเลข (3rem)
  const bar = (n: number, side: "l" | "r") => (
    <span className={`flex items-center gap-1.5 ${side === "l" ? "flex-row-reverse" : ""}`}>
      <span
        aria-hidden="true"
        className={`h-3 shrink-0 bg-accent ${side === "l" ? "rounded-l" : "rounded-r"}`}
        style={{ width: `calc((100% - 3rem) * ${n / max})` }}
      />
      <span>{formatCount(n)}</span>
    </span>
  );
  // ไล่จากอายุมากลงล่างเป็นอายุน้อย ตามรูปพีระมิดประชากร
  const rows = AGE_GROUPS.map((label, i) => ({ label, m: male[i], f: female[i] })).reverse();
  return (
    <Card
      id="home-pyramid"
      title="ผู้รับบริการตามเพศและอายุ"
      sub={`${rangeText(data.start, data.end)} · หน่วย: คน`}
      aside={
        <>
          รวม <Num>{formatCount(sum)}</Num> คน
        </>
      }
      className={className}
    >
      <table className="mx-auto w-full max-w-2xl border-collapse text-sm tabular-nums">
        <caption className="sr-only">ผู้รับบริการ (คน) ตามเพศและกลุ่มอายุ</caption>
        <thead className="text-muted">
          <tr>
            <th scope="col" className="w-1/2 pb-2 pr-2 text-right font-medium">ชาย</th>
            <th scope="col" className="px-2 pb-2 text-center font-medium whitespace-nowrap">อายุ (ปี)</th>
            <th scope="col" className="w-1/2 pb-2 pl-2 text-left font-medium">หญิง</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-0.5 pr-2">{bar(r.m, "l")}</td>
              <th scope="row" className="px-2 py-0.5 text-center font-normal whitespace-nowrap text-muted">
                {r.label}
              </th>
              <td className="py-0.5 pl-2">{bar(r.f, "r")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unknownSex > 0 && <p className="mt-2 text-xs text-muted">ไม่ระบุเพศ {formatCount(unknownSex)} คน</p>}
    </Card>
  );
}

/* ---------- page body ---------- */

export function HomeDashboardSkeleton() {
  const block = "animate-pulse rounded-2xl bg-surface motion-reduce:animate-none";
  return (
    <div aria-busy="true" aria-label="กำลังโหลด" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${block} h-32`} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`${block} h-96 lg:col-span-2`} />
        <div className={`${block} h-96`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${block} h-96`} />
        <div className={`${block} h-96`} />
      </div>
    </div>
  );
}

export function HomeDashboard() {
  const { start, end } = useDateRange();
  const { data, error, loading, retry } = useOverview(start, end);

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
  if (!data) return <HomeDashboardSkeleton />;

  const empty = data.kpi.visits.cur === 0;
  // ช่วงวันเดียว แท่งรายวันมีแท่งเดียว ไม่บอกอะไร จึงซ่อน และให้กราฟรายชั่วโมงขึ้นมาเป็นกราฟหลักแทน
  const singleDay = data.daily.length === 1;
  // ระหว่างโหลดช่วงใหม่ คงผลเดิมไว้แบบจางลง ไม่กระพริบเป็น skeleton
  return (
    <div aria-busy={loading} className={`flex flex-col gap-4 transition-opacity duration-200 ${loading ? "opacity-60" : ""}`}>
      <KpiRow data={data} />
      <div className="grid gap-4 lg:grid-cols-3">
        {empty ? (
          <Notice className="lg:col-span-2" icon={<CalendarX aria-hidden className="size-5" />} title="ไม่มีผู้ป่วยนอกในช่วงนี้" detail={rangeText(data.start, data.end)} />
        ) : singleDay ? (
          <Hourly data={data} className="lg:col-span-2" tall />
        ) : (
          <DailyTrend data={data} className="lg:col-span-2" />
        )}
        <Census data={data} />
      </div>
      {!empty && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Departments data={data} />
            <Funds data={data} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {!singleDay && <Hourly data={data} className="lg:col-span-2" />}
            <Pyramid data={data} className={singleDay ? "lg:col-span-3" : ""} />
          </div>
        </>
      )}
    </div>
  );
}
