import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { badRequest, isAuthed, unauthorized } from "../_lib/fund";
import { monthRange } from "../ar-sync/ledger";
import { ignoreMissingTable } from "../ar-trial-balance/trial-balance";
import { CASH_NAME, journalLines, type JournalGroup, type JournalLine } from "./journal";

/** response ของ /api/fund/ar-journal?month=YYYY-MM (format=xlsx ส่งไฟล์) */
export type ArJournal = { month: string; lines: JournalLine[]; total: number; missing: number };

// แยกตามเครื่องหมายด้วย ให้ยอดบวกและลบของบัญชีเดียวกันออกคนละข้าง (ไม่หักกลบ) ; ตามวันที่ลงบัญชี (entry_date)
const SQL = `SELECT l.account_code, a.name AS account_name, l.kind, l.source, a.revenue_code, a.diff_under_code, a.diff_over_code,
  count(*)::int AS n, SUM(l.amount) AS amount
FROM ar_ledger l LEFT JOIN ar_account a ON a.code = l.account_code
WHERE l.entry_date BETWEEN $1 AND $2
GROUP BY l.account_code, a.name, l.kind, l.source, a.revenue_code, a.diff_under_code, a.diff_over_code, sign(l.amount)`;
// เงินโอนที่ได้รับ (ar_transfer ไม่ยกเลิก) ตาม transfer_date ; amount ติดลบ = เครดิต account_code (journalLines kind transfer)
const TRANSFER_SQL = `SELECT t.account_code, a.name AS account_name, 'transfer' AS kind, 'transfer' AS source, NULL AS revenue_code, NULL AS diff_under_code, NULL AS diff_over_code,
  count(*)::int AS n, -SUM(t.amount) AS amount
FROM ar_transfer t LEFT JOIN ar_account a ON a.code = t.account_code
WHERE t.cancelled_at IS NULL AND t.transfer_date BETWEEN $1 AND $2
GROUP BY t.account_code, a.name, sign(t.amount)`;

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const today = todayIso();
  const month = request.nextUrl.searchParams.get("month") || today.slice(0, 7);
  const range = monthRange(month, today);
  if (!range) return badRequest("month ต้องเป็น YYYY-MM ตั้งแต่ 2025-10 ถึงเดือนปัจจุบัน");
  const [ledger, transfers] = await Promise.all([
    insightQuery<JournalGroup>(SQL, [range.from, range.to]),
    ignoreMissingTable(insightQuery<JournalGroup>(TRANSFER_SQL, [range.from, range.to]), []),
  ]);
  const lines = journalLines([...ledger, ...transfers]);

  if (request.nextUrl.searchParams.get("format") === "xlsx") {
    const rows = lines.map((l) => ({ ...l, dr_code: l.dr_code ?? "ยังไม่กำหนด", cr_code: l.cr_code ?? "ยังไม่กำหนด" }));
    return xlsxResponse<(typeof rows)[number]>(`ar-journal-${month}.xlsx`, [
      { key: "kind", header: "รายการ", width: 12 },
      { key: "dr_code", header: "เดบิต รหัสบัญชี", width: 18 },
      { key: "dr_name", header: "เดบิต ชื่อบัญชี", width: 40 },
      { key: "cr_code", header: "เครดิต รหัสบัญชี", width: 18 },
      { key: "cr_name", header: "เครดิต ชื่อบัญชี", width: 40 },
      { key: "n", header: "จำนวนรายการ", width: 14, type: "count" },
      { key: "amount", header: "จำนวนเงิน (บาท)", width: 18, type: "money" },
    ], rows);
  }
  const body: ArJournal = {
    month,
    lines,
    total: Math.round(lines.reduce((s, l) => s + l.amount * 100, 0)) / 100,
    missing: lines.filter((l) => (!l.dr_code && l.dr_name !== CASH_NAME) || (!l.cr_code && l.cr_name !== CASH_NAME)).length,
  };
  return Response.json(body);
}
