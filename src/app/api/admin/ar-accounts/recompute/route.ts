import { auth } from "@/auth";
import { recomputeLedger } from "@/app/api/fund/ar-sync/sync";

// คำนวณบัญชีของหนี้ทั้ง ledger ใหม่ตามกติกาบัญชี: { apply: false } ดูผลอย่างเดียว (ค่าเริ่มต้น), { apply: true } ปรับสมุด
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    return Response.json(await recomputeLedger(body?.apply === true));
  } catch (e) {
    console.error("ar-accounts/recompute", (e as Error).message);
    return Response.json({ error: "คำนวณบัญชีใหม่ไม่สำเร็จ" }, { status: 500 });
  }
}
