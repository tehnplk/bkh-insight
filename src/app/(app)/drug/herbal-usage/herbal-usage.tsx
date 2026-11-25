"use client";

import { useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { DataTableToggle, MultiTrendChart } from "@/components/charts/charts";
import { StackedBarChart } from "@/components/stacked-bar-chart/stacked-bar-chart";
import { formatBaht, formatCompactBaht, formatCount } from "@/lib/number-format";
import { usePersistedFilter } from "@/lib/persisted-filter";
import { THAI_MONTHS, THAI_MONTHS_SHORT, formatThaiDate, todayIso } from "@/lib/thai-date";
import { FY_BACK, fiscalYearOf, parseFiscalYear } from "@/app/api/fund/uc-dashboard/dashboard";
import { partialMonth } from "@/app/api/fund/dept-trend/trend";
import { reasons, type HerbalResponse, type ItemSum, type SideSum } from "@/app/api/drug/herbal-usage/herbal";
import { Notice, Panel, Skeleton, btn, focusRing, num, useJson, useUrlParams } from "@/app/(app)/fund/_components/ui";

const API = "/api/drug/herbal-usage";
const PARAMS = ["fy"] as const;
const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 ${focusRing}`;
const box = "rounded-lg border border-line bg-surface p-3";
// สีผูกกับฝั่ง: OP = --chart-1, IP = --chart-2, รวม = --chart-3
const SIDES = [
  { key: "op", label: "ผู้ป่วยนอก", color: "--chart-1" },
  { key: "ip", label: "ผู้ป่วยใน", color: "--chart-2" },
] as const;

// StackedBarChart ย่อ tick ≥ 10,000 เป็น "20K" (ห้ามใช้) และ tick ล้านบาทมีทศนิยมตำแหน่งเดียว ยอดหลักหมื่นจึงเป็น 0 ทุกเส้น
// shortcut: ส่งค่าเป็นหมื่นบาทแล้วคูณกลับใน tooltip/ตาราง ; เปลี่ยนเป็นบาทเมื่อ StackedBarChart รับ tickFormat ได้
const SCALE = 10_000;
const fromScaled = (n: number) => formatBaht(n * SCALE);

const beYear = (m: string) => +m.slice(0, 4) + 543;
const monthShort = (m: string) => THAI_MONTHS_SHORT[+m.slice(5, 7) - 1];
const monthLong = (m: string) => `${THAI_MONTHS[+m.slice(5, 7) - 1]} ${beYear(m)}`;
const monthMid = (m: string) => `${monthShort(m)} ${String(beYear(m)).slice(2)}`;
/** สัดส่วนยาสมุนไพรในยาทั้งหมดอยู่หลักทศนิยม จึงแสดง 2 ตำแหน่ง */
const sharePct = (n: number) => `${n.toFixed(2)}%`;
const Dash = () => <span className="text-muted">–</span>;
const Pct = ({ value }: { value: number | null }) => (value === null ? <Dash /> : <>{sharePct(value)}</>);

/** "14:05 น." ถ้าเป็นวันนี้ ไม่งั้นนำหน้าด้วยวันที่ พ.ศ. (เวลาไทย UTC+7 ไม่มี DST) */
function thaiTime(iso: string) {
  const t = new Date(Date.parse(iso) + 7 * 3_600_000).toISOString();
  const day = t.slice(0, 10);
  return `${day === todayIso() ? "" : `${formatThaiDate(day)} `}${t.slice(11, 16)} น.`;
}

export function HerbalUsage({ title }: { title: ReactNode }) {
  usePersistedFilter("drug/herbal-usage", PARAMS);
  const p = useUrlParams(PARAMS);
  const currentFy = fiscalYearOf(todayIso());
  const fy = parseFiscalYear(p.fy, currentFy) ?? currentFy;
  const fyOptions = Array.from({ length: FY_BACK + 1 }, (_, i) => currentFy - i);
  const { loading, data, error, retry } = useJson<HerbalResponse>(`${API}?fy=${fy}`);

  const partial = data ? partialMonth(data) : null;
  const withDays = (m: string, text: string) => (m === partial?.month ? `${text} (ข้อมูล ${partial.days} วัน)` : text);
  const categories = data?.months.map((m) => ({ key: m, label: monthShort(m), title: withDays(m, monthLong(m)) })) ?? [];

  let body: ReactNode;
  if (error) {
    body = <Notice title="โหลดข้อมูลไม่สำเร็จ" detail={error} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />;
  } else if (!data) {
    body = <Skeleton rows={8} />;
  } else if (data.year.listed === 0) {
    body = <Notice title="HOSxP ยังไม่มีรายการที่ระบุเป็นยาสมุนไพร" detail="ระบุได้ที่ drugitems: หมวด 3/4 หรือรหัส TTMT" />;
  } else {
    const y = data.year;
    const loaded = data.months.slice(0, data.loaded);
    const sideRows = (k: "op" | "ip") => data.items.reduce((s, x) => s + x[k].rows, 0);
    body = (
      <div className="flex flex-col gap-8">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="มูลค่ายาสมุนไพร" sub={`ผู้ป่วยนอก ${formatCompactBaht(sum(data.monthly.op))} · ผู้ป่วยใน ${formatCompactBaht(sum(data.monthly.ip))}`}>
            <CompactBaht value={y.amt} />
          </Kpi>
          <Kpi label="สัดส่วนในมูลค่ายาทั้งหมด" sub={`ผู้ป่วยนอก ${y.share.op === null ? "–" : sharePct(y.share.op)} · ผู้ป่วยใน ${y.share.ip === null ? "–" : sharePct(y.share.ip)}`}>
            <span title={`มูลค่ายาทั้งหมด ${formatBaht(y.drugAmt)} บาท`} className="text-kpi font-semibold tracking-tight">{y.share.all === null ? "–" : sharePct(y.share.all)}</span>
          </Kpi>
          <Kpi label="ครั้งที่สั่งใช้" sub={`ผู้ป่วยนอก ${formatCount(sideRows("op"))} · ผู้ป่วยใน ${formatCount(sideRows("ip"))}`}>
            <span className="text-kpi font-semibold tracking-tight">{formatCount(y.rows)}</span>
          </Kpi>
          <Kpi label="รายการที่มีการใช้" sub={`จากรายการที่ระบุเป็นยาสมุนไพร${y.inactive ? ` (ปิดใช้ ${y.inactive})` : ""}`}>
            <span className="text-kpi font-semibold tracking-tight">{formatCount(y.used)}</span>
            <span className="text-sm text-muted">/ {formatCount(y.listed)} รายการ</span>
          </Kpi>
        </dl>

        <div className="grid gap-8 xl:grid-cols-2 [&>*]:min-w-0">
          <Panel title="มูลค่ารายเดือน ตามวันที่สั่งใช้ยา" aside={<span className="text-sm text-muted">แกน: หมื่นบาท</span>}>
            <div className={box}>
              <StackedBarChart
                label={`มูลค่ายาสมุนไพรรายเดือน ปีงบ ${fy} (บาท)`}
                categoryHeader="เดือน"
                categories={categories.slice(0, data.loaded)}
                series={SIDES.map((s) => ({ key: s.key, label: s.label, color: `var(${s.color})` }))}
                values={loaded.map((_, i) => [(data.monthly.op[i] ?? 0) / SCALE, (data.monthly.ip[i] ?? 0) / SCALE])}
                format={fromScaled}
              />
            </div>
          </Panel>

          <Panel title="สัดส่วนในมูลค่ายาทั้งหมด">
            <div className={box}>
              <MultiTrendChart
                categories={categories}
                series={[
                  ...SIDES.map((s) => ({ key: s.key, label: s.label, color: s.color, values: data.monthly.share[s.key] })),
                  { key: "all", label: "รวม", color: "--chart-3", values: data.monthly.share.all },
                ]}
                tickFormat={(n) => `${+n.toFixed(2)}%`}
                valueFormat={sharePct}
                unit="% ของมูลค่ายาทั้งหมด"
                ariaLabel={`สัดส่วนมูลค่ายาสมุนไพรในมูลค่ายาทั้งหมดรายเดือน ปีงบ ${fy}`}
              />
              <DataTableToggle caption={`สัดส่วนมูลค่ายาสมุนไพรในมูลค่ายาทั้งหมด ปีงบ ${fy} (%)`}>
                <thead>
                  <tr>
                    <th scope="col" className="text-left">เดือน</th>
                    <th scope="col" className="text-right">ผู้ป่วยนอก</th>
                    <th scope="col" className="text-right">ผู้ป่วยใน</th>
                    <th scope="col" className="text-right">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {loaded.map((m, i) => (
                    <tr key={m}>
                      <th scope="row">{withDays(m, monthMid(m))}</th>
                      <td><Pct value={data.monthly.share.op[i]} /></td>
                      <td><Pct value={data.monthly.share.ip[i]} /></td>
                      <td><Pct value={data.monthly.share.all[i]} /></td>
                    </tr>
                  ))}
                </tbody>
              </DataTableToggle>
            </div>
          </Panel>
        </div>

        <Panel
          title={`รายการยาสมุนไพร · ปีงบ ${fy}`}
          aside={data.items.length > 0 && <a href={`${API}?fy=${fy}&format=xlsx`} className={btn} download>ส่งออก Excel</a>}
        >
          {data.items.length > 0 ? <ItemTable items={data.items} total={y.amt} /> : <Notice title={`ยังไม่มีการสั่งใช้ยาสมุนไพรในปีงบ ${fy}`} />}
          <p className="mt-2 text-xs text-muted">
            เกณฑ์จาก drugitems ของ HOSxP: หมวด 3/4 (sks_product_category_id) หรือมีรหัส TTMT · AN ที่สั่งยาหลายเดือนนับเดือนละครั้ง
            {partial && ` · ${monthMid(partial.month)} ยังไม่จบเดือน`}
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
              {fyOptions.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
          {data && <Freshness computedAt={data.computed_at} live={data.live} onRefreshed={retry} />}
        </div>
      </div>
      <div className="mt-6" aria-busy={loading}>
        {body}
      </div>
    </>
  );
}

const sum = (v: (number | null)[]) => v.reduce<number>((s, x) => s + (x ?? 0), 0);

function ItemTable({ items, total }: { items: ItemSum[]; total: number }) {
  const th = "px-3 py-2 font-medium whitespace-nowrap";
  const cell = `${num} px-3 py-2`;
  const sideCells = (s: SideSum) => (
    <>
      <td className={`${cell} border-l border-line`}>{formatCount(s.rows)}</td>
      <td className={cell}>{formatCount(s.visits)}</td>
      <td className={cell}>{formatCount(s.qty)}</td>
      <td className={cell}>{formatBaht(s.amt)}</td>
    </>
  );
  const sideHead = (visit: string) => (
    <>
      <th scope="col" className={`${th} border-l border-line text-right`}>ครั้งที่สั่ง</th>
      <th scope="col" className={`${th} text-right`}>{visit}</th>
      <th scope="col" className={`${th} text-right`}>จำนวน</th>
      <th scope="col" className={`${th} text-right`}>มูลค่า (บาท)</th>
    </>
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface-sunken text-muted">
          <tr>
            <th scope="col" rowSpan={2} className={`${th} text-left align-bottom`}>รายการ</th>
            <th scope="col" rowSpan={2} className={`${th} text-left align-bottom`}>เกณฑ์</th>
            <th scope="colgroup" colSpan={4} className={`${th} border-l border-line text-center`}>ผู้ป่วยนอก</th>
            <th scope="colgroup" colSpan={4} className={`${th} border-l border-line text-center`}>ผู้ป่วยใน</th>
            <th scope="col" rowSpan={2} className={`${th} border-l border-line text-right align-bottom`}>รวมมูลค่า (บาท)</th>
            <th scope="col" rowSpan={2} className={`${th} text-right align-bottom`}>สัดส่วน (%)</th>
          </tr>
          <tr className="border-t border-line">
            {sideHead("visit")}
            {sideHead("AN")}
          </tr>
        </thead>
        <tbody>
          {items.map((x) => (
            <tr key={x.icode} className="border-t border-line">
              <th scope="row" className="min-w-56 px-3 py-2 text-left font-normal">
                <span className="flex flex-wrap items-center gap-x-2">
                  {x.name}
                  {!x.active && <span className="rounded border border-line px-1 text-xs text-muted">ปิดใช้</span>}
                </span>
                <span className="block text-xs text-subtle tabular-nums">{x.icode}{x.units && ` · ${x.units}`}</span>
              </th>
              <td className="px-3 py-2 whitespace-nowrap">{reasons(x).join(", ")}</td>
              {sideCells(x.op)}
              {sideCells(x.ip)}
              <td className={`${cell} border-l border-line font-medium`}>{formatBaht(x.amt)}</td>
              <td className={cell}>{x.share === null ? <Dash /> : x.share.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line font-semibold">
            <th scope="row" colSpan={2} className="px-3 py-2 text-left">รวม</th>
            <td className={`${cell} border-l border-line`}>{formatCount(items.reduce((s, x) => s + x.op.rows, 0))}</td>
            <td className={cell} colSpan={2} />
            <td className={cell}>{formatBaht(items.reduce((s, x) => s + x.op.amt, 0))}</td>
            <td className={`${cell} border-l border-line`}>{formatCount(items.reduce((s, x) => s + x.ip.rows, 0))}</td>
            <td className={cell} colSpan={2} />
            <td className={cell}>{formatBaht(items.reduce((s, x) => s + x.ip.amt, 0))}</td>
            <td className={`${cell} border-l border-line`}>{formatBaht(total)}</td>
            <td className={cell}>{total ? "100.0" : <Dash />}</td>
          </tr>
        </tfoot>
      </table>
    </div>
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

/** "723,036 บาท": ตัวเลขเป็น text-kpi หน่วยเล็ก ค่าเต็มตอน hover */
function CompactBaht({ value }: { value: number }) {
  const s = formatCompactBaht(value);
  const i = s.lastIndexOf(" ");
  return (
    <span title={`${formatBaht(value)} บาท`} className="contents">
      <span className="text-kpi font-semibold tracking-tight">{s.slice(0, i)}</span>
      <span className="text-sm text-muted">{s.slice(i + 1)}</span>
    </span>
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
      const res = await fetch(API, { method: "POST" });
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
