import { auth } from "@/auth";
import { parseCase } from "../ledger";
import { CaseSettledError, runCaseSync } from "../sync";

// ดึงใหม่รายราย { vn } หรือ { an }: ใครที่ login แล้วกดได้ (เหมือน daily) เพราะยอดมาจาก HOSxP ตามกติกาเดิม ผู้ใช้ใส่ยอดเองไม่ได้
// ผู้กดบันทึกใน ar_sync_log.requested_by (mode 'case') แถวที่ลงลิงก์ด้วย sync_id ; งวดปิดแล้ว trigger เลื่อนเข้างวดเปิดเอง
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const c = parseCase(await request.json().catch(() => null));
  if ("error" in c) return Response.json({ error: c.error }, { status: 400 });

  try {
    const result = await runCaseSync(c, session.user.name ?? null);
    if (!result) return Response.json({ error: `ไม่พบลูกหนี้ของ ${"vn" in c ? "VN" : "AN"} นี้ทั้งใน HOSxP และสมุดลูกหนี้` }, { status: 404 });
    return Response.json(result);
  } catch (e) {
    if (e instanceof CaseSettledError) return Response.json({ error: e.message }, { status: 409 });
    console.error("ar-sync case", (e as Error).message);
    return Response.json({ error: "ดึงใหม่ไม่สำเร็จ" }, { status: 500 });
  }
}
