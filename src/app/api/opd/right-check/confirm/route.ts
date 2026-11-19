import { auth } from "@/auth";
import { hisQuery } from "@/lib/db";
import { badRequest, fundSql, unauthorized } from "@/app/api/fund/_lib/fund";
import { CONFIRMABLE, VN, compareSrm } from "../srm";
import { confirmSrm, loadSrmCache } from "../cache";

// ยืนยันใช้สิทธิของ HOSxP สำหรับ visit ที่ผลตรวจ สปสช. ไม่ตรง/ไม่พบสิทธิ (ต่อ HN ใน srm_right_check)
// สิทธิ/HCODE อ่านจาก HOSxP ที่ server ไม่เชื่อค่าจาก client ; การยืนยันแสดงเฉพาะเมื่อสิทธิใน HOSxP ยังเท่าค่าที่บันทึก (confirmedFor)

// สิทธิของ visit แบบเดียวกับ VISIT_SQL ของ /api/opd/right-check (ix_vn_unique + eq_ref) params: vn
const VISIT_SQL = `SELECT o.hn, ${fundSql("t")} AS fund, vp.hospmain
FROM ovst o
LEFT JOIN pttype t ON t.pttype = o.pttype
LEFT JOIN visit_pttype vp ON vp.vn = o.vn AND vp.pttype = o.pttype
WHERE o.vn = ?`;

const conflict = (error: string) => Response.json({ error }, { status: 409 });

/** POST { vn } -> SrmConfirm ({ by, at, fund, hospmain }) */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  const vn = (await request.json().catch(() => null))?.vn;
  if (typeof vn !== "string" || !VN.test(vn)) return badRequest("VN ต้องเป็นตัวเลข 12 หลัก");

  try {
    const [v] = await hisQuery<{ hn: string; fund: string | null; hospmain: string | null }>(VISIT_SQL, [vn]);
    if (!v) return Response.json({ error: "ไม่พบ visit นี้ใน HOSxP" }, { status: 404 });
    const cached = (await loadSrmCache([v.hn])).get(v.hn);
    if (!cached) return conflict("ยังไม่มีผลตรวจสิทธิกับ สปสช. ใน 24 ชั่วโมง ให้ตรวจสอบสิทธิก่อน");
    const his = { vn, hn: v.hn, name: "", pttype_name: null, hospsub: null, fund: v.fund, hospmain: v.hospmain };
    if (!CONFIRMABLE.has(compareSrm(his, cached.srm).status)) return conflict("สิทธิใน HOSxP ตรงกับ สปสช. แล้ว ไม่ต้องยืนยัน");
    const confirmed = await confirmSrm(v.hn, session.user.name ?? "ไม่ทราบชื่อ", v.fund, v.hospmain);
    if (!confirmed) return conflict("ผลตรวจสิทธิหมดอายุ ให้ตรวจสอบสิทธิใหม่ก่อน");
    return Response.json(confirmed);
  } catch (e) {
    console.error("opd/right-check/confirm", e instanceof Error ? e.message : e);
    return Response.json({ error: "บันทึกการยืนยันไม่สำเร็จ ลองอีกครั้ง" }, { status: 500 });
  }
}
