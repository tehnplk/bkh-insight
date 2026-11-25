import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import { parseRange } from "../_lib/fund";
import { MONTH_ERROR, parseMonth } from "../ar-capitation/data";
import { fail, sessionUser } from "../fwf-card/data";
import { BALANCE_SQL, DAILY_SQL, MAX_DAYS, REPORTS, toReport, type PatientType, type ReportKind, type ReportRow, type ReportTotal } from "./report";

/** response ของ GET: daily = ตั้งหนี้ตาม ref_date start..end ; balance = คงเหลือ ณ end (สิ้นเดือน, เดือนนี้ = วันนี้) */
export type ArReport = {
  report: ReportKind; patient_type: PatientType; start: string | null; end: string; month: string | null;
  rows: ReportRow[]; total: ReportTotal;
};

/** GET ?report=daily&type=OP|IP&start&end หรือ ?report=balance&type&month=YYYY-MM [&format=xlsx] */
export async function GET(request: NextRequest) {
  if (!(await sessionUser())) return fail("unauthorized", 401);
  const params = request.nextUrl.searchParams;
  const report = params.get("report");
  const type = params.get("type");
  if (report !== "daily" && report !== "balance") return fail("report ต้องเป็น daily หรือ balance");
  if (type !== "OP" && type !== "IP") return fail("type ต้องเป็น OP หรือ IP");

  let body: ArReport;
  if (report === "daily") {
    const r = parseRange(params, MAX_DAYS);
    if (!r.ok) return fail(r.error);
    const { start, end } = r.range;
    body = { report, patient_type: type, start, end, month: null, ...toReport(await insightQuery(DAILY_SQL, [start, end, type]), report) };
  } else {
    const m = parseMonth(params.get("month") ?? "", todayIso());
    if (!m) return fail(MONTH_ERROR);
    body = { report, patient_type: type, start: null, end: m.end, month: m.month, ...toReport(await insightQuery(BALANCE_SQL, [m.end, type]), report) };
  }
  if (params.get("format") !== "xlsx") return Response.json(body);

  type XRow = Record<string, string | number | null>;
  const def = REPORTS[report];
  const columns: XlsxColumn<XRow>[] = [
    { key: "account_code", header: def.code, width: 18 },
    { key: "account_name", header: "ชื่อบัญชี", width: 48 },
    { key: "n", header: def.count, type: "count" },
    ...def.money.map((c, i) => ({ key: `m${i}`, header: c.header, width: 20, type: "money" as const })),
  ];
  const flat = (code: string | null, name: string, n: number, values: number[]): XRow =>
    ({ account_code: code, account_name: name, n, ...Object.fromEntries(values.map((v, i) => [`m${i}`, v])) });
  const rows = [...body.rows.map((r) => flat(r.account_code, r.account_name, r.n, r.money)), flat(null, "รวม", body.total.n, body.total.money)];
  const period = report === "daily" ? `${body.start}_${body.end}` : body.month;
  return xlsxResponse(`ar-${report}-${type}-${period}.xlsx`, columns, rows);
}
