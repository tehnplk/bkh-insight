"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/app-shell/icons";

export type MultiSelectOption = {
  value: string;
  label: string;
  /** ข้อความรองหน้า label เช่น รหัส แสดงสีจางและค้นหาได้ */
  hint?: string;
};
export type MultiSelectGroup = { value: string; label: string; options: MultiSelectOption[] };

export type MultiSelectProps = {
  /** แสดงหน้าปุ่ม และเป็นชื่อของรายการสำหรับ screen reader */
  label: string;
  groups: MultiSelectGroup[];
  value: string[];
  /** เรียกครั้งเดียวตอนปิดรายการ (ถ้าค่าเปลี่ยน) หรือกดล้าง ค่าเรียงตามลำดับของ options */
  onChange: (values: string[]) => void;
  /** ข้อความบนปุ่มเมื่อไม่ได้เลือก (ค่าเริ่มต้น "ทั้งหมด") */
  allLabel?: string;
};

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const POP_WIDTH = 320; // w-80
const checkboxes = (root: HTMLElement | null) => [...(root?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])];
const matches = (o: MultiSelectOption, q: string) =>
  !q || o.label.toLowerCase().includes(q) || (o.hint?.toLowerCase().includes(q) ?? false);

// ปุ่มสรุปค่าที่เลือก + รายการ checkbox แบ่งกลุ่มใน native popover (top layer, Esc/คลิกนอกกรอบปิด และคืน focus ให้ปุ่ม)
// เลือกในรายการเป็นร่าง แล้วส่ง onChange ครั้งเดียวตอนปิด หน้าที่โหลดข้อมูลตาม URL จึงไม่ยิง query ทุกครั้งที่ติ๊ก
// คีย์บอร์ด: เปิดแล้ว focus อยู่ที่ช่องค้นหา, ลูกศรขึ้น/ลงเลื่อนระหว่าง checkbox, Space ติ๊ก, Esc ปิด
export function MultiSelect({ label, groups, value, onChange, allLabel = "ทั้งหมด" }: MultiSelectProps) {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [query, setQuery] = useState("");
  // ค่าล่าสุดสำหรับ handler ของ toggle ที่ผูกครั้งเดียว
  const latest = useRef({ draft, value, onChange });
  useEffect(() => {
    latest.current = { draft, value, onChange };
  });

  const all = groups.flatMap((g) => g.options);
  const order = new Map(all.map((o, i) => [o.value, i]));
  const sorted = (vs: string[]) => [...vs].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
  const labelOf = (v: string) => all.find((o) => o.value === v)?.label || v;

  useEffect(() => {
    const pop = popRef.current;
    const btn = btnRef.current;
    if (!pop || !btn) return;
    const before = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") return;
      const r = btn.getBoundingClientRect();
      pop.style.top = `${r.bottom + 4}px`;
      pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - POP_WIDTH - 8))}px`;
      pop.style.maxHeight = `${Math.max(240, innerHeight - r.bottom - 12)}px`;
      setDraft(latest.current.value);
      setQuery("");
    };
    const toggle = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === "open";
      setOpen(isOpen);
      if (isOpen) searchRef.current?.focus();
      else {
        const { draft: d, value: v, onChange: change } = latest.current;
        if (d.length !== v.length || d.some((x) => !v.includes(x))) change(d);
      }
    };
    pop.addEventListener("beforetoggle", before);
    pop.addEventListener("toggle", toggle);
    return () => {
      pop.removeEventListener("beforetoggle", before);
      pop.removeEventListener("toggle", toggle);
    };
  }, []);

  const q = query.trim().toLowerCase();
  const visible = groups
    .map((g) => ({ ...g, options: g.options.filter((o) => matches(o, q)) }))
    .filter((g) => g.options.length);
  const selected = new Set(draft);

  function setMany(values: string[], on: boolean) {
    const next = new Set(draft);
    for (const v of values) {
      if (on) next.add(v);
      else next.delete(v);
    }
    setDraft(sorted([...next]));
  }

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const list = [searchRef.current!, ...checkboxes(popRef.current)];
    const i = list.indexOf(document.activeElement as HTMLInputElement);
    e.preventDefault();
    list.at(Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)) % list.length)?.focus();
  }

  const summary = value.length === 0 ? allLabel : value.length === 1 ? labelOf(value[0]) : `${labelOf(sorted(value)[0])} +${value.length - 1}`;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span id={`${id}-label`} className="text-muted">
        {label}
      </span>
      <div className="flex h-9 min-w-0 items-center rounded-md border border-line bg-surface">
        <button
          ref={btnRef}
          type="button"
          popoverTarget={`${id}-pop`}
          aria-labelledby={`${id}-label ${id}-value`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={`${id}-pop`}
          className={`mx-0.5 flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 font-medium hover:bg-hover ${open ? "bg-hover" : ""} ${focusRing}`}
        >
          <span id={`${id}-value`} className="max-w-56 truncate">
            {summary}
          </span>
          {value.length > 1 && <span className="sr-only">{`เลือก ${value.length} รายการ`}</span>}
          <Icon name="chevron" className={`size-3.5 shrink-0 text-muted transition-transform duration-150 motion-reduce:transition-none ${open ? "-rotate-90" : "rotate-90"}`} />
        </button>
        {value.length > 0 && (
          <button
            type="button"
            aria-label={`ล้าง${label}ที่เลือก`}
            onClick={() => onChange([])}
            className={`mr-0.5 grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-foreground ${focusRing}`}
          >
            <Icon name="close" className="size-3.5" />
          </button>
        )}
      </div>

      <div
        ref={popRef}
        id={`${id}-pop`}
        popover="auto"
        role="dialog"
        aria-label={label}
        onKeyDown={onListKey}
        className="fixed inset-auto m-0 w-80 max-w-[calc(100vw-16px)] flex-col rounded-lg border border-line bg-surface text-sm text-foreground shadow-lg open:flex"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Icon name="search" className="size-4 shrink-0 text-muted" />
          <input
            ref={searchRef}
            type="search"
            aria-label={`ค้นหา${label}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 min-w-0 flex-1 bg-transparent outline-none"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
          {visible.length === 0 && <p className="px-2 py-3 text-muted">ไม่พบรายการที่ตรงกับคำค้น</p>}
          {visible.map((g) => {
            const values = g.options.map((o) => o.value);
            const n = values.filter((v) => selected.has(v)).length;
            return (
              <div key={g.value} role="group" aria-labelledby={`${id}-g-${g.value}`} className="py-0.5">
                <label className="sticky top-0 flex h-8 cursor-pointer items-center gap-2 rounded-md bg-surface px-2 font-semibold hover:bg-hover">
                  <input
                    type="checkbox"
                    checked={n === values.length}
                    ref={(el) => {
                      if (el) el.indeterminate = n > 0 && n < values.length;
                    }}
                    onChange={(e) => setMany(values, e.target.checked)}
                    className={`size-3.5 shrink-0 accent-accent ${focusRing}`}
                  />
                  <span id={`${id}-g-${g.value}`} className="min-w-0 flex-1 truncate">
                    {g.label}
                  </span>
                  <span className="text-xs font-normal text-muted tabular-nums">{n > 0 ? `${n}/${values.length}` : values.length}</span>
                </label>
                {g.options.map((o) => (
                  <label key={o.value} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md py-1 pr-2 pl-7 hover:bg-hover">
                    <input
                      type="checkbox"
                      checked={selected.has(o.value)}
                      onChange={(e) => setMany([o.value], e.target.checked)}
                      className={`size-3.5 shrink-0 accent-accent ${focusRing}`}
                    />
                    {o.hint && <span className="w-6 shrink-0 text-muted tabular-nums">{o.hint}</span>}
                    <span className="min-w-0 flex-1">{o.label}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
          <span className="text-muted tabular-nums" aria-live="polite">
            {draft.length ? `เลือก ${draft.length}` : allLabel}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={draft.length === 0}
              onClick={() => setDraft([])}
              className={`h-8 rounded-md px-3 font-medium hover:bg-hover disabled:pointer-events-none disabled:opacity-40 ${focusRing}`}
            >
              ล้าง
            </button>
            <button
              type="button"
              onClick={() => {
                popRef.current?.hidePopover();
                btnRef.current?.focus();
              }}
              className={`h-8 rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90 ${focusRing}`}
            >
              ตกลง
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
