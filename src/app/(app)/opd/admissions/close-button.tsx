"use client";

import { useId, useState } from "react";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { formatCount } from "@/lib/number-format";
import type { CloseReady } from "@/app/api/fund/close-privilege/route";
import { closeSkipReason } from "@/app/api/fund/close-privilege/nhso";
import type { VisitRow } from "@/app/api/opd/admissions/admissions";
import { btn, useJson } from "@/app/(app)/fund/_components/ui";
import { CloseConfirm, CloseResults, blockedReasons, runClose, type CloseItem } from "@/app/(app)/fund/close-privilege/close-run";

type Plan = { vns: string[]; skipped: { vn: string; reason: string }[] };

/** ปิดสิทธิ visit ที่ติ๊ก (ชุดเดียวกับปุ่ม 16 แฟ้ม) ผ่าน POST /api/fund/close-privilege เดียวกับหน้าปิดสิทธิ ต้องยืนยันใน modal ทุกครั้ง
 *  คัดรายที่ไม่เข้าเกณฑ์ออกจากข้อมูลแถวก่อน (ข้อมูลตอนติ๊ก) server ตรวจซ้ำทุกข้อ */
export function ClosePrivilegeButton({ rows, reload }: { rows: VisitRow[]; reload: () => void }) {
  const ready = useJson<CloseReady>("/api/fund/close-privilege?ready=1");
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [run, setRun] = useState<CloseItem[] | null>(null);
  const hintId = useId();
  const running = run?.some((i) => i.state !== "done") ?? false;

  const blocked = !rows.length
    ? "ติ๊กเลือก visit ในตารางก่อน"
    : ready.error
      ? `ตรวจความพร้อมปิดสิทธิไม่ได้: ${ready.error}`
      : !ready.data
        ? "กำลังตรวจความพร้อมปิดสิทธิ"
        : blockedReasons(ready.data).join(" · ");

  function start() {
    // ระหว่างส่ง: เปิดดูผลต่อ ไม่คัดชุดใหม่
    if (!running) {
      const now = Date.now();
      const next: Plan = { vns: [], skipped: [] };
      for (const r of rows) {
        const reason = closeSkipReason({ vstdate: r.vstdate, an: r.an, closed: r.claim_status === "closed" }, now);
        if (reason) next.skipped.push({ vn: r.vn, reason });
        else next.vns.push(r.vn);
      }
      setPlan(next);
      setRun(null);
    }
    setOpen(true);
  }

  async function confirm() {
    if (!plan) return;
    await runClose(plan.vns, setRun);
    reload();
  }

  return (
    <>
      <button
        type="button"
        disabled={!running && !!blocked}
        onClick={start}
        title={running ? undefined : blocked || undefined}
        aria-describedby={blocked && !running ? hintId : undefined}
        className={`${btn} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {running ? "กำลังปิดสิทธิ…" : "ปิดสิทธิ"}
      </button>
      {blocked && !running && (
        <span id={hintId} className="sr-only">
          {blocked}
        </span>
      )}
      <DetailModal open={open} onClose={() => setOpen(false)} title={run ? "ผลการปิดสิทธิ" : `ปิดสิทธิ ${formatCount(rows.length)} visit`}>
        {plan && !run && ready.data && (
          <CloseConfirm zone={ready.data.zone} count={plan.vns.length} unit="visit" onCancel={() => setOpen(false)} onConfirm={confirm}>
            {plan.skipped.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-muted">ข้าม {formatCount(plan.skipped.length)} visit</p>
                <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                  {plan.skipped.map((s) => (
                    <li key={s.vn} className="flex flex-wrap items-baseline justify-between gap-x-4 px-3 py-1.5">
                      <span className="tabular-nums">VN {s.vn}</span>
                      <span className="text-muted">{s.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CloseConfirm>
        )}
        {run && <CloseResults run={run} onClose={() => setOpen(false)} />}
      </DetailModal>
    </>
  );
}
