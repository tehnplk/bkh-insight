import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { LEDGER_START } from "../../ar-sync/ledger";
import { locked } from "../../ar-sync/sync";
import {
  BATCHES_SQL, BATCH_COUNTS_SQL, BATCH_INSERT_SQL, ENTRY_INSERT_SQL, attachPatients, fail, loadDebts, loadNames, loadPool, sessionUser, type FwfBatch,
} from "../data";
import { cents, monthEnd, monthOf, planMonthEnd, validMonth, type MonthEndPlan, type PlanDebt, type PlanRow } from "../fwf";

/** response ของ GET ?month= : แผนตัดหนี้ ณ สิ้นเดือน (เดือนนี้ = ถึงวันนี้) ; can_confirm เฉพาะเดือนที่จบแล้วและไม่มีเหตุห้าม */
export type MonthEndPreview = Omit<MonthEndPlan, "entries" | "rows"> & {
  month: string; rows: (PlanRow & { name: string | null })[]; can_confirm: boolean; ended: boolean; unset_cards: number; batches: FwfBatch[];
};
export type MonthEndResult = { batch_id: string; settle: number; diff: number; settle_amount: number; diff_amount: number; check: number; shifted: number };

class MonthEndError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** สิ้นเดือน (ไม่เกินวันนี้) ; ตัดได้ตั้งแต่เดือนเริ่มสมุดลูกหนี้ */
function parseMonth(raw: unknown, today: string) {
  if (!validMonth(raw, today, LEDGER_START)) return null;
  const end = monthEnd(raw);
  return { month: raw, end: end < today ? end : today, ended: raw < monthOf(today) };
}

async function plan(q: Parameters<typeof loadDebts>[0], end: string, patients: Map<string, PlanDebt>) {
  const [debts, pool] = await Promise.all([loadDebts(q, end), loadPool(q, end)]);
  // หนี้ที่ไม่ได้อ่าน HOSxP ก่อนถือ lock (เพิ่งตั้งระหว่างนั้น) = ต้องตรวจ รอบหน้าจะตัดได้
  const full = debts.map((d) => patients.get(`${d.patient_type}:${d.ref}`) ?? { ...d, hn: null, service_date: null, missing_reason: "เพิ่งตั้งหนี้ระหว่างคำนวณ กดใหม่อีกครั้ง" });
  return { pool, result: planMonthEnd(full, pool.cards, pool.balance, end) };
}
const keyed = (ds: PlanDebt[]) => new Map(ds.map((d) => [`${d.patient_type}:${d.ref}`, d]));

export async function GET(request: NextRequest) {
  if (!(await sessionUser())) return fail("unauthorized", 401);
  const today = todayIso();
  const m = parseMonth(request.nextUrl.searchParams.get("month") ?? "", today);
  if (!m) return fail("month ต้องเป็น YYYY-MM ตั้งแต่ ต.ค. 2568 ถึงเดือนปัจจุบัน");
  const patients = keyed(await attachPatients(await loadDebts(insightQuery, m.end)));
  const [{ pool, result }, batches] = await Promise.all([plan(insightQuery, m.end, patients), insightQuery<FwfBatch>(BATCHES_SQL)]);
  const names = await loadNames(result.rows.flatMap((r) => (r.hn ? [r.hn] : [])));
  const { entries, rows, ...rest } = result;
  void entries;
  const body: MonthEndPreview = {
    ...rest, month: m.month, ended: m.ended, unset_cards: pool.unset, batches,
    rows: rows.map((r) => ({ ...r, name: r.hn ? (names.get(r.hn) ?? null) : null })),
    can_confirm: m.ended && !result.blocked.length && result.entries.length > 0,
  };
  return Response.json(body);
}

/**
 * POST { month } ยืนยันตัดหนี้สิ้นเดือน: อ่าน HOSxP ก่อนถือ lock แล้วคำนวณแผนใหม่ภายใต้ lock ของ ar_ledger (ไม่เชื่อยอดจาก client)
 * ลงชุดใน fwf_settle_batch และแถว source fwf ลงวันสิ้นเดือน (งวดปิดแล้ว trigger เลื่อนเข้างวดเปิด)
 */
export async function POST(request: Request) {
  const user = await sessionUser();
  if (!user) return fail("unauthorized", 401);
  const today = todayIso();
  const m = parseMonth(((await request.json().catch(() => null)) ?? {}).month, today);
  if (!m) return fail("month ต้องเป็น YYYY-MM ตั้งแต่ ต.ค. 2568 ถึงเดือนปัจจุบัน");
  if (!m.ended) return fail("ยืนยันได้เมื่อจบเดือนแล้ว");
  const patients = keyed(await attachPatients(await loadDebts(insightQuery, m.end)));
  try {
    const result = await locked(async (tx): Promise<MonthEndResult> => {
      const { result: p } = await plan(tx, m.end, patients);
      if (p.blocked.length) throw new MonthEndError(p.blocked.join(" "), 409);
      if (!p.entries.length) throw new MonthEndError("ไม่มีหนี้ที่ตัดได้ในเดือนนี้ (ตัดไปแล้ว หรือทุกรายต้องตรวจ)", 409);
      const [{ id }] = await tx<{ id: string }>(BATCH_INSERT_SQL, [`${m.month}-01`, user.name, user.userId]);
      const rows = await tx<{ kind: "settle" | "diff"; amount: string; shifted: boolean }>(ENTRY_INSERT_SQL, [JSON.stringify(p.entries), id]);
      if (rows.length !== p.entries.length) throw new MonthEndError("รายการถูกตัดไปแล้ว กดดูตัวอย่างใหม่", 409);
      const sum = (k: "settle" | "diff") => -rows.filter((r) => r.kind === k).reduce((s, r) => s + cents(r.amount), 0) / 100;
      const counts = {
        settle: rows.filter((r) => r.kind === "settle").length, diff: rows.filter((r) => r.kind === "diff").length,
        settle_amount: sum("settle"), diff_amount: sum("diff"), check: p.totals.check_n, shifted: rows.filter((r) => r.shifted).length,
      };
      await tx(BATCH_COUNTS_SQL, [id, JSON.stringify(counts)]);
      return { batch_id: id, ...counts };
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof MonthEndError) return fail(e.message, e.status);
    throw e;
  }
}
