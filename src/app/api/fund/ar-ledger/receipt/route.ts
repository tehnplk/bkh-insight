import { auth } from "@/auth";
import { todayIso } from "@/lib/thai-date";
import { LEDGER_START, fromCents, toCents } from "../../ar-sync/ledger";
import { locked } from "../../ar-sync/sync";
import { MAX_RECEIPT_NO } from "../../ar-settle/settle";
import { planReceipt } from "./receipt";

// แถว set ของหนี้ + บัญชี ($1 patient_type, $2 ref) ; คงเหลือ = ทุก source ของ (patient_type, ref)
const DEBT_SQL = `SELECT s.ref, s.vn, s.an, s.patient_type, s.ref_date, s.pttype, s.hipdata_code, s.hospmain, s.hospmain_chwpart, s.account_code,
  a.settles_by_stm, (SELECT SUM(x.amount) FROM ar_ledger x WHERE x.patient_type = s.patient_type AND x.ref = s.ref) AS balance
FROM ar_ledger s LEFT JOIN ar_account a ON a.code = s.account_code
WHERE s.patient_type = $1 AND s.ref = $2 AND s.kind = 'set' AND s.source IN ('rcpt_debt', 'ipt')`;
const INSERT_SQL = `INSERT INTO ar_ledger (source, kind, ref, vn, an, patient_type, ref_date, entry_date, pttype, hipdata_code, hospmain, hospmain_chwpart, account_code, amount, note)
SELECT 'manual', x.kind, $1::text, $2::varchar, $3::varchar, $4::text, $5::date, $6::date, $7::text, $8::text, $9::text, $10::text, $11::text, x.amount, x.note
FROM jsonb_to_recordset($12::jsonb) AS x(kind text, amount numeric, note text)
RETURNING kind, amount, orig_entry_date IS NOT NULL AS shifted`;
type Debt = Record<"ref" | "vn" | "an" | "patient_type" | "ref_date" | "pttype" | "hipdata_code" | "hospmain" | "hospmain_chwpart" | "account_code", string | null> & {
  settles_by_stm: boolean | null; balance: string;
};
/** ผลของ POST /api/fund/ar-ledger/receipt (บาท) */
export type ReceiptResult = { settle: number; diff: number; balance: number; shifted: boolean };

const bad = (error: string, status = 400) => Response.json({ error }, { status });
class ReceiptError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * บันทึกรับเงินที่ไม่ได้มาจาก STM { patient_type, ref, amount, receipt_date, receipt_no, close } เฉพาะบัญชีที่ไม่ตัดด้วย STM
 * ลง source manual kind settle (Dr เงินฝากธนาคาร) และ diff เมื่อติ๊กปิดส่วนต่าง ภายใต้ lock เดียวกับ ar-sync/ตัดลูกหนี้ ยอดคงเหลืออ่านใหม่ใน lock
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return bad("unauthorized", 401);
  const b = await request.json().catch(() => null);
  if (b?.patient_type !== "OP" && b?.patient_type !== "IP") return bad("patient_type ต้องเป็น OP หรือ IP");
  const ref = typeof b.ref === "string" ? b.ref.trim() : "";
  if (!/^\d{1,15}$/.test(ref)) return bad("เลขอ้างอิงต้องเป็นตัวเลข (OP = เลขที่ลูกหนี้, IP = AN)");
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e10 || Math.round(amount * 100) !== amount * 100) return bad("จำนวนเงินต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง");
  const today = todayIso();
  const date = b.receipt_date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || date < LEDGER_START || date > today)
    return bad("วันที่รับเงินต้องอยู่ระหว่างวันเริ่มสมุดลูกหนี้ถึงวันนี้");
  const no = typeof b.receipt_no === "string" ? b.receipt_no.trim() : "";
  if (!no || no.length > MAX_RECEIPT_NO) return bad(`กรอกเลขที่ใบเสร็จ ไม่เกิน ${MAX_RECEIPT_NO} ตัวอักษร`);
  if (typeof b.close !== "boolean") return bad("close ต้องเป็น true/false");

  try {
    const result = await locked(async (tx): Promise<ReceiptResult> => {
      const [d] = await tx<Debt>(DEBT_SQL, [b.patient_type, ref]);
      if (!d) throw new ReceiptError("ไม่พบลูกหนี้นี้ในสมุดลูกหนี้", 404);
      if (!d.account_code) throw new ReceiptError("หนี้นี้ยังไม่ระบุบัญชี", 409);
      if (d.settles_by_stm) throw new ReceiptError("บัญชีนี้ตัดด้วย STM ให้ตัดที่หน้าตัดลูกหนี้", 409);
      const plan = planReceipt(toCents(d.balance), toCents(amount), b.close);
      if ("error" in plan) throw new ReceiptError(plan.error, 409);
      const rows = [
        { kind: "settle", amount: fromCents(plan.settle), note: `รับเงิน ใบเสร็จ ${no}` },
        ...(plan.diff ? [{ kind: "diff", amount: fromCents(plan.diff), note: `ปิดส่วนต่างหลังรับเงิน ใบเสร็จ ${no}` }] : []),
      ];
      const out = await tx<{ kind: string; amount: string; shifted: boolean }>(INSERT_SQL, [
        d.ref, d.vn, d.an, d.patient_type, d.ref_date, date, d.pttype, d.hipdata_code, d.hospmain, d.hospmain_chwpart, d.account_code, JSON.stringify(rows),
      ]);
      return { settle: -plan.settle / 100, diff: -plan.diff / 100, balance: (toCents(d.balance) + plan.settle + plan.diff) / 100, shifted: out.some((r) => r.shifted) };
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof ReceiptError) return bad(e.message, e.status);
    throw e;
  }
}
