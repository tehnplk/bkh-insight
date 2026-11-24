import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { badRequest, isAuthed, unauthorized } from "../_lib/fund";
import { fiscalYearOf, parseFiscalYear } from "../uc-dashboard/dashboard";
import type { FundRow, MetricRow, StmTrendResponse } from "./trend";

// ข้อมูลเล็ก (~40 ms ทั้งสอง query) จึงไม่ cache

// ยอดต่อกองทุน = stm_file.paid_total (ก่อนหัก ไม่ใช่ net_total) ; ตัด *_CALC ที่เป็นยอดคำนวณได้ กันนับซ้ำ
const FUNDS_SQL = `SELECT f.period_month, f.scheme, f.patient_type, a.key AS fund, SUM(a.value::numeric) AS amount
FROM stm_file f
JOIN stm_summary s ON s.stm_file_id = f.id
CROSS JOIN LATERAL jsonb_each_text(s.amounts) a
WHERE f.period_month BETWEEN $1 AND $2 AND a.key !~ '_CALC$'
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, 4`;

const METRICS_SQL = `WITH fl AS (
  SELECT f.period_month, f.scheme, f.patient_type,
         COUNT(*) AS files,
         MIN(f.run_no) AS first_run_no,
         (ARRAY_AGG(f.transfer_date - ((f.period_month + INTERVAL '1 month')::date - 1) ORDER BY f.run_no))[1] AS lag_first_days,
         AVG(f.transfer_date - ((f.period_month + INTERVAL '1 month')::date - 1))::numeric(8,1) AS lag_avg_days,
         MAX(f.transfer_date - ((f.period_month + INTERVAL '1 month')::date - 1)) AS lag_max_days
  FROM stm_file f
  WHERE f.period_month BETWEEN $1::date AND $2::date
  GROUP BY 1, 2, 3
), sm AS (
  SELECT f.period_month, f.scheme, f.patient_type,
         SUM(s.paid_total) AS paid_all,
         SUM(s.claim_total) FILTER (WHERE s.section = 'normal') AS claim_normal
  FROM stm_file f JOIN stm_summary s ON s.stm_file_id = f.id
  WHERE f.period_month BETWEEN $1::date AND $2::date
  GROUP BY 1, 2, 3
), rw AS (
  SELECT f.period_month, f.scheme, f.patient_type,
         COUNT(*) AS cases,
         SUM(r.adjrw) AS rw_all,
         SUM(r.adjrw) FILTER (WHERE d.amt > 0) AS rw_drg,
         SUM(d.amt) FILTER (WHERE d.amt > 0) AS drg_amount
  FROM stm_file f JOIN stm_row r ON r.stm_file_id = f.id
  CROSS JOIN LATERAL (SELECT (r.fund_amounts ->> CASE f.scheme WHEN 'UCS' THEN 'IP' ELSE 'CARE' END)::numeric AS amt) d
  WHERE f.period_month BETWEEN $1::date AND $2::date
    AND f.patient_type = 'IP' AND r.section = 'normal' AND r.adjrw > 0
  GROUP BY 1, 2, 3
)
SELECT fl.period_month, fl.scheme, fl.patient_type, fl.files,
       sm.paid_all, sm.claim_normal,
       rw.cases, rw.rw_all, rw.rw_drg, rw.drg_amount,
       fl.first_run_no, fl.lag_first_days, fl.lag_avg_days, fl.lag_max_days
FROM fl
LEFT JOIN sm USING (period_month, scheme, patient_type)
LEFT JOIN rw USING (period_month, scheme, patient_type)
ORDER BY 1, 2, 3`;

type Raw<T> = { [K in keyof T]: T[K] extends number | null ? string | number | null : T[K] };
const NUM_KEYS = ["files", "paid_all", "claim_normal", "cases", "rw_all", "rw_drg", "drg_amount", "first_run_no", "lag_first_days", "lag_avg_days", "lag_max_days"] as const;
// pg คืน numeric/bigint เป็น string ; null คงเป็น null (= ไม่มีข้อมูล ไม่ใช่ 0)
const n = (v: string | number | null) => (v === null ? null : Number(v));

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const raw = request.nextUrl.searchParams.get("fy");
  const currentFy = fiscalYearOf(todayIso());
  const fy = raw ? parseFiscalYear(raw, currentFy) : currentFy;
  if (fy === null) return badRequest("fy ไม่ถูกต้อง");

  const params = [`${fy - 544}-10-01`, `${fy - 543}-09-01`];
  const [funds, months] = await Promise.all([
    insightQuery<Raw<FundRow>>(FUNDS_SQL, params),
    insightQuery<Raw<MetricRow>>(METRICS_SQL, params),
  ]);
  const body: StmTrendResponse = {
    fy,
    funds: funds.map((r) => ({ ...r, amount: Number(r.amount) })),
    months: months.map((r) => ({ ...r, ...Object.fromEntries(NUM_KEYS.map((k) => [k, n(r[k])])) }) as MetricRow),
  };
  return Response.json(body);
}
