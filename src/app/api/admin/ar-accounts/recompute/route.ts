import { auth } from "@/auth";
import { recomputeAccounts } from "@/app/api/fund/ar-sync/sync";

// ใส่บัญชีให้รายการใน ledger ที่ account_code ยังเป็น NULL ตาม mapping ปัจจุบัน (กดหลังแก้ mapping)
export async function POST() {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    return Response.json({ updated: await recomputeAccounts() });
  } catch (e) {
    console.error("ar-accounts/recompute", (e as Error).message);
    return Response.json({ error: "คำนวณบัญชีใหม่ไม่สำเร็จ" }, { status: 500 });
  }
}
