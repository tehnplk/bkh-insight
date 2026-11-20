"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** ปุ่มไอคอนคัดลอก value ต่อท้ายค่าที่แสดง (HN, VN, AN, เลขบัตร) ; label = ชื่อสิ่งที่คัดลอก ใช้ทำ aria-label "คัดลอก{label}" */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("ok");
    } catch {
      // clipboard ใช้ไม่ได้นอก secure context: ผู้ใช้เลือกข้อความเองได้
      setState("fail");
    }
    setTimeout(() => setState("idle"), 1500);
  }
  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={`คัดลอก${label}`}
        title={state === "fail" ? "คัดลอกไม่ได้ ให้เลือกข้อความเอง" : `คัดลอก${label}`}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded align-middle font-normal text-muted outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {state === "ok" ? <Check className="size-3.5 text-success" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      </button>
      <span role="status" className="sr-only">{state === "ok" ? "คัดลอกแล้ว" : state === "fail" ? "คัดลอกไม่ได้" : ""}</span>
    </>
  );
}

/** ค่า + ปุ่มคัดลอก (คัดลอกค่าที่ตัดช่องว่างหัวท้าย) ; ค่าว่างคืน null ให้ผู้แสดง เช่น Fact ของ modal แสดงขีดเอง */
export function copyable(value: string | null | undefined, label: string) {
  const v = value?.trim();
  if (!v) return null;
  return (
    <span className="whitespace-nowrap">
      {v}
      <CopyButton value={v} label={label} />
    </span>
  );
}
