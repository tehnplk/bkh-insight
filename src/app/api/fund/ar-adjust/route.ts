import { auth } from "@/auth";
import { insightQuery, insightTransaction, type InsightTx } from "@/lib/db";
import { formatBaht } from "@/lib/number-format";
import { todayIso } from "@/lib/thai-date";
import { MAX_DECIDE_IDS, overReduces } from "./adjust";

export type AdjustRequest = {
  id: string;
  patient_type: "OP" | "IP";
  ref: string;
  vn: string | null;
  an: string | null;
  account_code: string | null;
  balance: string | null;
  amount: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};
/** response ของ GET /api/fund/ar-adjust : รออนุมัติทั้งหมด + ตัดสินแล้ว 50 รายการล่าสุด */
export type AdjustData = { requests: AdjustRequest[]; canApprove: boolean; me: string };

// ยอดคงเหลือทางบัญชีของหนี้ = ทุก source ของ (patient_type, ref) ; ข้อมูลหนี้จากแถว set
const LIST_SQL = `SELECT q.id, q.patient_type, q.ref, s.vn, s.an, s.account_code, b.balance, q.amount, q.reason, q.status, q.requested_by,
  to_char(q.requested_at, 'YYYY-MM-DD HH24:MI') AS requested_at, q.decided_by, to_char(q.decided_at, 'YYYY-MM-DD HH24:MI') AS decided_at, q.decision_note
FROM (
  (SELECT * FROM ar_adjust_request WHERE status = 'pending')
  UNION ALL
  (SELECT * FROM ar_adjust_request WHERE status <> 'pending' ORDER BY decided_at DESC LIMIT 50)
) q
LEFT JOIN ar_ledger s ON s.patient_type = q.patient_type AND s.ref = q.ref AND s.kind = 'set' AND s.source IN ('rcpt_debt', 'ipt')
LEFT JOIN LATERAL (SELECT SUM(x.amount) AS balance FROM ar_ledger x WHERE x.patient_type = q.patient_type AND x.ref = q.ref
  AND x.source IN (s.source, 'stm', 'manual')) b ON true
ORDER BY q.status = 'pending' DESC, COALESCE(q.decided_at, q.requested_at) DESC`;
const SET_ROW_SQL = `SELECT source, ref, vn, an, patient_type, ref_date, pttype, hipdata_code, hospmain, hospmain_chwpart, account_code
FROM ar_ledger WHERE patient_type = $1 AND ref = $2 AND kind = 'set' AND source IN ('rcpt_debt', 'ipt')`;
const REF_RE = /^\d{1,15}$/;
const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const session = await auth();
  if (!session) return bad("unauthorized", 401);
  const body: AdjustData = { requests: await insightQuery<AdjustRequest>(LIST_SQL), canApprove: session.user.role === "admin", me: session.user.name ?? "" };
  return Response.json(body);
}

// ขอปรับปรุง: { patient_type, ref, amount (บวก = เพิ่มหนี้, ลบ = ลดหนี้), reason }
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return bad("unauthorized", 401);
  const b = await request.json().catch(() => null);
  if (b?.patient_type !== "OP" && b?.patient_type !== "IP") return bad("patient_type ต้องเป็น OP หรือ IP");
  const ref = typeof b.ref === "string" ? b.ref.trim() : "";
  if (!REF_RE.test(ref)) return bad("เลขอ้างอิงต้องเป็นตัวเลข (OP = เลขที่ลูกหนี้, IP = AN)");
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) >= 1e10 || Math.round(amount * 100) !== amount * 100) return bad("จำนวนเงินต้องไม่เป็น 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง");
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (!reason || reason.length > 500) return bad("ต้องระบุเหตุผล ไม่เกิน 500 ตัวอักษร");
  const [debt] = await insightQuery(SET_ROW_SQL, [b.patient_type, ref]);
  if (!debt) return bad("ไม่พบลูกหนี้นี้ในสมุดลูกหนี้", 404);
  const [row] = await insightQuery<{ id: string }>(
    "INSERT INTO ar_adjust_request (patient_type, ref, amount, reason, requested_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [b.patient_type, ref, amount.toFixed(2), reason, session.user.name ?? "ไม่ทราบชื่อ"],
  );
  return Response.json(row);
}

// ยอดคงเหลือทางบัญชีทุก source ของหนี้ ณ ตอนอนุมัติ (0 ถ้าไม่มีแถว)
const BALANCE_SQL = "SELECT COALESCE(SUM(amount), 0) AS balance FROM ar_ledger WHERE patient_type = $1 AND ref = $2";
const ID_RE = /^[1-9]\d{0,17}$/;
type Decided = { ok: true; ledgerId: string | null } | { ok?: never; error: string; status: number };
/** ผลรายรายการของ PATCH แบบหลายรายการ */
export type DecideResult = { id: string } & ({ ok: true } | { ok: false; error: string });

