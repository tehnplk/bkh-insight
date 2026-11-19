import "server-only";
import { insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { STM_PAID_SQL } from "@/app/api/fund/_lib/stm";
import type { RepInfo } from "@/app/api/ipd/admissions/admissions";
import { classifyClaim, type ClaimInfo, type ClaimInput, type PatientType } from "./claim";

// ชุดส่งออกต่อราย (claim_batch_item_ref_idx): ไม่นับชุดที่ยกเลิก ยืนยันแล้วก่อน แล้วล่าสุด
const BATCH_SQL = `SELECT DISTINCT ON (i.ref) i.ref AS key, b.id::text AS id, b.created_at::text AS at, b.channel,
  b.confirmed_at::text AS confirmed_at, b.confirmed_by, b.submitted_on::text AS submitted_on
FROM claim_batch_item i JOIN claim_batch b ON b.id = i.batch_id
WHERE i.patient_type = $1 AND i.ref = ANY($2::text[]) AND b.cancelled_at IS NULL
ORDER BY i.ref, b.confirmed_at IS NULL, b.created_at DESC`;
// ปิดสิทธิผ่าน /fund/close-privilege (ไม่ย้อนเข้า HOSxP) นับเป็นปิดสิทธิแล้ว เหมือน claim-pipeline
const CLOSED_SQL = "SELECT DISTINCT vn AS key FROM nhso_close_log WHERE ok AND zone = 'prod' AND vn = ANY($1::text[])";

/** รายจาก his: k = VN (OP) / AN (IP) ; fdh เฉพาะ OP */
export type ClaimCand = Omit<ClaimInput, "type" | "rep" | "stm" | "batch"> & { k: string };

/**
 * สถานะเคลมต่อ key: รวม STM, REP, ชุดส่งออก และปิดสิทธิผ่านระบบนี้ (insight) กับข้อมูล his ของ cands แล้วจัดด้วย classifyClaim
 * reps = REP ล่าสุดต่อ key ที่หน้าโหลดไว้แล้ว ; ไม่ส่ง = อ่านด้วย repSql (latestRepSql ของหน้า คอลัมน์ key = repKey)
 */
export async function loadClaims(
  type: PatientType,
  cands: ClaimCand[],
  repSql: string,
  repKey: "vn" | "an",
  reps?: Map<string, RepInfo>,
): Promise<Map<string, ClaimInfo | undefined>> {
  const keys = cands.map((c) => c.k);
  if (!keys.length) return new Map();
  const [repRows, stm, batch, closed] = await Promise.all([
    reps ? null : insightQuery<RepInfo & Record<"vn" | "an", string>>(repSql, [keys]),
    insightQuery<{ key: string; paid: string; paid_at: string | null }>(STM_PAID_SQL[type === "OP" ? "op" : "ip"], [keys]),
    insightQuery<NonNullable<ClaimInput["batch"]> & { key: string }>(BATCH_SQL, [type, keys]),
    type === "OP" ? insightQuery<{ key: string }>(CLOSED_SQL, [keys]) : [],
  ]);
  const repBy = reps ?? new Map(repRows!.map((r) => [r[repKey], r]));
  const stmBy = new Map(stm.map((s) => [s.key, s]));
  const batchBy = new Map(batch.map((b) => [b.key, b]));
  const closedSet = new Set(closed.map((c) => c.key));
  const today = todayIso();
  return new Map(
    cands.map(({ k, ...c }) => [
      k,
      classifyClaim({ ...c, type, closed: c.closed || closedSet.has(k), rep: repBy.get(k), stm: stmBy.get(k), batch: batchBy.get(k) }, today),
    ]),
  );
}
