import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hisQuery, insightQuery } from "@/lib/db";
import { chunks, countMatched, type RepFileDetail } from "./file-detail";

type Num = string | null; // numeric ของ pg มาเป็น string
const BATCH = 1000;
// table/col เป็นค่าคงที่ ไม่ใช่ input: OP/OP_APPEAL_* = vn 12 หลัก, IP = an 9 หลัก
const HIS = {
  op: "SELECT vn AS ref, uc_money FROM vn_stat WHERE vn IN",
  ip: "SELECT an AS ref, uc_money FROM an_stat WHERE an IN",
};

export async function GET(request: NextRequest) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[1-9]\d{0,17}$/.test(id)) return Response.json({ error: "id ต้องเป็นจำนวนเต็มบวก" }, { status: 400 });

  const [file] = await insightQuery<RepFileDetail["file"]>(
    `SELECT file_name, rep_type, hcode, file_date, printed_at, imported_at, imported_by, row_count
     FROM rep_file WHERE id = $1`,
    [id],
  );
  if (!file) return Response.json({ error: "ไม่พบไฟล์" }, { status: 404 });

  const [[sum], funds, errors, refs] = await Promise.all([
    insightQuery<{ row_count: number; error_rows: number; claim_total: Num; compensation: Num }>(
      `SELECT COUNT(*)::int AS row_count,
         COUNT(*) FILTER (WHERE cardinality(error_codes) > 0)::int AS error_rows,
         COALESCE(SUM(claim_total), 0) AS claim_total,
         COALESCE(SUM(net_nhso + COALESCE(net_affiliation, 0)), 0) AS compensation
       FROM rep_row
       WHERE rep_file_id = $1`,
      [id],
    ),
    // shortcut: ไม่เกิน 100 กลุ่ม (ไฟล์จริง ~44) ถ้าเจอไฟล์ที่เกินค่อยแบ่งหน้า
    insightQuery<{ main_fund: string[]; sub_fund: string[]; n: number; compensation: Num }>(
      `SELECT main_fund, sub_fund, COUNT(*)::int AS n,
         COALESCE(SUM(net_nhso + COALESCE(net_affiliation, 0)), 0) AS compensation
       FROM rep_row
       WHERE rep_file_id = $1
       GROUP BY main_fund, sub_fund
       ORDER BY n DESC, compensation DESC
       LIMIT 100`,
      [id],
    ),
    insightQuery<{ code: string; kind: string | null; description: string | null; n: number; compensation: Num }>(
      `SELECT e.code, c.kind, c.description, COUNT(*)::int AS n,
         COALESCE(SUM(r.net_nhso + COALESCE(r.net_affiliation, 0)), 0) AS compensation
       FROM rep_row r
       CROSS JOIN LATERAL unnest(r.error_codes) AS e(code)
       LEFT JOIN rep_error_code c ON c.code = e.code
       WHERE r.rep_file_id = $1
       GROUP BY e.code, c.kind, c.description
       ORDER BY n DESC, e.code
       LIMIT 100`,
      [id],
    ),
    insightQuery<{ ref: string }>(
      `SELECT DISTINCT CASE WHEN patient_type = 'IP' THEN an ELSE seq_no END AS ref
       FROM rep_row
       WHERE rep_file_id = $1
         AND (CASE WHEN patient_type = 'IP' THEN an ELSE seq_no END) IS NOT NULL`,
      [id],
    ),
  ]);

  // ชุดละไม่เกิน 1000 ค่า ส่งพร้อมกันได้ เพราะ pool ของ his จำกัดไว้ 3 connection
  const head = HIS[file.rep_type === "IP" ? "ip" : "op"];
  const found = await Promise.all(
    chunks(refs.map((r) => r.ref), BATCH).map((batch) =>
      hisQuery<{ ref: string; uc_money: string | null }>(`${head} (${batch.map(() => "?").join(", ")})`, batch),
    ),
  );
  const matched = countMatched(found.flat());

  const body: RepFileDetail = {
    file,
    kpi: {
      total: sum.row_count,
      matched,
      unmatched: sum.row_count - matched,
      error_rows: sum.error_rows,
      claim_total: Number(sum.claim_total),
      compensation: Number(sum.compensation),
    },
    funds: funds.map((f) => ({ ...f, compensation: Number(f.compensation) })),
    errors: errors.map(({ code, description, n }) => ({ code, description, n })),
  };
  return Response.json(body);
}
