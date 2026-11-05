import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import type { VisitItem, VisitItemsResponse } from "../../types";
import { FULL_NAME_SQL, ITEM_NAME_SQL, badRequest, fundSql, isAuthed, loadLookups, round2, unauthorized } from "../../_lib/fund";

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const vn = request.nextUrl.searchParams.get("vn") ?? "";
  if (!/^\d{1,13}$/.test(vn)) return badRequest("vn ต้องเป็นตัวเลขไม่เกิน 13 หลัก");

  const [lk, [visit], items] = await Promise.all([
    loadLookups(),
    hisQuery<{ vn: string; hn: string; full_name: string; vstdate: string; pttype_name: string; fund_code: string }>(
      `SELECT v.vn, v.hn, ${FULL_NAME_SQL} AS full_name, v.vstdate, IFNULL(t.name, IFNULL(v.pttype, '')) AS pttype_name,
         ${fundSql("t")} AS fund_code
       FROM ovst v LEFT JOIN patient p ON p.hn = v.hn LEFT JOIN pttype t ON t.pttype = v.pttype
       WHERE v.vn = ?`,
      [vn],
    ),
    // รายการเดียวกันที่สั่งหลายครั้งในราคาเดียวกันรวมเป็นแถวเดียว
    hisQuery<{ income: string; icode: string; name: string | null; unitprice: number; qty: number; amount: number }>(
      `SELECT o.income, o.icode, ${ITEM_NAME_SQL} AS name, o.unitprice, SUM(o.qty) AS qty, SUM(o.sum_price) AS amount
       FROM opitemrece o LEFT JOIN s_drugitems s ON s.icode = o.icode
       WHERE o.vn = ?
       GROUP BY o.income, o.icode, o.unitprice, name
       ORDER BY amount DESC, o.icode`,
      [vn],
    ),
  ]);
  if (!visit) return Response.json({ error: "ไม่พบ visit" }, { status: 404 });

  const cats = new Map<string, { amount: number; items: VisitItem[] }>();
  for (const r of items) {
    const amount = Number(r.amount);
    let c = cats.get(r.income);
    if (!c) cats.set(r.income, (c = { amount: 0, items: [] }));
    c.amount += amount;
    c.items.push({ icode: r.icode, name: r.name ?? r.icode, qty: Number(r.qty), unitprice: round2(r.unitprice), amount: round2(amount) });
  }

  const body: VisitItemsResponse = {
    ...visit,
    fund_name: lk.fundName(visit.fund_code),
    total: round2(items.reduce((s, r) => s + Number(r.amount), 0)),
    categories: [...cats]
      .map(([income_code, c]) => ({ income_code, income_name: lk.income.get(income_code) ?? income_code, amount: round2(c.amount), items: c.items }))
      .sort((a, b) => b.amount - a.amount),
  };
  return Response.json(body);
}
