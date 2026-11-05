"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { formatBaht } from "@/lib/number-format";

// ชิ้นส่วนที่หน้าในโมดูล fund ใช้ร่วมกัน (มูลค่าตามกองทุน, มูลค่าตามแผนก)

export const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const btn = `inline-flex h-9 items-center justify-center rounded-md border border-line bg-surface px-3 text-sm font-medium text-foreground hover:bg-hover ${focusRing}`;
export const num = "text-right tabular-nums whitespace-nowrap";
export const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
export const formatPct = (p: number) => `${p.toFixed(1)}%`;

/** filter ของหน้าอยู่ใน URL แชร์ link ได้ เปลี่ยนแล้วล้าง page ของ grid (ค่าว่าง/null = ลบ param) */
export function useUrlParams<K extends string>(keys: readonly K[]) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const values = Object.fromEntries(keys.map((k) => [k, sp.get(k) ?? ""])) as Record<K, string>;
  function set(changes: Partial<Record<K, string | null>>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes) as [string, string | null | undefined][]) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  return { ...values, set };
}

/** GET JSON ตาม url (เปลี่ยน url = ยิงใหม่และยกเลิกคำขอเก่า) error ใช้ข้อความ { error } จาก API */
export function useJson<T>(url: string) {
  const [reload, setReload] = useState(0);
  const requestKey = `${url}#${reload}`;
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>({ key: "" });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `โหลดข้อมูลไม่สำเร็จ (HTTP ${res.status})`);
        return body as T;
      })
      .then(
        (data) => setResult({ key: requestKey, data }),
        (e: Error) => {
          if (!ctrl.signal.aborted) setResult({ key: requestKey, error: e.message });
        },
      );
    return () => ctrl.abort();
  }, [url, requestKey]);

  const loading = result.key !== requestKey;
  return { loading, data: loading ? undefined : result.data, error: loading ? undefined : result.error, retry: () => setReload((n) => n + 1) };
}

/** เงินในตาราง: ค่าเต็ม 2 ตำแหน่ง ไม่มีหน่วย (หน่วยอยู่ที่หัวคอลัมน์) ไม่มีค่า = "–" สีจาง */
export function Money({ value }: { value: number | null | undefined }) {
  return value == null || Number.isNaN(value) ? <span className="text-muted">–</span> : formatBaht(value);
}

export function ShareBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

export function Panel({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex min-h-9 flex-wrap items-center justify-between gap-2">
        <h2 className="text-title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Notice({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line px-4 py-10 text-center text-sm">
      <p className="font-medium">{title}</p>
      {detail && <p className="mt-1 text-muted">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-lg border border-line p-4" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-hover" style={{ width: `${90 - (i % 3) * 15}%` }} />
      ))}
    </div>
  );
}

export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-md border border-accent-line bg-accent-soft pr-0.5 pl-2 text-sm text-accent-text">
      {label}
      <button type="button" aria-label={`ล้าง ${label}`} onClick={onRemove} className={`grid size-6 place-items-center rounded hover:bg-hover ${focusRing}`}>
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}
