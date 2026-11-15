"use client";

import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from "react";

export type DetailModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** ค่าเริ่มต้น "default" กว้าง 40rem, "medium" กว้าง 56rem (สูงตามเนื้อหาเหมือน default) สำหรับตารางไม่กี่คอลัมน์
   *  "wide" = เกือบเต็มจอและสูงคงที่ (เนื้อหาเลื่อนข้างใน) สำหรับงานที่มีตาราง */
  size?: "default" | "medium" | "wide";
  /** ลากหัว modal เพื่อย้ายตำแหน่งได้ (อยู่ในจอเสมอ เปิดใหม่กลับกลางจอ) */
  draggable?: boolean;
};

const SIZE = {
  default: "w-[min(40rem,calc(100vw-2rem))] max-h-[calc(100dvh-4rem)]",
  medium: "w-[min(56rem,calc(100vw-2rem))] max-h-[calc(100dvh-4rem)]",
  wide: "w-[min(90rem,calc(100vw-2rem))] h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)]",
};

// <dialog> ของ browser: showModal() ทำให้ส่วนอื่น inert, Esc ปิดได้ และคืน focus ให้ปุ่มที่เปิดเมื่อปิด
export function DetailModal({ open, onClose, title, children, size = "default", draggable = false }: DetailModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const drag = useRef<{ x: number; y: number; dx: number; dy: number; rect: DOMRect } | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.style.translate = "";
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // ตำแหน่งเก็บใน style.translate ของ dialog ตรงๆ ไม่ต้อง re-render ระหว่างลาก
  function onPointerDown(e: PointerEvent<HTMLElement>) {
    const dialog = ref.current;
    if (!dialog || e.button !== 0 || (e.target as Element).closest("button")) return;
    const [dx = 0, dy = 0] = dialog.style.translate.split(" ").map(parseFloat);
    drag.current = { x: e.clientX, y: e.clientY, dx, dy, rect: dialog.getBoundingClientRect() };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || !ref.current) return;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    const mx = clamp(e.clientX - d.x, -d.rect.left, window.innerWidth - d.rect.right);
    const my = clamp(e.clientY - d.y, -d.rect.top, window.innerHeight - d.rect.bottom);
    ref.current.style.translate = `${d.dx + mx}px ${d.dy + my}px`;
  }
  const dragProps = draggable
    ? { onPointerDown, onPointerMove, onPointerUp: () => (drag.current = null), onPointerCancel: () => (drag.current = null) }
    : {};

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // React ส่ง close ของ dialog ที่ซ้อนข้างใน (เช่น DataGrid ใน modal) ขึ้นมาถึงตัวนอกด้วย จึงปิดเฉพาะเมื่อเป็น dialog นี้เอง
      onClose={(e) => e.target === e.currentTarget && onClose()}
      className={`m-auto ${SIZE[size]} rounded-xl bg-surface p-0 text-foreground shadow-[0_24px_48px_-12px_rgb(0_0_0/0.35)] backdrop:bg-black/40`}
    >
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <header
            {...dragProps}
            className={`flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4 ${draggable ? "cursor-move touch-none select-none" : ""}`}
          >
            <h2 id={titleId} className="text-title text-balance">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิด"
              className="-mr-2 grid size-9 shrink-0 cursor-default place-items-center rounded-md text-muted outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          {/* relative: ให้ element absolute ข้างใน (เช่น sr-only) อยู่ใน scroller ไม่ดัน dialog ให้เลื่อนซ้อนอีกชั้น */}
          <div className="relative overflow-y-auto px-6 py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
