import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import type { ClaimOverviewResponse, ClaimStatus, ClaimTotals } from "../types";
import {
  DAY_MS, UNKNOWN_FUND, UNKNOWN_NAME, badRequest, fundOf, int, isAuthed, isoDate, loadLookups, parseRange, previousRange, round2,
  unauthorized,
} from "../_lib/fund";
import { CLAIM_JOINS, STATUS_SQL, VISIT_AMOUNT_JOIN } from "../_lib/claim";

type Row = { vstdate: string; pttype: string | null; main_dep: string | null; status: ClaimStatus; visits: number; amount: number };

const SQL = `
SELECT t.vstdate, t.pttype, t.main_dep, t.status, COUNT(*) AS visits, SUM(t.amount) AS amount
FROM (
  SELECT o.vstdate, o.pttype, o.main_dep, COALESCE(x.amt, 0) AS amount, ${STATUS_SQL} AS status
  FROM ovst o
  ${VISIT_AMOUNT_JOIN}
  ${CLAIM_JOINS}
  WHERE o.vstdate BETWEEN ? AND ?
) t
GROUP BY t.vstdate, t.pttype, t.main_dep, t.status`;

const query = (start: string, end: string) => hisQuery<Row>(SQL, [start, end, start, end]);

const empty = (): ClaimTotals => ({
  visits: 0,
  amount: 0,
  closed: { visits: 0, amount: 0 },
  authen_only: { visits: 0, amount: 0 },
  none: { visits: 0, amount: 0 },
});
function addTo(t: ClaimTotals, r: Row) {
  const v = int(r.visits);
  const a = Number(r.amount);
  t.visits += v;
  t.amount += a;
  t[r.status].visits += v;
  t[r.status].amount += a;
}
const rounded = (t: ClaimTotals): ClaimTotals => ({
  visits: t.visits,
  amount: round2(t.amount),
  closed: { visits: t.closed.visits, amount: round2(t.closed.amount) },
  authen_only: { visits: t.authen_only.visits, amount: round2(t.authen_only.amount) },
  none: { visits: t.none.visits, amount: round2(t.none.amount) },
});
function group(rows: Row[], key: (r: Row) => string) {
  const m = new Map<string, ClaimTotals>();
  for (const r of rows) {
    const k = key(r);
    let t = m.get(k);
    if (!t) m.set(k, (t = empty()));
    addTo(t, r);
  }
  return m;
}

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const parsed = parseRange(request.nextUrl.searchParams);
  if (!parsed.ok) return badRequest(parsed.error);
  const r = parsed.range;
  const { start, end } = r;
  const prev = previousRange(r);

  const [lk, deps, rows] = await Promise.all([
    loadLookups(),
    hisQuery<{ code: string; name: string | null }>("SELECT depcode AS code, department AS name FROM kskdepartment"),
    query(start, end),
  ]);
  // ทีละช่วง: query นี้อ่าน opitemrece (MyISAM) ถ้ารันพร้อมกันจะถือ table lock นานขึ้น
  const prevRows = await query(prev.start, prev.end);

  const fundKey = (x: Row) => fundOf(lk, x.pttype);
  const depKey = (x: Row) => x.main_dep?.trim() || UNKNOWN_FUND;
  const depName = new Map(deps.map((d) => [d.code, d.name ?? d.code]));

  const totals = group(rows, () => "").get("") ?? empty();
  const prevTotals = group(prevRows, () => "").get("") ?? empty();
  const funds = group(rows, fundKey);
  const prevFunds = group(prevRows, fundKey);
  const days = group(rows, (x) => x.vstdate);

  const daily: ClaimOverviewResponse["daily"] = [];
  for (let t = r.startMs; t <= r.endMs; t += DAY_MS) {
    const date = isoDate(t);
    daily.push({ date, ...rounded(days.get(date) ?? empty()) });
  }

  const body: ClaimOverviewResponse = {
    start,
    end,
    totals: rounded(totals),
    previous: prevTotals.visits ? rounded(prevTotals) : null,
    by_fund: [...new Set([...funds.keys(), ...prevFunds.keys()])]
      .map((fund_code) => ({
        fund_code,
        fund_name: lk.fundName(fund_code),
        prev_visits: prevFunds.get(fund_code)?.visits ?? 0,
        prev_amount: round2(prevFunds.get(fund_code)?.amount ?? 0),
        ...rounded(funds.get(fund_code) ?? empty()),
      }))
      .sort((a, b) => b.amount - a.amount || b.visits - a.visits),
    by_department: [...group(rows, depKey)]
      .map(([dep_code, t]) => ({
        dep_code,
        dep_name: dep_code === UNKNOWN_FUND ? UNKNOWN_NAME : (depName.get(dep_code) ?? dep_code),
        ...rounded(t),
      }))
      .sort((a, b) => b.amount - a.amount || b.visits - a.visits),
    daily,
  };
  return Response.json(body);
}
