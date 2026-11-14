import { insightQuery } from "@/lib/db";
import { isAuthed, unauthorized } from "../_lib/fund";

/** response ของ GET /api/fund/freshness : ข้อมูลแต่ละแหล่งมีถึงเมื่อไร (ค่า null = ยังไม่มี) */
export type Freshness = {
  /** ดึงยอดลูกหนี้จาก HOSxP สำเร็จล่าสุด "YYYY-MM-DD HH:MI" */
  arSync: string | null;
  /** วันที่รับบริการล่าสุดใน REP ผู้ป่วยนอก / วันจำหน่ายล่าสุดใน REP ผู้ป่วยใน */
  repOp: string | null;
  repIp: string | null;
  /** STM งวดล่าสุดต่อสิทธิ/ประเภท */
  stm: { scheme: string; patient_type: string; period_month: string; transfer_date: string }[];
};

// ตาราง insight ทั้งหมด ไม่แตะ HOSxP
export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  const [[sync], [rep], stm] = await Promise.all([
    insightQuery<{ at: string | null }>("SELECT to_char(max(finished_at), 'YYYY-MM-DD HH24:MI') AS at FROM ar_sync_log WHERE finished_at IS NOT NULL AND error IS NULL"),
    insightQuery<{ op: string | null; ip: string | null }>(
      `SELECT to_char(max(admit_at) FILTER (WHERE patient_type = 'OP'), 'YYYY-MM-DD') AS op,
  to_char(max(discharge_at) FILTER (WHERE patient_type = 'IP'), 'YYYY-MM-DD') AS ip FROM rep_row`,
    ),
    insightQuery<Freshness["stm"][number]>(
      `SELECT DISTINCT ON (scheme, patient_type) scheme, patient_type, period_month::text AS period_month, transfer_date::text AS transfer_date
FROM stm_file ORDER BY scheme, patient_type, period_month DESC, run_no DESC`,
    ),
  ]);
  const body: Freshness = { arSync: sync?.at ?? null, repOp: rep?.op ?? null, repIp: rep?.ip ?? null, stm };
  return Response.json(body);
}
