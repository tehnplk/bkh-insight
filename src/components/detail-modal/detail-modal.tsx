"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type DetailModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
};

// <dialog> ของ browser: showModal() ทำให้ส่วนอื่น inert, Esc ปิดได้ และคืน focus ให้ปุ่มที่เปิดเมื่อปิด
export function DetailModal({ open, onClose, title, children }: DetailModalProps) {
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
      onClose={onClose}
      className="m-auto w-[min(40rem,calc(100vw-2rem))] max-h-[calc(100dvh-4rem)] rounded-xl bg-white p-0 text-zinc-900 shadow-[0_24px_48px_-12px_rgb(0_0_0/0.35)] backdrop:bg-zinc-950/40 dark:bg-zinc-900 dark:text-zinc-100"
    >
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 pt-5 pb-4 dark:border-zinc-800">
            <h2 id={titleId} className="text-lg font-semibold text-balance">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิด"
              className="-mr-2 grid size-9 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-teal-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
