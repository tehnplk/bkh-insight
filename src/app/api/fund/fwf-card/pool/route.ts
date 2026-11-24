import { insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { CARDS_SQL, attachPatients, fail, loadDebts, loadNames, loadPool, sessionUser, type CardRow } from "../data";
import { cardBalance, cents, planMonthEnd, type PlanRow } from "../fwf";

export type PoolCard = Pick<CardRow, "id" | "hn" | "type_label" | "sale_date" | "valid_from" | "valid_to" | "pool_amount"> & { name: string | null; usage: number; released: number; remaining: number };
export type Holder = { hn: string; name: string | null; cards: number; pool: number; usage: number; released: number; remaining: number; loss: number; unset: number };
/** response ของ GET /api/fund/fwf-card/pool */
export type PoolData = {
  today: string;
  /** pool_in = บัตรที่ขายถึงวันนี้, settled = ตัดหนี้แล้ว, released = โอนไปเงินบำรุง, lost = ส่วนต่างที่ pool ไม่พอ, unset = บัตรที่ชนิดยังไม่กำหนดยอด */
  summary: { pool_in: number; settled: number; released: number; balance: number; lost: number; unset: number; cards: number };
  /** บัตรที่หมดอายุแล้วและยังมีเงินคงเหลือ (การเงินบันทึกโอนไปเงินบำรุงเอง) */
  expired: PoolCard[];
  /** ผู้ถือบัตรที่มีการใช้สิทธิ (ตัดหนี้แล้ว) */
  holders: Holder[];
  /** หนี้ .501/.502 ที่ยังไม่ตัดได้เพราะไม่มีบัตรที่ใช้ได้หรือหา HN ไม่พบ (ณ วันนี้) */
  check: (PlanRow & { name: string | null })[];
};

export async function GET() {
  if (!(await sessionUser())) return fail("unauthorized", 401);
  const today = todayIso();
  const [pool, cards, debts] = await Promise.all([loadPool(insightQuery, today), insightQuery<CardRow>(CARDS_SQL.all), loadDebts(insightQuery, today)]);
  const plan = planMonthEnd(await attachPatients(debts), pool.cards, pool.balance, today);
  const check = plan.rows.filter((r) => r.status === "check");

  const active = cards.filter((c) => c.status === "active");
  const expired = active
    .map((c) => ({ c, ...cardBalance(c.pool_amount, c.usage, c.released) }))
    .filter((x) => x.c.valid_to < today && x.remaining != null && x.remaining > 0);
  const byHn = new Map<string, Holder>();
  for (const c of active) {
    const h = byHn.get(c.hn) ?? { hn: c.hn, name: null, cards: 0, pool: 0, usage: 0, released: 0, remaining: 0, loss: 0, unset: 0 };
    h.cards++;
    if (c.pool_amount == null) h.unset++;
    h.pool += cents(c.pool_amount);
    h.usage += cents(c.usage);
    h.released += cents(c.released);
    byHn.set(c.hn, h);
  }
  const holders = [...byHn.values()]
    .filter((h) => h.usage > 0)
    .map((h) => ({ ...h, remaining: (h.pool - h.usage - h.released) / 100, loss: Math.max(0, h.usage - h.pool) / 100, pool: h.pool / 100, usage: h.usage / 100, released: h.released / 100 }))
    .sort((a, b) => b.loss - a.loss || b.usage - a.usage);
  const names = await loadNames([...expired.map((x) => x.c.hn), ...holders.map((h) => h.hn), ...check.flatMap((r) => (r.hn ? [r.hn] : []))]);

  const body: PoolData = {
    today,
    summary: { pool_in: pool.pool_in, settled: pool.settled, released: pool.released, balance: pool.balance, lost: pool.lost, unset: pool.unset, cards: active.length },
    expired: expired.map(({ c, remaining }) => ({
      id: c.id, hn: c.hn, name: names.get(c.hn) ?? null, type_label: c.type_label, sale_date: c.sale_date, valid_from: c.valid_from, valid_to: c.valid_to,
      pool_amount: c.pool_amount, usage: Number(c.usage), released: Number(c.released), remaining: remaining ?? 0,
    })),
    holders: holders.map((h) => ({ ...h, name: names.get(h.hn) ?? null })),
    check: check.map((r) => ({ ...r, name: r.hn ? (names.get(r.hn) ?? null) : null })),
  };
  return Response.json(body);
}