/** ตัดสินหนึ่งคำขอใน transaction ที่ถือ lock ar_ledger แล้ว อนุมัติ = ลงสมุดลูกหนี้ source manual */
async function decide(tx: InsightTx, id: string, approve: boolean, note: string | null, me: string): Promise<Decided> {
  const [q] = await tx<{ patient_type: string; ref: string; amount: string; reason: string; requested_by: string; status: string }>(
    "SELECT patient_type, ref, amount, reason, requested_by, status FROM ar_adjust_request WHERE id = $1 FOR UPDATE",
    [id],
  );
  if (!q) return { error: "ไม่พบคำขอ", status: 404 };
  if (q.status !== "pending") return { error: "คำขอนี้ตัดสินไปแล้ว", status: 409 };
  if (q.requested_by === me) return { error: "อนุมัติคำขอของตัวเองไม่ได้ ต้องให้ผู้ดูแลคนอื่นตัดสิน", status: 403 };
  let ledgerId: string | null = null;
  if (approve) {
    const [debt] = await tx<Record<string, string | null>>(SET_ROW_SQL, [q.patient_type, q.ref]);
    if (!debt) return { error: "ไม่พบลูกหนี้นี้ในสมุดลูกหนี้แล้ว", status: 409 };
    const [{ balance }] = await tx<{ balance: string }>(BALANCE_SQL, [q.patient_type, q.ref]);
    // ยอดอาจเปลี่ยนระหว่างรออนุมัติ (ar-sync/STM/คำขออื่น) ห้ามลดหนี้จนติดลบ
    if (overReduces(balance, q.amount)) {
      return { error: `คงเหลือตอนนี้ ${formatBaht(Number(balance))} บาท ลดตามคำขอแล้วจะติดลบ ให้ไม่อนุมัติแล้วขอใหม่ตามยอดปัจจุบัน`, status: 409 };
    }
    const [row] = await tx<{ id: string }>(
      `INSERT INTO ar_ledger (source, kind, ref, vn, an, patient_type, ref_date, entry_date, pttype, hipdata_code, hospmain, hospmain_chwpart, account_code, amount, note)
VALUES ('manual', 'adjust', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [q.ref, debt.vn, debt.an, q.patient_type, debt.ref_date, todayIso(), debt.pttype, debt.hipdata_code, debt.hospmain, debt.hospmain_chwpart, debt.account_code, q.amount,
        `ปรับปรุงตามคำขอ #${id}: ${q.reason}`.slice(0, 1000)],
    );
    ledgerId = row.id;
  }
  await tx(
    "UPDATE ar_adjust_request SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, ledger_id = $5 WHERE id = $1",
    [id, approve ? "approved" : "rejected", me, note, ledgerId],
  );
  return { ok: true, ledgerId };
}

// ตัดสิน (admin เท่านั้น และไม่ใช่คนขอ): { id, approve: boolean, note? } หรือหลายรายการ { ids: string[], approve: true }
// ทั้งชุดอยู่ใน transaction เดียว ; รายการที่ตัดสินไม่ได้ (ของตัวเอง/ตัดสินแล้ว/ยอดจะติดลบ) คืน error รายรายการ ไม่ทำให้ชุดล้ม
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return bad("unauthorized", 401);
  if (session.user.role !== "admin") return bad("forbidden", 403);
  const b = await request.json().catch(() => null);
  const me = session.user.name ?? "ไม่ทราบชื่อ";
  const lock = (tx: InsightTx) => tx("SELECT pg_advisory_xact_lock(hashtext('ar_ledger'))"); // lock เดียวกับ ar-sync ให้ลงสมุดลูกหนี้เรียงคิวกัน

  if (Array.isArray(b?.ids)) {
    const ids = [...new Set(b.ids as unknown[])];
    if (b.approve !== true || !ids.length || ids.length > MAX_DECIDE_IDS || !ids.every((id): id is string => typeof id === "string" && ID_RE.test(id))) {
      return bad(`ส่ง ids 1–${MAX_DECIDE_IDS} รายการ และ approve: true (ไม่อนุมัติทำทีละรายการ)`);
    }
    const results = await insightTransaction(async (tx) => {
      await lock(tx);
      const out: DecideResult[] = [];
      for (const id of ids) {
        const r = await decide(tx, id, true, null, me);
        out.push(r.ok ? { id, ok: true } : { id, ok: false, error: r.error });
      }
      return out;
    });
    return Response.json({ results });
  }

  const id = typeof b?.id === "string" ? b.id : "";
  if (!ID_RE.test(id) || typeof b.approve !== "boolean") return bad("ส่ง id และ approve (true/false)");
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) || null : null;
  const result = await insightTransaction(async (tx) => (await lock(tx), decide(tx, id, b.approve, note, me)));
  return result.ok ? Response.json(result) : bad(result.error, result.status);
}
