// สถานที่เรียกเก็บ (/fund/ar-collect) แบบ pure: รวมยอดกลุ่มเรียกเก็บ OP/IP และนับรายที่ "เรียกเก็บ" แล้วตาม send_mode
// ไม่มี import ค่า จึงใช้ได้ทั้ง route, หน้า (client) และ collect.test.mjs
import type { GridPage } from "@/lib/grid-query";

/** ช่วงวันที่หนี้ (ar_ledger.ref_date) ยาวสุด */
export const MAX_DAYS = 31;

export type PatientType = "OP" | "IP";
/** ar_collect_group.send_mode */
export type SendMode = "book" | "claim" | "auto" | "none";
/** สถานะเคลมที่นับว่าเรียกเก็บแล้ว = "ส่งออกแล้ว" ขึ้นไป (CLAIM_STATUSES ถึง exported ของ claim-batch/claim.ts ซึ่ง test ตรวจว่าตรงกัน) */
export const SENT_STATUSES = ["paid", "rep_pass", "rep_c", "rep_deny", "nhso", "submitted", "exported"];

export type Amounts = { cost: number; debt: number; diff: number; received: number; balance: number };
const AMOUNT_KEYS = ["cost", "debt", "diff", "received", "balance"] as const;
/** ต่อ OP/IP: visits = จำนวน vn/an, sent = เรียกเก็บแล้ว (null = นับไม่ได้), closed = รับเงินครบ (คงเหลือ ≤ 0) */
export type Counts = { visits: number; sent: number | null; closed: number };

/** แถวตารางกลุ่ม ; grp = null คือบัญชีที่ยังไม่กำหนดกลุ่ม */
export type GroupRow = Amounts & { grp: number | null; name: string | null; send_mode: SendMode | null; OP: Counts; IP: Counts };
export type ArCollectSummary = { rows: GroupRow[]; totals: Omit<GroupRow, "grp" | "name" | "send_mode">; claim_error: boolean };

/** แถวตารางขวา (hospmain × กองทุน) ; hospmain/fund = null คือไม่ระบุ */
export type HospRow = Amounts & Counts & { hospmain: string | null; hosp_name: string | null; fund: string | null };
export type ArCollectGroup = { grp: number; OP: HospRow[]; IP: HospRow[]; claim_error: boolean };

/** แถวรายหนี้ของ modal */
export type DebtRow = Amounts & {
  ref: string;
  vn: string | null;
  an: string | null;
  hn: string | null;
  patient_name: string | null;
  ref_date: string;
  pttype: string | null;
  pttype_name: string | null;
  settle_date: string | null;
  settle_source: string | null;
  settle_ref: string | null;
};
export type DebtPage = GridPage<DebtRow>;

/** ที่มาของรับเงินล่าสุด (ar_ledger.source ของแถว settle) */
export const SOURCE_LABEL: Record<string, string> = { stm: "STM", manual: "บันทึกรับเงิน", fwf: "เงินรับล่วงหน้า", capitation: "เหมาจ่าย" };

export type Num = string | number | null;
const n = (v: Num) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
export const amountsOf = (r: Record<(typeof AMOUNT_KEYS)[number], Num>): Amounts =>
  Object.fromEntries(AMOUNT_KEYS.map((k) => [k, r2(n(r[k]))])) as Amounts;

/** เรียกเก็บแล้ว: auto = ทุกราย, claim = ตามสถานะเคลม (ไม่มีผล = null), book/none = 0 จนกว่าจะมีบันทึกส่งหนังสือ */
export function sentOf(mode: SendMode | null, visits: number, claimSent: number | null | undefined): number | null {
  if (mode === "auto") return visits;
  if (mode === "claim") return claimSent ?? null;
  return 0;
}

/** key ของการนับ: `${type}` (ทั้งกลุ่ม) และ `${type}|${hospmain}|${fund}` (แถวตารางขวา) */
export const hospKey = (type: PatientType, hospmain: string | null, fund: string | null) => `${type}|${hospmain ?? ""}|${fund ?? ""}`;

/** นับ vn/an ที่ไม่ซ้ำซึ่งสถานะเคลมอยู่ใน SENT_STATUSES ; status(type, k) = สถานะเคลมของ key */
export function countSent(
  keys: { patient_type: PatientType; k: string; hospmain: string | null; hipdata_code: string | null }[],
  status: (type: PatientType, k: string) => string | undefined,
): Map<string, number> {
  const seen = new Set<string>();
  const out = new Map<string, number>();
  const add = (key: string) => out.set(key, (out.get(key) ?? 0) + 1);
  for (const r of keys) {
    const id = `${r.patient_type}|${r.k}|${r.hospmain ?? ""}|${r.hipdata_code ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = status(r.patient_type, r.k);
    if (!s || !SENT_STATUSES.includes(s)) continue;
    add(hospKey(r.patient_type, r.hospmain, r.hipdata_code));
    // ทั้งกลุ่มนับ key ละครั้ง แม้ key เดียวมีหลาย hospmain/กองทุน
    if (!seen.has(`${r.patient_type}|${r.k}`)) {
      seen.add(`${r.patient_type}|${r.k}`);
      add(r.patient_type);
    }
  }
  return out;
}

export type GroupSqlRow = Record<(typeof AMOUNT_KEYS)[number], Num> & {
  grp: number | null;
  name: string | null;
  send_mode: SendMode | null;
  patient_type: PatientType;
  visits: Num;
  closed: Num;
};

const zeroCounts = (): Counts => ({ visits: 0, sent: 0, closed: 0 });
const zeroAmounts = (): Amounts => ({ cost: 0, debt: 0, diff: 0, received: 0, balance: 0 });

/** แถว Q1 (กลุ่ม × OP/IP เรียงตาม sort แล้ว) เป็นแถวละกลุ่ม + แถวรวม ; claimSent = ผลของ countSent ต่อกลุ่ม (ไม่มี = นับไม่ได้) */
export function pivotGroups(rows: GroupSqlRow[], claimSent: Map<number, Map<string, number>>): Omit<ArCollectSummary, "claim_error"> {
  const by = new Map<string, GroupRow>();
  for (const r of rows) {
    const id = String(r.grp);
    let g = by.get(id);
    if (!g) by.set(id, (g = { grp: r.grp, name: r.name, send_mode: r.send_mode, ...zeroAmounts(), OP: zeroCounts(), IP: zeroCounts() }));
    const a = amountsOf(r);
    for (const k of AMOUNT_KEYS) g[k] = r2(g[k] + a[k]);
    const visits = n(r.visits);
    const counted = r.grp == null ? undefined : claimSent.get(r.grp);
    g[r.patient_type] = { visits, closed: n(r.closed), sent: sentOf(r.send_mode, visits, counted && (counted.get(r.patient_type) ?? 0)) };
  }
  const out = [...by.values()];
  const totals = { ...zeroAmounts(), OP: zeroCounts(), IP: zeroCounts() };
  for (const g of out) {
    for (const k of AMOUNT_KEYS) totals[k] = r2(totals[k] + g[k]);
    for (const t of ["OP", "IP"] as const) {
      totals[t].visits += g[t].visits;
      totals[t].closed += g[t].closed;
      totals[t].sent = totals[t].sent == null || g[t].sent == null ? null : totals[t].sent + g[t].sent;
    }
  }
  return { rows: out, totals };
}
