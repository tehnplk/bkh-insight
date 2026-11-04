"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/app-shell/icons";

// ค่าเข้า/ออกเป็น ISO YYYY-MM-DD (ค.ศ.) เสมอ แสดงผลเป็น พ.ศ. ด้วย Intl ทุกการคำนวณใช้ UTC จึงไม่เลื่อนตาม timezone เครื่อง
const UTC = { timeZone: "UTC" } as const;
const fmtDisplay = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { ...UTC, day: "2-digit", month: "2-digit", year: "numeric" });
const fmtFull = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { ...UTC, dateStyle: "full" });
const MONTHS = Array.from({ length: 12 }, (_, m) =>
  new Intl.DateTimeFormat("th-TH", { ...UTC, month: "long" }).format(new Date(Date.UTC(2000, m, 1))),
);
// 2000-01-02 เป็นวันอาทิตย์
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Intl.DateTimeFormat("th-TH", { ...UTC, weekday: "narrow" }).format(new Date(Date.UTC(2000, 0, 2 + i))),
);
const BE = 543;

const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * 86_400_000));
/** เลื่อนเดือน/ตั้งปี-เดือนใหม่ โดยวันไม่เกินวันสุดท้ายของเดือนนั้น (31 ม.ค. + 1 เดือน = 28/29 ก.พ.) */
const setMonth = (s: string, y: number, m: number) => {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(parse(s).getUTCDate(), last))));
};
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parse(s).getTime());

const navBtn =
  "grid size-8 place-items-center rounded-md text-muted outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
const selectCls = "h-8 rounded-md border border-line bg-surface px-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type ThaiDatePickerProps = {
  /** ISO YYYY-MM-DD (ค.ศ.) */
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
  /** ISO YYYY-MM-DD วันแรก/วันสุดท้ายที่เลือกได้ */
  min?: string;
  max?: string;
};

