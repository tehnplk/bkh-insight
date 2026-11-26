import { auth } from "@/auth";
import { insightExecute } from "@/lib/db";
import { ACCOUNT_RE } from "../transfer";

const fail = (error: string, status = 400) => Response.json({ error }, { status });
const SIDES = ["ALL", "OP", "IP"];
// แถว OP/IP สร้างจากแถว ALL ของกองทุนเดียวกัน (ไม่มี ALL = ไม่พบกองทุน) ; ALL ชนตัวเองแล้วอัปเดต
const UPSERT_SQL = `INSERT INTO ar_transfer_fund_map (fund_key, side, fund_name, smt_account_name, account_code, ignore, updated_by, updated_at)
SELECT fund_key, $2::text, fund_name, smt_account_name, $3::text, $4::boolean, $5::text, now() FROM ar_transfer_fund_map WHERE fund_key = $1 AND side = 'ALL'
ON CONFLICT (fund_key, side) DO UPDATE SET account_code = EXCLUDED.account_code, ignore = EXCLUDED.ignore, updated_by = EXCLUDED.updated_by, updated_at = now()`;

/**
 * จับคู่กองทุน SMT กับบัญชี (admin เท่านั้น) { fund_key, side?: "ALL" | "OP" | "IP" (ค่าเริ่มต้น ALL), account_code: string | null, ignore: boolean }
 * แถว mapping สร้างตอนนำเข้า ; OP/IP ที่ account_code null และไม่ ignore = ใช้ตาม ALL ; มีผลกับรายการที่นำเข้าครั้งถัดไป (แถวเดิมที่การเงินยังไม่แก้ได้บัญชีใหม่ตอนนำเข้า)
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return fail("unauthorized", 401);
  if (session.user.role !== "admin") return fail("ต้องเป็นผู้ดูแลระบบ", 403);
  const b = await request.json().catch(() => null);
  const key = typeof b?.fund_key === "string" ? b.fund_key : "";
  if (!key || key.length > 200) return fail("fund_key ไม่ถูกต้อง");
  const side = b.side ?? "ALL";
  if (!SIDES.includes(side)) return fail("side ต้องเป็น ALL, OP หรือ IP");
  if (typeof b.ignore !== "boolean") return fail("ignore ต้องเป็น true/false");
  const account = typeof b.account_code === "string" ? b.account_code.trim() : null;
  if (b.ignore ? account : account !== null && !ACCOUNT_RE.test(account)) return fail(b.ignore ? "กองทุนที่ไม่ใช้ต้องไม่ระบุบัญชี" : "รหัสบัญชีต้องเป็นรูปแบบ 4301020105.214");
  const { rowCount } = await insightExecute(UPSERT_SQL, [key, side, account || null, b.ignore, session.user.name ?? "ไม่ทราบชื่อ"]);
  if (!rowCount) return fail("ไม่พบกองทุนนี้", 404);
  return Response.json({ ok: true });
}
