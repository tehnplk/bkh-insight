import { todayIso } from "@/lib/thai-date";
import { autoSync, fail, sessionUser, syncMonth } from "../data";
import { validMonth } from "../fwf";

// ดึงรายการขายบัตรจาก HOSxP: { month: "YYYY-MM" } ดึงเดือนนั้น ; {} = เดือนที่ยังไม่เคยดึงตั้งแต่เริ่ม pool ทีละเดือน + เดือนนี้/เดือนก่อน
// ({ force: true } = ดึงเดือนนี้/เดือนก่อนแม้เพิ่งดึง) ; upsert ตาม hos_guid กดซ้ำได้ ไม่ทับวันที่หรือการยกเลิกของการเงิน
export async function POST(request: Request) {
  const user = await sessionUser();
  if (!user) return fail("unauthorized", 401);
  const b = ((await request.json().catch(() => null)) ?? {}) as { month?: unknown; force?: unknown };
  if (b.month != null) {
    if (!validMonth(b.month, todayIso())) return fail("month ต้องเป็น YYYY-MM ตั้งแต่เดือนเริ่ม pool ถึงเดือนปัจจุบัน");
    return Response.json({ months: [b.month], counts: { [b.month]: await syncMonth(b.month, user.name) } });
  }
  return Response.json(await autoSync(user.name, b.force === true));
}
