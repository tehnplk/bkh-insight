"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";

const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const WEEKDAYS = [["อา", "อาทิตย์"], ["จ", "จันทร์"], ["อ", "อังคาร"], ["พ", "พุธ"], ["พฤ", "พฤหัสบดี"], ["ศ", "ศุกร์"], ["ส", "เสาร์"]];

// วันที่เป็น ISO YYYY-MM-DD (ค.ศ.) เสมอ คำนวณแบบ UTC จึงไม่เลื่อนตาม timezone ของเครื่อง แปลงเป็น พ.ศ. ตอนแสดงผลเท่านั้น
const parse = (iso: string) => iso.split("-").map(Number) as [number, number, number];
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const [y, m, d] = parse(iso);
  return ymd(y, m, d + n);
};
const addMonths = (iso: string, n: number) => {
  const [y, m, d] = parse(iso);
  const last = new Date(Date.UTC(y, m + n, 0)).getUTCDate();
  return ymd(y, m + n, Math.min(d, last));
};
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const noopSubscribe = () => () => {};
const todayTh = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

/** "4 พ.ย. 2569" หรือ long: "4 พฤศจิกายน 2569" */
export function formatThaiDate(iso: string, long = false) {
  const [y, m, d] = parse(iso);
  return `${d} ${(long ? MONTHS : MONTHS_SHORT)[m - 1]} ${y + 543}`;
}

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const iconBtn = `grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40 ${focusRing}`;

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === "left" ? "M12 5l-5 5 5 5" : "M8 5l5 5-5 5"} />
    </svg>
  );
}

export type ThaiDateStepperProps = {
  /** YYYY-MM-DD (ค.ศ.) */
  value: string;
  onChange: (iso: string) => void;
  /** วันแรกที่เลือกได้ YYYY-MM-DD เช่น วันเริ่มของช่วงวันที่ */
  min?: string;
  /** วันสุดท้ายที่เลือกได้ YYYY-MM-DD เช่น วันนี้ */
  max?: string;
  /** แสดงปุ่มวันก่อน/ถัดไป (ค่าเริ่มต้น true) ปิดได้เมื่อใช้เป็นคู่ช่วงวันที่ */
  stepper?: boolean;
  /** ข้อความ label ที่แสดงหน้าปุ่ม และเป็นชื่อของปฏิทินสำหรับ screen reader */
  label: string;
};

