// state ของหน้าแรกใน URL ใช้ร่วมกันทั้ง server และ client (ไม่มี server-only)
import {
  addDaysIso,
  type HipdataOption,
  isIsoDate,
  isPttypeCode,
  MAX_SPAN_DAYS,
  type PttypeOption,
  spanDays,
} from "@/app/api/visit/opd-visit/opd-visit";
import type { MultiSelectGroup } from "@/components/multi-select/multi-select";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** ?from= / ?to= ที่ไม่ใช่วันจริงใช้วันนี้ */
export const pickDate = (v: string | string[] | undefined, today: string) => {
  const s = first(v);
  return isIsoDate(s) ? s : today;
};

/** จำนวนสิทธิสูงสุดใน ?pttype= (pttype ที่ใช้งาน ~160 รหัส) กัน IN list ยาวผิดปกติจาก URL ที่แก้เอง */
export const MAX_PTTYPES = 200;

/** ?pttype=89,77 (หรือส่งซ้ำหลาย param) ตัดค่าที่ไม่ใช่รูปแบบรหัสสิทธิทิ้ง และไม่ซ้ำ */
export function parsePttypes(v: string | string[] | undefined) {
  const raw = (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => s.split(","));
  return [...new Set(raw.map((s) => s.trim()).filter(isPttypeCode))];
}

/** `AND o.pttype IN (?, ?, …)` ตามจำนวนรหัส (ไม่ส่ง list ว่าง: ไม่มีรหัส = ไม่กรอง) */
export const pttypeInSql = (n: number) => (n ? `AND o.pttype IN (${Array(n).fill("?").join(", ")})` : "");

/** ตัวเลือกของ MultiSelect แบ่งตามกลุ่มสิทธิ (hipdata_code) รหัสที่อยู่ใน URL แต่ไม่อยู่ในรายการ (ปิดใช้แล้ว) แยกไว้ท้ายสุดให้ติ๊กออกได้ */
export function pttypeGroups(options: PttypeOption[], groups: HipdataOption[], selected: string[]): MultiSelectGroup[] {
  const known = new Set(options.map((p) => p.code));
  const orphans = selected.filter((c) => !known.has(c)).map((c) => ({ value: c, label: c }));
  return [
    ...groups.map((g) => ({
      value: g.value,
      label: g.label,
      options: options.filter((p) => p.group === g.value).map((p) => ({ value: p.code, label: p.name || p.code, hint: p.code })),
    })),
    { value: "__unlisted", label: "รหัสที่ไม่อยู่ในรายการ", options: orphans },
  ].filter((g) => g.options.length);
}

/** ?tab= (ไม่ส่ง = summary) */
export type HomeTab = "summary" | "trend";
/** ?by= ของแท็บแนวโน้ม (ไม่ส่ง = day) */
export type TrendBy = "day" | "month";
/** ?metric= ของแท็บแนวโน้ม (ไม่ส่ง = income) */
export type TrendMetric = "income" | "visits";

export const TABS: { value: HomeTab; label: string }[] = [
  { value: "summary", label: "สรุปตามสิทธิ" },
  { value: "trend", label: "แนวโน้ม" },
];
export const tabId = (t: HomeTab) => `home-tab-${t}`;
export const panelId = (t: HomeTab) => `home-panel-${t}`;

export const parseTab =(v: string | null | undefined): HomeTab => (v === "trend" ? "trend" : "summary");
export const parseBy = (v: string | null | undefined): TrendBy => (v === "month" ? "month" : "day");
export const parseMetric = (v: string | null | undefined): TrendMetric => (v === "visits" ? "visits" : "income");

/**
 * รายเดือนดูได้ไม่เกิน 6 เดือน: query รวมต่อเดือนบน HIS ใช้เวลาตามจำนวน visit
 * (วัดจริง 6 เดือน ~1.7 วินาที, 12 เดือน ~3.3 วินาที ซึ่งช้าเกินสำหรับหน้าแรก)
 */
export const MAX_SPAN_MONTHS = 6;