export function ThaiDatePicker({ value, onChange, "aria-label": label, min, max }: ThaiDatePickerProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const focusDay = useRef(false);
  const current = valid(value) ? value : today();
  const [cursor, setCursor] = useState(current);
  const [open, setOpen] = useState(false);

  const inRange = (s: string) => (!min || s >= min) && (!max || s <= max);
  const clamp = (s: string) => (min && s < min ? min : max && s > max ? max : s);

  useEffect(() => {
    const pop = popRef.current;
    const trigger = triggerRef.current;
    if (!pop || !trigger) return;
    const place = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") return;
      const r = trigger.getBoundingClientRect();
      pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
      pop.style.top = `${r.bottom + 4}px`;
    };
    const sync = (e: Event) => setOpen((e as ToggleEvent).newState === "open");
    pop.addEventListener("beforetoggle", place);
    pop.addEventListener("toggle", sync);
    return () => {
      pop.removeEventListener("beforetoggle", place);
      pop.removeEventListener("toggle", sync);
    };
  }, []);

  // โฟกัสวันที่ cursor หลังเปิดหรือเลื่อนด้วยคีย์บอร์ด (ปุ่มต้องมองเห็นแล้วจึงโฟกัสได้)
  useEffect(() => {
    if (!focusDay.current || !open) return;
    focusDay.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${cursor}"]`)?.focus();
  }, [cursor, open]);

  function pick(s: string) {
    if (!inRange(s)) return;
    onChange(s);
    popRef.current?.hidePopover();
    triggerRef.current?.focus();
  }

  const cur = parse(cursor);
  const y = cur.getUTCFullYear();
  const m = cur.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1));
  const start = iso(new Date(first.getTime() - first.getUTCDay() * 86_400_000));
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const weeks = Math.ceil((first.getUTCDay() + daysInMonth) / 7);
  const now = today();
  const nowYear = parse(now).getUTCFullYear();
  const minYear = min ? parse(min).getUTCFullYear() : Math.min(y, nowYear - 10);
  const maxYear = max ? parse(max).getUTCFullYear() : Math.max(y, nowYear + 1);
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
  const prevMonth = setMonth(cursor, y, m - 1);
  const nextMonth = setMonth(cursor, y, m + 1);
  const noPrev = !!min && iso(new Date(Date.UTC(y, m, 0))) < min; // วันสุดท้ายของเดือนก่อนอยู่ก่อน min
  const noNext = !!max && iso(new Date(Date.UTC(y, m + 1, 1))) > max; // วันแรกของเดือนถัดไปอยู่หลัง max

  function onGridKey(e: KeyboardEvent<HTMLTableElement>) {
    const dow = cur.getUTCDay();
    const next = {
      ArrowLeft: addDays(cursor, -1),
      ArrowRight: addDays(cursor, 1),
      ArrowUp: addDays(cursor, -7),
      ArrowDown: addDays(cursor, 7),
      Home: addDays(cursor, -dow),
      End: addDays(cursor, 6 - dow),
      PageUp: e.shiftKey ? setMonth(cursor, y - 1, m) : prevMonth,
      PageDown: e.shiftKey ? setMonth(cursor, y + 1, m) : nextMonth,
    }[e.key];
    if (!next) return;
    e.preventDefault();
    focusDay.current = true;
    setCursor(clamp(next));
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        popoverTarget={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label} ${fmtFull.format(parse(current))}`}
        onClick={() => {
          // เปิดใหม่ทุกครั้งเริ่มที่วันที่เลือกอยู่
          setCursor(current);
          focusDay.current = true;
        }}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-foreground tabular-nums outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        {fmtDisplay.format(parse(current))}
        <Icon name="calendar" className="size-4 text-muted" />
      </button>

      <div
        ref={popRef}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={label}
        className="fixed inset-auto m-0 w-72 rounded-lg border border-line bg-surface p-3 text-sm text-foreground shadow-lg"
      >
        <div className="flex items-center gap-1">
          <button type="button" aria-label="เดือนก่อน" className={navBtn} disabled={noPrev} onClick={() => setCursor(clamp(prevMonth))}>
            <Icon name="chevron" className="size-4 rotate-180" />
          </button>
          <select aria-label="เดือน" value={m} onChange={(e) => setCursor(clamp(setMonth(cursor, y, Number(e.target.value))))} className={`${selectCls} min-w-0 flex-1`}>
            {MONTHS.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
          <select aria-label="ปี พ.ศ." value={y} onChange={(e) => setCursor(clamp(setMonth(cursor, Number(e.target.value), m)))} className={`${selectCls} tabular-nums`}>
            {years.map((yr) => (
              <option key={yr} value={yr}>
                {yr + BE}
              </option>
            ))}
          </select>
          <button type="button" aria-label="เดือนถัดไป" className={navBtn} disabled={noNext} onClick={() => setCursor(clamp(nextMonth))}>
            <Icon name="chevron" className="size-4" />
          </button>
        </div>

        <table ref={gridRef} role="grid" aria-label={`${MONTHS[m]} ${y + BE}`} onKeyDown={onGridKey} className="mt-2 w-full border-collapse text-center tabular-nums">
          <thead>
            <tr>
              {WEEKDAYS.map((d) => (
                <th key={d} scope="col" className="h-7 text-xs font-medium text-muted">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: weeks }, (_, w) => (
              <tr key={w}>
                {Array.from({ length: 7 }, (_, d) => {
                  const day = addDays(start, w * 7 + d);
                  const date = parse(day);
                  const selected = day === current;
                  const outside = date.getUTCMonth() !== m;
                  return (
                    <td key={day} className="p-0.5">
                      <button
                        type="button"
                        data-date={day}
                        tabIndex={day === cursor ? 0 : -1}
                        aria-label={fmtFull.format(date)}
                        aria-pressed={selected}
                        aria-current={day === now ? "date" : undefined}
                        disabled={!inRange(day)}
                        onClick={() => pick(day)}
                        className={`size-8 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30 ${
                          selected
                            ? "bg-accent font-semibold text-accent-fg"
                            : `hover:bg-hover ${day === now ? "border border-accent-line font-semibold text-accent-text" : outside ? "text-muted" : ""}`
                        }`}
                      >
                        {date.getUTCDate()}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-2 flex justify-end border-t border-line pt-2">
          <button
            type="button"
            disabled={!inRange(now)}
            onClick={() => pick(now)}
            className="h-8 rounded-md px-3 font-medium text-accent-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            วันนี้
          </button>
        </div>
      </div>
    </>
  );
}
