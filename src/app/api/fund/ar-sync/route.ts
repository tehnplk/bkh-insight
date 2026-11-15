import { auth } from "@/auth";
import { insightQuery } from "@/lib/db";
import { formatThaiDate } from "@/lib/thai-date";
import { closedThrough } from "../ar-trial-balance/trial-balance";
import { addDays, nextMonth } from "./ledger";
import { runSync } from "./sync";

// ดึงยอดลูกหนี้จาก HOSxP ลง ar_ledger: { mode: "daily" } ใครที่ login แล้วกดได้, { mode: "backfill", month: "YYYY-MM" } admin เท่านั้น
// หน้า admin ส่ง backfill ทีละเดือนเรียงจากเก่าไปใหม่ (หนึ่ง request ต่อเดือน ไม่ให้ request เดียวนานเกินไป)
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const mode = body?.mode;
  if (mode !== "daily" && mode !== "backfill") return Response.json({ error: "mode ต้องเป็น daily หรือ backfill" }, { status: 400 });
  if (mode === "backfill" && session.user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  if (mode === "backfill" && typeof body.month !== "string") return Response.json({ error: "ต้องระบุ month (YYYY-MM)" }, { status: 400 });
  // backfill ลงวันที่ตามเดือนนั้นเอง เดือนที่ปิดงวดแล้วจึงห้าม (รายวัน/ตัดหนี้ให้ trigger เลื่อนเข้างวดเปิด)
  if (mode === "backfill") {
    const through = await closedThrough(insightQuery);
    if (through && body.month <= through) return Response.json({ error: `งวดถึง ${formatThaiDate(addDays(`${nextMonth(through)}-01`, -1))} ปิดแล้ว ดึงย้อนหลังเดือนที่ปิดไม่ได้ ต้องเปิดงวดที่หน้า ปิดงวดลูกหนี้ ก่อน` }, { status: 409 });
  }

  try {
    const log = await runSync(mode === "daily" ? { mode } : { mode, month: body.month }, session.user.name ?? null);
    return Response.json(log, { status: log.error ? 500 : 200 });
  } catch (e) {
    if (e instanceof RangeError) return Response.json({ error: e.message }, { status: 400 });
    console.error("ar-sync", (e as Error).message);
    return Response.json({ error: "ดึงยอดไม่สำเร็จ" }, { status: 500 });
  }
}
