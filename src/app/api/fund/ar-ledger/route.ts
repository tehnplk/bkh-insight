import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { badRequest, isAuthed, round2, unauthorized } from "../_lib/fund";
import { ledgerMonths, monthRange } from "../ar-sync/ledger";
import { LOG_COLS, type SyncLog } from "../ar-sync/sync";

export type Balance = { opening: number; increase: number; decrease: number; closing: number };
/** code = null คือกลุ่ม "ไม่ระบุบัญชี" */
export type AccountBalance = Balance & { code: string | null; name: string | null };

/** response ของ /api/fund/ar-ledger?month=YYYY-MM */
export type ArLedgerSummary = {
  month: string;
  months: string[];
  rows: AccountBalance[];
  totals: Balance;
  /** ครั้งล่าสุดที่กด (อาจ error) และครั้งล่าสุดที่สำเร็จ */
  lastSync: SyncLog | null;
  lastSuccessAt: string | null;
};

// ยกมา = ก่อนต้นเดือน, ตั้งเพิ่ม = ยอดบวกในเดือน, ลดหนี้ = ยอดลบในเดือน (ยกเลิก/ปรับลด/กลับรายการ แสดงเป็นบวก), คงเหลือ = ถึงสิ้นเดือน
// บัญชีที่ไม่มียอดยกมาและไม่มีรายการในเดือนไม่แสดง
const SUMMARY_SQL = `SELECT l.account_code AS code, a.name,
  COALESCE(SUM(l.amount) FILTER (WHERE l.entry_date < $1), 0) AS opening,
  COALESCE(SUM(l.amount) FILTER (WHERE l.entry_date >= $1 AND l.amount > 0), 0) AS increase,
  COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_date >= $1 AND l.amount < 0), 0) AS decrease,
  SUM(l.amount) AS closing
FROM ar_ledger l
LEFT JOIN ar_account a ON a.code = l.account_code
WHERE l.entry_date <= $2
GROUP BY l.account_code, a.name
HAVING SUM(l.amount) FILTER (WHERE l.entry_date < $1) <> 0 OR bool_or(l.entry_date >= $1)
ORDER BY l.account_code NULLS LAST`;

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const today = todayIso();
  const month = request.nextUrl.searchParams.get("month") || today.slice(0, 7);
  const range = monthRange(month, today);
  if (!range) return badRequest("month ต้องเป็น YYYY-MM ตั้งแต่ 2025-10 ถึงเดือนปัจจุบัน");

  const [rows, [lastSync], [success]] = await Promise.all([
    insightQuery<Record<keyof AccountBalance, string | null>>(SUMMARY_SQL, [range.from, range.to]),
    insightQuery<SyncLog>(`SELECT ${LOG_COLS} FROM ar_sync_log ORDER BY started_at DESC LIMIT 1`),
    insightQuery<{ at: string }>("SELECT to_char(finished_at, 'YYYY-MM-DD HH24:MI') AS at FROM ar_sync_log WHERE finished_at IS NOT NULL AND error IS NULL ORDER BY started_at DESC LIMIT 1"),
  ]);
  const totals: Balance = { opening: 0, increase: 0, decrease: 0, closing: 0 };
  const out = rows.map((r): AccountBalance => {
    const b = { opening: round2(r.opening), increase: round2(r.increase), decrease: round2(r.decrease), closing: round2(r.closing) };
    for (const k of Object.keys(totals) as (keyof Balance)[]) totals[k] += b[k];
    return { code: r.code, name: r.name, ...b };
  });
  for (const k of Object.keys(totals) as (keyof Balance)[]) totals[k] = round2(totals[k]);
  const body: ArLedgerSummary = { month, months: ledgerMonths(today), rows: out, totals, lastSync: lastSync ?? null, lastSuccessAt: success?.at ?? null };
  return Response.json(body);
}
