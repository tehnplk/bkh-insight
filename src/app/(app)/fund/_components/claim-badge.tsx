import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { CLAIM_DEADLINE_DAYS, CLAIM_LABEL, type ClaimInfo, type ClaimStatusKey, type PatientType } from "@/app/api/fdh/claim-batch/claim";

const chip = "rounded border px-1.5 py-0.5 whitespace-nowrap";
const OK = "border-success-line bg-success-soft text-success";
const BAD = "border-danger-line bg-danger-soft text-danger";
const WAIT = "border-warning-line bg-warning-soft text-warning";
const NEUTRAL = "border-line bg-surface-sunken text-muted";
const TONE: Record<ClaimStatusKey, string> = {
  paid: OK,
  rep_pass: OK,
  rep_c: BAD,
  rep_deny: BAD,
  nhso: "border-accent-line bg-accent-soft text-accent-text",
  submitted: "border-accent-line bg-accent-soft text-accent-text",
  exported: NEUTRAL,
  unclaimed: NEUTRAL,
  failed: BAD,
  wait_close: WAIT,
  unsent: WAIT,
  overdue: BAD,
};
const NO_EVIDENCE: ClaimStatusKey[] = ["unsent", "wait_close", "overdue"];

/** หลักฐานของสถานะเป็นข้อความเดียว (title และ screen reader) */
function evidence(c: ClaimInfo, type: PatientType): string {
  if (NO_EVIDENCE.includes(c.status))
    return `${c.days != null ? `${formatCount(c.days)} วันหลัง${type === "OP" ? "วันรับบริการ" : "วันจำหน่าย"}` : "ไม่มีวันที่"} (กำหนด ${CLAIM_DEADLINE_DAYS[type]} วัน)`;
  const at = formatThaiDate(c.at);
  const batch = c.batch ? `ชุดส่งออก #${c.batch} (ดูที่ประวัติส่งออกเคลม)` : null;
  return [c.status === "paid" ? "STM" : c.status.startsWith("rep_") ? "REP" : null, c.detail, c.amount != null ? `${formatBaht(c.amount)} บาท` : null, at, batch]
    .filter(Boolean)
    .join(" · ");
}

/**
 * คอลัมน์ "สถานะเคลม" ของ /opd/admissions และ /ipd/admissions: ป้ายสถานะจากหลักฐานที่แรงสุด (STM > REP > HOSxP FDH > ชุดส่งออกที่ยืนยันแล้ว > HOSxP จองส่ง > ชุดที่ยังไม่ยืนยัน)
 * ยังไม่มีหลักฐานแสดงจำนวนวันตั้งแต่วันรับบริการ/จำหน่าย ; ไม่มีสถานะ (กองทุนที่ไม่ต้องส่งหรือโหลดไม่ได้) แสดงขีด
 */
export function ClaimBadge({ claim, type }: { claim?: ClaimInfo; type: PatientType }) {
  if (!claim) return <span className="text-muted">–</span>;
  const label = CLAIM_LABEL[claim.status];
  const note = evidence(claim, type);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={`${label} · ${note}`}>
      <span className={`${chip} ${TONE[claim.status]}`}>{label}</span>
      {NO_EVIDENCE.includes(claim.status) && claim.days != null ? (
        <span className="text-muted tabular-nums">{formatCount(claim.days)} วัน</span>
      ) : null}
      <span className="sr-only">{note}</span>
    </span>
  );
}
