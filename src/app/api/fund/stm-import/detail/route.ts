import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { insightQuery } from "@/lib/db";
import type { StmSection } from "../stm";

type Num = string; // numeric ของ pg มาเป็น string

/** response ของ /api/fund/stm-import/detail (modal ใน /fund/stm-import) */
export type StmFileDetail = {
  file: {
    doc_no: string;
    file_name: string;
    scheme: string;
    patient_type: string;
    hcode: string;
    period_month: string;
    run_no: number;
    printed_at: string | null;
    transfer_date: string;
    paid_total: Num;
    deduction: Num;
    net_total: Num;
    row_count: number;
    imported_by: string | null;
    imported_at: string;
  };
  reps: { section: StmSection; rep_no: string; period_label: string | null; cases: number | null; passed: number | null; claim_total: Num | null; paid_total: Num; source: string | null }[];
  /** ยอดรวมรายกองทุน/หมวดจากชีตสรุป */
  funds: { fund: string; amount: Num }[];
};

export async function GET(request: NextRequest) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[1-9]\d{0,17}$/.test(id)) return Response.json({ error: "id ต้องเป็นจำนวนเต็มบวก" }, { status: 400 });

  const [[file], reps, funds] = await Promise.all([
    insightQuery<StmFileDetail["file"]>(
      `SELECT doc_no, file_name, scheme, patient_type, hcode, period_month, run_no, printed_at, transfer_date,
         paid_total, deduction, net_total, row_count, imported_by, imported_at
       FROM stm_file WHERE id = $1`,
      [id],
    ),
    // shortcut: ไม่แบ่งหน้า (ไฟล์จริงมากสุด ~30 REP) ถ้าเจอไฟล์ที่เกิน 500 ค่อยแบ่งหน้า
    insightQuery<StmFileDetail["reps"][number]>(
      `SELECT section, rep_no, period_label, cases, passed, claim_total, paid_total, source
       FROM stm_summary WHERE stm_file_id = $1
       ORDER BY array_position(ARRAY['normal', 'appeal', 'd1_normal', 'd1_appeal'], section), rep_no
       LIMIT 500`,
      [id],
    ),
    insightQuery<StmFileDetail["funds"][number]>(
      `SELECT e.key AS fund, sum(e.value::numeric) AS amount
       FROM stm_summary s CROSS JOIN LATERAL jsonb_each_text(s.amounts) AS e
       WHERE s.stm_file_id = $1
       GROUP BY e.key
       ORDER BY amount DESC`,
      [id],
    ),
  ]);
  if (!file) return Response.json({ error: "ไม่พบไฟล์" }, { status: 404 });
  const body: StmFileDetail = { file, reps, funds };
  return Response.json(body);
}
