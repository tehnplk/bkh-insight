import { auth } from "@/auth";
import { hisQuery, insightTransaction } from "@/lib/db";
import {
  STALE_SLIP_REASON, parseStaleVns, planStaleSlip,
  type StaleDebt, type StaleSlipResult, type StaleVisit,
} from "../../ar-precheck/precheck";

// SQL ผ่าน prove-query แล้ว ห้ามเปลี่ยนถ้าไม่ได้ prove ใหม่
// H1 ตรวจซ้ำกับ HOSxP ว่ายังเป็นใบค้างหลัง admit (opitemrece ใช้ ix_vn เอง ห้ามใส่ FORCE INDEX)
const visitsSql = (n: number) => `SELECT o.vn, NULLIF(o.an, '') AS an, vs.vn IS NOT NULL AS has_stat,
  (SELECT SUM(r.amount) FROM rcpt_debt r WHERE r.vn = o.vn AND (r.status IS NULL OR r.status <> 'ABORT')) AS debt_amount,
  (SELECT COUNT(*) FROM opitemrece i WHERE i.vn = o.vn) AS n_items
FROM ovst o LEFT JOIN vn_stat vs ON vs.vn = o.vn
WHERE o.vn IN (${Array(n).fill("?").join(", ")})`;
// L1 หนี้ OPD ของ vn ในสมุด (หนึ่งแถวต่อ debt_id) คงเหลือทุก source
const DEBTS_SQL = `SELECT s.vn, s.ref, SUM(x.amount) AS balance, bool_or(x.source = 'stm') AS settled
FROM ar_ledger s
JOIN ar_ledger x ON x.patient_type = s.patient_type AND x.ref = s.ref
WHERE s.kind = 'set' AND s.source = 'rcpt_debt' AND s.vn = ANY($1::text[])
GROUP BY s.vn, s.ref`;
// P1 คำขอที่รออนุมัติของ ref เดียวกัน (ไม่มี unique constraint จึงเช็คใต้ lock)
const PENDING_SQL = "SELECT ref FROM ar_adjust_request WHERE status = 'pending' AND patient_type = 'OP' AND ref = ANY($1::text[])";
// I1
const INSERT_SQL = `INSERT INTO ar_adjust_request (patient_type, ref, amount, reason, requested_by)
SELECT 'OP', x.ref, x.amount, $3::text, $4::text
FROM unnest($1::text[], $2::numeric[]) AS x(ref, amount)
RETURNING id, ref, amount`;

const bad = (error: string, status = 400) => Response.json({ error }, { status });

// ขอปรับปรุงใบลูกหนี้ OPD ค้างหลัง admit หลายราย { vns }: ยอด = ลดให้คงเหลือ 0 ต่อ debt_id เหตุผลคงที่ อนุมัติตามขั้นตอนเดิมที่ /fund/ar-ledger
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return bad("unauthorized", 401);
  const vns = parseStaleVns((await request.json().catch(() => null))?.vns);
  if ("error" in vns) return bad(vns.error);
  const me = session.user.name ?? "ไม่ทราบชื่อ";

  // อ่าน his ก่อนถือ lock เหมือน ar-sync
  const visits = await hisQuery<StaleVisit>(visitsSql(vns.length), vns);
  const result = await insightTransaction<StaleSlipResult>(async (tx) => {
    await tx("SELECT pg_advisory_xact_lock(hashtext('ar_ledger'))");
    const debts = await tx<StaleDebt>(DEBTS_SQL, [vns]);
    const pending = debts.length ? await tx<{ ref: string }>(PENDING_SQL, [debts.map((d) => d.ref)]) : [];
    const { requests, skipped } = planStaleSlip(vns, visits, debts, new Set(pending.map((p) => p.ref)));
    if (!requests.length) return { created: [], skipped };
    const rows = await tx<{ id: string; ref: string; amount: string }>(INSERT_SQL, [requests.map((r) => r.ref), requests.map((r) => r.amount), STALE_SLIP_REASON, me]);
    const vnOf = new Map(requests.map((r) => [r.ref, r.vn]));
    return { created: rows.map((r) => ({ id: r.id, vn: vnOf.get(r.ref)!, ref: r.ref, amount: r.amount })), skipped };
  });
  return Response.json(result);
}
