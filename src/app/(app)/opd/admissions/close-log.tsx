"use client";

import { useState, type ReactNode } from "react";
import { CopyButton, copyable } from "@/components/copy-button/copy-button";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { formatThaiDate } from "@/lib/thai-date";
import type { CloseLogEntry } from "@/app/api/fund/close-privilege/log/route";
import { formatCid, type VisitRow } from "@/app/api/opd/admissions/admissions";
import { Skeleton, focusRing, useJson } from "@/app/(app)/fund/_components/ui";
import { Fact, Facts, LoadError } from "@/app/(app)/fund/uc-debtor/uc-debtor-detail";

// ป้ายเลขปิดสิทธิ: สีบอกที่มา HOSxP (info) / ระบบนี้ (accent) ; ขนาดเท่าป้าย "ไม่พบเลขปิดสิทธิ" ของคอลัมน์เดียวกัน
const chip = "rounded px-1.5 py-0.5 font-medium";

/** เลขปิดสิทธิ/Approval Code จาก HOSxP แสดงอย่างเดียว */
export function HisCloseBadge({ code }: { code: string }) {
  return (
    <span title="ปิดสิทธิโดย HOSxP" className={`${chip} bg-info-soft text-info-text`}>
      <span className="sr-only">ปิดสิทธิโดย HOSxP </span>
      {code}
    </span>
  );
}

/** ปิดสิทธิผ่านระบบนี้ (/fund/close-privilege) กดดูรายละเอียดการปิดสิทธิจาก nhso_save_endpoint_log */
export function AppCloseBadge({ row, title }: { row: VisitRow; title: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!row.app_close) return null;
  const code = row.app_close.authen_code || "ปิดแล้ว";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`ปิดสิทธิโดย BKH Insight ${code} ดูรายละเอียด`}
        title="ปิดสิทธิโดย BKH Insight"
        className={`${chip} cursor-pointer bg-accent-soft text-accent-text hover:underline ${focusRing}`}
      >
        {code}
      </button>
      <DetailModal open={open} onClose={() => setOpen(false)} title={title}>
        {/* โหลดเฉพาะตอนเปิด ไม่ให้ทุกแถวยิง request */}
        {open && <CloseLog row={row} />}
      </DetailModal>
    </>
  );
}

/** timestamptz ของ insight เป็น string เวลาไทย "YYYY-MM-DD HH:MM:SS…" */
const dateTime = (s: string) => `${formatThaiDate(s)} ${s.slice(11, 19)}`;

/** PDPA: โหลดเลขบัตรเฉพาะตอนเปิด modal ไม่อยู่ในแถว grid หรือ Excel (ใช้ใน modal รายละเอียดแถวด้วย) */
export function Cid({ vn }: { vn: string }) {
  const { loading, data, error } = useJson<{ cid: string | null }>(`/api/opd/admissions/cid?vn=${vn}`);
  if (loading) return <span className="text-muted">กำลังโหลด…</span>;
  const cid = formatCid(data?.cid);
  if (error || !cid) return <span className="text-muted" title={error}>–</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="select-all">{cid}</span>
      {/* คัดลอกเฉพาะตัวเลข 13 หลัก (หน้าจอแสดงแบบมีขีด) */}
      <CopyButton value={cid.replace(/\D/g, "")} label="เลขบัตรประชาชน" />
    </span>
  );
}

/** ชื่อและ VN มาจากแถว ส่วนเลขบัตรจาก /api/opd/admissions/cid ; การปิดสิทธิเฉพาะครั้งที่สำเร็จ (prod) */
function CloseLog({ row }: { row: VisitRow }) {
  const { loading, data, error, retry } = useJson<{ entry: CloseLogEntry | null }>(`/api/fund/close-privilege/log?vn=${row.vn}`);
  if (loading) return <Skeleton rows={3} />;
  if (error || !data) return <LoadError what="การปิดสิทธิ" error={error} retry={retry} />;
  const e = data.entry;
  return (
    <div className="text-sm">
      <Facts>
        <Fact label="เลขบัตรประชาชน">
          <Cid vn={row.vn} />
        </Fact>
        <Fact label="ชื่อ-สกุล">{row.patient_name}</Fact>
        <Fact label="VN">{copyable(row.vn, "VN")}</Fact>
        <Fact label="วันเวลาที่ปิดสิทธิ">{e && dateTime(e.closed_at)}</Fact>
        <Fact label="เลขปิดสิทธิจาก สปสช.">{e?.authen_code}</Fact>
        <Fact label="ผู้กดปิดสิทธิ">{e?.requested_by}</Fact>
      </Facts>
    </div>
  );
}
