"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, FileX, HandCoins, Hourglass, Percent, TriangleAlert, Wallet } from "lucide-react";
import { DataTableToggle, DonutChart, RankedBarChart, type DonutSegment, type RankedItem } from "@/components/charts/charts";
import { StackedBarChart, type StackedBarCategory, type StackedBarSeries } from "@/components/stacked-bar-chart/stacked-bar-chart";
import { formatBaht, formatCompactBaht, formatCount } from "@/lib/number-format";
import { THAI_MONTHS_SHORT, formatThaiDate } from "@/lib/thai-date";
import { DEBTOR_STATUSES, STATUS_LABEL, type DebtorStatus, type DebtorType } from "@/app/api/fund/uc-debtor/debtor";
import type { Amount, Totals, UcDashboard as Data } from "@/app/api/fund/uc-dashboard/dashboard";
import { btn, focusRing, useJson, useUrlParams } from "../_components/ui";

export const TITLE = "ภาพรวมลูกหนี้ UC";

/** การ์ดลอยบนพื้น bg-background (แบบเดียวกับหน้าแรก) */
const card = "rounded-2xl bg-surface shadow-sm ring-1 ring-line/60";
const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium ${focusRing}`;

// สีสถานะผูกกับสถานะทุกกราฟในหน้า ตรวจด้วย dataviz validator ทั้งสองธีมแล้ว (ทุกคู่ผ่าน CVD และ normal-vision)
const STATUS_COLOR: Record<DebtorStatus, string> = { paid: "--chart-3", error: "--chart-2", none: "--chart-7" };
const TYPES = [
  { value: "opd", label: "OPD", name: "ผู้ป่วยนอก" },
  { value: "ipd", label: "IPD", name: "ผู้ป่วยใน" },
] as const satisfies readonly { value: DebtorType; label: string; name: string }[];

const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const pctText = (n: number) => `${n.toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`;
const full = (n: number) => `${formatBaht(n)} บาท`;
const merge = (a: Amount, b: Amount): Amount => ({ count: a.count + b.count, debtor: a.debtor + b.debtor, comp: a.comp + b.comp });
const both = (d: Data, k: keyof Totals) => merge(d.totals.opd[k], d.totals.ipd[k]);
const lastDay = (ym: string) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);
const thaiTime = (iso: string) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** link ไปรายการลูกหนี้ของเดือนนั้น (/fund/uc-debtor รับช่วงได้ไม่เกิน 31 วัน) end ไม่เกินวันสุดท้ายของข้อมูล */
function debtorHref(d: Data, type: DebtorType, ym: string, status: DebtorStatus) {
  const start = `${ym}-01`;
  if (start > d.end) return undefined;
  const end = lastDay(ym) < d.end ? lastDay(ym) : d.end;
  return `/fund/uc-debtor?${new URLSearchParams({ type, start, end, status })}`;
}

/** "216.26 ล้านบาท" -> ["216.26", "ล้านบาท"] ให้ตัวเลขเป็น text-kpi หน่วยเล็ก */
function splitBaht(n: number) {
  const s = formatCompactBaht(n);
  const i = s.lastIndexOf(" ");
  return [s.slice(0, i), s.slice(i + 1)];
}

function Baht({ value }: { value: number }) {
  const [num, unit] = splitBaht(value);
  return (
    <>
      <span className="text-kpi font-semibold tracking-tight">{num}</span>
      <span className="text-sm text-muted">{unit}</span>
    </>
  );
}

const Dot = ({ status }: { status: DebtorStatus }) => (
  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: `var(${STATUS_COLOR[status]})` }} />
);

/* ---------- layout ---------- */

function Card({ id, title, sub, aside, className = "", children }: { id: string; title: string; sub?: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`${card} min-w-0 p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={id} className="text-title">
            {title}
          </h2>
          {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
        </div>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl bg-surface-sunken px-4 py-10 text-center text-sm">
      <span className="text-muted">{icon}</span>
      <p className="mt-2 font-medium">{title}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ---------- KPI ---------- */

const CHIP = {
  accent: "bg-accent-soft text-accent-text",
  paid: "bg-[color-mix(in_oklab,var(--chart-3)_16%,var(--surface))] text-(--chart-3)",
  error: "bg-[color-mix(in_oklab,var(--chart-2)_16%,var(--surface))] text-(--chart-2)",
  none: "bg-[color-mix(in_oklab,var(--chart-7)_16%,var(--surface))] text-(--chart-7)",
};

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

function Kpi({ label, icon: Icon, tone, title, value, sub, split, className = "" }: { label: string; icon: Icon; tone: keyof typeof CHIP; title?: string; value: ReactNode; sub: ReactNode; split: [string, string]; className?: string }) {
  return (
    <div className={`${card} relative flex min-w-0 flex-col p-4 ${className}`}>
      <span aria-hidden="true" className={`absolute top-4 right-4 grid size-9 place-items-center rounded-lg ${CHIP[tone]}`}>
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <dt className="min-h-9 pr-11 text-sm text-muted">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5 tabular-nums" title={title}>
        {value}
      </dd>
      <dd className="mt-0.5 text-sm text-muted tabular-nums">{sub}</dd>
      <dd className="mt-auto pt-3">
        <span className="grid grid-cols-[auto_1fr] gap-x-2 border-t border-line pt-2 text-xs tabular-nums">
          {TYPES.map((t, i) => (
            <span key={t.value} className="contents">
              <span className="text-muted">{t.label}</span>
              <span className="text-right">{split[i]}</span>
            </span>
          ))}
        </span>
      </dd>
    </div>
  );
}

function KpiRow({ data: d }: { data: Data }) {
  const total = both(d, "total");
  const withRep = merge(both(d, "paid"), both(d, "error"));
  const error = both(d, "error");
  const none = both(d, "none");
  const per = (f: (t: Totals) => string): [string, string] => [f(d.totals.opd), f(d.totals.ipd)];
  const rate = (t: Totals) => pctText(pctOf(t.total.comp, t.total.debtor));
  const money = (n: number) => <Baht value={n} />;
  return (
    <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      <Kpi
        label="ลูกหนี้ UC รวม"
        // ต่ำกว่า xl การ์ดแรกกว้างสองช่อง แถวที่เหลือจึงเต็มพอดี (2+2+1 / 3+2) ไม่มีการ์ดค้างแถวเดียว
        className="col-span-2 xl:col-span-1"
        icon={Wallet}
        tone="accent"
        title={full(total.debtor)}
        value={money(total.debtor)}
        sub={`${formatCount(total.count)} ราย`}
        split={per((t) => formatCompactBaht(t.total.debtor))}
      />
      <Kpi
        label="ชดเชยตาม REP"
        icon={HandCoins}
        tone="paid"
        title={full(total.comp)}
        value={money(total.comp)}
        sub={`มี REP ${formatCount(withRep.count)} ราย`}
        split={per((t) => formatCompactBaht(t.total.comp))}
      />
      <Kpi
        label="อัตราได้รับชดเชย"
        icon={Percent}
        tone="paid"
        title={`ชดเชย ${full(total.comp)} จากลูกหนี้ ${full(total.debtor)}`}
        value={
          <>
            <span className="text-kpi font-semibold tracking-tight">{pctText(pctOf(total.comp, total.debtor))}</span>
            <span className="text-sm text-muted">ของลูกหนี้</span>
          </>
        }
        sub={`ได้รับชดเชย ${formatCount(both(d, "paid").count)} ราย`}
        split={per(rate)}
      />
      <Kpi
        label="ติด error"
        icon={TriangleAlert}
        tone="error"
        title={full(error.debtor)}
        value={money(error.debtor)}
        sub={`${formatCount(error.count)} ราย`}
        split={per((t) => formatCompactBaht(t.error.debtor))}
      />
      <Kpi
        label="ยังไม่มี REP"
        icon={Hourglass}
        tone="none"
        title={full(none.debtor)}
        value={money(none.debtor)}
        sub={`${formatCount(none.count)} ราย`}
        split={per((t) => formatCompactBaht(t.none.debtor))}
      />
    </dl>
  );
}

/* ---------- รายเดือนตามสถานะ ---------- */

// StackedBarChart จัด tick แกน y เองไม่ได้ จึงส่งค่าเป็นล้านบาท (tick = ล้านบาท) แล้วคูณกลับตอนแสดงใน tooltip/ตาราง
// shortcut: ถ้า StackedBarChart มี prop tickFormat ให้ส่งค่าบาทตรงๆ แล้วใช้ formatMillions แทน
const SERIES: StackedBarSeries[] = DEBTOR_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], short: `${STATUS_LABEL[s]} (บาท)`, color: `var(${STATUS_COLOR[s]})` }));
const fromMillions = (n: number) => formatBaht(n * 1e6);

