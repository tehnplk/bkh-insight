import "server-only";
import { insightQuery, type InsightTx } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { fyStartOf } from "../ar-capitation/capitation";
import { fiscalYearOf, parseFiscalYear } from "../uc-dashboard/dashboard";
import { PRIOR_YEAR_ACCOUNT, keyBudgetYear, type FundSide, type PendingLine } from "./transfer";

/** pending = รอออกใบเสร็จ, received = รับแล้ว (receipt_date ไม่ NULL) */
export type TransferStatus = "pending" | "received" | "cancelled";
export type TransferRow = {
  id: string;
  source: "smt" | "manual";
  transfer_date: string;
  ref_doc_no: string | null;
  /** ปีงบ พ.ศ. ของงบ (mouGrpCode ของ SMT) ; manual = null */
  budget_year: number | null;
  fund_key: string | null;
  fund_name: string | null;
  account_code: string;
  account_name: string | null;
  /** บัญชีลูกหนี้ที่ตัดด้วย STM: ไม่ลงสมุดรายวัน (เงินก้อนนี้ลงตอนตัดรายตัวด้วย STM) ใช้กระทบยอดเท่านั้น */
  stm: boolean;
  amount: number;
  smt_amount: number | null;
  /** การเงินแก้ยอดจาก SMT (amount ≠ smt_amount) */
  edited: boolean;
  note: string | null;
  status: TransferStatus;
  /** batchNo ของชุดโอน SMT (จาก smt_key) ; manual = null */
  batch: string | null;
  receipt_no: string | null;
  /** วันที่ใบเสร็จ = วันลงบัญชี ; null = รอออกใบเสร็จ */
  receipt_date: string | null;
  received_by: string | null;
  received_at: string | null;
  unreceived_by: string | null;
  unreceived_at: string | null;
  unreceive_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};
export type FundMapRow = { fund_key: string; side: FundSide; fund_name: string | null; smt_account_name: string | null; account_code: string | null; ignore: boolean; updated_by: string | null };
/** stm = ar_account.settles_by_stm (ไม่ลงสมุดรายวัน) */
export type AccountOption = { code: string; name: string; stm?: boolean };

const ROWS_SQL = `SELECT id::text AS id, source, smt_key, transfer_date, ref_doc_no, fund_key, fund_name, account_code, amount, smt_amount, note,
  created_by, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at, updated_by, to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at,
  cancelled_by, to_char(cancelled_at, 'YYYY-MM-DD HH24:MI') AS cancelled_at, cancel_reason,
  NULLIF(split_part(smt_key, '|', 3), '') AS batch, receipt_no, receipt_date, received_by, to_char(received_at, 'YYYY-MM-DD HH24:MI') AS received_at,
  unreceived_by, to_char(unreceived_at, 'YYYY-MM-DD HH24:MI') AS unreceived_at, unreceive_reason
FROM ar_transfer WHERE transfer_date BETWEEN $1 AND $2`;
// ยอดรับต่อบัญชี: รับแล้วตามวันที่ใบเสร็จในปีงบ $1..$2 + รอออกใบเสร็จทุกปีงบ (ไม่ยกเลิก)
const SUMMARY_SQL = `SELECT account_code, receipt_date, amount FROM ar_transfer
WHERE cancelled_at IS NULL AND (receipt_date BETWEEN $1 AND $2 OR receipt_date IS NULL)`;
// รอออกใบเสร็จทุกปีงบ ; batch = batchNo ใน smt_key (ช่องที่ 3) ; batch_receipt_no = ใบเสร็จของแถวอื่นในชุดเดียวกันที่รับแล้ว
const PENDING_SQL = `SELECT t.id::text AS id, t.source, t.transfer_date, NULLIF(split_part(t.smt_key, '|', 3), '') AS batch, t.ref_doc_no, t.fund_name, t.account_code, t.amount,
  (SELECT max(r.receipt_no) FROM ar_transfer r WHERE r.source = 'smt' AND t.source = 'smt' AND r.transfer_date = t.transfer_date
     AND split_part(r.smt_key, '|', 3) = split_part(t.smt_key, '|', 3) AND r.receipt_date IS NOT NULL AND r.cancelled_at IS NULL) AS batch_receipt_no
FROM ar_transfer t WHERE t.cancelled_at IS NULL AND t.receipt_date IS NULL
ORDER BY t.transfer_date, t.id`;
// เรียงตามแถว ALL ของกองทุน: ยังไม่จับคู่ขึ้นก่อน แล้วที่จับคู่แล้ว ที่ไม่ใช้ไว้ท้าย ; แถว OP/IP ต่อท้าย ALL ของกองทุนเดียวกัน
const FUNDS_SQL = `SELECT m.fund_key, m.side, m.fund_name, m.smt_account_name, m.account_code, m.ignore, m.updated_by
FROM ar_transfer_fund_map m JOIN ar_transfer_fund_map a ON a.fund_key = m.fund_key AND a.side = 'ALL'
ORDER BY (a.account_code IS NULL AND NOT a.ignore) DESC, a.ignore, m.fund_key, m.side <> 'ALL', m.side = 'IP'`;
type DbRow = Omit<TransferRow, "amount" | "smt_amount" | "edited" | "status" | "account_name" | "stm" | "budget_year"> & { smt_key: string | null; amount: string; smt_amount: string | null };