// ปุ่มแสดงวันที่ พ.ศ. + ปุ่มวันก่อน/ถัดไป และปฏิทินใน native popover (top layer, Esc/คลิกนอกกรอบปิดได้ และคืน focus ให้ปุ่ม)
// ในปฏิทิน: ลูกศรเลื่อนวัน/สัปดาห์, Home/End ต้น/ท้ายสัปดาห์, PageUp/PageDown เดือน (กด Shift = ปี)
export function ThaiDateStepper({ value, onChange, min, max, label, stepper = true }: ThaiDateStepperProps) {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(value);
  // วันนี้ของเครื่องผู้ใช้อ่านหลัง hydrate เท่านั้น (server/ตอน hydrate = "") นาฬิกาเครื่องคลาดจาก server จะได้ไม่ทำให้ HTML ไม่ตรงกัน
  const today = useSyncExternalStore(noopSubscribe, todayTh, () => "");
  const clamp = (iso: string) => (max && iso > max ? max : min && iso < min ? min : iso);
  const outOfRange = (iso: string) => (!!max && iso > max) || (!!min && iso < min);

  useEffect(() => {
    const pop = popRef.current;
    const btn = btnRef.current;
    if (!pop || !btn) return;
    const before = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") return;
      const r = btn.getBoundingClientRect();
      pop.style.top = `${r.bottom + 4}px`;
      // ยังไม่แสดงจึงวัดความกว้างไม่ได้ ใช้ค่า w-72 (288px) แล้วดันเข้าในจอบนหน้าจอแคบ
      pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 288 - 8))}px`;
      setFocus(value);
      moveFocus.current = true;
    };
    const toggle = (e: Event) => setOpen((e as ToggleEvent).newState === "open");
    pop.addEventListener("beforetoggle", before);
    pop.addEventListener("toggle", toggle);
    return () => {
      pop.removeEventListener("beforetoggle", before);
      pop.removeEventListener("toggle", toggle);
    };
  }, [value]);

  // ย้าย focus ตามวันที่เลือกเฉพาะตอนเปิดหรือกดปุ่มในตาราง ไม่แย่ง focus จากปุ่มเปลี่ยนเดือน
  useEffect(() => {
    if (!open || !moveFocus.current) return;
    moveFocus.current = false;
    popRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`)?.focus();
  }, [open, focus]);

  function pick(iso: string) {
    onChange(iso);
    popRef.current?.hidePopover();
    btnRef.current?.focus();
  }

  function onGridKey(e: KeyboardEvent<HTMLTableElement>) {
    const wd = weekday(focus);
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      Home: () => addDays(focus, -wd),
      End: () => addDays(focus, 6 - wd),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
    };
    if (!step[e.key]) return;
    e.preventDefault();
    moveFocus.current = true;
    setFocus(clamp(step[e.key]()));
  }

  const [y, m] = parse(focus);
  const first = ymd(y, m, 1);
  const lead = weekday(first);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => ymd(y, m, i + 1))];
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const nextMonthBlocked = !!max && addMonths(first, 1) > max;
  const prevMonthBlocked = !!min && ymd(y, m, 0) < min;
  const nextDayBlocked = !!max && value >= max;
  const prevDayBlocked = !!min && value <= min;
  const heading = `${MONTHS[m - 1]} ${y + 543}`;

  return (
    <div className="flex items-center gap-2">
      <span id={`${id}-label`} className="text-muted">
        {label}
      </span>
      <div className="flex h-9 items-center rounded-md border border-line bg-surface">
        {stepper && (
          <button type="button" aria-label="วันก่อนหน้า" disabled={prevDayBlocked} className={`${iconBtn} ml-0.5`} onClick={() => onChange(clamp(addDays(value, -1)))}>
            <Chevron dir="left" />
          </button>
        )}
        <button
          ref={btnRef}
          type="button"
          popoverTarget={`${id}-cal`}
          aria-labelledby={`${id}-label ${id}-value`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={`${id}-cal`}
          className={`h-8 rounded-md px-2 ${stepper ? "" : "mx-0.5"} font-medium whitespace-nowrap tabular-nums hover:bg-hover ${open ? "bg-hover" : ""} ${focusRing}`}
        >
          <span aria-hidden="true">{formatThaiDate(value)}</span>
          <span id={`${id}-value`} className="sr-only">
            {formatThaiDate(value, true)}
          </span>
        </button>
        {stepper && (
          <button type="button" aria-label="วันถัดไป" disabled={nextDayBlocked} className={`${iconBtn} mr-0.5`} onClick={() => onChange(clamp(addDays(value, 1)))}>
            <Chevron dir="right" />
          </button>
        )}
      </div>

      <div
        ref={popRef}
        id={`${id}-cal`}
        popover="auto"
        role="dialog"
        aria-label={label}
        className="fixed inset-auto m-0 w-72 rounded-lg border border-line bg-surface p-3 text-sm text-foreground shadow-lg"
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="เดือนก่อนหน้า"
            disabled={prevMonthBlocked}
            className={iconBtn}
            onClick={() => setFocus(clamp(addMonths(focus, -1)))}
          >
            <Chevron dir="left" />
          </button>
          <p aria-live="polite" className="font-semibold tabular-nums">
            {heading}
          </p>
          <button
            type="button"
            aria-label="เดือนถัดไป"
            disabled={nextMonthBlocked}
            className={iconBtn}
            onClick={() => setFocus(clamp(addMonths(focus, 1)))}
          >
            <Chevron dir="right" />
          </button>
        </div>

        <table aria-label={heading} onKeyDown={onGridKey} className="mt-2 w-full border-collapse text-center tabular-nums">
          <thead>
            <tr>
              {WEEKDAYS.map(([short, full]) => (
                <th key={short} abbr={full} scope="col" className="h-8 text-xs font-medium text-muted">
                  {short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, i) => (
              <tr key={i}>
                {week.map((iso, j) =>
                  iso ? (
                    <td key={iso} className="p-0.5">
                      <button
                        type="button"
                        data-iso={iso}
                        tabIndex={iso === focus ? 0 : -1}
                        disabled={outOfRange(iso)}
                        aria-label={formatThaiDate(iso, true)}
                        aria-pressed={iso === value}
                        aria-current={iso === today ? "date" : undefined}
                        onClick={() => pick(iso)}
                        className={`grid size-8 w-full place-items-center rounded-md disabled:pointer-events-none disabled:opacity-35 ${focusRing} ${
                          iso === value
                            ? "bg-accent font-semibold text-accent-fg"
                            : iso === today
                              ? "font-semibold text-accent-text hover:bg-hover"
                              : "hover:bg-hover"
                        }`}
                      >
                        {Number(iso.slice(8))}
                      </button>
                    </td>
                  ) : (
                    <td key={`pad-${j}`} />
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-2 flex justify-end border-t border-line pt-2">
          <button
            type="button"
            disabled={!today || outOfRange(today) || value === today}
            onClick={() => pick(today)}
            className={`h-8 rounded-md px-3 font-medium text-accent-text hover:bg-hover disabled:pointer-events-none disabled:opacity-40 ${focusRing}`}
          >
            วันนี้
          </button>
        </div>
      </div>
    </div>
  );
}
