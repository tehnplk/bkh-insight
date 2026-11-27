import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { locked } from "../ar-sync/sync";
import { closedThrough } from "../ar-trial-balance/trial-balance";
import { fail, sessionUser } from "../fwf-card/data";
import { capBlock, fyStartOf, type CapTotals } from "./capitation";
import {
  BATCHES_SQL, BATCH_COUNTS_SQL, BATCH_INSERT_SQL, ENTRY_INSERT_SQL, MONTH_ERROR, loadAccounts, notMigrated, parseMonth, planAccount,
  type AccountPlan, type CapBatch,
} from "./data";

/** ต่อบัญชีลูกหนี้: pool_before = pool ที่ใช้ตัดได้ (รับโอน − ใช้แล้วในปีงบ) ; blocked = เหตุที่ยืนยันบัญชีนี้ไม่ได้ */
export type CapAccountPreview = {
  code: string; name: string; clear_code: string; clear_short_code: string | null;
  pool_received: number; pool_used: number; pool_before: number; pool_after: number; totals: CapTotals; blocked: string | null; can_confirm: boolean;
  /** เงินโอนเข้า clear_code ที่โอนถึงสิ้นเดือนแต่ยังรอออกใบเสร็จ (ยังไม่นับใน pool) มี = ยืนยันไม่ได้ */
  pending: number; pending_n: number;
};
/** response ของ GET ?month= : แผนตัดหนี้ ณ สิ้นเดือน (เดือนนี้ = ถึงวันนี้) และชุดที่ตัดแล้วล่าสุด */
export type CapPreview = {
  month: string; month_end: string; fy_start: string; ended: boolean; closed_through: string | null; accounts: CapAccountPreview[]; batches: CapBatch[];
};
export type CapResult = { batch_id: string; settle_n: number; diff_n: number; settle_amount: number; diff_amount: number; shifted: number };

class CapError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const blockOf = (p: AccountPlan, ended: boolean, month: string, through: string | null) =>
  capBlock({ ended, month, through, ...p.account, pending_n: p.pending_n, entries: p.plan.entries.length });

export async function GET(request: NextRequest) {
  if (!(await sessionUser())) return fail("unauthorized", 401);
  const m = parseMonth(request.nextUrl.searchParams.get("month") ?? "", todayIso());
  if (!m) return fail(MONTH_ERROR);
  try {
    const [accounts, batches, through] = await Promise.all([loadAccounts(insightQuery), insightQuery<CapBatch>(BATCHES_SQL), closedThrough(insightQuery)]);
    const plans = await Promise.all(accounts.map((a) => planAccount(insightQuery, a, m.month, m.end)));
    const body: CapPreview = {
      month: m.month, month_end: m.end, fy_start: fyStartOf(m.month), ended: m.ended, closed_through: through, batches,
      accounts: plans.map((p) => {
        const blocked = blockOf(p, m.ended, m.month, through);
        return {
          ...p.account, pool_received: p.received, pool_used: p.used, pool_before: p.plan.pool_before, pool_after: p.plan.pool_after,
          totals: p.plan.totals, blocked, can_confirm: !blocked, pending: p.pending, pending_n: p.pending_n,
        };
      }),
    };
    return Response.json(body);
  } catch (e) {
    return notMigrated(e);
  }
}

/**
 * POST { month, account } ยืนยันตัดหนี้สิ้นเดือนของบัญชีลูกหนี้หนึ่งบัญชี: คำนวณแผนใหม่ภายใต้ lock ของ ar_ledger (ไม่เชื่อยอดจาก client)
 * ลงชุดใน ar_capitation_batch และแถว source capitation ลงวันสิ้นเดือน (เดือนที่รายได้/ส่วนต่างเกิด เหมือนตัดหนี้สิ้นเดือนของบัตรต่างด้าว)
 */
export async function POST(request: Request) {
  const user = await sessionUser();
  if (!user) return fail("unauthorized", 401);
  const b = ((await request.json().catch(() => null)) ?? {}) as { month?: unknown; account?: unknown };
  const m = parseMonth(b.month, todayIso());
  if (!m) return fail(MONTH_ERROR);
  try {
    const result = await locked(async (tx): Promise<CapResult> => {
      const account = (await loadAccounts(tx)).find((a) => a.code === b.account);
      if (!account) throw new CapError("บัญชีนี้ไม่ได้ตัดด้วยเงินเหมาจ่าย", 400);
      const p = await planAccount(tx, account, m.month, m.end);
      const blocked = blockOf(p, m.ended, m.month, await closedThrough(tx));
      if (blocked) throw new CapError(blocked, 409);
      const { plan } = p;
      const counts = { n: plan.totals.n, settle_n: plan.totals.settle_n, diff_n: plan.totals.diff_n, settle_amount: plan.totals.settle, diff_amount: plan.totals.diff };
      const [{ id }] = await tx<{ id: string }>(BATCH_INSERT_SQL, [
        `${m.month}-01`, account.code, account.clear_code, account.clear_short_code, plan.pool_before, plan.pool_after, JSON.stringify(counts), user.name, user.userId,
      ]);
      const rows = await tx<{ shifted: boolean }>(ENTRY_INSERT_SQL, [JSON.stringify(plan.entries), id]);
      if (rows.length !== plan.entries.length) throw new CapError("รายการถูกตัดไปแล้ว กดดูตัวอย่างใหม่", 409);
      const shifted = rows.filter((r) => r.shifted).length;
      await tx(BATCH_COUNTS_SQL, [id, JSON.stringify({ ...counts, shifted })]);
      return { batch_id: id, settle_n: counts.settle_n, diff_n: counts.diff_n, settle_amount: counts.settle_amount, diff_amount: counts.diff_amount, shifted };
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof CapError) return fail(e.message, e.status);
    return notMigrated(e);
  }
}
