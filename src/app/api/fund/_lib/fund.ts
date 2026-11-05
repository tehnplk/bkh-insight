import "server-only";
import { auth } from "@/auth";
import { hisQuery } from "@/lib/db";
import type { CategoryAmount, FundCode } from "../types";

// กองทุน = pttype.hipdata_code (ว่าง/NULL = UNKNOWN)
// มูลค่า = opitemrece.sum_price ของรายการ OPD: แถว IPD ใน opitemrece มี an และ vn เป็น NULL เสมอ จึงกรองด้วย vn IS NOT NULL
// กองทุนของมูลค่าอิง opitemrece.pttype (สิทธิที่เรียกเก็บรายการนั้นจริง) ส่วนจำนวน visit/คนอิง ovst.pttype (สิทธิหลักของ visit)

export const UNKNOWN_FUND = "UNKNOWN";
export const UNKNOWN_NAME = "ไม่ระบุ";
// ต้องตรงกับ MAX_RANGE_DAYS ใน DateRangeFilter (import จากไฟล์ "use client" ไม่ได้ เพราะฝั่ง server จะได้ client reference ไม่ใช่ตัวเลข)
const MAX_RANGE_DAYS = 31;
export const DAY_MS = 86_400_000;

/** SQL ของรหัสกองทุนจาก alias ของตาราง pttype */
export const fundSql = (t: string) => `COALESCE(NULLIF(TRIM(${t}.hipdata_code), ''), '${UNKNOWN_FUND}')`;
/** SQL ของรหัสแผนกหลักของ visit จาก alias ของ ovst (ว่าง/NULL = UNKNOWN) */
export const depSql = (v: string) => `COALESCE(NULLIF(TRIM(${v}.main_dep), ''), '${UNKNOWN_FUND}')`;
/** SQL ของชื่อแผนก ต้อง LEFT JOIN kskdepartment k ON k.depcode = <ovst>.main_dep */
export const depNameSql = (v: string) => `IF(${depSql(v)} = '${UNKNOWN_FUND}', '${UNKNOWN_NAME}', IFNULL(k.department, ${v}.main_dep))`;
export const FULL_NAME_SQL = "CONCAT_WS(' ', CONCAT(IFNULL(p.pname,''), p.fname), p.lname)";
export const ITEM_NAME_SQL = "CONCAT_WS(' ', s.name, NULLIF(TRIM(s.strength), ''))";

export const round2 = (n: number | string | null) => Math.round(Number(n ?? 0) * 100) / 100;
export const int = (n: number | string | null) => Math.trunc(Number(n ?? 0));

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });
export const badRequest = (error: string) => Response.json({ error }, { status: 400 });
export const isAuthed = async () => Boolean(await auth());

function toUtc(raw: string | null): number | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? t : null;
}

export const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10);

export type DateRange = { start: string; end: string; startMs: number; endMs: number; days: number };

/** start/end แบบ YYYY-MM-DD ที่เป็นวันจริง start <= end และยาวไม่เกิน MAX_RANGE_DAYS (31) วัน (นับรวมวันแรกและวันสุดท้าย) */
export function parseRange(params: URLSearchParams): { ok: true; range: DateRange } | { ok: false; error: string } {
  const startMs = toUtc(params.get("start"));
  const endMs = toUtc(params.get("end"));
  if (startMs === null || endMs === null) return { ok: false, error: "start และ end ต้องเป็นวันที่รูปแบบ YYYY-MM-DD" };
  if (startMs > endMs) return { ok: false, error: "start ต้องไม่เกิน end" };
  const days = (endMs - startMs) / DAY_MS + 1;
  if (days > MAX_RANGE_DAYS) return { ok: false, error: `ช่วงวันที่ยาวได้ไม่เกิน ${MAX_RANGE_DAYS} วัน` };
  return { ok: true, range: { start: isoDate(startMs), end: isoDate(endMs), startMs, endMs, days } };
}

