import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hisQuery, insightQuery } from "@/lib/db";
import { inList } from "@/app/api/fund/_lib/fund";

export type FundItem = { icode: string; name: string; units: string | null; income: string | null; unitprice: string | null; nhso_adp_code: string | null; istatus: string | null };
/** response ของ GET /api/admin/ar-funds/items?code= : รายการใน HOSxP ที่กติกาครอบคลุม (หมวดรายรับ + icode) */
export type FundItemsData = { code: string; items: FundItem[] };

// s_drugitems ตารางเล็ก (~ไม่กี่พันแถว) ผ่านการพิสูจน์แล้ว ~0.4 วินาที
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  const code = request.nextUrl.searchParams.get("code") ?? "";
  if (!/^[A-Z][A-Z0-9_]{0,15}$/.test(code)) return Response.json({ error: "code ไม่ถูกต้อง" }, { status: 400 });

  const [rule] = await insightQuery<{ incomes: string[]; icodes: string[] }>("SELECT incomes, icodes FROM ar_fund_rule WHERE code = $1", [code]);
  if (!rule) return Response.json({ error: "ไม่พบกติกา" }, { status: 404 });
  const where = [rule.incomes.length && inList("s.income", rule.incomes.length), rule.icodes.length && inList("s.icode", rule.icodes.length)].filter(Boolean);
  const items = where.length
    ? await hisQuery<FundItem>(
        `SELECT s.icode, CONCAT_WS(' ', s.name, NULLIF(TRIM(s.strength), '')) AS name, s.units, s.income, s.unitprice, s.nhso_adp_code, s.istatus
FROM s_drugitems s WHERE ${where.join(" OR ")} ORDER BY s.istatus = 'Y' DESC, s.name`,
        [...rule.incomes, ...rule.icodes],
      )
    : [];
  const body: FundItemsData = { code, items };
  return Response.json(body);
}
