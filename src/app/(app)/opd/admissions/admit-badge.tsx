"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { copyable } from "@/components/copy-button/copy-button";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { admitStatus, type AdmitInfo, type VisitRow } from "@/app/api/opd/admissions/admissions";
import { Skeleton, focusRing, useJson } from "@/app/(app)/fund/_components/ui";
import { DebtorItems, Fact, Facts, LoadError } from "@/app/(app)/fund/uc-debtor/uc-debtor-detail";

// ป้ายเล็กใต้ VN (ไม่ดันความสูงแถว): ค้างฝั่งผู้ป่วยนอก = แดง, admit แล้วไม่มีค้าง = กลาง
const chip = "rounded border px-1 text-xs leading-4 whitespace-nowrap tabular-nums";
const TONE = { clear: "border-line text-muted", left: "border-danger-line bg-danger-soft text-danger" } as const;
const TABS = [
  { id: "an", label: "ข้อมูล AN" },
  { id: "items", label: "ค่าใช้จ่ายค้างผู้ป่วยนอก" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** ป้ายใต้ VN: ไม่ admit = ไม่แสดง, admit แล้วไม่มีค้าง = "Admit" (แสดงเมื่อกรองเท่านั้น), ยังมีรายการค้างฝั่งผู้ป่วยนอก = ป้ายแดงพร้อมยอด ; กดดูรายละเอียด */
export function AdmitBadge({ row, title }: { row: VisitRow; title: ReactNode }) {
  const [open, setOpen] = useState(false);
  const status = admitStatus(row);
  if (status === "none") return null;
  const label = status === "left" ? `Admit · ค้าง OPD ${formatBaht(row.opd_left ?? 0)}` : "Admit";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`ดูรายละเอียด ${label}${status === "left" ? " บาท" : ""} AN ${row.an}`}
        title={`AN ${row.an}`}
        className={`${chip} ${TONE[status]} cursor-pointer hover:underline ${focusRing}`}
      >
        {label}
      </button>
      <DetailModal open={open} onClose={() => setOpen(false)} size="medium" title={title}>
        {/* โหลดเฉพาะตอนเปิด ไม่ให้ทุกแถวยิง request */}
        {open && <AdmitDetail row={row} />}
      </DetailModal>
    </>
  );
}

function AdmitDetail({ row }: { row: VisitRow }) {
  const [tab, setTab] = useState<Tab>(row.opd_left != null ? "items" : "an");
  const id = useId();
  // ลูกศรซ้าย/ขวาสลับแท็บ (ARIA tabs pattern)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const step = e.key === "ArrowRight" ? 1 : TABS.length - 1;
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + step) % TABS.length].id;
    setTab(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  return (
    <div className="text-sm">
      <div role="tablist" aria-label="รายละเอียด admit" onKeyDown={onKey} className="inline-flex rounded-md border border-line p-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`${id}-${t.id}`}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            aria-controls={`${id}-panel`}
            tabIndex={t.id === tab ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`h-8 rounded px-3 text-sm font-medium ${focusRing} ${t.id === tab ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-hover"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="mt-4">
        {tab === "an" ? (
          <AnInfo vn={row.vn} />
        ) : row.opd_left == null ? (
          <p className="rounded-lg border border-line px-4 py-8 text-center text-muted">ไม่มีรายการค้างฝั่งผู้ป่วยนอก</p>
        ) : (
          // opitemrece ที่ vn = visit ทุกแถว: รายการที่ผู้ป่วยจ่ายแล้ว (paidst 01/03/04) มีป้ายบอกและไม่อยู่ในยอดลูกหนี้สิทธิ
          <DebtorItems vn={row.vn} an={null} />
        )}
      </div>
    </div>
  );
}

const dateTime = (d: string | null, t: string | null) => (d ? `${formatThaiDate(d)} ${t?.slice(0, 5) ?? ""}`.trim() : null);

function AnInfo({ vn }: { vn: string }) {
  const { loading, data: a, error, retry } = useJson<AdmitInfo>(`/api/opd/admissions/admit?${new URLSearchParams({ vn })}`);
  if (loading) return <Skeleton rows={4} />;
  if (error || !a) return <LoadError what="ข้อมูล AN" error={error} retry={retry} />;
  return (
    <Facts>
      <Fact label="AN">{copyable(a.an, "AN")}</Fact>
      <Fact label="วันที่ admit">{dateTime(a.regdate, a.regtime)}</Fact>
      <Fact label="วันที่จำหน่าย">{dateTime(a.dchdate, a.dchtime) ?? "ยังไม่จำหน่าย"}</Fact>
      <Fact label="สถานะการจำหน่าย">{a.dchstts_name}</Fact>
      <Fact label="วันนอน">{a.los_days == null ? null : `${formatCount(a.los_days)} วัน${a.dchdate ? "" : " (ถึงวันนี้)"}`}</Fact>
      <Fact label="Ward">{a.ward_name}</Fact>
      <Fact label="สิทธิ">{a.pttype_name ?? a.pttype}</Fact>
      <Fact label="แพทย์ผู้รับไว้">{a.doctor_name}</Fact>
      <Fact label="PDx">{a.pdx ? `${a.pdx} ${a.pdx_name ?? ""}`.trim() : null}</Fact>
      <Fact label="ปิดการเงิน">{a.finance_lock === "Y" ? "ปิดแล้ว" : "ยังไม่ปิด"}</Fact>
    </Facts>
  );
}

const FILTERS = [
  { status: "left", label: "Admit ค้าง OPD" },
  { status: "clear", label: "Admit ไม่มีค้าง" },
] as const;

/** ปุ่มกรองในแถบสรุป (ตัวกรอง cf "admit" ไม่มีคอลัมน์ในตาราง) กดซ้ำ = ล้าง ; ปกติหน้าซ่อน visit ที่ admit แล้วไม่มีค้าง */
export function AdmitFilter({ active, onFilter }: { active: string[]; onFilter: (values: string[]) => void }) {
  return (
    <span role="group" aria-label="กรองสถานะ Admit" className="inline-flex flex-wrap items-center gap-1.5">
      {FILTERS.map(({ status, label }) => {
        const on = active.length === 1 && active[0] === status;
        return (
          <button
            key={status}
            type="button"
            aria-pressed={on}
            onClick={() => onFilter(on ? [] : [status])}
            title={on ? "ล้างตัวกรองสถานะ Admit" : `กรองตารางเฉพาะ ${label}`}
            className={`rounded-md border px-2.5 py-1 text-sm cursor-pointer ${focusRing} ${on ? `${TONE[status]} ring-2 ring-current` : "border-line hover:bg-hover"}`}
          >
            {label}
          </button>
        );
      })}
    </span>
  );
}
