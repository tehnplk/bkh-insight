"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type DetailModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** "wide" = เกือบเต็มจอและสูงคงที่ (เนื้อหาเลื่อนข้างใน) สำหรับงานที่มีตาราง ค่าเริ่มต้น "default" กว้าง 40rem */
  size?: "default" | "wide";
};

const SIZE = {
  default: "w-[min(40rem,calc(100vw-2rem))] max-h-[calc(100dvh-4rem)]",
  wide: "w-[min(90rem,calc(100vw-2rem))] h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)]",
};

// <dialog> ของ browser: showModal() ทำให้ส่วนอื่น inert, Esc ปิดได้ และคืน focus ให้ปุ่มที่เปิดเมื่อปิด
export function DetailModal({ open, onClose, title, children, size = "default" }: DetailModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

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
          <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
            <h2 id={titleId} className="text-title text-balance">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิด"
              className="-mr-2 grid size-9 shrink-0 place-items-center rounded-md text-muted outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
