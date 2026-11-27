import { auth } from "@/auth";
import { todayIso } from "@/lib/thai-date";
import { LEDGER_START } from "../../ar-sync/ledger";
import { locked } from "../../ar-sync/sync";
import { closedThrough } from "../../ar-trial-balance/trial-balance";
import { closedMsg, receiptLock } from "../data";
import { parseReceiptAction, receiptAccount } from "../transfer";

/** response ของ POST /api/fund/ar-transfer/receipt */
export type ReceiptResult = { n: number };

class ReceiptError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// แถวรอออกใบเสร็จ (ไม่ยกเลิก) ของชุดโอน SMT ($1 วันที่โอน, $2 batchNo ช่องที่ 3 ของ smt_key) หรือของ id ($1) ; ล็อกแถวไว้จนจบ transaction
const PENDING_COLS = "id::text AS id, smt_key, account_code, transfer_date, updated_by IS NOT NULL AS edited";
const BATCH_SQL = `SELECT ${PENDING_COLS} FROM ar_transfer
WHERE source = 'smt' AND transfer_date = $1 AND split_part(smt_key, '|', 3) = $2 AND cancelled_at IS NULL AND receipt_date IS NULL FOR UPDATE`;
const ROW_SQL = `SELECT ${PENDING_COLS} FROM ar_transfer WHERE id = $1 AND cancelled_at IS NULL AND receipt_date IS NULL FOR UPDATE`;
// account_code ตาม receiptAccount (งบปีก่อนปีงบของวันที่ใบเสร็จ -> PRIOR_YEAR_ACCOUNT) ; updated_by คงเดิม นำเข้าใหม่ไม่ทับเพราะรับแล้ว
const RECEIVE_SQL = `UPDATE ar_transfer t SET receipt_no = $2, receipt_date = $3, received_by = $4, received_at = now(), account_code = x.account_code
FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, account_code text)
WHERE t.id = x.id AND t.cancelled_at IS NULL AND t.receipt_date IS NULL`;
const RECEIVED_SQL = "SELECT account_code, receipt_date FROM ar_transfer WHERE id = $1 AND cancelled_at IS NULL AND receipt_date IS NOT NULL FOR UPDATE";
const UNRECEIVE_SQL = `UPDATE ar_transfer SET receipt_no = NULL, receipt_date = NULL, received_by = NULL, received_at = NULL,
  unreceived_by = $2, unreceived_at = now(), unreceive_reason = $3
WHERE id = $1 AND cancelled_at IS NULL AND receipt_date IS NOT NULL`;

/**
 * ลงรับ { action: "receive", transfer_date, batch | id, receipt_no, receipt_date }: ทุกแถวที่ยังรอออกใบเสร็จของชุดโอน (หรือแถวเดียว)
 * ยกเลิกการรับ { action: "unreceive", id, reason }: ห้ามเมื่อวันที่ใบเสร็จอยู่ในงวดที่ปิด หรือยอดนี้ถูกใช้ตัดหนี้เหมาจ่ายแล้ว (receiptLock)
 * ผู้ที่ login ทุกคน (การเงิน) บันทึกชื่อจาก session ; ทำภายใต้ lock ของ ar_ledger เดียวกับการยืนยันตัดหนี้เหมาจ่าย
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = parseReceiptAction(await request.json().catch(() => null), LEDGER_START, todayIso());
  if ("error" in body) return Response.json({ error: body.error }, { status: 400 });
  const name = session.user.name ?? "ไม่ทราบชื่อ";
  try {
    const result = await locked(async (tx): Promise<ReceiptResult> => {
      const through = await closedThrough(tx);
      if (body.action === "unreceive") {
        const [r] = await tx<{ account_code: string; receipt_date: string }>(RECEIVED_SQL, [body.id]);
        if (!r) throw new ReceiptError("ไม่พบรายการที่ลงรับแล้ว หรือยกเลิกไปแล้ว", 404);
        const why = await receiptLock(tx, r, through);
        if (why) throw new ReceiptError(why, 409);
        await tx(UNRECEIVE_SQL, [body.id, name, body.reason]);
        return { n: 1 };
      }
      if (through && body.receipt_date.slice(0, 7) <= through) throw new ReceiptError(closedMsg(through), 409);
      const t = body.target;
      const rows = await tx<{ id: string; smt_key: string | null; account_code: string; transfer_date: string; edited: boolean }>(
        "id" in t ? ROW_SQL : BATCH_SQL,
        "id" in t ? [t.id] : [t.transfer_date, t.batch],
      );
      if (!rows.length) throw new ReceiptError("ไม่พบรายการรอออกใบเสร็จของชุดนี้ อาจลงรับไปแล้ว", 404);
      if (rows.some((r) => body.receipt_date < r.transfer_date)) throw new ReceiptError("วันที่ใบเสร็จต้องไม่ก่อนวันที่โอน", 400);
      const updates = rows.map((r) => ({ id: r.id, account_code: receiptAccount(r, body.receipt_date) }));
      await tx(RECEIVE_SQL, [JSON.stringify(updates), body.receipt_no, body.receipt_date, name]);
      return { n: rows.length };
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof ReceiptError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
