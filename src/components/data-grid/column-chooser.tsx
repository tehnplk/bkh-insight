"use client";

import { useEffect, useId, useRef } from "react";

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const POP_WIDTH = 256; // w-64

/**
 * ปุ่ม "คอลัมน์" เลือกซ่อน/แสดงคอลัมน์ของ DataGrid (native popover) ติ๊กแล้วมีผลทันที
 * columns = คอลัมน์ที่ซ่อนได้ (id + ชื่อ) ตามลำดับที่แสดง ; hidden = id ที่ซ่อนอยู่
 */
export function ColumnChooser({
  columns,
  hidden,
  onChange,
}: {
  columns: { id: string; label: string }[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
}) {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // วาง popover ใต้ปุ่ม ชิดขอบขวาของปุ่ม (ปุ่มอยู่ฝั่งขวาของแถบ)
  useEffect(() => {
    const pop = popRef.current;
    const btn = btnRef.current;
    if (!pop || !btn) return;
    const place = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") return;
      const r = btn.getBoundingClientRect();
      pop.style.top = `${r.bottom + 4}px`;
      pop.style.left = `${Math.max(8, Math.min(r.right - POP_WIDTH, innerWidth - POP_WIDTH - 8))}px`;
      pop.style.maxHeight = `${Math.max(240, innerHeight - r.bottom - 12)}px`;
    };
    pop.addEventListener("beforetoggle", place);
    return () => pop.removeEventListener("beforetoggle", place);
  }, []);
  const set = new Set(hidden);
  const shown = columns.filter((c) => !set.has(c.id)).length;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        popoverTarget={`${id}-pop`}
        aria-haspopup="dialog"
        title="เลือกคอลัมน์ที่แสดง"
        className={`inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium text-foreground hover:bg-hover ${focusRing}`}
      >
        <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 4h14v12H3zM8 4v12M13 4v12" />
        </svg>
        คอลัมน์
        {hidden.length > 0 && <span className="text-xs text-muted tabular-nums">{`${shown}/${columns.length}`}</span>}
      </button>
      <div
        ref={popRef}
        id={`${id}-pop`}
        popover="auto"
        role="dialog"
        aria-label="เลือกคอลัมน์ที่แสดง"
        className="fixed inset-auto m-0 w-64 max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-lg border border-line bg-surface text-sm text-foreground shadow-lg open:flex"
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
          {columns.map((c) => (
            <label key={c.id} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-hover">
              <input
                type="checkbox"
                checked={!set.has(c.id)}
                // ต้องเหลืออย่างน้อยหนึ่งคอลัมน์
                disabled={!set.has(c.id) && shown === 1}
                onChange={(e) => onChange(e.target.checked ? hidden.filter((h) => h !== c.id) : [...hidden, c.id])}
                className={`size-3.5 shrink-0 accent-accent ${focusRing}`}
              />
              <span className="min-w-0 flex-1">{c.label}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end border-t border-line px-3 py-2">
          <button
            type="button"
            disabled={!hidden.length}
            onClick={() => onChange([])}
            className={`h-8 rounded-md px-3 font-medium hover:bg-hover disabled:pointer-events-none disabled:opacity-40 ${focusRing}`}
          >
            แสดงทั้งหมด
          </button>
        </div>
      </div>
    </>
  );
}
