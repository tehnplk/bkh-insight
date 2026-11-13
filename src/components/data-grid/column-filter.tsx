"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/app-shell/icons";
import type { FacetPage } from "@/lib/grid-query";

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const POP_WIDTH = 288; // w-72
const SEARCH_DEBOUNCE_MS = 300;
const BLANK = "(ว่าง)";
const fmt = (n: number) => n.toLocaleString("th-TH");
const checkboxes = (root: HTMLElement | null) => [...(root?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])];

/**
 * ตัวกรองบนหัวคอลัมน์แบบ Excel: ปุ่มกรวย -> popover รายการค่าที่ไม่ซ้ำ (ดึงจาก server ตามตัวกรองอื่นที่ใช้อยู่) ติ๊กเลือก และพิมพ์ค้นหาค่าได้
 * ติ๊กเป็นร่าง ส่ง onChange ครั้งเดียวตอนปิด (เหมือน MultiSelect) ; ค่าว่าง = เลือกทั้งหมด (ไม่กรอง)
 * facetUrl(q) = URL ของ endpoint พร้อม facet=<คอลัมน์> และตัวกรองปัจจุบัน
 */
export function ColumnFilter({
  label,
  value,
  onChange,
  facetUrl,
  formatValue,
}: {
  label: string;
  value: string[];
  onChange: (values: string[]) => void;
  facetUrl: (q: string) => string;
  formatValue?: (v: string) => string;
}) {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [query, setQuery] = useState("");
  const [sentQuery, setSentQuery] = useState("");
  const [facets, setFacets] = useState<{ key: string; data?: FacetPage; error?: string }>({ key: "" });
  const latest = useRef({ draft, value, onChange });
  useEffect(() => {
    latest.current = { draft, value, onChange };
  });

  const url = open ? facetUrl(sentQuery) : "";
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `โหลดรายการไม่สำเร็จ (HTTP ${res.status})`);
        return body as FacetPage;
      })
      .then(
        (data) => setFacets({ key: url, data }),
        (e: Error) => {
          if (!ctrl.signal.aborted) setFacets({ key: url, error: e.message });
        },
      );
    return () => ctrl.abort();
  }, [url]);

  // พิมพ์ค้นหา: หน่วงก่อนยิง request (ค้นฝั่ง server เพราะค่าอาจมีมากกว่าที่แสดง)
  useEffect(() => {
    if (query === sentQuery) return;
    const t = setTimeout(() => setSentQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, sentQuery]);

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
      setSentQuery("");
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

  const show = (v: string, l?: string) => (v === "" ? BLANK : (l ?? formatValue?.(v) ?? v));
  const loading = !!url && facets.key !== url;
  const values = facets.key === url ? (facets.data?.values ?? []) : [];
  const selected = new Set(draft);
  // ค่าที่เลือกไว้แต่ไม่อยู่ในรายการตอนนี้ (ค้นหาอยู่/ตัวกรองอื่นเปลี่ยน) ยังแสดงให้เอาออกได้
  const listed = new Set(values.map((f) => f.value));
  const extra = sentQuery ? [] : draft.filter((v) => !listed.has(v));
  const visible = values.map((f) => f.value);
  const allOn = visible.length > 0 && visible.every((v) => selected.has(v));

  function setMany(vs: string[], on: boolean) {
    const next = new Set(draft);
    for (const v of vs) {
      if (on) next.add(v);
      else next.delete(v);
    }
    setDraft([...next]);
  }

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const list = [searchRef.current!, ...checkboxes(popRef.current)];
    const i = list.indexOf(document.activeElement as HTMLInputElement);
    e.preventDefault();
    list.at(Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)) % list.length)?.focus();
  }

  const active = value.length > 0;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        popoverTarget={`${id}-pop`}
        aria-label={active ? `กรอง${label} (เลือก ${value.length})` : `กรอง${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={active ? `กรอง: ${value.map((v) => show(v)).join(", ")}` : `กรอง${label}`}
        // ไม่ให้คลิกที่ปุ่มไปลากคอลัมน์หรือ sort
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        className={`ml-1 inline-grid size-6 place-items-center rounded align-middle ${active ? "bg-accent-soft text-accent-text" : "text-muted opacity-60 hover:opacity-100"} hover:bg-hover hover:text-foreground ${focusRing}`}
      >
        <svg viewBox="0 0 20 20" className="size-3.5" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 4h14l-5.5 6.5V16l-3-1.5v-4z" />
        </svg>
      </button>

      <div
        ref={popRef}
        id={`${id}-pop`}
        popover="auto"
        role="dialog"
        aria-label={`กรอง${label}`}
        onKeyDown={onListKey}
        className="fixed inset-auto m-0 w-72 max-w-[calc(100vw-16px)] flex-col rounded-lg border border-line bg-surface text-sm font-normal whitespace-normal text-foreground shadow-lg open:flex"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Icon name="search" className="size-4 shrink-0 text-muted" />
          <input
            ref={searchRef}
            type="search"
            aria-label={`ค้นหาค่าใน${label}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 min-w-0 flex-1 bg-transparent outline-none"
          />
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          {facets.key === url && facets.error && (
            <p role="alert" className="px-2 py-3 text-danger">
              {facets.error}
            </p>
          )}
          {loading && !values.length && <p className="px-2 py-3 text-muted">กำลังโหลด…</p>}
          {!loading && !facets.error && !values.length && !extra.length && <p className="px-2 py-3 text-muted">ไม่พบค่าที่ตรงกับคำค้น</p>}
          {visible.length > 1 && (
            <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 font-semibold hover:bg-hover">
              <input type="checkbox" checked={allOn} onChange={(e) => setMany(visible, e.target.checked)} className={`size-3.5 shrink-0 accent-accent ${focusRing}`} />
              <span className="min-w-0 flex-1">{sentQuery ? "เลือกทั้งหมดที่ค้นพบ" : "เลือกทั้งหมด"}</span>
            </label>
          )}
          {extra.map((v) => (
            <label key={`x-${v}`} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md py-1 pr-2 pl-2 hover:bg-hover">
              <input type="checkbox" checked onChange={() => setMany([v], false)} className={`size-3.5 shrink-0 accent-accent ${focusRing}`} />
              <span className="min-w-0 flex-1 break-words">{show(v)}</span>
              <span className="text-xs text-muted tabular-nums">0</span>
            </label>
          ))}
          {values.map((f) => (
            <label key={f.value} className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md py-1 pr-2 pl-2 hover:bg-hover">
              <input
                type="checkbox"
                checked={selected.has(f.value)}
                onChange={(e) => setMany([f.value], e.target.checked)}
                className={`size-3.5 shrink-0 accent-accent ${focusRing}`}
              />
              <span className={`min-w-0 flex-1 break-words ${f.value === "" ? "text-muted" : ""}`}>{show(f.value, f.label || undefined)}</span>
              <span className="text-xs text-muted tabular-nums">{fmt(f.count)}</span>
            </label>
          ))}
          {facets.key === url && facets.data?.truncated && (
            <p className="px-2 py-2 text-xs text-muted">แสดง {fmt(values.length)} ค่าแรกที่พบบ่อย พิมพ์ค้นหาเพื่อหาค่าอื่น</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
          <span className="text-muted tabular-nums" aria-live="polite">
            {draft.length ? `เลือก ${fmt(draft.length)}` : "ทั้งหมด"}
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
    </>
  );
}
