"use client";

import { useId } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MultiSelect, type MultiSelectGroup } from "@/components/multi-select/multi-select";
import { ThaiDatePicker } from "@/components/thai-date-picker/thai-date-picker";
import { addDaysIso, isIsoDate, MAX_SPAN_DAYS } from "@/app/api/visit/opd-visit/opd-visit";
import {
  addMonthsIso,
  homeQuery,
  MAX_SPAN_MONTHS,
  monthEnd,
  monthOptionLabel,
  monthStart,
  toDayRange,
  toMonthRange,
  type TrendBy,
} from "./home-params";
import { Segmented } from "./segmented";

type Props = {
  from: string;
  to: string;
  pttypes: string[];
  pttypeGroups: MultiSelectGroup[];
  /** มุมมองของแท็บแนวโน้ม ไม่ส่ง = แท็บสรุป (เลือกวันอย่างเดียว) */
  by?: TrendBy;
  /** วันนี้ (ISO) จาก server */
  today: string;
};

/** เดือนย้อนหลังที่เลือกได้ในมุมมองรายเดือน */
const MONTH_HISTORY = 36;

const BY_OPTIONS = [
  { value: "day", label: "รายวัน" },
  { value: "month", label: "รายเดือน" },
] as const;

/**
 * ตัวกรองของหน้าแรก (ใช้ร่วมทั้งสองแท็บ) เก็บใน URL: from, to (วันนี้ไม่ใส่ใน URL) และ pttype คั่นด้วยจุลภาค (?pttype=89,77)
 * แท็บแนวโน้มเพิ่ม by: รายวันเลือกวันได้ไม่เกิน MAX_SPAN_DAYS, รายเดือนเลือกเดือนได้ไม่เกิน MAX_SPAN_MONTHS
 * param อื่น (tab, metric) คงไว้ตามเดิม
 */
export function HomeFilters({ from, to, pttypes, pttypeGroups, by, today }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastPickable = (start: string) => {
    const cap = addDaysIso(start, MAX_SPAN_DAYS - 1);
    return cap < today ? cap : today;
  };

  function navigate(patch: Record<string, string | null>) {
    router.replace(`${pathname}${homeQuery(searchParams, patch, today)}`, { scroll: false });
  }

  // เลื่อนวันเริ่มเกินวันสิ้นสุด หรือทำให้ช่วงยาวเกิน ให้ดึงวันสิ้นสุดตามมา
  function setFrom(v: string) {
    if (!isIsoDate(v)) return;
    const cap = lastPickable(v);
    navigate({ from: v, to: to < v ? v : to > cap ? cap : to });
  }

  function setBy(next: TrendBy) {
    const r = next === "month" ? toMonthRange(to) : toDayRange(from, to);
    navigate({ by: next, ...r });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {by && <Segmented label="มุมมอง" options={BY_OPTIONS} value={by} onChange={setBy} />}
      {by === "month" ? (
        <MonthRange from={from} to={to} today={today} onChange={navigate} />
      ) : (
        <div role="group" aria-label="ช่วงวันที่รับบริการ" className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ThaiDatePicker label="ตั้งแต่" value={from} max={today} stepper={false} onChange={setFrom} />
          <ThaiDatePicker
            label="ถึง"
            value={to}
            min={from}
            max={lastPickable(from)}
            stepper={false}
            onChange={(v) => isIsoDate(v) && navigate({ to: v })}
          />
        </div>
      )}
      <MultiSelect
        label="สิทธิ"
        allLabel="ทุกสิทธิ"
        groups={pttypeGroups}
        value={pttypes}
        onChange={(v) => navigate({ pttype: v.join(",") || null })}
      />
    </div>
  );
}

/** ช่วงเดือน: from = วันแรกของเดือน, to = วันสุดท้ายของเดือน (เดือนปัจจุบันใช้วันนี้) */
function MonthRange({ from, to, today, onChange }: { from: string; to: string; today: string; onChange: (p: Record<string, string>) => void }) {
  const current = monthStart(today);
  const endOf = (m: string) => (monthEnd(m) < today ? monthEnd(m) : today);
  const fromMonth = monthStart(from);
  const toMonth = monthStart(to);
  // ย้อนหลัง MONTH_HISTORY เดือน (หรือถึงเดือนใน URL ถ้าเก่ากว่า) เรียงใหม่ไปเก่า
  const oldest = [addMonthsIso(current, -(MONTH_HISTORY - 1)), fromMonth].sort()[0];
  const months: string[] = [];
  for (let m = current; m >= oldest; m = addMonthsIso(m, -1)) months.push(m);
  const lastTo = [addMonthsIso(fromMonth, MAX_SPAN_MONTHS - 1), current].sort()[0];

  function setFrom(m: string) {
    const cap = addMonthsIso(m, MAX_SPAN_MONTHS - 1);
    const nextTo = toMonth < m ? m : toMonth > cap ? cap : toMonth;
    onChange({ from: m, to: endOf(nextTo) });
  }

  return (
    <div role="group" aria-label="ช่วงเดือนที่รับบริการ" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <MonthSelect label="ตั้งแต่" value={fromMonth} months={months} onChange={setFrom} />
      <MonthSelect
        label="ถึง"
        value={toMonth}
        months={months.filter((m) => m >= fromMonth && m <= lastTo)}
        onChange={(m) => onChange({ to: endOf(m) })}
      />
    </div>
  );
}

function MonthSelect({ label, value, months, onChange }: { label: string; value: string; months: string[]; onChange: (m: string) => void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-line bg-surface px-2 font-medium tabular-nums outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        {months.map((m) => (
          <option key={m} value={m}>
            {monthOptionLabel(m)}
          </option>
        ))}
      </select>
    </div>
  );
}
