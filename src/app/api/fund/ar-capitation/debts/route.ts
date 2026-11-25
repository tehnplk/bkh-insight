import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { parseGridQuery, type GridPage } from "@/lib/grid-query";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { fail, sessionUser } from "../../fwf-card/data";
import type { CapRow } from "../capitation";
import { MONTH_ERROR, loadAccounts, notMigrated, parseMonth, planAccount } from "../data";

export type CapDebtPage = GridPage<CapRow>;

/** GET ?month&account + page/pageSize/q[/format=xlsx]: รายหนี้ตามแผนตัด เรียงลำดับที่ตัด (วันที่ตั้งหนี้, ref) ค้นด้วย VN/AN/ref */
export async function GET(request: NextRequest) {
  if (!(await sessionUser())) return fail("unauthorized", 401);
  const params = request.nextUrl.searchParams;
  const m = parseMonth(params.get("month") ?? "", todayIso());
  if (!m) return fail(MONTH_ERROR);
  // ลำดับคือลำดับที่ใช้ pool จึงไม่มีคอลัมน์ที่ sort ได้
  const grid = parseGridQuery(params, []);
  if (!grid.ok) return fail(grid.error);
  const { page, pageSize, q, format } = grid.query;
  try {
    const account = (await loadAccounts(insightQuery)).find((a) => a.code === params.get("account"));
    if (!account) return fail("บัญชีนี้ไม่ได้ตัดด้วยเงินเหมาจ่าย");
    const { plan } = await planAccount(insightQuery, account, m.month, m.end);
    const rows = q ? plan.rows.filter((r) => [r.ref, r.vn, r.an].some((v) => v?.includes(q))) : plan.rows;
    if (format === "xlsx")
      return xlsxResponse<CapRow>(`ar-capitation-${account.code}-${m.month}.xlsx`, [
        { key: "ref_date", header: "วันที่ตั้งหนี้", width: 12 },
        { key: "patient_type", header: "OP/IP", width: 6 },
        { key: "vn", header: "VN", width: 14 },
        { key: "an", header: "AN", width: 12 },
        { key: "ref", header: "เลขที่หนี้", width: 12 },
        { key: "balance", header: "คงเหลือ (บาท)", width: 14, type: "money" },
        { key: "settle", header: "ตัดด้วยเหมาจ่าย (บาท)", width: 16, type: "money" },
        { key: "diff", header: "ส่วนต่าง (บาท)", width: 14, type: "money" },
      ], rows);
    const body: CapDebtPage = { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
    return Response.json(body);
  } catch (e) {
    return notMigrated(e);
  }
}
