import { auth } from "@/auth";
import { insightQuery, insightTransaction } from "@/lib/db";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate, todayIso } from "@/lib/thai-date";
import { addDays, ledgerMonths, nextMonth } from "@/app/api/fund/ar-sync/ledger";
import { closedThrough, loadTrialBalance, type TbTotals } from "@/app/api/fund/ar-trial-balance/trial-balance";

// ปิดงวดสมุดลูกหนี้ (admin เท่านั้น): GET ประวัติ, POST { through: "YYYY-MM" } ปิดต่อเนื่องถึงเดือนนั้น, PATCH { month, reason } เปิดงวดล่าสุด
// ปิด/เปิดถือ lock เดียวกับ ar-sync/ตัดหนี้/ar-adjust ให้ไม่ชนกับการลงสมุดลูกหนี้ ; trigger ar_ledger_period_guard บังคับงวดปิดที่ฐาน

export type ArPeriod = {
  id: string; month: string; locked_by: string; locked_at: string;
  unlocked_by: string | null; unlocked_at: string | null; unlock_reason: string | null; totals: TbTotals;
};
/** through = ปิดถึงเดือนไหน (null = ยังไม่ปิด) ; closable = เดือนที่จบแล้วและยังไม่ปิด (เก่าไปใหม่) */
export type ArPeriodsData = { through: string | null; closable: string[]; history: ArPeriod[] };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('ar_ledger'))";
const HISTORY_SQL = `SELECT id, to_char(month, 'YYYY-MM') AS month, locked_by, to_char(locked_at, 'YYYY-MM-DD HH24:MI') AS locked_at,
  unlocked_by, to_char(unlocked_at, 'YYYY-MM-DD HH24:MI') AS unlocked_at, unlock_reason, snapshot->'totals' AS totals
FROM ar_period_close ORDER BY month DESC, locked_at DESC LIMIT 200`;
const UNASSIGNED_SQL = "SELECT count(*)::int AS n, COALESCE(SUM(amount), 0) AS amount FROM ar_ledger WHERE account_code IS NULL AND entry_date <= $1";
const INSERT_SQL = "INSERT INTO ar_period_close (month, locked_by, snapshot) VALUES ($1::date, $2, $3::jsonb) RETURNING id";
// เปิดได้เฉพาะงวดล่าสุดที่ปิดอยู่
const UNLOCK_SQL = `UPDATE ar_period_close SET unlocked_by = $2, unlocked_at = now(), unlock_reason = $3
WHERE unlocked_at IS NULL AND month = $1::date AND month = (SELECT max(month) FROM ar_period_close WHERE unlocked_at IS NULL)
RETURNING id`;

const bad = (error: string, status = 400) => Response.json({ error }, { status });
const monthEnd = (m: string) => addDays(`${nextMonth(m)}-01`, -1);
/** เดือนที่จบแล้ว (สิ้นเดือน < วันนี้) ที่ยังไม่ปิด ต่อจาก through */
const closableMonths = (through: string | null, today: string) =>
  ledgerMonths(today).reverse().filter((m) => m < today.slice(0, 7) && (!through || m > through));

// proxy.ts กันไว้แล้ว แต่ route ใต้ /api/admin ไม่มี layout ครอบ จึงเช็คซ้ำ
async function adminName() {
  const session = await auth();
  if (!session) return { error: bad("unauthorized", 401) };
  if (session.user.role !== "admin") return { error: bad("forbidden", 403) };
  return { name: session.user.name ?? "ไม่ทราบชื่อ" };
}

export async function GET() {
  const { error } = await adminName();
  if (error) return error;
  const [through, history] = await Promise.all([closedThrough(insightQuery), insightQuery<ArPeriod>(HISTORY_SQL)]);
  const body: ArPeriodsData = { through, closable: closableMonths(through, todayIso()), history };
  return Response.json(body);
}

export async function POST(request: Request) {
  const { name, error } = await adminName();
  if (error) return error;
  const b = await request.json().catch(() => null);
  const target = typeof b?.through === "string" ? b.through : "";
  if (!MONTH.test(target)) return bad("ส่ง through เป็น YYYY-MM");
  const today = todayIso();

  const result = await insightTransaction(async (tx) => {
    await tx(LOCK_SQL);
    const through = await closedThrough(tx);
    const months = closableMonths(through, today).filter((m) => m <= target);
    if (!months.length) {
      if (through && target <= through) return { error: `ปิดงวดถึง ${formatThaiDate(monthEnd(through))} แล้ว`, status: 409 };
      return { error: "ปิดได้เฉพาะเดือนที่จบแล้ว ตั้งแต่ ต.ค. 2568", status: 400 };
    }
    const end = monthEnd(target);
    const [u] = await tx<{ n: number; amount: string }>(UNASSIGNED_SQL, [end]);
    if (u.n > 0) {
      return {
        error: `ยังมี ${formatCount(u.n)} รายการ (${formatBaht(Number(u.amount))} บาท) ที่ลงบัญชีถึง ${formatThaiDate(end)} แต่ยังไม่ระบุบัญชี กำหนดบัญชีที่หน้า บัญชีลูกหนี้ตามสิทธิ ก่อนปิดงวด`,
        status: 409,
        unassigned: { n: u.n, amount: Number(u.amount) },
      };
    }
    for (const m of months) await tx(INSERT_SQL, [`${m}-01`, name, JSON.stringify(await loadTrialBalance(tx, m, monthEnd(m)))]);
    return { ok: true as const, months };
  }).catch((e) => {
    if ((e as { code?: string }).code === "23505") return { error: "งวดนี้ถูกปิดไปแล้ว โหลดหน้าใหม่", status: 409 };
    throw e;
  });
  if (!("error" in result)) return Response.json(result);
  const { status, ...body } = result;
  return Response.json(body, { status });
}

export async function PATCH(request: Request) {
  const { name, error } = await adminName();
  if (error) return error;
  const b = await request.json().catch(() => null);
  const month = typeof b?.month === "string" ? b.month : "";
  const reason = typeof b?.reason === "string" ? b.reason.trim() : "";
  if (!MONTH.test(month)) return bad("ส่ง month เป็น YYYY-MM");
  if (!reason || reason.length > 500) return bad("ต้องระบุเหตุผล ไม่เกิน 500 ตัวอักษร");

  const rows = await insightTransaction(async (tx) => {
    await tx(LOCK_SQL);
    return tx<{ id: string }>(UNLOCK_SQL, [`${month}-01`, name, reason]);
  });
  if (!rows.length) return bad("เปิดได้เฉพาะงวดล่าสุดที่ปิดอยู่ โหลดหน้าใหม่", 409);
  return Response.json(rows[0]);
}
