import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hisQuery, insightTransaction } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { closedThrough } from "../../ar-trial-balance/trial-balance";
import { fiscalYearOf, parseFiscalYear } from "../../uc-dashboard/dashboard";
import { planImport, smtKey, type ExistingTransfer, type FundMapEntry, type ImportCounts, type SmtTransferRow, type UnmappedFund } from "../transfer";

/** response ของ POST /api/fund/ar-transfer/import?fy= */
export type ImportResult = { fy: number; fetched: number; counts: ImportCounts; unmapped: UnmappedFund[] };

// API สาธารณะของ SMT ตัวเดียวกับ /api/fund/smt-reconcile (ไม่ต้อง login) ; ตอนนี้ใช้เฉพาะ budgetSource UC เพราะ .214/.217 อยู่ใน UC เท่านั้น
const SMT_URL = "https://smt.nhso.go.th/smtf/api/budgetreport/budgetSummaryByVendorReport/search";
const SMT_TIMEOUT_MS = 20_000;
/** "2026-11-19" -> "19/11/2569" */
const beDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${+iso.slice(0, 4) + 543}`;

const EXISTING_SQL = `SELECT smt_key, amount, account_code, updated_by IS NOT NULL AS edited, cancelled_at IS NOT NULL AS cancelled
FROM ar_transfer WHERE smt_key = ANY($1)`;
const NEW_FUNDS_SQL = `INSERT INTO ar_transfer_fund_map (fund_key, fund_name, smt_account_name)
SELECT x.fund_key, x.fund_name, x.smt_account_name FROM jsonb_to_recordset($1::jsonb) AS x(fund_key text, fund_name text, smt_account_name text)
ON CONFLICT (fund_key) DO NOTHING`;
const INSERT_SQL = `INSERT INTO ar_transfer (source, smt_key, transfer_date, ref_doc_no, fund_key, fund_name, account_code, amount, smt_amount, created_by)
SELECT 'smt', x.smt_key, x.transfer_date, x.ref_doc_no, x.fund_key, x.fund_name, x.account_code, x.amount, x.amount, $2
FROM jsonb_to_recordset($1::jsonb) AS x(smt_key text, transfer_date date, ref_doc_no text, fund_key text, fund_name text, account_code text, amount numeric)
ON CONFLICT (smt_key) DO NOTHING`;
// แถวที่การเงินแก้/ยกเลิกระหว่างนี้ไม่ทับ (เงื่อนไขซ้ำกับ planImport)
const UPDATE_SQL = `UPDATE ar_transfer t SET amount = x.amount, smt_amount = x.amount, account_code = x.account_code
FROM jsonb_to_recordset($1::jsonb) AS x(smt_key text, account_code text, amount numeric)
WHERE t.smt_key = x.smt_key AND t.updated_by IS NULL AND t.cancelled_at IS NULL`;

async function fetchSmt(fy: number, today: string): Promise<SmtTransferRow[]> {
  const [cfg] = await hisQuery<{ hospitalcode: string | null }>("SELECT hospitalcode FROM opdconfig LIMIT 1");
  const hcode = String(cfg?.hospitalcode ?? "").trim();
  if (!/^\d{5}$/.test(hcode)) throw new Error("ไม่พบรหัสหน่วยบริการ (opdconfig.hospitalcode)");
  const fyEnd = `${fy - 543}-09-30`;
  const res = await fetch(SMT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vendorSearchConditionCode: "2", vendorId5Digit: hcode, budgetSource: "UC", budgetYear: "",
      transferStartDate: `01/10/${fy - 1}`, transferEndDate: beDate(fyEnd < today ? fyEnd : today), hospType: "", isTest: "",
    }),
    signal: AbortSignal.timeout(SMT_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`SMT ตอบ HTTP ${res.status}`);
  const body = (await res.json()) as { status?: string; datas?: SmtTransferRow[] };
  if (body.status !== "success" || !Array.isArray(body.datas)) throw new Error("SMT ตอบรูปแบบที่ไม่รู้จัก");
  return body.datas.filter((r) => typeof r.postingDate === "string" && /^\d{8}$/.test(r.postingDate) && typeof r.total === "number");
}

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
    const err = e as Error;
    return Response.json({ error: `ดึงข้อมูล SMT ไม่สำเร็จ: ${err.name === "TimeoutError" ? "หมดเวลารอ" : err.message}` }, { status: 502 });
  }
  const name = session.user.name ?? "ไม่ทราบชื่อ";

  const result = await insightTransaction(async (tx): Promise<ImportResult> => {
    await tx("SELECT pg_advisory_xact_lock(hashtext('ar_transfer_import'))"); // กดพร้อมกันสองคนไม่ชนกัน
    const keys = smt.map(smtKey);
    const [maps, existing, through] = await Promise.all([
      tx<FundMapEntry & { fund_key: string }>("SELECT fund_key, account_code, ignore FROM ar_transfer_fund_map"),
      keys.length ? tx<ExistingTransfer & { smt_key: string }>(EXISTING_SQL, [keys]) : Promise.resolve([]),
      closedThrough(tx),
    ]);
    const plan = planImport(smt, new Map(maps.map((m) => [m.fund_key, m])), new Map(existing.map((e) => [e.smt_key, e])), through);
    if (plan.newFunds.length) await tx(NEW_FUNDS_SQL, [JSON.stringify(plan.newFunds)]);
    if (plan.inserts.length) await tx(INSERT_SQL, [JSON.stringify(plan.inserts), name]);
    if (plan.updates.length) await tx(UPDATE_SQL, [JSON.stringify(plan.updates)]);
    return { fy, fetched: smt.length, counts: plan.counts, unmapped: plan.unmapped };
  });
  return Response.json(result);
}
