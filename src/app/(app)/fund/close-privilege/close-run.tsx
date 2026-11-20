"use client";

// ชิ้นที่ใช้ร่วมระหว่าง /fund/close-privilege กับปุ่ม "ปิดสิทธิ" ของ /opd/admissions: ยืนยัน ยิงทีละราย และแสดงผลรายต่อราย
import type { ReactNode } from "react";
import { AuthNotice } from "@/components/auth-card/auth-card";
import { formatCount } from "@/lib/number-format";
import type { CloseReady, CloseResult } from "@/app/api/fund/close-privilege/route";
import type { Zone } from "@/app/api/fund/close-privilege/nhso";
import { btn, focusRing } from "../_components/ui";

export const primary = `inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
export const ZONE_LABEL = { test: "Test Zone", prod: "Production" } as const;

export type CloseItem = { vn: string; state: "wait" | "sending" | "done"; result?: CloseResult };

/** เหตุที่ยังกดปิดสิทธิไม่ได้ (ว่าง = พร้อม) */
export const blockedReasons = (r: CloseReady) => [
  ...(r.missing.length ? [`ยังไม่ได้ตั้งค่า ${r.missing.join(", ")}`] : []),
  ...(r.recorderError ? [r.recorderError] : []),
];

export const tally = (run: CloseItem[] | null) => ({
  ok: run?.filter((i) => i.result?.ok).length ?? 0,
  fail: run?.filter((i) => i.result && !i.result.ok).length ?? 0,
});

/** ทีละรายตามลำดับ หนึ่ง POST ต่อราย ให้เห็นผลรายต่อราย ; error ทั้งคำขอ (เช่น ยังไม่ตั้งค่า) หยุดรายที่เหลือ */
export async function runClose(vns: string[], onChange: (items: CloseItem[]) => void) {
  const items: CloseItem[] = vns.map((vn) => ({ vn, state: "wait" }));
  const update = (i: number, patch: Partial<CloseItem>) => {
    items[i] = { ...items[i], ...patch };
    onChange([...items]);
  };
  onChange([...items]);
  for (let i = 0; i < vns.length; i++) {
    update(i, { state: "sending" });
    const res = await fetch("/api/fund/close-privilege", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vns: [vns[i]] }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    const result: CloseResult | undefined = res?.ok ? body?.results?.[0] : undefined;
    if (result) {
      update(i, { state: "done", result });
      continue;
    }
    const msg = body?.error ?? (res ? `ส่งไม่สำเร็จ (HTTP ${res.status})` : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    update(i, { state: "done", result: { vn: vns[i], ok: false, error: msg } });
    for (let j = i + 1; j < vns.length; j++) update(j, { state: "done", result: { vn: vns[j], ok: false, error: "ไม่ได้ส่ง" } });
    break;
  }
}

/** ขั้นยืนยันก่อนยิง (ห้ามปิดอัตโนมัติ) ; children = รายละเอียดเพิ่ม เช่น รายที่ข้าม */
export function CloseConfirm({
  zone, count, unit, onCancel, onConfirm, children,
}: { zone: Zone; count: number; unit: string; onCancel: () => void; onConfirm: () => void; children?: ReactNode }) {
  return (
    <div className="space-y-4 text-base">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted">จำนวน</dt>
        <dd className="font-medium">
          {formatCount(count)} {unit}
        </dd>
        <dt className="text-muted">ส่งไปที่</dt>
        <dd className="font-medium">{ZONE_LABEL[zone]}</dd>
      </dl>
      {children}
      <AuthNotice tone="warning">ผลการปิดจากหน้านี้ไม่แสดงใน HOSxP ห้ามกดปิดสิทธิรายเดียวกันซ้ำใน HOSxP</AuthNotice>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={btn}>
          ยกเลิก
        </button>
        <button type="button" onClick={onConfirm} disabled={!count} className={primary}>
          ยืนยันปิดสิทธิ {formatCount(count)} {unit}
        </button>
      </div>
    </div>
  );
}

/** ผลรายต่อราย (สำเร็จ + authenCode + dataError / ข้อความ error) ; ปุ่มปิดแสดงเมื่อส่งครบ */
export function CloseResults({ run, onClose }: { run: CloseItem[]; onClose: () => void }) {
  const sending = run.some((i) => i.state !== "done");
  const { ok, fail } = tally(run);
  return (
    <div className="space-y-3 text-base">
      <ol aria-live="polite" className="divide-y divide-line rounded-lg border border-line">
        {run.map((i) => (
          <li key={i.vn} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2">
            <span className="tabular-nums">VN {i.vn}</span>
            {i.state === "wait" && <span className="text-muted">รอส่ง</span>}
            {i.state === "sending" && <span className="text-muted">กำลังส่ง…</span>}
            {i.result?.ok && (
              <span className="font-medium text-success">
                สำเร็จ {i.result.authenCode}
                {i.result.dataError && <span className="ml-2 font-normal text-warning">{i.result.dataError}</span>}
              </span>
            )}
            {i.result && !i.result.ok && <span className="text-danger">ไม่สำเร็จ: {i.result.error}</span>}
          </li>
        ))}
      </ol>
      {!sending && (
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="font-medium">
            สำเร็จ {formatCount(ok)} ราย · ไม่สำเร็จ {formatCount(fail)} ราย
          </p>
          <button type="button" onClick={onClose} className={btn}>
            ปิด
          </button>
        </div>
      )}
    </div>
  );
}
