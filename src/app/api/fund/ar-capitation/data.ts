import "server-only";
import type { InsightTx } from "@/lib/db";
import { LEDGER_START } from "../ar-sync/ledger";
import { FWF_ACCOUNTS, monthEnd, monthOf, validMonth } from "../fwf-card/fwf";
import { fyStartOf, planCapitation, poolAvailable, type CapDebt, type CapPlan } from "./capitation";

/** month YYYY-MM ตั้งแต่เดือนเริ่มสมุดลูกหนี้ถึงเดือนนี้ ; end = สิ้นเดือน (เดือนนี้ = ถึงวันนี้) */
export function parseMonth(raw: unknown, today: string) {
  if (!validMonth(raw, today, LEDGER_START)) return null;
  const end = monthEnd(raw);
  return { month: raw, end: end < today ? end : today, ended: raw < monthOf(today) };
}
export const MONTH_ERROR = "month ต้องเป็น YYYY-MM ตั้งแต่ ต.ค. 2568 ถึงเดือนปัจจุบัน";

/** ก่อนรัน migration 202611252000_ar_capitation.sql (ตาราง/คอลัมน์ยังไม่มี) ตอบ 503 แทน 500 */
export function notMigrated(e: unknown) {
  const code = (e as { code?: string }).code;
  if (code !== "42P01" && code !== "42703") throw e;
  return Response.json({ error: "ยังไม่ได้รัน migration ตัดหนี้เหมาจ่าย (202611252000_ar_capitation.sql)" }, { status: 503 });
}

// SQL ของ insight ; ค่าทุกตัวเป็น bind parameter
// บัญชีที่ตัดด้วยเหมาจ่าย = มี clear_code ; .501/.502 ตัดด้วยเงินรับล่วงหน้าบัตรต่างด้าว (/fund/fwf-card) ไม่แตะที่นี่แม้มีคนตั้ง clear_code
const ACCOUNTS_SQL = `SELECT code, name, clear_code, clear_short_code FROM ar_account
WHERE clear_code IS NOT NULL AND NOT (code = ANY($1::text[])) ORDER BY code`;
// หนี้ของบัญชีที่คงเหลือ > 0 ตั้งหนี้ $2..$3 ; คงเหลือ = HOSxP + stm + manual + fwf + capitation ของหนี้เดียวกัน
const DEBTS_SQL = `SELECT s.ref, s.vn, s.an, s.patient_type, s.ref_date::text AS ref_date, s.pttype, s.hipdata_code, s.hospmain, s.hospmain_chwpart,
  s.hospmain_type, s.account_code, b.balance
FROM ar_ledger s
CROSS JOIN LATERAL (SELECT SUM(x.amount) AS balance FROM ar_ledger x
  WHERE x.patient_type = s.patient_type AND x.ref = s.ref AND x.source IN (s.source, 'stm', 'manual', 'fwf', 'capitation')) b
WHERE s.kind = 'set' AND s.source IN ('rcpt_debt', 'ipt') AND s.account_code = $1 AND s.ref_date BETWEEN $2::date AND $3::date AND b.balance > 0
ORDER BY s.ref_date, s.ref`;
// pool ของบัญชีรายได้ $1: รับโอน (ไม่ยกเลิก) ต้นปีงบ $2 ถึงสิ้นเดือน $3 ; ใช้แล้ว = settle ของทุกชุดในปีงบที่ตัดกับบัญชีนี้
const POOL_SQL = `SELECT
  (SELECT COALESCE(SUM(amount), 0) FROM ar_transfer WHERE cancelled_at IS NULL AND account_code = $1 AND transfer_date BETWEEN $2::date AND $3::date) AS received,
  (SELECT COALESCE(-SUM(l.amount), 0) FROM ar_capitation_batch b JOIN ar_ledger l ON l.capitation_batch_id = b.id
    WHERE l.kind = 'settle' AND b.clear_code = $1 AND b.month >= $2::date AND b.month < $2::date + interval '1 year') AS used`;

export const BATCH_INSERT_SQL = `INSERT INTO ar_capitation_batch (month, account_code, clear_code, clear_short_code, pool_before, pool_after, counts, created_by, created_user_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text AS id`;
export const BATCH_COUNTS_SQL = "UPDATE ar_capitation_batch SET counts = $2 WHERE id = $1";
const COLS = "source, kind, ref, vn, an, patient_type, ref_date, entry_date, pttype, hipdata_code, hospmain, hospmain_chwpart, hospmain_type, account_code, amount, note";
// trigger ar_ledger_period_guard เลื่อนวันที่ตกงวดปิดก่อน RETURNING (route ไม่ยืนยันเดือนที่ปิดแล้วอยู่ดี)
export const ENTRY_INSERT_SQL = `INSERT INTO ar_ledger (${COLS}, capitation_batch_id)
SELECT ${COLS}, $2 FROM jsonb_to_recordset($1::jsonb) AS x(source text, kind text, ref text, vn varchar, an varchar, patient_type text,
  ref_date date, entry_date date, pttype text, hipdata_code text, hospmain text, hospmain_chwpart text, hospmain_type text, account_code text, amount numeric, note text)
ON CONFLICT (capitation_batch_id, patient_type, ref, kind) WHERE capitation_batch_id IS NOT NULL DO NOTHING
RETURNING kind, amount, orig_entry_date IS NOT NULL AS shifted`;
export const BATCHES_SQL = `SELECT id::text AS id, to_char(month, 'YYYY-MM') AS month, account_code, clear_code, clear_short_code, pool_before, pool_after, counts,
  created_by, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
FROM ar_capitation_batch ORDER BY id DESC LIMIT 24`;

export type CapAccount = { code: string; name: string; clear_code: string; clear_short_code: string | null };
export type CapBatch = {
  id: string; month: string; account_code: string; clear_code: string; clear_short_code: string; pool_before: string; pool_after: string;
  counts: Record<string, number>; created_by: string; created_at: string;
};
export type AccountPlan = { account: CapAccount; received: number; used: number; plan: CapPlan };

export const loadAccounts = (q: InsightTx) => q<CapAccount>(ACCOUNTS_SQL, [[FWF_ACCOUNTS.OP, FWF_ACCOUNTS.IP]]);

/** แผนตัดหนี้ของบัญชี ณ สิ้นเดือน end (YYYY-MM-DD ของเดือน month) */
export async function planAccount(q: InsightTx, account: CapAccount, month: string, end: string): Promise<AccountPlan> {
  const from = fyStartOf(month);
  const [debts, [pool]] = await Promise.all([
    q<CapDebt>(DEBTS_SQL, [account.code, from, end]),
    q<{ received: string; used: string }>(POOL_SQL, [account.clear_code, from, end]),
  ]);
  return { account, received: Number(pool.received), used: Number(pool.used), plan: planCapitation(debts, poolAvailable(pool.received, pool.used), from, end) };
}
