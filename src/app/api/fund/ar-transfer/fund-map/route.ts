import { auth } from "@/auth";
import { insightExecute } from "@/lib/db";
import { ACCOUNT_RE } from "../transfer";

const fail = (error: string, status = 400) => Response.json({ error }, { status });

/**
 * จับคู่กองทุน SMT กับบัญชี (admin เท่านั้น) { fund_key, account_code: string | null, ignore: boolean }
 * แถว mapping สร้างตอนนำเข้า ; มีผลกับรายการที่นำเข้าครั้งถัดไป (แถวเดิมที่การเงินยังไม่แก้ได้บัญชีใหม่ตอนนำเข้า)
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return fail("unauthorized", 401);
  if (session.user.role !== "admin") return fail("ต้องเป็นผู้ดูแลระบบ", 403);
  const b = await request.json().catch(() => null);
  const key = typeof b?.fund_key === "string" ? b.fund_key : "";
  if (!key || key.length > 200) return fail("fund_key ไม่ถูกต้อง");
  if (typeof b.ignore !== "boolean") return fail("ignore ต้องเป็น true/false");
  const account = typeof b.account_code === "string" ? b.account_code.trim() : null;
  if (b.ignore ? account : account !== null && !ACCOUNT_RE.test(account)) return fail(b.ignore ? "กองทุนที่ไม่ใช้ต้องไม่ระบุบัญชี" : "รหัสบัญชีต้องเป็นรูปแบบ 4301020105.214");
  const { rowCount } = await insightExecute(
    "UPDATE ar_transfer_fund_map SET account_code = $2, ignore = $3, updated_by = $4, updated_at = now() WHERE fund_key = $1",
    [key, account || null, b.ignore, session.user.name ?? "ไม่ทราบชื่อ"],
  );
  if (!rowCount) return fail("ไม่พบกองทุนนี้", 404);
  return Response.json({ ok: true });
}
