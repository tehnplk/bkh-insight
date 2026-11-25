import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { insightQuery } from "@/lib/db";
import { closedThrough } from "../../ar-trial-balance/trial-balance";
import { loadAccounts, loadFunds, loadRows, parseFy, type AccountOption, type FundMapRow } from "../data";
import { summarize, type SummaryRow } from "../transfer";

/** response ของ GET /api/fund/ar-transfer/summary?fy= */
export type ArTransferSummary = {
  fy: number;
  /** เดือนของปีงบ YYYY-MM ต.ค.→ก.ย. */
  months: string[];
  /** ยอดรับต่อบัญชีต่อเดือนตามวันที่โอน ไม่นับที่ยกเลิก */
  summary: SummaryRow[];
  funds: FundMapRow[];
  accounts: AccountOption[];
  /** เดือนล่าสุดที่ปิดงวด YYYY-MM ; รายการถึงเดือนนี้เพิ่ม/แก้ไม่ได้ */
  closed_through: string | null;
  admin: boolean;
};

const fyMonths = (fy: number) => Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(fy - 544, 9 + i, 1)).toISOString().slice(0, 7));

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const fy = parseFy(request.nextUrl.searchParams);
  if (fy === null) return Response.json({ error: "fy ไม่ถูกต้อง" }, { status: 400 });
  const [funds, through] = await Promise.all([loadFunds(), closedThrough(insightQuery)]);
  const accounts = await loadAccounts(funds);
  const rows = await loadRows(fy, accounts);
  const body: ArTransferSummary = {
    fy,
    months: fyMonths(fy),
    summary: summarize(rows.map((r) => ({ ...r, cancelled: r.status === "cancelled" }))),
    funds,
    accounts,
    closed_through: through,
    admin: session.user.role === "admin",
  };
  return Response.json(body);
}
