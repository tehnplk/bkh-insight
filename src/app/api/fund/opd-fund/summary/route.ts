import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import type { FundSummary, FundSummaryResponse } from "../../types";
import {
  OPI_BY_DATE, add, badRequest, categoryList, fundOf, fundSql, int, isAuthed, loadLookups, parseRange, pttypeName, round2, unauthorized,
} from "../../_lib/fund";

export async function GET(request: NextRequest) {
  // proxy.ts กันไว้แล้ว แต่ route ที่อ่าน HIS ต้องเช็ค session เองซ้ำ
  if (!(await isAuthed())) return unauthorized();
  const parsed = parseRange(request.nextUrl.searchParams);
  if (!parsed.ok) return badRequest(parsed.error);
  const { start, end } = parsed.range;

  const [lk, visitRows, patientRows, itemRows] = await Promise.all([
    loadLookups(),
    hisQuery<{ pttype: string | null; visits: number }>(
      "SELECT v.pttype, COUNT(*) AS visits FROM ovst v WHERE v.vstdate BETWEEN ? AND ? GROUP BY v.pttype",
      [start, end],
    ),
    // ROLLUP แถว fund = NULL คือจำนวนคนไม่ซ้ำทั้งช่วง (คนเดียวอาจอยู่หลายกองทุน จึงรวมจากรายกองทุนไม่ได้)
    hisQuery<{ fund: string | null; patients: number }>(
      `SELECT ${fundSql("t")} AS fund, COUNT(DISTINCT v.hn) AS patients
       FROM ovst v LEFT JOIN pttype t ON t.pttype = v.pttype
       WHERE v.vstdate BETWEEN ? AND ? GROUP BY fund WITH ROLLUP`,
      [start, end],
    ),
    hisQuery<{ pttype: string; income: string; amount: number }>(
      `SELECT o.pttype, o.income, SUM(o.sum_price) AS amount FROM ${OPI_BY_DATE}
       WHERE o.vstdate BETWEEN ? AND ? AND o.vn IS NOT NULL GROUP BY o.pttype, o.income`,
      [start, end],
    ),
  ]);

  type Acc = { visits: number; amount: number; categories: Map<string, number>; pttypes: Map<string, { visits: number; amount: number; categories: Map<string, number> }> };
  const funds = new Map<string, Acc>();
  const acc = (code: string) => {
    let a = funds.get(code);
    if (!a) funds.set(code, (a = { visits: 0, amount: 0, categories: new Map(), pttypes: new Map() }));
    return a;
  };
  const pt = (a: Acc, code: string) => {
    let p = a.pttypes.get(code);
    if (!p) a.pttypes.set(code, (p = { visits: 0, amount: 0, categories: new Map() }));
    return p;
  };

  for (const r of visitRows) {
    const a = acc(fundOf(lk, r.pttype));
    a.visits += int(r.visits);
    pt(a, r.pttype ?? "").visits += int(r.visits);
  }
  const allCategories = new Map<string, number>();
  for (const r of itemRows) {
    const amount = Number(r.amount);
    const a = acc(fundOf(lk, r.pttype));
    a.amount += amount;
    add(a.categories, r.income, amount);
    const p = pt(a, r.pttype);
    p.amount += amount;
    add(p.categories, r.income, amount);
    add(allCategories, r.income, amount);
  }
  const patients = new Map(patientRows.map((r) => [r.fund, int(r.patients)]));

  const list: FundSummary[] = [...funds]
    .map(([fund_code, a]) => ({
      fund_code,
      fund_name: lk.fundName(fund_code),
      visits: a.visits,
      patients: patients.get(fund_code) ?? 0,
      amount: round2(a.amount),
      categories: categoryList(lk, a.categories),
      pttypes: [...a.pttypes]
        .map(([pttype, p]) => ({ pttype, pttype_name: pttypeName(lk, pttype), visits: p.visits, amount: round2(p.amount),
          categories: categoryList(lk, p.categories) }))
        .sort((x, y) => y.amount - x.amount || y.visits - x.visits),
    }))
    .sort((x, y) => y.amount - x.amount || y.visits - x.visits);

  const body: FundSummaryResponse = {
    start,
    end,
    totals: {
      visits: list.reduce((s, f) => s + f.visits, 0),
      patients: patients.get(null) ?? 0,
      amount: round2([...funds.values()].reduce((s, f) => s + f.amount, 0)),
    },
    categories: categoryList(lk, allCategories),
    funds: list,
  };
  return Response.json(body);
}
