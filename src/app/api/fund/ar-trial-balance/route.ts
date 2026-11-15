import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { badRequest, isAuthed, unauthorized } from "../_lib/fund";
import { monthRange } from "../ar-sync/ledger";
import { ignoreMissingTable, loadTrialBalance, snapshotChanges, type TrialBalance } from "./trial-balance";

/** response ของ /api/fund/ar-trial-balance?month=YYYY-MM (format=xlsx ส่งไฟล์) ; closed = งวดนี้ปิดอยู่ changes = จำนวนบัญชีที่ยอดต่างจากตอนปิด */
export type ArTrialBalance = TrialBalance & { month: string; closed: { by: string; at: string; changes: number } | null };

// S3: งวดที่ปิดอยู่ของเดือนนี้ ; locked_at เป็น "YYYY-MM-DD HH24:MI" เวลาไทย
const CLOSED_SQL = `SELECT locked_by, to_char(locked_at, 'YYYY-MM-DD HH24:MI') AS locked_at, snapshot
FROM ar_period_close WHERE month = $1::date AND unlocked_at IS NULL`;

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const today = todayIso();
  const month = request.nextUrl.searchParams.get("month") || today.slice(0, 7);
  const range = monthRange(month, today);
  if (!range) return badRequest("month ต้องเป็น YYYY-MM ตั้งแต่ 2025-10 ถึงเดือนปัจจุบัน");
  const [tb, [close]] = await Promise.all([
    loadTrialBalance(insightQuery, month, range.to),
    ignoreMissingTable(insightQuery<{ locked_by: string; locked_at: string; snapshot: TrialBalance }>(CLOSED_SQL, [range.from]), []),
  ]);

  if (request.nextUrl.searchParams.get("format") === "xlsx") {
    const rows = [
      ...tb.rows.map((r) => ({ ...r, code: r.code ?? (r.type === "retained" ? "" : "ยังไม่กำหนด") })),
      { code: "", name: "รวม", ...tb.totals },
    ];
    return xlsxResponse<(typeof rows)[number]>(`ar-trial-balance-${month}.xlsx`, [
      { key: "code", header: "รหัสบัญชี", width: 18 },
      { key: "name", header: "ชื่อบัญชี", width: 40 },
      { key: "opening_dr", header: "ยกมา เดบิต (บาท)", width: 18, type: "money" },
      { key: "opening_cr", header: "ยกมา เครดิต (บาท)", width: 18, type: "money" },
      { key: "dr", header: "ระหว่างงวด เดบิต (บาท)", width: 18, type: "money" },
      { key: "cr", header: "ระหว่างงวด เครดิต (บาท)", width: 18, type: "money" },
      { key: "closing_dr", header: "ยกไป เดบิต (บาท)", width: 18, type: "money" },
      { key: "closing_cr", header: "ยกไป เครดิต (บาท)", width: 18, type: "money" },
    ], rows);
  }
  const body: ArTrialBalance = {
    month,
    ...tb,
    closed: close ? { by: close.locked_by, at: close.locked_at, changes: snapshotChanges(tb, close.snapshot) } : null,
  };
  return Response.json(body);
}
