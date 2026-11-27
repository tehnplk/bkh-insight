import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { insightQuery } from "@/lib/db";
import { closedThrough } from "../../ar-trial-balance/trial-balance";
import { loadAccounts, loadFunds, loadPending, loadSummaryRows, parseFy, type AccountOption, type FundMapRow } from "../data";
import { pendingBatches, summarize, type PendingBatch, type SummaryRow } from "../transfer";

/** response ของ GET /api/fund/ar-transfer/summary?fy= */
export type ArTransferSummary = {
  fy: number;
  /** เดือนของปีงบ YYYY-MM ต.ค.→ก.ย. */
  months: string[];
  /** ยอดรับแล้วต่อบัญชีต่อเดือนตามวันที่ใบเสร็จ + รอออกใบเสร็จ (pending) ไม่นับที่ยกเลิก */
  summary: SummaryRow[];
  /** ชุดโอนที่รอออกใบเสร็จทุกปีงบ (ไม่ขึ้นกับ fy) */
  pending: PendingBatch[];
  funds: FundMapRow[];
  accounts: AccountOption[];
  /** เดือนล่าสุดที่ปิดงวด YYYY-MM ; ลงรับ/แก้รายการที่วันที่ใบเสร็จถึงเดือนนี้ไม่ได้ */
  closed_through: string | null;
  admin: boolean;
};

const fyMonths = (fy: number) => Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(fy - 544, 9 + i, 1)).toISOString().slice(0, 7));

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const fy = parseFy(request.nextUrl.searchParams);
  if (fy === null) return Response.json({ error: "fy ไม่ถูกต้อง" }, { status: 400 });
  const [funds, through, rows, pending] = await Promise.all([loadFunds(), closedThrough(insightQuery), loadSummaryRows(fy), loadPending()]);
  const accounts = await loadAccounts(funds);
  const body: ArTransferSummary = {
    fy,
    months: fyMonths(fy),
    summary: summarize(rows),
    pending: pendingBatches(pending),
    funds,
    accounts,
    closed_through: through,
    admin: session.user.role === "admin",
  };
  return Response.json(body);
}
