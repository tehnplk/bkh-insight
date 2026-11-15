"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { formatBaht, formatCount } from "@/lib/number-format";
import { btn } from "./ui";
import type { CaseSyncResult } from "@/app/api/fund/ar-sync/sync";

type Result = { tone: "muted" | "warning" | "danger"; text: string };
const TONE = { muted: "text-muted", warning: "text-warning", danger: "text-danger" };

function describe(r: CaseSyncResult) {
  const booked = `ลงสมุดแล้ว ${formatBaht(r.booked)} บาท`;
  const balance = r.balance !== r.booked ? ` · คงเหลือ ${formatBaht(r.balance)} บาท` : "";
  return `${r.entries ? `ลงสมุดเพิ่ม ${formatCount(r.entries)} รายการ` : "ยอดตรงกับ HOSxP แล้ว ไม่มีรายการใหม่"} · ${booked}${balance}`;
}

/** ปุ่มดึงยอดของรายนี้ใหม่จาก HOSxP (POST /api/fund/ar-sync/case) ส่ง vn สำหรับ OPD หรือ an สำหรับ IPD */
export function CaseResync({ vn, an, onDone }: { vn: string | null; an: string | null; onDone?: () => void }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>();
  function run() {
    setResult(undefined);
    startTransition(async () => {
      const res = await fetch("/api/fund/ar-sync/case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vn ? { vn } : { an }),
      }).catch(() => null);
      const body = await res?.json().catch(() => null);
      if (!res?.ok) {
        const error = body?.error ?? `ดึงใหม่ไม่สำเร็จ${res ? ` (HTTP ${res.status})` : ""}`;
        return setResult({ tone: res?.status === 409 ? "warning" : "danger", text: error });
      }
      setResult({ tone: "muted", text: describe(body) });
      onDone?.();
    });
  }
  if (!vn && !an) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <button type="button" onClick={run} disabled={pending} className={`${btn} gap-1.5 disabled:cursor-wait disabled:opacity-60`}>
        <RefreshCw aria-hidden className={`size-4 ${pending ? "animate-spin motion-reduce:animate-none" : ""}`} />
        {pending ? "กำลังดึง…" : "ดึงใหม่"}
      </button>
      {result && (
        <p role={result.tone === "muted" ? "status" : "alert"} className={`tabular-nums ${TONE[result.tone]}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
