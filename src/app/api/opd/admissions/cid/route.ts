import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hisQuery } from "@/lib/db";
import { badRequest, unauthorized } from "@/app/api/fund/_lib/fund";

// PDPA: cid ไม่อยู่ในแถว grid/Excel โหลดเฉพาะตอนเปิด modal รายละเอียด (access_log บันทึกผู้ดูจาก proxy)
const SQL = "SELECT p.cid FROM ovst o JOIN patient p ON p.hn = o.hn WHERE o.vn = ?";

/** GET ?vn=<12 หลัก> -> { cid } (ไม่พบ visit = null) */
export async function GET(request: NextRequest) {
  if (!(await auth())) return unauthorized();
  const vn = request.nextUrl.searchParams.get("vn");
  if (!vn || !/^\d{12}$/.test(vn)) return badRequest("vn ต้องเป็นตัวเลข 12 หลัก");
  const [row] = await hisQuery<{ cid: string | null }>(SQL, [vn]);
  return Response.json({ cid: row?.cid ?? null }, { headers: { "Cache-Control": "no-store" } });
}
