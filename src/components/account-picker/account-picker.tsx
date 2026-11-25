"use client";

import { useState } from "react";

export type AccountOption = { code: string; name: string };

/**
 * ช่องบัญชีแบบพิมพ์ค้น (ARIA combobox) ค้นแบบ substring ทั้งรหัสและชื่อ
 * ไม่ใช้ <datalist> เพราะ Chrome จับชื่อเฉพาะต้นคำ ชื่อภาษาไทยไม่มีเว้นวรรค ค้นกลางชื่อไม่เจอ
 */
export function AccountPicker({ id, accounts, value, invalid, onChange }: { id: string; accounts: readonly AccountOption[]; value: string; invalid: boolean; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = value.trim().toLowerCase();
  // เลือกบัญชีแล้ว (หรือยังไม่พิมพ์) แสดงทั้งผัง ให้เปลี่ยนบัญชีได้โดยไม่ต้องลบรหัสเดิม
  const list = !q || accounts.some((a) => a.code === value) ? accounts : accounts.filter((a) => `${a.code} ${a.name}`.toLowerCase().includes(q));
  const optId = (i: number) => `${id}-opt-${i}`;
  const selected = Math.max(0, list.findIndex((a) => a.code === value));
  const move = (i: number) => {
    setOpen(true);
    setActive(i);
  };
  const choose = (code: string) => {
    onChange(code);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        id={id}
        required
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && list[active] ? optId(active) : undefined}
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onClick={() => !open && move(selected)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") move(open ? Math.min(active + 1, list.length - 1) : selected);
          else if (e.key === "ArrowUp") move(Math.max(active - 1, 0));
          else if (e.key === "Escape" && open) setOpen(false);
          else if (e.key === "Enter" && open && list[active]) choose(list[active].code);
          else return;
          e.preventDefault();
        }}
        className="h-9 w-48 rounded-md border border-line bg-surface px-3 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-danger-line"
      />
      {open && list.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="บัญชี"
          className="absolute top-full left-0 z-20 mt-1 max-h-72 w-[min(32rem,calc(100vw-32px))] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-1 shadow-lg"
        >
          {list.map((a, i) => (
            <li
              key={a.code}
              id={optId(i)}
              ref={i === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              role="option"
              aria-selected={a.code === value}
              // mousedown: กัน input blur ปิดรายการก่อนคลิกถึง ; click: กัน <label> ที่ครอบส่งคลิกต่อให้ input แล้วเปิดรายการซ้ำ
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                choose(a.code);
              }}
              onMouseMove={() => setActive(i)}
              className={`flex cursor-pointer gap-2 rounded-md px-2 py-1.5 ${i === active ? "bg-hover" : ""}`}
            >
              <span className="shrink-0 tabular-nums">{a.code}</span>
              <span className="min-w-0 text-muted">{a.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
