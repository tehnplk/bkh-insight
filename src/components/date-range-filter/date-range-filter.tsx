"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ThaiDatePicker } from "@/components/thai-date-picker/thai-date-picker";
import { todayIso } from "@/lib/thai-date";

// ช่วงวันที่อยู่ใน URL เป็น ISO ค.ศ. (start, end) ยาวไม่เกิน MAX_RANGE_DAYS วันรวมวันแรกและวันสุดท้าย
// ไม่มีค่า = วันนี้ถึงวันนี้ ตามเวลาไทย (ตรงกับ preset "วันนี้" ซึ่งเป็นตัวแรก)
// ใช้ useSearchParams ทั้งคู่ ผู้ใช้ต้องครอบ DateRangeFilter และ component ที่เรียก useDateRange ด้วย <Suspense>

/** ช่วงยาวสุดที่เลือกได้ (วัน รวมวันแรกและวันสุดท้าย) 31 = เลือกได้เต็มเดือน ต้องตรงกับ MAX_RANGE_DAYS ใน src/app/api/fund/_lib/fund.ts (API ตอบ 400 ถ้าเกิน) */
export const MAX_RANGE_DAYS = 31;
const SPAN = MAX_RANGE_DAYS - 1;

// คำนวณบน UTC ล้วน ไม่เลื่อนตาม timezone ของเครื่อง
const DAY_MS = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number) => new Date(toTime(iso) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / DAY_MS);
const minIso = (a: string, b: string) => (a < b ? a : b);
const maxIso = (a: string, b: string) => (a > b ? a : b);
const valid = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toTime(v)) && addDays(v, 0) === v;

/** ปรับช่วงให้ถูกต้อง: end >= start และยาวไม่เกิน MAX_RANGE_DAYS (ตัดฝั่งที่ไม่ได้เลือก) */
function clampRange(start: string, end: string, keep: "start" | "end", today: string) {
  if (keep === "start") {
    let e = maxIso(end, start);
    if (daysBetween(start, e) > SPAN) e = maxIso(start, minIso(addDays(start, SPAN), today));
    return { start, end: e };
  }
  let s = minIso(start, end);
  if (daysBetween(s, end) > SPAN) s = addDays(end, -SPAN);
  return { start: s, end };
}

function presets(today: string) {
  return [
    { id: "today", label: "วันนี้", start: today, end: today },
    { id: "7d", label: "7 วันล่าสุด", start: addDays(today, -6), end: today },
    { id: "30d", label: "30 วันล่าสุด", start: addDays(today, -29), end: today },
    // ต้นเดือนถึงวันนี้ยาวไม่เกิน 31 วันเสมอ
    { id: "month", label: "เดือนนี้", start: `${today.slice(0, 8)}01`, end: today },
  ];
}

/** ช่วงวันที่จาก URL (start, end) ที่ปรับให้ถูกต้องแล้ว (ค่าผิดรูปแบบใช้ค่าเริ่มต้น, end < start หรือยาวเกิน MAX_RANGE_DAYS ถูกตัด) */
export function useDateRange(): { start: string; end: string } {
  const sp = useSearchParams();
  const today = todayIso();
  const start = sp.get("start");
  const end = sp.get("end");
  // ไม่มีค่า = วันนี้ (ถ้ามีแค่ end ให้ start = end)
  const e = valid(end) ? end : today;
  return clampRange(valid(start) ? start : e, e, "start", today);
}

/** ตัวเลือกช่วงวันที่ ("ตั้งแต่" – "ถึง" + ช่วงสำเร็จรูป) เขียน start/end ลง URL และล้าง page ต้องอยู่ใต้ <Suspense> */
export function DateRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { start, end } = useDateRange();
  const today = todayIso();
  const options = presets(today);
  const current = options.find((p) => p.start === start && p.end === end)?.id ?? "";

  function apply(nextStart: string, nextEnd: string, keep: "start" | "end" = "start") {
    const r = clampRange(nextStart, nextEnd, keep, today);
    if (r.start === start && r.end === end) return;
    const next = new URLSearchParams(sp.toString());
    next.set("start", r.start);
    next.set("end", r.end);
    next.delete("page");
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
      <select
        aria-label="ช่วงวันที่สำเร็จรูป"
        value={current}
        onChange={(e) => {
          const p = options.find((o) => o.id === e.target.value);
          if (p) apply(p.start, p.end);
        }}
        className="h-9 rounded-md border border-line bg-surface px-2 text-foreground outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        {/* แสดงเฉพาะตอนช่วงไม่ตรงกับ preset ใด ("วันนี้" จึงเป็นตัวเลือกแรกเสมอ) */}
        {!current && (
          <option value="" disabled>
            กำหนดเอง
          </option>
        )}
      </select>
      <ThaiDatePicker label="ตั้งแต่" stepper={false} value={start} onChange={(v) => apply(v, end, "start")} />
      <ThaiDatePicker label="ถึง" stepper={false} value={end} onChange={(v) => apply(start, v, "end")} />
    </div>
  );
}
