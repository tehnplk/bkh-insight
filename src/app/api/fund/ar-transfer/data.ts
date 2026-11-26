import "server-only";
import { insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { fiscalYearOf, parseFiscalYear } from "../uc-dashboard/dashboard";
import { PRIOR_YEAR_ACCOUNT, keyBudgetYear, type FundSide } from "./transfer";

export type TransferStatus = "active" | "cancelled";
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
  amount: number;
  smt_amount: number | null;
  /** การเงินแก้ยอดจาก SMT (amount ≠ smt_amount) */
  edited: boolean;
  note: string | null;
  status: TransferStatus;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};
export type FundMapRow = { fund_key: string; side: FundSide; fund_name: string | null; smt_account_name: string | null; account_code: string | null; ignore: boolean; updated_by: string | null };
export type AccountOption = { code: string; name: string };

const ROWS_SQL = `SELECT id::text AS id, source, smt_key, transfer_date, ref_doc_no, fund_key, fund_name, account_code, amount, smt_amount, note,
  created_by, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at, updated_by, to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at,
  cancelled_by, to_char(cancelled_at, 'YYYY-MM-DD HH24:MI') AS cancelled_at, cancel_reason
FROM ar_transfer WHERE transfer_date BETWEEN $1 AND $2`;
// เรียงตามแถว ALL ของกองทุน: ยังไม่จับคู่ขึ้นก่อน แล้วที่จับคู่แล้ว ที่ไม่ใช้ไว้ท้าย ; แถว OP/IP ต่อท้าย ALL ของกองทุนเดียวกัน
const FUNDS_SQL = `SELECT m.fund_key, m.side, m.fund_name, m.smt_account_name, m.account_code, m.ignore, m.updated_by
FROM ar_transfer_fund_map m JOIN ar_transfer_fund_map a ON a.fund_key = m.fund_key AND a.side = 'ALL'
ORDER BY (a.account_code IS NULL AND NOT a.ignore) DESC, a.ignore, m.fund_key, m.side <> 'ALL', m.side = 'IP'`;
type DbRow = Omit<TransferRow, "amount" | "smt_amount" | "edited" | "status" | "account_name" | "budget_year"> & { smt_key: string | null; amount: string; smt_amount: string | null };

/** ?fy= (ไม่ส่ง = ปีงบปัจจุบัน) ; null = ไม่ถูกต้อง */
export function parseFy(params: URLSearchParams): number | null {
  const current = fiscalYearOf(todayIso());
  const raw = params.get("fy");
  return raw ? parseFiscalYear(raw, current) : current;
}

export const loadFunds = () => insightQuery<FundMapRow>(FUNDS_SQL);

/** บัญชีที่เลือกได้: ผังบัญชีลูกหนี้ (ar_account) + บัญชีงบปีก่อน + บัญชีที่ SMT แนะนำ/ที่จับคู่ใน mapping (ชื่อจาก SMT) */
export async function loadAccounts(funds: FundMapRow[]): Promise<AccountOption[]> {
  const out = new Map([PRIOR_YEAR_ACCOUNT, ...(await insightQuery<AccountOption>("SELECT code, name FROM ar_account"))].map((a) => [a.code, a]));
  for (const f of funds) {
    for (const code of [f.fund_key.split("|")[1], f.account_code]) {
      if (code && /^\d{10}\.(\d{3}|\d{5})$/.test(code) && !out.has(code)) out.set(code, { code, name: f.smt_account_name ?? "" });
    }
  }
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** ทุกแถวของปีงบ fy ตามวันที่โอน (รวมที่ยกเลิก) */
export async function loadRows(fy: number, accounts: AccountOption[]): Promise<TransferRow[]> {
  const names = new Map(accounts.map((a) => [a.code, a.name]));
  const rows = await insightQuery<DbRow>(ROWS_SQL, [`${fy - 544}-10-01`, `${fy - 543}-09-30`]);
  return rows.map(({ smt_key, ...r }) => {
    const amount = Number(r.amount), smt = r.smt_amount === null ? null : Number(r.smt_amount);
    return { ...r, budget_year: keyBudgetYear(smt_key), amount, smt_amount: smt, edited: smt !== null && smt !== amount, status: r.cancelled_at ? "cancelled" : "active", account_name: names.get(r.account_code) || null };
  });
}
