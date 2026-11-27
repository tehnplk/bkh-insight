import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { insightTransaction } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { fiscalYearOf, parseFiscalYear } from "../../uc-dashboard/dashboard";
import { fetchSmt, smtErrorText } from "../smt";
import { mapKey, planImport, smtKey, type ExistingTransfer, type FundMapEntry, type FundSide, type ImportCounts, type SmtTransferRow, type UnmappedFund } from "../transfer";

/** response ของ POST /api/fund/ar-transfer/import?fy= */
export type ImportResult = { fy: number; fetched: number; counts: ImportCounts; unmapped: UnmappedFund[] };

const EXISTING_SQL = `SELECT smt_key, amount, account_code, updated_by IS NOT NULL AS edited, cancelled_at IS NOT NULL AS cancelled, receipt_date IS NOT NULL AS received
FROM ar_transfer WHERE smt_key = ANY($1)`;
const MAPS_SQL = "SELECT fund_key, side, account_code, ignore FROM ar_transfer_fund_map";
const NEW_FUNDS_SQL = `INSERT INTO ar_transfer_fund_map (fund_key, side, fund_name, smt_account_name)
SELECT x.fund_key, x.side, x.fund_name, x.smt_account_name FROM jsonb_to_recordset($1::jsonb) AS x(fund_key text, side text, fund_name text, smt_account_name text)
ON CONFLICT (fund_key, side) DO NOTHING`;
const INSERT_SQL = `INSERT INTO ar_transfer (source, smt_key, transfer_date, ref_doc_no, fund_key, fund_name, account_code, amount, smt_amount, created_by)
SELECT 'smt', x.smt_key, x.transfer_date, x.ref_doc_no, x.fund_key, x.fund_name, x.account_code, x.amount, x.amount, $2
FROM jsonb_to_recordset($1::jsonb) AS x(smt_key text, transfer_date date, ref_doc_no text, fund_key text, fund_name text, account_code text, amount numeric)
ON CONFLICT (smt_key) DO NOTHING`;
// แถวที่การเงินแก้/ยกเลิก/ลงรับระหว่างนี้ไม่ทับ (เงื่อนไขซ้ำกับ planImport) ; แถวใหม่เป็นรอออกใบเสร็จ (receipt_date NULL)
const UPDATE_SQL = `UPDATE ar_transfer t SET amount = x.amount, smt_amount = x.amount, account_code = x.account_code
FROM jsonb_to_recordset($1::jsonb) AS x(smt_key text, account_code text, amount numeric)
WHERE t.smt_key = x.smt_key AND t.updated_by IS NULL AND t.cancelled_at IS NULL AND t.receipt_date IS NULL`;

/** ดึงรายการโอนของปีงบ (ตามวันที่โอน) จาก SMT แล้วเพิ่ม/อัปเดตเฉพาะกองทุนที่จับคู่บัญชีแล้ว ; ผู้ที่ login ทุกคนกดได้ */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const today = todayIso();
  const raw = request.nextUrl.searchParams.get("fy");
  const currentFy = fiscalYearOf(today);
  const fy = raw ? parseFiscalYear(raw, currentFy) : currentFy;
  if (fy === null) return Response.json({ error: "fy ไม่ถูกต้อง" }, { status: 400 });

  let smt: SmtTransferRow[];
  try {
    smt = await fetchSmt(fy, today);
  } catch (e) {
    return Response.json({ error: smtErrorText(e as Error) }, { status: 502 });
  }
  const name = session.user.name ?? "ไม่ทราบชื่อ";

  const result = await insightTransaction(async (tx): Promise<ImportResult> => {
    await tx("SELECT pg_advisory_xact_lock(hashtext('ar_transfer_import'))"); // กดพร้อมกันสองคนไม่ชนกัน
    const keys = smt.map(smtKey);
    const [maps, existing] = await Promise.all([
      tx<FundMapEntry & { fund_key: string; side: FundSide }>(MAPS_SQL),
      keys.length ? tx<ExistingTransfer & { smt_key: string }>(EXISTING_SQL, [keys]) : Promise.resolve([]),
    ]);
    const plan = planImport(smt, new Map(maps.map((m) => [mapKey(m.fund_key, m.side), m])), new Map(existing.map((e) => [e.smt_key, e])));
    if (plan.newFunds.length) await tx(NEW_FUNDS_SQL, [JSON.stringify(plan.newFunds)]);
    if (plan.inserts.length) await tx(INSERT_SQL, [JSON.stringify(plan.inserts), name]);
    if (plan.updates.length) await tx(UPDATE_SQL, [JSON.stringify(plan.updates)]);
    return { fy, fetched: smt.length, counts: plan.counts, unmapped: plan.unmapped };
  });
  return Response.json(result);
}
