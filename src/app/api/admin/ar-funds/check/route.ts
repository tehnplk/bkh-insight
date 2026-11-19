import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hisQuery, insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { fundOf, inList, loadLookups } from "@/app/api/fund/_lib/fund";
import { ITEMS_SQL, REP_SQL, TOTALS_SQL, byChunks, loadFundRules } from "../sql";
import { checkRules, monthBounds, ruleReady, type Diag, type ItemRow, type RepRow, type RuleCheck, type VisitInfo, type VisitTotal } from "../rules";

/** response ของ GET /api/admin/ar-funds/check?month=YYYY-MM */
export type FundCheckData = { month: string; start: string; end: string; checks: RuleCheck[] };

// SQL ผ่านการพิสูจน์กับฐานจริงแล้ว (ส.ค. 2569): รายการ ~1 วินาที/เดือน (ix_vstdate), ยอดทั้ง visit ~1 วินาที (UCS 10,459 VN),
// วินิจฉัยใช้ ix_vn_icd_unique, ovst ใช้ ix_vn_unique, REP ~60 ms ; ITEMS_SQL/TOTALS_SQL อยู่ที่ ../sql.ts

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });

  const month = request.nextUrl.searchParams.get("month") ?? "";
  const bounds = monthBounds(month, todayIso());
  if (!bounds) return Response.json({ error: "month ต้องเป็น YYYY-MM ตั้งแต่ 2024-10 ถึงเดือนปัจจุบัน" }, { status: 400 });
  const { start, end, next } = bounds;

  const [rules, lk] = await Promise.all([loadFundRules(), loadLookups()]);
  const ready = rules.filter(ruleReady);
  const itemRules = ready.filter((r) => r.match_mode === "items");
  const totalRules = ready.filter((r) => r.match_mode !== "items");
  const ptOf = (rs: typeof rules) => {
    const funds = new Set(rs.flatMap((r) => r.hipdata_codes));
    return [...lk.pttype].filter(([, p]) => funds.has(p.fund)).map(([c]) => c);
  };
  const itemPts = ptOf(itemRules);
  const totalPts = ptOf(totalRules);
  const incomes = [...new Set(itemRules.flatMap((r) => [...r.incomes, ...r.activities.filter((a) => a.active).flatMap((a) => a.incomes)]))];
  const icodes = [...new Set(itemRules.flatMap((r) => [...r.icodes, ...r.required_icodes, ...r.activities.filter((a) => a.active).flatMap((a) => a.icodes)]))];
  const repKeys = [...new Set(rules.flatMap((r) => r.rep_keys))];

  const [rawItems, rawTotals, rep] = await Promise.all([
    itemPts.length && (incomes.length || icodes.length)
      ? hisQuery<Omit<ItemRow, "fund">>(ITEMS_SQL("range", itemPts.length, incomes.length, icodes.length), [start, end, ...itemPts, ...incomes, ...icodes])
      : Promise.resolve([]),
    totalPts.length ? hisQuery<Omit<VisitTotal, "fund">>(TOTALS_SQL("range", totalPts.length), [start, end, ...totalPts]) : Promise.resolve([]),
    repKeys.length ? insightQuery<RepRow>(REP_SQL, [start, next, repKeys]) : Promise.resolve([]),
  ]);
  const items: ItemRow[] = rawItems.map((r) => ({ ...r, fund: fundOf(lk, r.pttype) }));
  const totals: VisitTotal[] = rawTotals.map((r) => ({ ...r, fund: fundOf(lk, r.pttype) }));
  const repVns = [...new Set(rep.map((r) => r.vn))];

  // วินิจฉัย: ของ visit ที่มีรายการ / ยอด / REP จ่าย (ใช้ทั้งเงื่อนไขรหัสโรคและเหตุผล) เฉพาะเมื่อมีกติกาที่ใช้รหัสโรค
  const diags = new Map<string, Diag[]>();
  if (ready.some((r) => r.icd10.length || r.activities.some((a) => a.active && a.icd10.length))) {
    const vns = [...new Set([...items.map((i) => i.vn), ...totals.map((t) => t.vn), ...repVns])];
    for (const d of await byChunks<{ vn: string; icd10: string; diagtype: string | null }>(vns, (n) => `SELECT vn, icd10, diagtype FROM ovstdiag WHERE ${inList("vn", n)}`))
      diags.set(d.vn, [...(diags.get(d.vn) ?? []), { icd10: d.icd10.toUpperCase(), pdx: d.diagtype?.trim() === "1" }]);
  }
  // สิทธิของ visit ที่ REP จ่าย (เหตุผลของราย REP จ่ายแต่ไม่เข้าเกณฑ์) ; รายการของ visit เหล่านี้ที่อยู่นอกเดือนจะไม่มีในชุดรายการ
  const visits = new Map<string, VisitInfo>(
    (await byChunks<{ vn: string; pttype: string | null }>(repVns, (n) => `SELECT vn, pttype FROM ovst WHERE ${inList("vn", n)}`)).map((v) => [v.vn, { pttype: v.pttype, fund: fundOf(lk, v.pttype) }]),
  );
  const body: FundCheckData = { month, start, end, checks: checkRules(rules, items, diags, rep, totals, visits) };
  return Response.json(body);
}