const ym = (iso: string) => iso.split("-").map(Number) as [number, number];
/** วันแรกของเดือน YYYY-MM-01 */
export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
/** วันสุดท้ายของเดือน */
export const monthEnd = (iso: string) => {
  const [y, m] = ym(iso);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
/** วันแรกของเดือนที่เลื่อนไป n เดือน */
export const addMonthsIso = (iso: string, n: number) => {
  const [y, m] = ym(iso);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};
/** จำนวนเดือนในช่วง นับรวมทั้งสองฝั่ง */
export const spanMonths = (from: string, to: string) => {
  const [fy, fm] = ym(from);
  const [ty, tm] = ym(to);
  return (ty - fy) * 12 + tm - fm + 1;
};

/** ข้อผิดพลาดของช่วงวันที่ตามมุมมอง ("" = ใช้ได้) ตรวจซ้ำที่ server ทุกครั้ง */
export function rangeError(from: string, to: string, by: TrendBy) {
  if (from > to) return "วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด";
  if (by === "month") return spanMonths(from, to) > MAX_SPAN_MONTHS ? `ช่วงเดือนต้องไม่เกิน ${MAX_SPAN_MONTHS} เดือน` : "";
  return spanDays(from, to) > MAX_SPAN_DAYS ? `ช่วงวันที่ต้องไม่เกิน ${MAX_SPAN_DAYS} วัน` : "";
}

/** ช่วงรายวัน (ตารางสรุปและกราฟรายวัน) จากช่วงใดๆ: เก็บวันสิ้นสุด ตัดวันเริ่มให้ไม่เกิน MAX_SPAN_DAYS */
export function toDayRange(from: string, to: string) {
  const earliest = addDaysIso(to, -(MAX_SPAN_DAYS - 1));
  return { from: from < earliest ? earliest : from, to };
}

/**
 * ช่วงรายเดือนเมื่อสลับจากรายวัน: ช่วงรายวันยาวสุด 31 วัน ได้แค่ 1-2 แท่ง ไม่เห็นแนวโน้ม
 * จึงขยายเป็น MAX_SPAN_MONTHS เดือนที่จบที่เดือนของวันสิ้นสุด
 */
export function toMonthRange(to: string) {
  return { from: addMonthsIso(to, -(MAX_SPAN_MONTHS - 1)), to };
}

const DEFAULTS: Record<string, string> = { tab: "summary", by: "day", metric: "income" };

/**
 * query string ใหม่จาก params ปัจจุบัน + patch (null = ลบ) ค่า default และ from/to ที่เป็นวันนี้ไม่ใส่ใน URL
 * pttype เป็นรหัส [0-9A-Za-z] คั่นด้วยจุลภาค จึงคืน "," ให้อ่านง่ายแทน %2C
 */
export function homeQuery(current: URLSearchParams, patch: Record<string, string | null>, today: string) {
  const sp = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "" || DEFAULTS[k] === v || ((k === "from" || k === "to") && v === today)) sp.delete(k);
    else sp.set(k, v);
  }
  const qs = sp.toString().replace(/%2C/g, ",");
  return qs ? `?${qs}` : "";
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", ...opts });
const dayShort = fmt({ day: "numeric", month: "short" });
const dayLong = fmt({ day: "numeric", month: "short", year: "numeric" });
const monthShort = fmt({ month: "short", year: "2-digit" });
const monthLong = fmt({ month: "long", year: "numeric" });
const monthOption = fmt({ month: "short", year: "numeric" });
const date = (iso: string) => new Date(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`);

/** ป้ายแกน x: "4 พ.ย." หรือ "พ.ย. 69" (พ.ศ.) */
export const bucketLabel = (key: string, by: TrendBy) => (by === "month" ? monthShort : dayShort).format(date(key));
/** หัว tooltip/ตาราง: "4 พ.ย. 2569" หรือ "พฤศจิกายน 2569" */
export const bucketTitle = (key: string, by: TrendBy) => (by === "month" ? monthLong : dayLong).format(date(key));
/** ตัวเลือกเดือน: "พ.ย. 2569" */
export const monthOptionLabel = (iso: string) => monthOption.format(date(iso));
