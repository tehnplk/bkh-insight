import { auth } from "@/auth";
import { insightQuery } from "@/lib/db";

/** งวดที่นำเข้าแล้ว: หนึ่งแถวต่อ (สิทธิ, OP/IP, เดือน) พร้อมครั้งที่ที่มี */
export type StmPeriod = { scheme: string; patient_type: string; period_month: string; runs: number[] };

export async function GET() {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  // shortcut: ไม่จำกัดช่วง (ปีละไม่เกิน ~50 แถว) ถ้าเก็บหลายปีจนช้าค่อยรับปีงบเป็น param
  const rows = await insightQuery<StmPeriod>(
    `SELECT scheme, patient_type, period_month, array_agg(run_no ORDER BY run_no) AS runs
     FROM stm_file
     GROUP BY scheme, patient_type, period_month
     ORDER BY period_month`,
  );
  return Response.json(rows);
}
