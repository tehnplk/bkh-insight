"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { formatBaht, formatCount } from "@/lib/number-format";
import { Notice, Panel, Skeleton, btn, focusRing, num, useJson } from "../_components/ui";
import type { SummaryPanel, SummaryResponse, SummaryTotals } from "@/app/api/fund/ar-precheck-summary/summary";

type Type = "opd" | "ipd";
const TYPES = [
  { value: "opd", label: "ผู้ป่วยนอก", date: "วันรับบริการ" },
  { value: "ipd", label: "ผู้ป่วยใน", date: "วันจำหน่าย" },
] as const satisfies readonly { value: Type; label: string; date: string }[];

const th = "px-3 py-1.5 font-medium align-bottom";
const td = "px-3 py-1.5";
const box = "max-w-full overflow-x-auto rounded-lg border border-line";
const badge = "inline-block rounded border px-1.5 py-0.5 whitespace-nowrap";

/** หัวคอลัมน์เงิน: ชื่อ (บาท) บรรทัดแรก แหล่งข้อมูลจางบรรทัดสอง */
const MoneyHead = ({ label, source }: { label: string; source?: string }) => (
  <th className={`${th} ${num}`}>
    {label} (บาท)
    {source && <span className="block font-normal">{source}</span>}
  </th>
);

/** หน้าตรวจรายตัว (ar-precheck) ช่วงและประเภทเดียวกัน fund = กรองกลุ่มสิทธิ, mismatch = เฉพาะไม่ตรง */
function precheckHref(type: Type, start: string, end: string, fund?: string, mismatch?: boolean) {
  const q = new URLSearchParams({ start, end });
  if (type === "ipd") q.set("type", "ipd");
  if (mismatch) q.set("only", "mismatch");
  if (fund) q.set("cf", JSON.stringify({ fund: [fund] }));
  return `/fund/ar-precheck?${q}`;
}

function DetailLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} aria-label={label} title={label} className={`inline-flex size-7 items-center justify-center rounded-md text-accent-text hover:bg-hover ${focusRing}`}>
      <Search className="size-4" aria-hidden />
    </Link>
  );
}

function Status({ t, href }: { t: SummaryTotals; href: string }) {
  if (!t.mismatch) return <span className={`${badge} border-success-line bg-success-soft text-success`}>ตรง</span>;
  return (
    <Link href={href} className={`${badge} border-danger-line bg-danger-soft text-danger underline-offset-2 hover:underline ${focusRing}`}>
      ไม่ตรง {formatCount(t.mismatch)} ราย
    </Link>
  );
}

const money = (v: number, extra = "") => <td className={`${td} ${num} ${extra}`}>{formatBaht(v)}</td>;

function TypePanel({ type, label, date, data, start, end }: { type: Type; label: string; date: string; data: SummaryPanel; start: string; end: string }) {
  const opd = type === "opd";
  const t = data.total;
  const fundCells = (f: SummaryTotals) => (
    <>
      <td className={`${td} ${num}`}>{formatCount(f.count)}</td>
      {money(f.income)}
      {money(f.paid_money)}
      {money(f.rcpt_money)}
      {opd && money(f.pp)}
      {money(f.debt, "font-semibold")}
    </>
  );
  return (
    <Panel title={label} aside={<span className="text-sm text-muted">ตาม{date}</span>}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className={box}>
          <table className="w-full border-collapse tabular-nums">
            <caption className="sr-only">ยอดรวม{label}</caption>
            <thead className="bg-surface-sunken text-left text-xs text-muted">
              <tr>
                <MoneyHead label="ค่าใช้จ่ายทั้งหมด" source="ใบสั่งยา" />
                <MoneyHead label="ต้องชำระเงิน" source="ใบสั่งยา" />
                <MoneyHead label="ค่าใช้จ่ายทั้งหมด" source="สรุป" />
                <MoneyHead label="ต้องชำระเงิน" source="สรุป" />
                <MoneyHead label="ชำระเงินแล้ว" source="สรุป" />
                {opd && <MoneyHead label="PPFS" source="สรุป" />}
                <MoneyHead label="ลูกหนี้" source="สรุป" />
                <th className={th}>สถานะ</th>
                <th className={th}>รายตัว</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                {money(t.rx_total)}
                {money(t.rx_pay)}
                {money(t.income)}
                {money(t.paid_money)}
                {money(t.rcpt_money)}
                {opd && money(t.pp)}
                {money(t.debt, "font-semibold")}
                <td className={td}><Status t={t} href={precheckHref(type, start, end, undefined, true)} /></td>
                <td className={td}><DetailLink href={precheckHref(type, start, end)} label={`รายตัว${label}ทุกกลุ่มสิทธิ`} /></td>
              </tr>
            </tbody>
          </table>
        </div>

        <section>
          <h3 className="mb-2 text-base font-semibold">แยกกลุ่มสิทธิ</h3>
          <div className={box}>
            <table className="w-full border-collapse tabular-nums">
              <caption className="sr-only">{label} แยกกลุ่มสิทธิ</caption>
              <thead className="bg-surface-sunken text-left text-xs text-muted">
                <tr>
                  <th className={th}>INSCL</th>
                  <th className={th}>กลุ่มสิทธิ</th>
                  <th className={`${th} ${num}`}>จำนวน</th>
                  <MoneyHead label="ค่าใช้จ่ายทั้งหมด" />
                  <MoneyHead label="ต้องชำระเงิน" />
                  <MoneyHead label="ชำระเงินแล้ว" />
                  {opd && <MoneyHead label="PPFS" />}
                  <MoneyHead label="ลูกหนี้" />
                  <th className={th}>รายตัว</th>
                </tr>
              </thead>
              <tbody>
                {data.funds.length === 0 && (
                  <tr className="border-t border-line">
                    <td colSpan={opd ? 9 : 8} className={`${td} text-center text-muted`}>ไม่มีรายในช่วงนี้</td>
                  </tr>
                )}
                {data.funds.map((f) => (
                  <tr key={f.fund} className="border-t border-line">
                    <td className={`${td} whitespace-nowrap`}>{f.fund}</td>
                    <th scope="row" className={`${td} text-left font-normal`}>{f.fund_name}</th>
                    {fundCells(f)}
                    <td className={td}><DetailLink href={precheckHref(type, start, end, f.fund)} label={`รายตัว${label} กลุ่มสิทธิ ${f.fund}`} /></td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line font-semibold">
                  <th scope="row" colSpan={2} className={`${td} text-left`}>รวม</th>
                  {fundCells(t)}
                  <td className={td} />
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Panel>
  );
}

export function SummaryView() {
  const { start, end } = useDateRange();
  const { data, error, loading, retry } = useJson<SummaryResponse>(`/api/fund/ar-precheck-summary?${new URLSearchParams({ start, end })}`);
  let body: ReactNode;
  if (error) body = <Notice title="โหลดข้อมูลไม่สำเร็จ" detail={error} action={<button type="button" onClick={retry} className={btn}>ลองอีกครั้ง</button>} />;
  else if (loading || !data) body = <div className="grid gap-6 2xl:grid-cols-2"><Skeleton /><Skeleton /></div>;
  else
    body = (
      <div className="grid items-start gap-6 2xl:grid-cols-2">
        {TYPES.map((x) => <TypePanel key={x.value} type={x.value} label={x.label} date={x.date} data={data[x.value]} start={start} end={end} />)}
      </div>
    );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title text-balance">สรุปค่ารักษาก่อนตั้งหนี้</h1>
        <DateRangeFilter hideLabels />
      </div>
      <div className="mt-6">{body}</div>
    </>
  );
}