const fyRange = (fy: number) => [`${fy - 544}-10-01`, `${fy - 543}-09-30`];
export const loadSummaryRows = (fy: number) => insightQuery<{ account_code: string; receipt_date: string | null; amount: string }>(SUMMARY_SQL, fyRange(fy));
export const loadPending = () => insightQuery<PendingLine>(PENDING_SQL);

/** ?fy= (ไม่ส่ง = ปีงบปัจจุบัน) ; null = ไม่ถูกต้อง */
export function parseFy(params: URLSearchParams): number | null {
  const current = fiscalYearOf(todayIso());
  const raw = params.get("fy");
  return raw ? parseFiscalYear(raw, current) : current;
}

export const loadFunds = () => insightQuery<FundMapRow>(FUNDS_SQL);

/** บัญชีที่เลือกได้: ผังบัญชีลูกหนี้ (ar_account) + บัญชีงบปีก่อน + บัญชีที่ SMT แนะนำ/ที่จับคู่ใน mapping (ชื่อจาก SMT) */
export async function loadAccounts(funds: FundMapRow[]): Promise<AccountOption[]> {
  const out = new Map([PRIOR_YEAR_ACCOUNT, ...(await insightQuery<AccountOption>("SELECT code, name, settles_by_stm AS stm FROM ar_account"))].map((a) => [a.code, a]));
  for (const f of funds) {
    for (const code of [f.fund_key.split("|")[1], f.account_code]) {
      if (code && /^\d{10}\.(\d{3}|\d{5})$/.test(code) && !out.has(code)) out.set(code, { code, name: f.smt_account_name ?? "" });
    }
  }
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** ทุกแถวของปีงบ fy ตามวันที่โอน (รวมที่ยกเลิก) */
export async function loadRows(fy: number, accounts: AccountOption[]): Promise<TransferRow[]> {
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const rows = await insightQuery<DbRow>(ROWS_SQL, fyRange(fy));
  return rows.map(({ smt_key, ...r }) => {
    const amount = Number(r.amount), smt = r.smt_amount === null ? null : Number(r.smt_amount);
    const acc = byCode.get(r.account_code);
    return { ...r, budget_year: keyBudgetYear(smt_key), amount, smt_amount: smt, edited: smt !== null && smt !== amount, status: r.cancelled_at ? "cancelled" : r.receipt_date ? "received" : "pending", account_name: acc?.name || null, stm: !!acc?.stm };
  });
}

export const closedMsg = (through: string) => `งวดถึงเดือน ${through} ปิดแล้ว ลงรับหรือแก้ยอดรับที่วันที่ใบเสร็จอยู่ในงวดที่ปิดไม่ได้`;

// มีชุดตัดหนี้เหมาจ่ายของบัญชี $1 ตั้งแต่เดือนของวันที่ใบเสร็จ $2 ถึงสิ้นปีงบ ($3 = ต้นปีงบ) = pool ของชุดนั้นนับยอดรับนี้แล้ว
const CAPITATION_USED_SQL = `SELECT to_char(min(month), 'YYYY-MM') AS month FROM ar_capitation_batch
WHERE clear_code = $1 AND month >= date_trunc('month', $2::date) AND month < $3::date + interval '1 year'`;

/**
 * เหตุที่ถอน/ลดยอดรับที่ลงรับแล้วไม่ได้ (null = ได้): วันที่ใบเสร็จอยู่ในงวดที่ปิด หรือมีชุดตัดหนี้เหมาจ่ายของบัญชีนี้ที่เดือน ≥ เดือนของใบเสร็จในปีงบเดียวกัน
 * (pool ของชุดนั้นรวมยอดนี้ไปแล้ว ถอนออกจะทำให้ตัดหนี้เกินเงินที่รับ) ; เรียกภายใต้ lock ของ ar_ledger (locked) ให้ไม่ชนกับการยืนยันตัดหนี้
 */
export async function receiptLock(tx: InsightTx, r: { account_code: string; receipt_date: string }, through: string | null): Promise<string | null> {
  if (through && r.receipt_date.slice(0, 7) <= through) return closedMsg(through);
  const [used] = await tx<{ month: string | null }>(CAPITATION_USED_SQL, [r.account_code, r.receipt_date, fyStartOf(r.receipt_date.slice(0, 7))]);
  return used?.month ? `ยอดรับนี้ใช้ตัดหนี้เหมาจ่ายของบัญชี ${r.account_code} เดือน ${used.month} ไปแล้ว ถอนหรือลดยอดไม่ได้` : null;
}
