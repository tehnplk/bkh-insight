import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { badRequest, isAuthed, unauthorized } from "../../_lib/fund";
import { VN } from "../nhso";

/** การปิดสิทธิที่สำเร็จ (prod) ผ่านระบบนี้ของ visit ; closed_at = เวลาที่ สปสช. ตอบ ไม่มีใช้เวลาที่ยิง */
export type CloseLogEntry = { closed_at: string; authen_code: string | null; requested_by: string };

// unique (vn, zone) WHERE ok จึงได้ไม่เกินหนึ่งแถว (prove-query ผ่าน)
const LOG_SQL = "SELECT request_at, response_at, authen_code, requested_by FROM nhso_save_endpoint_log WHERE ok AND zone = 'prod' AND vn = $1";

/** GET ?vn= -> { entry } (ไม่ได้ปิดผ่านระบบนี้ = null) ใช้ใน modal ป้ายปิดสิทธิของ /opd/admissions */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const vn = request.nextUrl.searchParams.get("vn") ?? "";
  if (!VN.test(vn)) return badRequest("vn ต้องเป็นตัวเลข 12 หลัก");
  try {
    const [r] = await insightQuery<{ request_at: string; response_at: string | null; authen_code: string | null; requested_by: string }>(LOG_SQL, [vn]);
    const entry: CloseLogEntry | null = r ? { closed_at: r.response_at ?? r.request_at, authen_code: r.authen_code, requested_by: r.requested_by } : null;
    return Response.json({ entry });
  } catch (e) {
    console.error("close-privilege/log", e);
    return Response.json({ error: `อ่านการปิดสิทธิไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
