"use client";

import type { ReactNode } from "react";
import { useDateRange } from "@/components/date-range-filter/date-range-filter";
import { formatThaiDate } from "@/lib/thai-date";
import type { DepartmentSummary, DepartmentSummaryResponse } from "@/app/api/fund/types";
import { CategoryList } from "../_components/category-list";
import { SummaryTable, type SummaryRow } from "../_components/summary-table";
import { FilterChip, Notice, Panel, Skeleton, btn, useJson, useUrlParams } from "../_components/ui";
import { VisitGrid } from "../_components/visit-grid";

const PARAMS = ["dep", "fund", "income"] as const;

const toRows = (deps: DepartmentSummary[]): SummaryRow[] =>
  deps.map((d) => ({
    code: d.dep_code,
    name: d.dep_name,
    visits: d.visits,
    patients: d.patients,
    amount: d.amount,
    children: d.funds.map((f) => ({ code: f.fund_code, name: f.fund_name, visits: f.visits, amount: f.amount })),
  }));

export function OpdDepartment() {
  const { start, end } = useDateRange();
  const { dep, fund, income, set } = useUrlParams(PARAMS);
  const { loading, data, error, retry } = useJson<DepartmentSummaryResponse>(`/api/fund/opd-department/summary?${new URLSearchParams({ start, end })}`);

  const selected = data?.departments.find((d) => d.dep_code === dep);
  const selectedFund = selected?.funds.find((f) => f.fund_code === fund);
  const fundName = selectedFund?.fund_name ?? fund;
  // หมวดค่าใช้จ่ายตามขอบเขตที่เลือก: กองทุนในแผนก > แผนก > ทุกแผนก
  const categories = selectedFund?.categories ?? selected?.categories ?? data?.categories ?? [];
  const categoryScope = selected ? (selectedFund ? `${selected.dep_name} · ${fundName}` : selected.dep_name) : "ทุกแผนก";

  // เปลี่ยนกองทุนแล้วหมวดที่เลือกไว้ไม่มีในขอบเขตใหม่ ให้ล้างหมวดด้วย
  function selectFund(depCode: string, code: string) {
    const d = data?.departments.find((x) => x.dep_code === depCode);
    const scope = (code ? d?.funds.find((f) => f.fund_code === code)?.categories : d?.categories) ?? [];
    const keepIncome = income && scope.some((c) => c.income_code === income);
    set({ dep: depCode, fund: code, income: keepIncome ? income : null });
  }
  const incomeName = categories.find((c) => c.income_code === income)?.income_name ?? income;

  const extraParams: Record<string, string> = { start, end };
  if (dep) extraParams.dep = dep;
  if (fund) extraParams.fund = fund;
  if (income) extraParams.income = income;

  let summary: ReactNode;
  if (error) {
    summary = (
      <Notice title="โหลดข้อมูลไม่สำเร็จ" detail={error} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
    );
  } else if (!data) {
    summary = <Skeleton />;
  } else if (data.departments.length === 0) {
    summary = <Notice title="ไม่มีการรับบริการในช่วงนี้" detail={`${formatThaiDate(start)} – ${formatThaiDate(end)}`} />;
  } else {
    summary = (
      <SummaryTable
        key={`${start}|${end}`}
        rows={toRows(data.departments)}
        totals={data.totals}
        header="แผนก"
        expandLabel="แยกตามกองทุน"
        hideRowCode
        selected={dep}
        selectedChild={fund}
        onSelect={(code) => set({ dep: code, fund: null, income: null })}
        onSelectChild={selectFund}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8" aria-busy={loading}>
      <Panel title="แผนก">{summary}</Panel>

      {data && data.departments.length > 0 && (
        <Panel title={`หมวดค่าใช้จ่าย (บาท) · ${categoryScope}`}>
          <CategoryList categories={categories} income={income} onIncome={(code) => set({ income: code })} />
        </Panel>
      )}

      <Panel
        title="รายการรับบริการ"
        aside={
          (dep || fund || income) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {dep && <FilterChip label={selected?.dep_name ?? dep} onRemove={() => set({ dep: null, fund: null, income: null })} />}
              {fund && <FilterChip label={fundName} onRemove={() => set({ fund: null })} />}
              {income && <FilterChip label={incomeName} onRemove={() => set({ income: null })} />}
            </div>
          )
        }
      >
        <VisitGrid extraParams={extraParams} showDepartment />
      </Panel>
    </div>
  );
}
