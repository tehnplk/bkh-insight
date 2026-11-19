import { insightQuery } from "@/lib/db";
import { repFilterValues, type RepCand, type RepInfo, type RepStatus } from "@/app/api/ipd/admissions/admissions";

const REP_LABEL = { pass: "ผ่าน", c: "ติด C", deny: "Deny" } as const;
/** ชื่อค่าของตัวกรองหัวคอลัมน์ REP ("" แสดงเป็น "(ว่าง)" ที่ DataGrid) */
export const REP_FILTER_LABEL: Record<string, string> = { ...REP_LABEL, none: "ยังไม่มี REP" };
/** สถานะ REP ในไฟล์ Excel: undefined (ไม่มีสถานะ) = ว่าง, null = ยังไม่มี REP */
export const repLabel = (rep: RepInfo | null | undefined) =>
  rep ? [REP_LABEL[rep.status], ...rep.codes].join(" ") : rep === null ? "ยังไม่มี REP" : "";

/**
 * REP ล่าสุด (tran_id มากสุด) ต่อ VN (OP: seq_no) หรือ AN (IP) ของรายการใน $1 (text[] ห้ามว่าง) ไม่กรองกองทุน
 * status: pass = ไม่มี error, deny = มี DENY (codes = รหัส Deny รายตัว), c = ติด C ; col/key/pt เป็นค่าคงที่ในโค้ด ไม่ใช่ input
 */
export const latestRepSql = (col: "seq_no" | "an", key: "vn" | "an", pt: "OP" | "IP") => `SELECT DISTINCT ON (r.${col})
       r.${col} AS ${key}, r.rep_no, f.file_date AS rep_date,
       CASE WHEN cardinality(r.error_codes) = 0 THEN 'pass'
            WHEN 'DENY' = ANY(r.error_codes) THEN 'deny'
            ELSE 'c' END AS status,
       CASE WHEN cardinality(r.error_codes) = 0 THEN ARRAY[]::text[]
            WHEN 'DENY' = ANY(r.error_codes)
              THEN ARRAY(SELECT DISTINCT e.v FROM jsonb_each_text(r.deny) AS e(k, v) WHERE e.v <> 'C' ORDER BY e.v)
            ELSE r.error_codes END AS codes
FROM rep_row r
JOIN rep_file f ON f.id = r.rep_file_id
WHERE r.patient_type = '${pt}' AND r.${col} = ANY($1::text[])
ORDER BY r.${col}, r.tran_id::bigint DESC`;

/**
 * ตัวกรองหัวคอลัมน์ "rep" ของ opd/ipd admissions: สถานะ REP อยู่ insight (JOIN กับ his ไม่ได้)
 * จึงดูสถานะของทุกแถวที่ผ่านตัวกรองอื่น (cands จาก his) แล้วจัดค่าในโค้ด ; sql = latestRepSql ของหน้า (คอลัมน์ key = keyCol)
 */
export async function loadRepFilterValues(cands: RepCand[], sql: string, keyCol: "vn" | "an", fundOf: (pttype: string | null) => string) {
  const reps = cands.length ? await insightQuery<Record<"vn" | "an", string> & { status: RepStatus }>(sql, [cands.map((c) => c.k)]) : [];
  return repFilterValues(cands, new Map(reps.map((r) => [r[keyCol], r.status])), fundOf);
}
