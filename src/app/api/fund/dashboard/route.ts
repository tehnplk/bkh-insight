import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import type { FundDashboardResponse } from "../types";
import {
  DAY_MS, ITEM_NAME_SQL, OPI_BY_DATE, add, badRequest, categoryList, fundOf, int, isAuthed, isoDate, loadLookups, parseRange, previousRange, round2,
  unauthorized,
} from "../_lib/fund";

const TOP_ITEMS = 10;

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const parsed = parseRange(request.nextUrl.searchParams);
  if (!parsed.ok) return badRequest(parsed.error);
  const r = parsed.range;
  const { start, end } = r;
  const prev = previousRange(r);

  const [lk, visitsByDay, [people], itemsByDay, fundIncome, [prevVisits], [prevAmount], top] = await Promise.all([
    loadLookups(),
    hisQuery<{ d: string; pttype: string | null; visits: number }>(
      "SELECT v.vstdate AS d, v.pttype, COUNT(*) AS visits FROM ovst v WHERE v.vstdate BETWEEN ? AND ? GROUP BY v.vstdate, v.pttype",
      [start, end],
    ),
    hisQuery<{ patients: number }>("SELECT COUNT(DISTINCT v.hn) AS patients FROM ovst v WHERE v.vstdate BETWEEN ? AND ?", [start, end]),
    hisQuery<{ d: string; amount: number }>(
      `SELECT o.vstdate AS d, SUM(o.sum_price) AS amount FROM ${OPI_BY_DATE}
       WHERE o.vstdate BETWEEN ? AND ? AND o.vn IS NOT NULL GROUP BY o.vstdate`,
      [start, end],
    ),
    hisQuery<{ pttype: string; income: string; amount: number }>(
      `SELECT o.pttype, o.income, SUM(o.sum_price) AS amount FROM ${OPI_BY_DATE}
       WHERE o.vstdate BETWEEN ? AND ? AND o.vn IS NOT NULL GROUP BY o.pttype, o.income`,
      [start, end],
    ),
    hisQuery<{ visits: number }>("SELECT COUNT(*) AS visits FROM ovst v WHERE v.vstdate BETWEEN ? AND ?", [prev.start, prev.end]),
    hisQuery<{ amount: number | null }>(
      `SELECT SUM(o.sum_price) AS amount FROM ${OPI_BY_DATE} WHERE o.vstdate BETWEEN ? AND ? AND o.vn IS NOT NULL`,
      [prev.start, prev.end],
    ),
    // รายการหนึ่งแทบทั้งหมดอยู่หมวดเดียว จึงใช้ MAX(income) เป็นหมวดที่แสดง
    hisQuery<{ icode: string; name: string | null; income: string; qty: number; amount: number }>(
      `SELECT x.icode, ${ITEM_NAME_SQL} AS name, x.income, x.qty, x.amount
       FROM (SELECT o.icode, MAX(o.income) AS income, SUM(o.qty) AS qty, SUM(o.sum_price) AS amount
             FROM ${OPI_BY_DATE} WHERE o.vstdate BETWEEN ? AND ? AND o.vn IS NOT NULL
             GROUP BY o.icode ORDER BY amount DESC LIMIT ?) x
       LEFT JOIN s_drugitems s ON s.icode = x.icode
       ORDER BY x.amount DESC`,
      [start, end, TOP_ITEMS],
    ),
  ]);

  const fundVisits = new Map<string, number>();
  const dayVisits = new Map<string, number>();
  for (const v of visitsByDay) {
    add(fundVisits, fundOf(lk, v.pttype), int(v.visits));
    add(dayVisits, v.d, int(v.visits));
  }
  const fundAmount = new Map<string, number>();
  const categories = new Map<string, number>();
  const fundCat = new Map<string, Map<string, number>>();
  for (const x of fundIncome) {
    const fund = fundOf(lk, x.pttype);
    const amount = Number(x.amount);
    add(fundAmount, fund, amount);
    add(categories, x.income, amount);
    let m = fundCat.get(fund);
    if (!m) fundCat.set(fund, (m = new Map()));
    add(m, x.income, amount);
  }
  const dayAmount = new Map(itemsByDay.map((x) => [x.d, Number(x.amount)]));

  const visits = [...fundVisits.values()].reduce((s, n) => s + n, 0);
  const amount = [...fundAmount.values()].reduce((s, n) => s + n, 0);
  // ช่วงก่อนหน้าไม่มีข้อมูลเลย (เช่น ก่อนเริ่มใช้ระบบ) = null แทนการเทียบกับศูนย์
  const pv = int(prevVisits.visits);
  const pa = Number(prevAmount.amount ?? 0);

  const daily: FundDashboardResponse["daily"] = [];
  for (let t = r.startMs; t <= r.endMs; t += DAY_MS) {
    const date = isoDate(t);
    daily.push({ date, visits: dayVisits.get(date) ?? 0, amount: round2(dayAmount.get(date) ?? 0) });
  }

  const body: FundDashboardResponse = {
    start,
    end,
    totals: {
      visits,
      patients: int(people.patients),
      amount: round2(amount),
      avg_per_visit: visits ? round2(amount / visits) : 0,
    },
    previous: pv || pa ? { visits: pv, amount: round2(pa) } : null,
    by_fund: [...new Set([...fundVisits.keys(), ...fundAmount.keys()])]
      .map((fund_code) => ({
        fund_code,
        fund_name: lk.fundName(fund_code),
        visits: fundVisits.get(fund_code) ?? 0,
        amount: round2(fundAmount.get(fund_code) ?? 0),
      }))
      .sort((a, b) => b.amount - a.amount || b.visits - a.visits),
    by_category: categoryList(lk, categories),
    fund_category: [...fundCat].flatMap(([fund_code, m]) =>
      [...m].map(([income_code, a]) => ({ fund_code, income_code, amount: round2(a) })),
    ).sort((a, b) => b.amount - a.amount),
    daily,
    top_items: top.map((x) => ({
      icode: x.icode,
      name: x.name ?? x.icode,
      income_name: lk.income.get(x.income) ?? x.income,
      qty: Number(x.qty),
      amount: round2(x.amount),
    })),
  };
  return Response.json(body);
}
