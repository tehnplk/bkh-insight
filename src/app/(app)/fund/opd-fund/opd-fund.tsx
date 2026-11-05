"use client";

import type { ReactNode } from "react";
import { useDateRange } from "@/components/date-range-filter/date-range-filter";
import { formatThaiDate } from "@/lib/thai-date";
import type { FundSummary, FundSummaryResponse } from "@/app/api/fund/types";
import { CategoryList } from "../_components/category-list";
import { SummaryTable, type SummaryRow } from "../_components/summary-table";
import { FilterChip, Notice, Panel, Skeleton, btn, useJson, useUrlParams } from "../_components/ui";
import { VisitGrid } from "../_components/visit-grid";

const PARAMS = ["fund", "pttype", "income"] as const;

const toRows = (funds: FundSummary[]): SummaryRow[] =>
  funds.map((f) => ({
    code: f.fund_code,
    name: f.fund_name,
    visits: f.visits,
    patients: f.patients,
    amount: f.amount,
    children: f.pttypes.map((p) => ({ code: p.pttype, name: p.pttype_name, visits: p.visits, amount: p.amount })),
  }));

export function OpdFund() {
  const { start, end } = useDateRange();
  const { fund, pttype, income, set } = useUrlParams(PARAMS);
  const { loading, data, error, retry } = useJson<FundSummaryResponse>(`/api/fund/opd-fund/summary?${new URLSearchParams({ start, end })}`);

  const selected: FundSummary | undefined = data?.funds.find((f) => f.fund_code === fund);
  const selectedPt = selected?.pttypes.find((p) => p.pttype === pttype);
  const pttypeName = selectedPt?.pttype_name ?? pttype;
  // หมวดค่าใช้จ่ายตามขอบเขตที่เลือก: สิทธิย่อย > กองทุน > ทุกกองทุน
  const categories = selectedPt?.categories ?? selected?.categories ?? data?.categories ?? [];
  const categoryScope = selected ? (selectedPt ? `${selected.fund_name} · ${pttypeName}` : selected.fund_name) : "ทุกกองทุน";

  // เปลี่ยนสิทธิย่อยแล้วหมวดที่เลือกไว้ไม่มีในขอบเขตใหม่ ให้ล้างหมวดด้วย
  function selectPttype(fundCode: string, code: string) {
    const f = data?.funds.find((x) => x.fund_code === fundCode);
    const scope = (code ? f?.pttypes.find((p) => p.pttype === code)?.categories : f?.categories) ?? [];
    const keepIncome = income && scope.some((c) => c.income_code === income);
    set({ fund: fundCode, pttype: code, income: keepIncome ? income : null });
  }
  const incomeName = categories.find((c) => c.income_code === income)?.income_name ?? income;

  const extraParams: Record<string, string> = { start, end };
  if (fund) extraParams.fund = fund;
  if (pttype) extraParams.pttype = pttype;
  if (income) extraParams.income = income;

  let summary: ReactNode;
  if (error) {
    summary = (
      <Notice title="โหลดข้อมูลไม่สำเร็จ" detail={error} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
    );
  } else if (!data) {
    summary = <Skeleton />;
  } else if (data.funds.length === 0) {
    summary = <Notice title="ไม่มีการรับบริการในช่วงนี้" detail={`${formatThaiDate(start)} – ${formatThaiDate(end)}`} />;
  } else {
    summary = (
      <SummaryTable
        key={`${start}|${end}`}
        rows={toRows(data.funds)}
        totals={data.totals}
        header="กองทุน"
        expandLabel="แยกตามสิทธิ"
        childCodeFirst
        selected={fund}
        selectedChild={pttype}
        onSelect={(code) => set({ fund: code, pttype: null, income: null })}
        onSelectChild={selectPttype}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8" aria-busy={loading}>
      <Panel title="กองทุน">{summary}</Panel>

      {data && data.funds.length > 0 && (
        <Panel title={`หมวดค่าใช้จ่าย (บาท) · ${categoryScope}`}>
          <CategoryList categories={categories} income={income} onIncome={(code) => set({ income: code })} />
        </Panel>
      )}

      <Panel
        title="รายการรับบริการ"
        aside={
          (fund || pttype || income) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {fund && <FilterChip label={selected?.fund_name ?? fund} onRemove={() => set({ fund: null, pttype: null, income: null })} />}
              {pttype && <FilterChip label={pttypeName} onRemove={() => set({ pttype: null })} />}
              {income && <FilterChip label={incomeName} onRemove={() => set({ income: null })} />}
            </div>
          )
        }
      >
        <VisitGrid extraParams={extraParams} />
      </Panel>
    </div>
  );
}
