"use client";

import type { ReactNode } from "react";
import { formatBaht, formatCompactBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { CategoryAmount } from "@/app/api/fund/types";
import { CategoryList } from "./category-list";
import { FilterChip, Panel, focusRing } from "./ui";
import { VisitGrid } from "./visit-grid";

export const rangeText = (start: string, end: string) => (start === end ? formatThaiDate(start) : `${formatThaiDate(start)} – ${formatThaiDate(end)}`);

type ScopeDetailProps = {
  visits: number;
  /** ไม่ส่ง = ไม่แสดง (API มีผู้ป่วยไม่ซ้ำเฉพาะระดับแถวหลัก ไม่แยกตามแถวย่อย) */
  patients?: number;
  amount: number;
  chipsLabel: string;
  chips: { code: string; label: ReactNode }[];
  /** รหัสแถวย่อยที่เลือก "" = ทั้งหมด */
  chip: string;
  onChip: (code: string) => void;
  categories: CategoryAmount[];
  income: string;
  onIncome: (code: string) => void;
  gridParams: Record<string, string>;
};

/** เนื้อหาใน modal ของแถวสรุป (กองทุน/แผนก): ตัวเลขสรุป, แถวย่อย, หมวดค่าใช้จ่าย และรายการรับบริการ ตามขอบเขตที่เลือก */
export function ScopeDetail({ visits, patients, amount, chipsLabel, chips, chip, onChip, categories, income, onIncome, gridParams }: ScopeDetailProps) {
  const incomeName = categories.find((c) => c.income_code === income)?.income_name ?? income;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
          <Kpi label="visit" value={formatCount(visits)} />
          {patients !== undefined && <Kpi label="ผู้ป่วย" value={formatCount(patients)} />}
          <Kpi label="มูลค่า" value={<span title={`${formatBaht(amount)} บาท`}>{formatCompactBaht(amount)}</span>} />
        </dl>
        {chips.length > 1 && (
          <div role="group" aria-label={chipsLabel} className="flex flex-wrap gap-1">
            <Chip on={!chip} onClick={() => onChip("")}>
              ทั้งหมด
            </Chip>
            {chips.map((c) => (
              <Chip key={c.code} on={c.code === chip} onClick={() => onChip(c.code)}>
                {c.label}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <Panel title="หมวดค่าใช้จ่าย (บาท)">
        <CategoryList categories={categories} income={income} onIncome={onIncome} />
      </Panel>

      <Panel title="รายการรับบริการ" aside={income && <FilterChip label={incomeName} onRemove={() => onIncome("")} />}>
        <VisitGrid extraParams={gridParams} />
      </Panel>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-7 rounded-md border px-2 py-0.5 text-left text-sm ${
        on ? "border-accent-line bg-accent-soft font-medium text-accent-text" : "border-line text-muted hover:bg-hover hover:text-foreground"
      } ${focusRing}`}
    >
      {children}
    </button>
  );
}
