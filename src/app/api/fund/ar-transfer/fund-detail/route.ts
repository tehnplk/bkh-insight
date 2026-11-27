import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { todayIso } from "@/lib/thai-date";
import { parseFy } from "../data";
import { SMT_SOURCES, cachedSmt, smtErrorText, type SmtSource } from "../smt";
import { fundDetail, type FundDetail } from "../transfer";

/** response ของ GET /api/fund/ar-transfer/fund-detail?fy=&fund_key= */
export type FundDetailResult = FundDetail & { fy: number; fund_key: string };

/** fund_key = budgetSource|mophId|mouGrpCode ไม่รวมปี (fundKey ใน transfer.ts) */
const FUND_KEY_RE = /^[A-Z]{1,10}\|[^|]{0,40}\|[^|]{0,20}$/;

/** รายการโอนจริงจาก SMT ของกองทุนหนึ่งในปีงบ (วันที่โอน) ให้ตัดสินว่าควรจับคู่บัญชีไหน ; ทุกคนที่ login ดูได้ */
export async function GET(request: NextRequest) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const fy = parseFy(params);
  if (fy === null) return Response.json({ error: "fy ไม่ถูกต้อง" }, { status: 400 });
  const key = params.get("fund_key") ?? "";
  const source = key.split("|")[0] as SmtSource;
  if (!FUND_KEY_RE.test(key) || !SMT_SOURCES.includes(source)) return Response.json({ error: "fund_key ไม่ถูกต้อง" }, { status: 400 });
  try {
    const body: FundDetailResult = { fy, fund_key: key, ...fundDetail(await cachedSmt(fy, todayIso(), source), key) };
    return Response.json(body);
  } catch (e) {
    return Response.json({ error: smtErrorText(e as Error) }, { status: 502 });
  }
}