/** ช่วงยาวเท่ากันที่อยู่ก่อน start ทันที */
export function previousRange(r: DateRange): { start: string; end: string } {
  return { start: isoDate(r.startMs - r.days * DAY_MS), end: isoDate(r.startMs - DAY_MS) };
}

export type Lookups = {
  pttype: Map<string, { name: string; fund: FundCode }>;
  income: Map<string, string>;
  fundName: (code: FundCode) => string;
};

// ตารางอ้างอิงเล็ก (pttype ~170, income ~20, nhso_inscl_code ~20 แถว) จึงดึงทั้งตารางแล้ว map ในโค้ด
// ชื่อกองทุนจาก nhso_inscl_code ถ้าไม่มี (เช่น NRH, PVT) ใช้รหัสแทน
export async function loadLookups(): Promise<Lookups> {
  const [pt, inc, funds] = await Promise.all([
    hisQuery<{ pttype: string; name: string | null; fund: string }>(
      `SELECT t.pttype, t.name, ${fundSql("t")} AS fund FROM pttype t`,
    ),
    hisQuery<{ income: string; name: string | null }>("SELECT income, name FROM income"),
    hisQuery<{ code: string; name: string | null }>("SELECT inscl_code AS code, inscl_name AS name FROM nhso_inscl_code"),
  ]);
  const names = new Map(funds.map((f) => [f.code, f.name ?? f.code]));
  return {
    pttype: new Map(pt.map((p) => [p.pttype, { name: p.name ?? p.pttype, fund: p.fund }])),
    income: new Map(inc.map((i) => [i.income, i.name ?? i.income])),
    fundName: (code) => (code === UNKNOWN_FUND ? UNKNOWN_NAME : (names.get(code) ?? code)),
  };
}

export const fundOf = (lk: Lookups, pttype: string | null) => (pttype && lk.pttype.get(pttype)?.fund) || UNKNOWN_FUND;
export const pttypeName = (lk: Lookups, pttype: string | null) => (pttype ? (lk.pttype.get(pttype)?.name ?? pttype) : "");

/** รวมยอดตามหมวด (income) แล้วเรียงมากไปน้อย */
export function categoryList(lk: Lookups, amounts: Map<string, number>): CategoryAmount[] {
  return [...amounts]
    .map(([income_code, amount]) => ({ income_code, income_name: lk.income.get(income_code) ?? income_code, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

export const add = <K>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v);

// opitemrece เป็น MyISAM: SELECT ที่นานจะถือ table lock ทำให้ HOSxP เขียนรายการค่าใช้จ่ายไม่ได้ระหว่างนั้น
// จึงบังคับใช้ ix_vstdate กับคิวรีตามช่วงวันที่ทุกตัว (optimizer เคยเลือก ix_pttype แล้วสแกนทั้งประวัติ)
export const OPI_BY_DATE = "opitemrece o FORCE INDEX (ix_vstdate)";

/** เงื่อนไข o.pttype ของกองทุน (ห้ามส่ง list ว่างเข้า IN) UNKNOWN = pttype ที่ไม่อยู่ในกองทุนใดเลย */
export function fundPttypeFilter(lk: Lookups, fund: FundCode): { sql: string; params: string[] } {
  const unknown = fund === UNKNOWN_FUND;
  const codes = [...lk.pttype].filter(([, p]) => (unknown ? p.fund !== UNKNOWN_FUND : p.fund === fund)).map(([c]) => c);
  if (!codes.length) return { sql: unknown ? "1 = 1" : "1 = 0", params: [] };
  const list = codes.map(() => "?").join(", ");
  // NOT IN ไม่จับ NULL จึงต้องรวม pttype ว่างเข้า UNKNOWN เอง (ovst.pttype เป็น NULL ได้)
  return { sql: unknown ? `(o.pttype IS NULL OR o.pttype NOT IN (${list}))` : `o.pttype IN (${list})`, params: codes };
}
