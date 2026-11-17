import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import { badRequest, isAuthed, unauthorized } from "@/app/api/fund/_lib/fund";
import { todayIso } from "@/lib/thai-date";
import { FY_BACK, fiscalMonths, fiscalYearOf, fiscalYearRange, parseFiscalYear } from "@/app/api/fund/uc-dashboard/dashboard";
import { fillMonths, type MalnutritionFyResponse } from "../overview/types";

// รายเดือนทั้งปีงบ: AN ไม่ซ้ำ (EXISTS) และ AdjRW ของ ipt ; ทั้งปีราว 0.5–0.7 วินาทีบน replica
const MALNUTRITION_MONTH_SQL = `
  SELECT DATE_FORMAT(i.dchdate, '%Y-%m') AS month, COUNT(*) AS cases, SUM(i.adjrw) AS adjrw_sum, COUNT(i.adjrw) AS adjrw_n
  FROM ipt i
  WHERE i.dchdate BETWEEN ? AND ?
    AND EXISTS (SELECT 1 FROM iptdiag d WHERE d.an = i.an AND LEFT(d.icd10, 3) BETWEEN 'E40' AND 'E46')
  GROUP BY month
  ORDER BY month`;

type Num = number | string | null;

/** GET /api/home/malnutrition-fy?fy=2569 */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const today = todayIso();
  const currentFy = fiscalYearOf(today);
  const fy = parseFiscalYear(request.nextUrl.searchParams.get("fy") ?? "", currentFy);
  if (fy === null) return badRequest(`fy ต้องเป็นปีงบ พ.ศ. ${currentFy - FY_BACK}–${currentFy}`);
  // ปีงบปัจจุบันจบที่วันนี้
  const range = fiscalYearRange(fy, today);
  const rows = await hisQuery<{ month: string; cases: Num; adjrw_sum: Num }>(MALNUTRITION_MONTH_SQL, [range.start, range.end]);
  const body: MalnutritionFyResponse = { fy, months: fillMonths(rows, fiscalMonths(fy), range.end) };
  return Response.json(body);
}
