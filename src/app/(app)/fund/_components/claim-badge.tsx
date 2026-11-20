"use client";

import { useState } from "react";
import Link from "next/link";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import {
  CHANNEL_SHORT,
  CLAIM_DEADLINE_DAYS,
  CLAIM_LABEL,
  type ClaimInfo,
  type ClaimStatusKey,
  type PatientType,
} from "@/app/api/fdh/claim-batch/claim";
import { focusRing } from "./ui";
import { Fact, Facts } from "../uc-debtor/uc-debtor-detail";

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
/** กลุ่ม "ส่งแล้ว": ป้ายกดดูวันที่ส่ง */
const SENT: ClaimStatusKey[] = ["submitted", "nhso", "exported"];

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
  const [open, setOpen] = useState(false);
  if (!claim) return <span className="text-muted">–</span>;
  const label = CLAIM_LABEL[claim.status];
  const note = evidence(claim, type);
  const sent = SENT.includes(claim.status);
  return (
    <>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={`${label} · ${note}`}>
        {sent ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`${label} ดูวันที่ส่ง`}
            className={`${chip} ${TONE[claim.status]} cursor-pointer hover:underline ${focusRing}`}
          >
            {label}
          </button>
        ) : (
          <span className={`${chip} ${TONE[claim.status]}`}>{label}</span>
        )}
        {NO_EVIDENCE.includes(claim.status) && claim.days != null ? (
          <span className="text-muted tabular-nums">{formatCount(claim.days)} วัน</span>
        ) : null}
        <span className="sr-only">{note}</span>
      </span>
      {/* modal อยู่นอก span ที่มี title ไม่งั้น tooltip ของป้ายขึ้นทั้ง modal */}
      {sent && (
        <DetailModal open={open} onClose={() => setOpen(false)} title={`สถานะเคลม: ${label}`}>
          <SentDetail claim={claim} />
        </DetailModal>
      )}
    </>
  );
}

/** วันที่และที่มาของการส่ง ; ไม่มีค่าแสดงขีด (Fact) */
function SentDetail({ claim: c }: { claim: ClaimInfo }) {
  const fromBatch = c.status !== "nhso";
  return (
    <div className="text-sm">
      <Facts>
        <Fact label={c.status === "exported" ? "วันที่ส่งออก" : c.status === "submitted" ? "วันที่อัปโหลด" : "วันที่ส่ง"}>{formatThaiDate(c.at)}</Fact>
        {/* nhso มาจาก fdh_claim_status / จองส่ง FDH ของ HOSxP */}
        <Fact label="ช่องทาง">{c.channel ? CHANNEL_SHORT[c.channel] : fromBatch ? null : "FDH (HOSxP)"}</Fact>
        {fromBatch && <Fact label="เลขชุด">{c.batch && `#${c.batch}`}</Fact>}
        {c.status === "submitted" && <Fact label="วันที่ส่งออก">{formatThaiDate(c.exported_at)}</Fact>}
        {fromBatch && <Fact label={c.status === "exported" ? "ผู้ส่งออก" : "ผู้ยืนยัน"}>{c.by}</Fact>}
        <Fact label="หลักฐาน">{c.detail}</Fact>
      </Facts>
      {c.batch && (
        <Link href="/fdh/claim-batch" className={`mt-3 inline-block text-accent-text hover:underline ${focusRing}`}>
          ประวัติส่งออกเคลม
        </Link>
      )}
    </div>
  );
}
