"use client";

import type { ReactNode } from "react";
import { useDateRange } from "@/components/date-range-filter/date-range-filter";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import type { DepartmentSummary, DepartmentSummaryResponse } from "@/app/api/fund/types";
import { CategoryList } from "../_components/category-list";
import { ScopeDetail, rangeText } from "../_components/scope-detail";
import { SummaryTable, type SummaryRow } from "../_components/summary-table";
import { FilterChip, Notice, Panel, Skeleton, btn, useJson, useUrlParams } from "../_components/ui";
import { VisitGrid } from "../_components/visit-grid";

// q = ช่องค้นหาของ DataGrid ล้างตอนเปิด/ปิด modal ให้ grid ใน modal เริ่มใหม่ (page ล้างใน set อยู่แล้ว)
const PARAMS = ["dep", "fund", "income", "q"] as const;

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
  const { dep, fund, income, q, set } = useUrlParams(PARAMS);
  const { loading, data, error, retry } = useJson<DepartmentSummaryResponse>(`/api/fund/opd-department/summary?${new URLSearchParams({ start, end })}`);

  const selected = data?.departments.find((d) => d.dep_code === dep);

  // เลือกกองทุน (จากตารางหรือใน modal) หมวดที่เลือกไว้ไม่มีในขอบเขตใหม่ให้ล้าง เปลี่ยนแผนก = เปิด modal ใหม่ ล้างคำค้น
  function selectFund(depCode: string, code: string) {
    const d = data?.departments.find((x) => x.dep_code === depCode);
    const scope = (code ? d?.funds.find((f) => f.fund_code === code)?.categories : d?.categories) ?? [];
    const keepIncome = income && scope.some((c) => c.income_code === income);
    set({ dep: depCode, fund: code, income: keepIncome ? income : null, q: depCode === dep ? q : null });
  }
  const close = () => set({ dep: null, fund: null, income: null, q: null });

  let summary: ReactNode;
  if (error) {
    summary = (
      <Notice title="โหลดข้อมูลไม่สำเร็จ" detail={error} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
    );
  } else if (!data) {
    summary = <Skeleton />;
  } else if (data.departments.length === 0) {
    summary = <Notice title="ไม่มีการรับบริการในช่วงนี้" detail={rangeText(start, end)} />;
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
        onSelect={(code) => (code ? selectFund(code, "") : close())}
        onSelectChild={selectFund}
      />
    );
  }

  let detail: ReactNode;
  if (selected) {
    detail = <DepartmentDetail dep={selected} fund={fund} income={income} start={start} end={end} onFund={(code) => selectFund(selected.dep_code, code)} onIncome={(code) => set({ income: code })} />;
  } else if (error) {
    detail = <Notice title="โหลดข้อมูลไม่สำเร็จ" detail={error} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />;
  } else if (!data) {
    detail = <Skeleton rows={8} />;
  } else {
    detail = <Notice title="ไม่พบแผนกนี้ในช่วงวันที่ที่เลือก" detail={rangeText(start, end)} />;
  }

  return (
    <div className="flex flex-col gap-8" aria-busy={loading}>
      <section aria-label="แผนก">{summary}</section>

      {/* modal เปิดอยู่ไม่ render ส่วนนี้ เพราะ DataGrid เก็บ page/q/sort ใน URL สอง grid ในหน้าเดียวจะใช้ state ร่วมกัน */}
      {!dep && data && data.departments.length > 0 && (
        <>
          <Panel title="หมวดค่าใช้จ่าย (บาท) · ทุกแผนก">
            <CategoryList categories={data.categories} income={income} onIncome={(code) => set({ income: code })} />
          </Panel>
          <Panel
            title="รายการรับบริการ"
            aside={income && <FilterChip label={data.categories.find((c) => c.income_code === income)?.income_name ?? income} onRemove={() => set({ income: null })} />}
          >
            <VisitGrid extraParams={income ? { start, end, income } : { start, end }} showDepartment />
          </Panel>
        </>
      )}

      <DetailModal
        open={!!dep}
        onClose={close}
        size="wide"
        title={
          <>
            {selected?.dep_name ?? dep}{" "}
            <span className="ml-1 font-normal whitespace-nowrap text-muted">{rangeText(start, end)}</span>
          </>
        }
      >
        {detail}
      </DetailModal>
    </div>
  );
}

type DepartmentDetailProps = {
  dep: DepartmentSummary;
  fund: string;
  income: string;
  start: string;
  end: string;
  onFund: (code: string) => void;
  onIncome: (code: string) => void;
};

// grid ใน modal ไม่มีคอลัมน์แผนก เพราะทุกแถวเป็นแผนกเดียวกัน
function DepartmentDetail({ dep, fund, income, start, end, onFund, onIncome }: DepartmentDetailProps) {
  const f = dep.funds.find((x) => x.fund_code === fund);

  const params: Record<string, string> = { start, end, dep: dep.dep_code };
  if (f) params.fund = f.fund_code;
  if (income) params.income = income;

  return (
    <ScopeDetail
      visits={f?.visits ?? dep.visits}
      patients={f ? undefined : dep.patients}
      amount={f?.amount ?? dep.amount}
      chipsLabel="กองทุน"
      chips={dep.funds.map((x) => ({
        code: x.fund_code,
        label: (
          <>
            {x.fund_name} {x.fund_code !== "UNKNOWN" && <span className="text-xs opacity-70">{x.fund_code}</span>}
          </>
        ),
      }))}
      chip={f?.fund_code ?? ""}
      onChip={onFund}
      categories={f?.categories ?? dep.categories}
      income={income}
      onIncome={onIncome}
      gridParams={params}
    />
  );
}
