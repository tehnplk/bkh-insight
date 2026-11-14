import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hisQuery, insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { OPI_BY_DATE, inList, loadLookups } from "@/app/api/fund/_lib/fund";
import { REP_SQL, itemNames, loadFundRules } from "../sql";
import { monthBounds } from "../rules";

export type SuggestItem = { icode: string; name: string; income: string | null; vns: number; share: number; unpaidShare: number | null };
/**
 * response ของ GET /api/admin/ar-funds/suggest?code=&month= : รายการที่พบบ่อยในเคสที่ REP จ่ายกองทุนนี้ เทียบกับเคสที่มีรายการตามกติกาแต่ REP ไม่จ่าย
 * (แบบ smart-statement: พบในเคสได้รับเงินบ่อย แต่ไม่ค่อยพบในเคสไม่ได้รับ = น่าจะเป็นรายการที่ทำให้ได้รับเงิน)
 */
export type SuggestData = { code: string; month: string; paid: number; unpaid: number; minPaid: number; items: SuggestItem[] };

const MIN_SHARE = 0.2;
const MIN_PAID = 5;
const LIMIT = 40;
const CHUNK = 1000;
// his: ~0.9 วินาที/เดือน (ส.ค. 2569 PP 150 VN) ช่วงวันที่ ≤ 1 เดือน FORCE INDEX ตามกฎ opitemrece
const FREQ_SQL = (n: number) => `SELECT o.icode, o.income, COUNT(DISTINCT o.vn) AS vns
FROM ${OPI_BY_DATE}
WHERE o.vstdate BETWEEN ? AND ? AND o.vn IS NOT NULL AND o.paidst = '02' AND ${inList("o.vn", n)}
GROUP BY o.icode, o.income`;
// visit ที่มีรายการตามเงื่อนไขของกติกา (ไม่สนรหัสโรค) ใช้หาเคสที่ REP ไม่จ่าย
const CANDIDATE_SQL = (pt: number, inc: number, ic: number) => `SELECT DISTINCT o.vn
FROM ${OPI_BY_DATE}
WHERE o.vstdate BETWEEN ? AND ? AND o.vn IS NOT NULL AND o.paidst = '02' AND ${inList("o.pttype", pt)}
  AND (${[inc && inList("o.income", inc), ic && inList("o.icode", ic)].filter(Boolean).join(" OR ")})`;

async function frequency(vns: string[], start: string, end: string) {
  const counts = new Map<string, { income: string | null; vns: number }>();
  for (let i = 0; i < vns.length; i += CHUNK) {
    const batch = vns.slice(i, i + CHUNK);
    for (const r of await hisQuery<{ icode: string; income: string | null; vns: number }>(FREQ_SQL(batch.length), [start, end, ...batch])) {
      const c = counts.get(r.icode);
      counts.set(r.icode, { income: r.income, vns: (c?.vns ?? 0) + Number(r.vns) });
    }
  }
  return counts;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  const params = request.nextUrl.searchParams;
  const code = params.get("code") ?? "";
  const month = params.get("month") ?? "";
  const bounds = monthBounds(month, todayIso());
  if (!/^[A-Z][A-Z0-9_]{0,15}$/.test(code) || !bounds) return Response.json({ error: "ต้องระบุ code และ month (YYYY-MM)" }, { status: 400 });

  const rule = (await loadFundRules()).find((r) => r.code === code);
  if (!rule) return Response.json({ error: "ไม่พบกติกา" }, { status: 404 });
  const paidVns = rule.rep_keys.length ? [...new Set((await insightQuery<{ vn: string }>(REP_SQL, [bounds.start, bounds.next, rule.rep_keys])).map((r) => r.vn))] : [];

  const acts = rule.activities.filter((a) => a.active);
  const incomes = [...new Set([...rule.incomes, ...acts.flatMap((a) => a.incomes)])];
  const icodes = [...new Set([...rule.icodes, ...acts.flatMap((a) => a.icodes)])];
  let unpaidVns: string[] = [];
  if (rule.match_mode === "items" && (incomes.length || icodes.length)) {
    const lk = await loadLookups();
    const funds = new Set(rule.hipdata_codes);
    const pts = rule.pttypes.length ? rule.pttypes : [...lk.pttype].filter(([, p]) => funds.has(p.fund)).map(([c]) => c);
    if (pts.length) {
      const paidSet = new Set(paidVns);
      const cand = await hisQuery<{ vn: string }>(CANDIDATE_SQL(pts.length, incomes.length, icodes.length), [bounds.start, bounds.end, ...pts, ...incomes, ...icodes]);
      unpaidVns = cand.map((c) => c.vn).filter((vn) => !paidSet.has(vn));
    }
  }

  const [paidCounts, unpaidCounts] = await Promise.all([frequency(paidVns, bounds.start, bounds.end), frequency(unpaidVns, bounds.start, bounds.end)]);
  const top = paidVns.length >= MIN_PAID
    ? [...paidCounts].filter(([, c]) => c.vns / paidVns.length >= MIN_SHARE)
        .map(([icode, c]) => ({ icode, c, share: c.vns / paidVns.length, unpaidShare: unpaidVns.length ? (unpaidCounts.get(icode)?.vns ?? 0) / unpaidVns.length : null }))
        // แยกเคสได้ดีก่อน (พบในเคสได้รับมากกว่าเคสไม่ได้รับ)
        .sort((a, b) => b.share - (b.unpaidShare ?? 0) - (a.share - (a.unpaidShare ?? 0)) || b.c.vns - a.c.vns)
        .slice(0, LIMIT)
    : [];
  const names = new Map((await itemNames(top.map((t) => t.icode))).map((r) => [r.code, r.name]));
  const body: SuggestData = {
    code, month, paid: paidVns.length, unpaid: unpaidVns.length, minPaid: MIN_PAID,
    items: top.map((t) => ({ icode: t.icode, name: names.get(t.icode) ?? t.icode, income: t.c.income, vns: t.c.vns, share: t.share, unpaidShare: t.unpaidShare })),
  };
  return Response.json(body);
}
