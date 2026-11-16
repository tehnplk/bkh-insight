import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { badRequest, isAuthed, unauthorized } from "../../_lib/fund";

type Num = string; // numeric ของ pg มาเป็น string

/** แถว STM ของรายหนึ่ง (modal เงินเข้า STM ใน /fund/claim-pipeline) */
export type StmCaseRow = {
  id: string;
  doc_no: string;
  scheme: string;
  period_month: string;
  run_no: number;
  /** วันที่ออก STM (ผู้นำเข้ากรอก) */
  transfer_date: string;
  section: string;
  rep_no: string;
  tran_id: string | null;
  adjrw: Num | null;
  claim_total: Num | null;
  paid_total: Num;
  fund_amounts: Record<string, number>;
};
export type StmCaseDetail = { rows: StmCaseRow[] };

const COLS = `r.id, f.doc_no, f.scheme, f.period_month, f.run_no, f.transfer_date,
       r.section, r.rep_no, r.tran_id, r.adjrw, r.claim_total, r.paid_total, r.fund_amounts`;
// ต้องเป็นแถวชุดเดียวกับ STM_SQL ใน ../route.ts ยอดรวมใน modal จึงเท่ากับช่องในตาราง (prove-query)
const SQL = {
  op: {
    re: /^\d{12}$/,
    error: "key (VN) ต้องเป็นตัวเลข 12 หลัก",
    sql: `SELECT ${COLS}
FROM stm_row r JOIN stm_file f ON f.id = r.stm_file_id
WHERE f.patient_type = 'OP' AND r.seq_no = $1
UNION ALL
SELECT ${COLS}
FROM stm_row r JOIN stm_file f ON f.id = r.stm_file_id JOIN rep_row rr ON rr.tran_id = r.tran_id
WHERE f.patient_type = 'OP' AND NULLIF(r.seq_no, '') IS NULL AND rr.seq_no = $1
ORDER BY period_month, run_no, rep_no, id`,
  },
  ip: {
    re: /^\d{9}$/,
    error: "key (AN) ต้องเป็นตัวเลข 9 หลัก",
    sql: `SELECT ${COLS}
FROM stm_row r JOIN stm_file f ON f.id = r.stm_file_id
WHERE f.patient_type = 'IP' AND r.an = $1
ORDER BY f.period_month, f.run_no, r.rep_no, r.id`,
  },
};

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const type = params.get("type") ?? "";
  if (type !== "op" && type !== "ip") return badRequest("type ต้องเป็น op หรือ ip");
  const { re, error, sql } = SQL[type];
  const key = params.get("key") ?? "";
  if (!re.test(key)) return badRequest(error);
  const body: StmCaseDetail = { rows: await insightQuery<StmCaseRow>(sql, [key]) };
  return Response.json(body);
}
