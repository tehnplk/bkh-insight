"use client";

import type { CategoryAmount } from "@/app/api/fund/types";
import { Money, Notice, focusRing, formatPct, pct } from "./ui";

/** หมวดค่าใช้จ่ายพร้อมแถบเทียบหมวดที่มากที่สุด กดเพื่อกรองรายการ (กดซ้ำ = ยกเลิก ส่ง "") */
export function CategoryList({ categories, income, onIncome }: { categories: CategoryAmount[]; income: string; onIncome: (code: string) => void }) {
  if (categories.length === 0) return <Notice title="ไม่มีค่าใช้จ่ายในช่วงนี้" />;
  const total = categories.reduce((s, c) => s + c.amount, 0);
  const max = Math.max(...categories.map((c) => c.amount));
  return (
    <ul className="grid gap-x-6 gap-y-0.5 rounded-lg border border-line p-2 text-sm sm:grid-cols-2">
      {categories.map((c) => {
        const active = c.income_code === income;
        return (
          <li key={c.income_code}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onIncome(active ? "" : c.income_code)}
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-left ${
                active ? "bg-accent-soft text-accent-text" : "hover:bg-hover"
              } ${focusRing}`}
            >
              <span className={`truncate ${active ? "font-semibold" : ""}`}>{c.income_name}</span>
              <span className="text-right tabular-nums">
                <Money value={c.amount} />
                <span className="ml-2 inline-block w-11 text-xs text-muted">{formatPct(pct(c.amount, total))}</span>
              </span>
              <span className="col-span-2 h-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
                <span className={`block h-full rounded-full ${active ? "bg-accent" : "bg-muted/50"}`} style={{ width: `${pct(c.amount, max)}%` }} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
