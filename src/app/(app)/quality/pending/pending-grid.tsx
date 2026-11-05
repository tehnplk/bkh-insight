"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FilterDataGrid, gridColumnHelper } from "@/components/filter-data-grid/filter-data-grid";
import { formatThaiDate, ThaiDateStepper } from "@/components/thai-date-stepper/thai-date-stepper";
import { addDaysIso, isIsoDate } from "@/app/api/visit/opd-visit/opd-visit";
import {
  DAY_OPTIONS,
  DEFAULT_DAYS,
  DEFAULT_KIND,
  defaultDchFrom,
  isPendingKind,
  MAX_DCH_SPAN_DAYS,
  parseDays,
  PENDING_KINDS,
  type PendingKind,
  type PendingRow,
  type PendingSummary,
} from "@/app/api/quality/pending/pending";
import type { GridPage } from "@/lib/grid-query";
import { Segmented } from "./segmented";

const FILTER_KEYS = ["kind", "days", "from", "to"] as const;
type PendingPage = GridPage<PendingRow> & { summary: PendingSummary };
const SELECT_CLASS =
  "h-9 min-w-0 rounded-md border border-line bg-surface pr-8 pl-3 font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring";
const muted = <span className="text-muted">–</span>;
const dash = (v: string | null) => v || muted;
const dateCell = { className: "whitespace-nowrap tabular-nums" };

const col = gridColumnHelper<PendingRow>();
const head = [
  col.accessor("an", { header: "AN", meta: { className: "tabular-nums" } }),
  col.accessor("hn", { header: "HN", meta: { className: "tabular-nums" } }),
  col.accessor("name", { header: "ชื่อ-นามสกุล", meta: { className: "whitespace-nowrap" } }),
  col.accessor("ward", { header: "ward", cell: (c) => dash(c.getValue()), meta: { className: "whitespace-nowrap" } }),
];
const regdate = col.accessor("regdate", { header: "วันรับ", cell: (c) => formatThaiDate(c.getValue()), meta: dateCell });
const days = (header: string) =>
  col.accessor("days", {
    header,
    cell: (c) => <span className="font-semibold">{c.getValue().toLocaleString("th-TH")}</span>,
    meta: { className: "text-right tabular-nums" },
  });

const COLUMNS = {
  "overdue-discharge": col.columns([
    ...head,
    col.accessor("doctor", { header: "แพทย์ผู้รับ", cell: (c) => dash(c.getValue()), meta: { className: "whitespace-nowrap" } }),
    regdate,
    days("ค้าง (วัน)"),
  ]),
  "ipd-no-dx": col.columns([
    ...head,
    col.accessor("doctor", { header: "แพทย์", cell: (c) => dash(c.getValue()), meta: { className: "whitespace-nowrap" } }),
    regdate,
    col.accessor("dchdate", { header: "วันจำหน่าย", cell: (c) => formatThaiDate(c.getValue() ?? ""), meta: dateCell }),
    days("หลังจำหน่าย (วัน)"),
  ]),
} satisfies Record<PendingKind, unknown>;

export function PendingGrid({ today }: { today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const kindParam = sp.get("kind") ?? "";
  const kind: PendingKind = isPendingKind(kindParam) ? kindParam : DEFAULT_KIND;
  const days = parseDays(sp.get("days")) ?? DEFAULT_DAYS;
  const defaultFrom = defaultDchFrom(today);
  const date = (k: string, fallback: string) => {
    const v = sp.get(k) ?? "";
    return isIsoDate(v) ? v : fallback;
  };
  const from = date("from", defaultFrom);
  const to = date("to", today);
  const lastPickable = (start: string) => {
    const cap = addDaysIso(start, MAX_DCH_SPAN_DAYS - 1);
    return cap < today ? cap : today;
  };

  function replace(next: URLSearchParams) {
    next.delete("page");
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  // หมวดใหม่มีคอลัมน์และ filter ของตัวเอง จึงล้าง sort และ filter ของหมวดเดิม (คำค้นหาเก็บไว้)
  function setKind(v: PendingKind) {
    const next = new URLSearchParams(sp.toString());
    for (const key of ["sort", "dir", "days", "from", "to"]) next.delete(key);
    if (v === DEFAULT_KIND) next.delete("kind");
    else next.set("kind", v);
    replace(next);
  }

  function setDays(v: number) {
    const next = new URLSearchParams(sp.toString());
    if (v === DEFAULT_DAYS) next.delete("days");
    else next.set("days", String(v));
    replace(next);
  }

  function setRange(nextFrom: string, nextTo: string) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v, d] of [["from", nextFrom, defaultFrom], ["to", nextTo, today]] as const) {
      if (v === d) next.delete(k);
      else next.set(k, v);
    }
    replace(next);
  }

  // เลื่อนวันเริ่มเกินวันสิ้นสุด หรือทำให้ช่วงยาวเกิน ให้ดึงวันสิ้นสุดตามมา
  function setFrom(v: string) {
    if (!isIsoDate(v)) return;
    const cap = lastPickable(v);
    setRange(v, to < v ? v : to > cap ? cap : to);
  }

  const dayOptions: readonly number[] = DAY_OPTIONS.includes(days as (typeof DAY_OPTIONS)[number])
    ? DAY_OPTIONS
    : [...DAY_OPTIONS, days].sort((a, b) => a - b);

  return (
    <FilterDataGrid<PendingRow, PendingPage>
      // คนละหมวดคนละคอลัมน์ เริ่ม grid ใหม่ทั้งตัว
      key={kind}
      endpoint="/api/quality/pending"
      filterKeys={FILTER_KEYS}
      liveSearch
      exportPlacement="summary"
      toolbar={
        <>
          <Segmented label="หมวดรายการค้าง" options={PENDING_KINDS} value={kind} onChange={setKind} />
          {kind === "overdue-discharge" ? (
            <label className="flex items-center gap-2">
              <span className="shrink-0 text-muted">รับเกิน</span>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={SELECT_CLASS}>
                {dayOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <span className="shrink-0 text-muted">วัน</span>
            </label>
          ) : (
            <div role="group" aria-label="ช่วงวันที่จำหน่าย" className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <ThaiDateStepper label="จำหน่ายตั้งแต่" value={from} max={today} stepper={false} onChange={setFrom} />
              <ThaiDateStepper
                label="ถึง"
                value={to}
                min={from}
                max={lastPickable(from)}
                stepper={false}
                onChange={(v) => isIsoDate(v) && setRange(from, v)}
              />
            </div>
          )}
        </>
      }
      columns={COLUMNS[kind]}
      getRowId={(r) => r.an}
      renderSummary={({ summary: s }) => <Summary s={s} />}
    />
  );
}

const n = (v: number) => v.toLocaleString("th-TH");

function Summary({ s }: { s: PendingSummary }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1 text-muted tabular-nums">
      <p className="flex items-baseline gap-1.5">
        <span className={`text-base font-semibold ${s.count ? "text-danger" : "text-success"}`}>{n(s.count)}</span>
        <span>ราย{s.of != null && ` จากผู้จำหน่าย ${n(s.of)} ราย`}</span>
      </p>
      {s.byWard.length > 0 && (
        <ul aria-label="แยกตาม ward" className="flex flex-wrap gap-x-3 gap-y-1">
          {s.byWard.map((w) => (
            <li key={w.ward ?? ""} className="whitespace-nowrap">
              {w.ward ?? "ไม่ระบุ ward"} <span className="font-semibold text-foreground">{n(w.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
