"use client";

import type { ReactNode } from "react";
import { THAI_MONTHS_SHORT, todayIso } from "@/lib/thai-date";
import { focusRing } from "../_components/ui";
import { monthsBetween } from "@/app/api/fund/fwf-card/fwf";

// ชิ้นส่วนที่แท็บของ /fund/fwf-card ใช้ร่วมกัน

export const FIELD = `h-9 min-w-0 rounded-md border border-line bg-surface px-3 ${focusRing}`;
export const primary = `inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;
export const SELECT = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium ${focusRing}`;
export const dash = <span className="text-muted">–</span>;
export const monthLabel = (m: string) => `${THAI_MONTHS_SHORT[+m.slice(5, 7) - 1]} ${+m.slice(0, 4) + 543}`;

/** ป้ายธงในตาราง tone ตาม token */
export function Flag({ tone, children, title }: { tone: "warning" | "danger" | "info" | "muted"; children: ReactNode; title?: string }) {
  const cls = { warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger", info: "bg-info-soft text-info-text", muted: "bg-surface-sunken text-muted" }[tone];
  return <span title={title} className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}>{children}</span>;
}

export async function send<T = unknown>(url: string, method: string, body: unknown): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const json = await res?.json().catch(() => null);
  return res?.ok ? { ok: true, body: json } : { ok: false, error: json?.error ?? `ไม่สำเร็จ${res ? ` (HTTP ${res.status})` : ""}` };
}

export function MonthSelect({ value, from, onChange, label = "เดือน" }: { value: string; from: string; onChange: (m: string) => void; label?: string }) {
  const months = monthsBetween(from, todayIso()).reverse();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={SELECT}>
        {months.map((m) => (
          <option key={m} value={m}>{monthLabel(m)}</option>
        ))}
      </select>
    </label>
  );
}

export function Status({ result }: { result?: { ok: boolean; text: string } }) {
  if (!result) return null;
  return <p role={result.ok ? "status" : "alert"} className={`text-sm whitespace-pre-line tabular-nums ${result.ok ? "text-success" : "text-danger"}`}>{result.text}</p>;
}
