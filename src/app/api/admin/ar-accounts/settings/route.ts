import { auth } from "@/auth";
import { insightQuery } from "@/lib/db";

const ACCOUNT_RE = /^\d{10}\.(\d{3}|\d{5})$/;

// ตั้งบัญชีคู่ของลูกหนี้หนึ่งบัญชี: { code, revenue_code, diff_under_code, diff_over_code, settles_by_stm }
// บัญชีรายได้/ส่วนต่างเป็นรหัสผังบัญชีหมวด 4 ที่ไม่ได้อยู่ใน ar_account จึงตรวจแค่รูปแบบ ; ค่าว่าง = ยังไม่กำหนด
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  const b = await request.json().catch(() => null);
  if (!b || typeof b.code !== "string") return Response.json({ error: "ต้องระบุ code" }, { status: 400 });
  const codes: Record<string, string | null> = {};
  for (const k of ["revenue_code", "diff_under_code", "diff_over_code"]) {
    const v = typeof b[k] === "string" ? b[k].trim() : "";
    if (v && !ACCOUNT_RE.test(v)) return Response.json({ error: `${v} ไม่ใช่รหัสบัญชีรูปแบบ 0000000000.000` }, { status: 400 });
    codes[k] = v || null;
  }
  if (typeof b.settles_by_stm !== "boolean") return Response.json({ error: "settles_by_stm ต้องเป็น true/false" }, { status: 400 });
  const rows = await insightQuery<{ code: string }>(
    "UPDATE ar_account SET revenue_code = $2, diff_under_code = $3, diff_over_code = $4, settles_by_stm = $5 WHERE code = $1 RETURNING code",
    [b.code, codes.revenue_code, codes.diff_under_code, codes.diff_over_code, b.settles_by_stm],
  );
  if (!rows.length) return Response.json({ error: "ไม่พบบัญชีนี้ในผังบัญชี" }, { status: 404 });
  return Response.json(rows[0]);
}