function TypeToggle({ value, onChange }: { value: DebtorType; onChange: (t: DebtorType) => void }) {
  return (
    <div role="radiogroup" aria-label="ประเภทผู้ป่วย" className="flex h-9 items-center gap-0.5 rounded-md border border-line bg-surface px-0.5 text-sm">
      {TYPES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={value === t.value}
          onClick={() => onChange(t.value)}
          className={`h-8 rounded-md px-3 ${focusRing} ${value === t.value ? "bg-accent-soft font-medium text-accent-text" : "text-muted hover:bg-hover hover:text-foreground"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Monthly({ data: d, className }: { data: Data; className?: string }) {
  const [type, setType] = useState<DebtorType>("opd");
  const { categories, values } = useMemo(
    () => ({
      categories: d.months.map<StackedBarCategory>((m) => {
        const short = THAI_MONTHS_SHORT[+m.month.slice(5, 7) - 1];
        return { key: m.month, label: short, title: `${short} ${+m.month.slice(0, 4) + 543}` };
      }),
      values: d.months.map((m) => DEBTOR_STATUSES.map((s) => m[type][s].debtor / 1e6)),
    }),
    [d, type],
  );
  const hrefFor = useCallback((c: number, s: number) => debtorHref(d, type, d.months[c].month, DEBTOR_STATUSES[s]), [d, type]);
  const name = TYPES.find((t) => t.value === type)!.name;
  return (
    <Card
      id="uc-monthly"
      title="ลูกหนี้รายเดือนตามสถานะ REP"
      sub={`ปีงบ ${d.fy} · ${name} · แกน: ล้านบาท`}
      aside={<TypeToggle value={type} onChange={setType} />}
      className={className}
    >
      <StackedBarChart
        label={`ลูกหนี้${name}รายเดือนตามสถานะ REP ปีงบ ${d.fy} (บาท)`}
        categoryHeader="เดือน"
        categories={categories}
        series={SERIES}
        values={values}
        format={fromMillions}
        hrefFor={hrefFor}
        height={300}
      />
    </Card>
  );
}

/* ---------- สัดส่วนตามสถานะ ---------- */

function StatusShare({ data: d }: { data: Data }) {
  const total = both(d, "total");
  const rows = DEBTOR_STATUSES.map((s) => ({ s, a: both(d, s) }));
  const segments = useMemo<DonutSegment[]>(
    () => rows.map(({ s, a }) => ({ label: STATUS_LABEL[s], value: a.debtor, color: STATUS_COLOR[s], valueText: `${full(a.debtor)} · ${pctText(pctOf(a.debtor, total.debtor))}` })),
    // rows มาจาก d
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d],
  );
  return (
    <Card id="uc-share" title="สัดส่วนลูกหนี้ตามสถานะ" sub={`ปีงบ ${d.fy} · OPD + IPD`}>
      <DonutChart
        segments={segments}
        ariaLabel="สัดส่วนยอดลูกหนี้ตามสถานะ REP"
        center={
          <>
            <span className="block text-kpi font-semibold tabular-nums" title={full(total.debtor)}>
              {splitBaht(total.debtor)[0]}
            </span>
            <span className="block text-sm text-muted">{splitBaht(total.debtor)[1]} ลูกหนี้รวม</span>
          </>
        }
      />
      <table className="mt-5 w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">ลูกหนี้ตามสถานะ REP: จำนวนราย ยอดลูกหนี้ และสัดส่วน</caption>
        <thead className="text-xs text-muted">
          <tr>
            <th scope="col" className="pb-1.5 text-left font-medium">สถานะ</th>
            <th scope="col" className="hidden pb-1.5 pl-3 text-right font-medium sm:table-cell">ราย</th>
            <th scope="col" className="pb-1.5 pl-3 text-right font-medium whitespace-nowrap">ลูกหนี้ (บาท)</th>
            <th scope="col" className="pb-1.5 pl-3 text-right font-medium">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, a }) => (
            <tr key={s} className="border-t border-line">
              <th scope="row" className="py-1.5 text-left font-normal whitespace-nowrap">
                <span className="flex items-center gap-2">
                  <Dot status={s} />
                  {STATUS_LABEL[s]}
                </span>
              </th>
              <td className="hidden py-1.5 pl-3 text-right text-muted sm:table-cell">{formatCount(a.count)}</td>
              <td className="py-1.5 pl-3 text-right font-medium">{formatBaht(a.debtor)}</td>
              <td className="py-1.5 pl-3 text-right text-muted">{pctText(pctOf(a.debtor, total.debtor))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line font-semibold">
            <th scope="row" className="py-1.5 text-left">รวม</th>
            <td className="hidden py-1.5 pl-3 text-right sm:table-cell">{formatCount(total.count)}</td>
            <td className="py-1.5 pl-3 text-right">{formatBaht(total.debtor)}</td>
            <td className="py-1.5 pl-3 text-right">100%</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

/* ---------- OPD เทียบ IPD ---------- */

function Compare({ data: d }: { data: Data }) {
  return (
    <Card id="uc-compare" title="OPD เทียบ IPD" sub={`ปีงบ ${d.fy} · สัดส่วนตามยอดลูกหนี้`}>
      <div className="flex flex-col gap-6">
        {TYPES.map((t) => {
          const x = d.totals[t.value];
          return (
            <div key={t.value}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className="font-semibold">
                  {t.name} <span className="font-normal text-muted">({t.label})</span>
                </h3>
                <span className="text-sm text-muted tabular-nums">{formatCount(x.total.count)} ราย</span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-3 tabular-nums">
                {[
                  { k: "ลูกหนี้", v: formatCompactBaht(x.total.debtor), t: full(x.total.debtor) },
                  { k: "ชดเชย", v: formatCompactBaht(x.total.comp), t: full(x.total.comp) },
                  { k: "ได้รับชดเชย", v: pctText(pctOf(x.total.comp, x.total.debtor)), t: "ของยอดลูกหนี้" },
                ].map((m) => (
                  <div key={m.k} className="min-w-0">
                    <dt className="text-xs text-muted">{m.k}</dt>
                    <dd className="mt-0.5 font-semibold whitespace-nowrap" title={m.t}>
                      {m.v}
                    </dd>
                  </div>
                ))}
              </dl>
              {/* แท่ง 100% ตามยอดลูกหนี้ ค่าเดียวกันอยู่ในข้อความใต้แท่ง จึงซ่อนจาก screen reader */}
              <div aria-hidden="true" className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full bg-surface-sunken">
                {DEBTOR_STATUSES.map((s) =>
                  x[s].debtor > 0 ? (
                    <span key={s} title={`${STATUS_LABEL[s]} ${full(x[s].debtor)}`} style={{ flexGrow: x[s].debtor, background: `var(${STATUS_COLOR[s]})` }} />
                  ) : null,
                )}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                {DEBTOR_STATUSES.map((s) => (
                  <li key={s} className="flex items-center gap-1.5">
                    <Dot status={s} />
                    <span className="text-muted">{STATUS_LABEL[s]}</span>
                    <span className="font-medium" title={full(x[s].debtor)}>
                      {pctText(pctOf(x[s].debtor, x.total.debtor))}
                    </span>
                    <span className="text-muted">· {formatCount(x[s].count)} ราย</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------- อายุลูกหนี้ที่ยังไม่มี REP ---------- */

const AGING_LABEL = { "0-30": "0–30 วัน", "31-60": "31–60 วัน", "61-90": "61–90 วัน", "90+": "เกิน 90 วัน" } as const;
// OPD/IPD ในแท่งเดียวกันเป็นสถานะ "ยังไม่มี REP" ทั้งคู่ จึงใช้สีเดียวกันต่างน้ำหนัก
const AGING_TONE = { opd: `var(${STATUS_COLOR.none})`, ipd: `color-mix(in oklab, var(${STATUS_COLOR.none}) 45%, var(--surface))` };

function Aging({ data: d }: { data: Data }) {
  const max = Math.max(1, ...d.aging.map((a) => a.opd.debtor + a.ipd.debtor));
  const none = both(d, "none");
  return (
    <Card id="uc-aging" title="ยังไม่มี REP ตามระยะเวลาค้าง" sub={`นับถึง ${formatThaiDate(d.today)} · จากวันรับบริการหรือวันจำหน่าย`}>
      <ul aria-hidden="true" className="flex gap-4 text-xs">
        {TYPES.map((t) => (
          <li key={t.value} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: AGING_TONE[t.value] }} />
            {t.label}
          </li>
        ))}
      </ul>
      <table className="mt-3 w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">ลูกหนี้ที่ยังไม่มี REP ตามระยะเวลาค้าง แยก OPD และ IPD</caption>
        <thead className="text-xs text-muted">
          <tr>
            <th scope="col" className="pb-1.5 text-left font-medium whitespace-nowrap">ระยะเวลา</th>
            <th scope="col" className="hidden w-full pb-1.5 sm:table-cell">
              <span className="sr-only">สัดส่วน</span>
            </th>
            <th scope="col" className="pb-1.5 pl-3 text-right font-medium whitespace-nowrap">OPD (ราย)</th>
            <th scope="col" className="pb-1.5 pl-3 text-right font-medium whitespace-nowrap">IPD (ราย)</th>
            <th scope="col" className="pb-1.5 pl-3 text-right font-medium whitespace-nowrap">ลูกหนี้ (บาท)</th>
          </tr>
        </thead>
        <tbody>
          {d.aging.map((a) => {
            const sum = a.opd.debtor + a.ipd.debtor;
            return (
              <tr key={a.bucket} className="border-t border-line">
                <th scope="row" className="py-2 pr-3 text-left font-normal whitespace-nowrap">{AGING_LABEL[a.bucket]}</th>
                <td aria-hidden="true" className="hidden py-2 sm:table-cell">
                  <div className="flex h-2.5 gap-0.5" style={{ width: `${(sum / max) * 100}%` }}>
                    {TYPES.map((t) =>
                      a[t.value].debtor > 0 ? (
                        <span key={t.value} className="first:rounded-l-sm last:rounded-r-sm" title={`${t.label} ${full(a[t.value].debtor)}`} style={{ flexGrow: a[t.value].debtor, background: AGING_TONE[t.value] }} />
                      ) : null,
                    )}
                  </div>
                </td>
                <td className={`py-2 pl-3 text-right ${a.opd.count ? "" : "text-muted"}`}>{formatCount(a.opd.count)}</td>
                <td className={`py-2 pl-3 text-right ${a.ipd.count ? "" : "text-muted"}`}>{formatCount(a.ipd.count)}</td>
                <td className={`py-2 pl-3 text-right ${sum ? "font-medium" : "text-muted"}`}>{formatBaht(sum)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-line font-semibold">
            <th scope="row" className="py-2 text-left">รวม</th>
            <td className="hidden sm:table-cell" />
            <td className="py-2 pl-3 text-right">{formatCount(d.totals.opd.none.count)}</td>
            <td className="py-2 pl-3 text-right">{formatCount(d.totals.ipd.none.count)}</td>
            <td className="py-2 pl-3 text-right">{formatBaht(none.debtor)}</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

/* ---------- ชดเชยตามกองทุน / รหัส error ---------- */

const FUND_LIMIT = 12; // เกินนี้รวมเป็น "อื่นๆ"
const noop = () => {};
/** "ผู้ป่วยใน (IP) / IPINRGR" -> "IPINRGR" (ชื่อเต็มอยู่ใน tooltip และตาราง) */
const fundLabel = (key: string) => (key.includes(" / ") ? key.slice(key.indexOf(" / ") + 3) : key);

function Funds({ data: d }: { data: Data }) {
  const rows = useMemo(() => {
    const all = [...(d.affiliation ? [{ key: "ต้นสังกัด", label: "ต้นสังกัด", amount: d.affiliation }] : []), ...d.funds.map((f) => ({ ...f, label: fundLabel(f.key) }))]
      .filter((f) => f.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    if (all.length <= FUND_LIMIT) return all;
    const rest = all.slice(FUND_LIMIT - 1);
    return [...all.slice(0, FUND_LIMIT - 1), { key: `อื่นๆ (${rest.length} รายการ)`, label: `อื่นๆ (${rest.length} รายการ)`, amount: rest.reduce((s, f) => s + f.amount, 0) }];
  }, [d]);
  const items = useMemo<RankedItem[]>(
    () => rows.map((f) => ({ label: f.label, value: f.amount, valueText: formatCompactBaht(f.amount), tooltip: `${f.key} · ${full(f.amount)}` })),
    [rows],
  );
  // ไม่แสดงยอดรวม: fund_amounts รวมกันไม่เท่าชดเชยสุทธิ (ต่างราว 0.2%) จะขัดกับ KPI "ชดเชยตาม REP"
  return (
    <Card id="uc-funds" title="ชดเชยตามกองทุน" sub={`ปีงบ ${d.fy} · ตาม REP ล่าสุด`}>
      {rows.length ? (
        <>
          <RankedBarChart items={items} ariaLabel="ชดเชยตามกองทุน" onSelect={noop} />
          <DataTableToggle caption="ชดเชยตามกองทุน (บาท)">
            <thead>
              <tr>
                <th scope="col" className="text-left">กองทุน</th>
                <th scope="col" className="text-right">ชดเชย (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.key}>
                  <th scope="row">{f.key}</th>
                  <td>{formatBaht(f.amount)}</td>
                </tr>
              ))}
            </tbody>
          </DataTableToggle>
        </>
      ) : (
        <Empty icon={<HandCoins aria-hidden className="size-5" />} title="ยังไม่มีชดเชยในปีงบนี้" />
      )}
    </Card>
  );
}

function Errors({ data: d }: { data: Data }) {
  const router = useRouter();
  const onSelect = useCallback((it: RankedItem) => it.href && router.push(it.href), [router]);
  const items = useMemo<RankedItem[]>(
    () =>
      d.errors.map((e) => {
        // link ไปเดือนล่าสุดที่พบรหัสนี้ ของประเภทที่ยอดมากกว่า (/fund/uc-debtor ดูได้ครั้งละไม่เกิน 31 วัน)
        const type: DebtorType = e.ipd.debtor > e.opd.debtor ? "ipd" : "opd";
        return {
          label: e.description ? `${e.code} ${e.description}` : e.code,
          value: e.debtor,
          // ป้ายปลายแท่งสั้น ให้ชื่อรหัสมีที่บนจอแคบ (จำนวนรายอยู่ใน tooltip และตาราง)
          valueText: formatCompactBaht(e.debtor),
          // หัว tooltip เป็น label เต็ม (รหัส + ความหมาย) แล้ว
          tooltip: `${full(e.debtor)} · ${formatCount(e.count)} ราย`,
          href: debtorHref(d, type, e[type].last.slice(0, 7), "error"),
        };
      }),
    [d],
  );
  return (
    <Card id="uc-errors" title="รหัส error ตามยอดลูกหนี้" sub={`ปีงบ ${d.fy} · 10 อันดับ · visit ที่มีหลายรหัสนับทุกรหัส`}>
      {items.length ? (
        <>
          <RankedBarChart items={items} ariaLabel="รหัส error ตามยอดลูกหนี้" onSelect={onSelect} />
          <DataTableToggle caption="รหัส error ตามยอดลูกหนี้ ความหมาย จำนวนราย และยอดลูกหนี้ (บาท)">
            <thead>
              <tr>
                <th scope="col" className="text-left">รหัส</th>
                <th scope="col" className="text-left">ความหมาย</th>
                <th scope="col" className="text-right">ราย</th>
                <th scope="col" className="text-right">ลูกหนี้ (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {d.errors.map((e, i) => (
                <tr key={e.code}>
                  <th scope="row">
                    {items[i].href ? (
                      <Link href={items[i].href} className={`underline-offset-2 hover:underline ${focusRing}`}>
                        {e.code}
                      </Link>
                    ) : (
                      e.code
                    )}
                  </th>
                  <td className="min-w-64 !text-left !whitespace-normal">{e.description ?? <span className="text-muted">–</span>}</td>
                  <td>{formatCount(e.count)}</td>
                  <td>{formatBaht(e.debtor)}</td>
                </tr>
              ))}
            </tbody>
          </DataTableToggle>
        </>
      ) : (
        <Empty icon={<TriangleAlert aria-hidden className="size-5" />} title="ไม่มีรายการติด error ในปีงบนี้" />
      )}
    </Card>
  );
}

/* ---------- page body ---------- */

const Title = () => <h1 className="text-title text-balance">{TITLE}</h1>;

function Header({ data, loading, setFy }: { data?: Data; loading?: boolean; setFy: (fy: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Title />
      {data && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted tabular-nums">{loading ? "กำลังคำนวณ…" : `คำนวณเมื่อ ${thaiTime(data.generatedAt)} น.`}</span>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">ปีงบประมาณ</span>
            <select value={data.fy} onChange={(e) => setFy(e.target.value)} className={SELECT_CLASS}>
              {data.fyOptions.map((fy) => (
                <option key={fy} value={fy}>
                  ปีงบ {fy}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

export function UcDashboardSkeleton() {
  const block = "animate-pulse rounded-2xl bg-surface motion-reduce:animate-none";
  return (
    <div className="flex flex-col gap-5">
      <Title />
      <div aria-busy="true" aria-label="กำลังโหลด" className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={`${block} h-40`} />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className={`${block} h-96 lg:col-span-2`} />
          <div className={`${block} h-96`} />
        </div>
      </div>
    </div>
  );
}

export function UcDashboard() {
  const { fy, set } = useUrlParams(["fy"]);
  const setFy = (v: string) => set({ fy: v });
  const { data, error, loading, retry } = useJson<Data>(`/api/fund/uc-dashboard${fy ? `?${new URLSearchParams({ fy })}` : ""}`);
  // ระหว่างโหลดปีงบใหม่ คงผลเดิมไว้แบบจาง ไม่กระพริบเป็น skeleton
  const [shown, setShown] = useState<Data>();
  if (data && data !== shown) setShown(data);

  if (error) {
    return (
      <div className="flex flex-col gap-5">
        <Header data={shown} setFy={setFy} />
        <div role="alert" className={`${card} p-5`}>
          <Empty
            icon={<CircleAlert aria-hidden className="size-5" />}
            title={`โหลดข้อมูลไม่สำเร็จ: ${error}`}
            action={
              <button type="button" className={btn} onClick={retry}>
                ลองอีกครั้ง
              </button>
            }
          />
        </div>
      </div>
    );
  }
  if (!shown) return <UcDashboardSkeleton />;
  const d = shown;
  const empty = d.totals.opd.total.count + d.totals.ipd.total.count === 0;

  return (
    <div className="flex flex-col gap-5">
      <Header data={d} loading={loading} setFy={setFy} />
      <div aria-busy={loading} className={`flex flex-col gap-4 transition-opacity duration-200 ${loading ? "opacity-60" : ""}`}>
        {!d.hasRep && (
          <p role="status" className="inline-flex w-fit flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-warning-line bg-warning-soft py-1.5 pr-1.5 pl-3 text-sm text-warning">
            <FileX aria-hidden className="size-4" />
            <span className="font-medium">ยังไม่ได้นำเข้า REP ของปีงบนี้</span>
            <Link href="/fund/rep-import" className={`rounded-full bg-surface px-2.5 py-0.5 font-medium text-foreground hover:bg-hover ${focusRing}`}>
              นำเข้า REP
            </Link>
          </p>
        )}
        {empty ? (
          <div className={`${card} p-5`}>
            <Empty icon={<Wallet aria-hidden className="size-5" />} title={`ไม่มีลูกหนี้ UC ในปีงบ ${d.fy}`} />
          </div>
        ) : (
          <>
            <KpiRow data={d} />
            <div className="grid gap-4 lg:grid-cols-3">
              <Monthly data={d} className="lg:col-span-2" />
              <StatusShare data={d} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Compare data={d} />
              <Aging data={d} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Funds data={d} />
              <Errors data={d} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
