"use client";

import type { ReactNode } from "react";
import { useDateRange } from "@/components/date-range-filter/date-range-filter";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import type { FundSummary, FundSummaryResponse } from "@/app/api/fund/types";
import { CategoryList } from "../_components/category-list";
import { SummaryTable, type SummaryRow } from "../_components/summary-table";
import { ScopeDetail, rangeText } from "../_components/scope-detail";
import { FilterChip, Notice, Panel, Skeleton, btn, useJson, useUrlParams } from "../_components/ui";
import { VisitGrid } from "../_components/visit-grid";

// q = ช่องค้นหาของ DataGrid ล้างตอนเปิด/ปิด modal ให้ grid ใน modal เริ่มใหม่ (page ล้างใน set อยู่แล้ว)
const PARAMS = ["fund", "pttype", "income", "q"] as const;

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
  const { fund, pttype, income, q, set } = useUrlParams(PARAMS);
  const { loading, data, error, retry } = useJson<FundSummaryResponse>(`/api/fund/opd-fund/summary?${new URLSearchParams({ start, end })}`);

  const selected: FundSummary | undefined = data?.funds.find((f) => f.fund_code === fund);

  // เลือกสิทธิย่อย (จากตารางหรือใน modal) หมวดที่เลือกไว้ไม่มีในขอบเขตใหม่ให้ล้าง เปลี่ยนกองทุน = เปิด modal ใหม่ ล้างคำค้น
  function selectPttype(fundCode: string, code: string) {
    const f = data?.funds.find((x) => x.fund_code === fundCode);
    const scope = (code ? f?.pttypes.find((p) => p.pttype === code)?.categories : f?.categories) ?? [];
    const keepIncome = income && scope.some((c) => c.income_code === income);
    set({ fund: fundCode, pttype: code, income: keepIncome ? income : null, q: fundCode === fund ? q : null });
  }
  const close = () => set({ fund: null, pttype: null, income: null, q: null });

  let summary: ReactNode;
  if (error) {
    summary = (
      <Notice title="โหลดข้อมูลไม่สำเร็จ" detail={error} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
    );
  } else if (!data) {
    summary = <Skeleton />;
  } else if (data.funds.length === 0) {
    summary = <Notice title="ไม่มีการรับบริการในช่วงนี้" detail={rangeText(start, end)} />;
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
        onSelect={(code) => (code ? selectPttype(code, "") : close())}
        onSelectChild={selectPttype}
      />
    );
  }

  let detail: ReactNode;
  if (selected) {
    detail = <FundDetail fund={selected} pttype={pttype} income={income} start={start} end={end} onPttype={(code) => selectPttype(selected.fund_code, code)} onIncome={(code) => set({ income: code })} />;
  } else if (error) {
    detail = <Notice title="โหลดข้อมูลไม่สำเร็จ" detail={error} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />;
  } else if (!data) {
    detail = <Skeleton rows={8} />;
  } else {
    detail = <Notice title="ไม่พบกองทุนนี้ในช่วงวันที่ที่เลือก" detail={rangeText(start, end)} />;
  }

  return (
    <div className="flex flex-col gap-8" aria-busy={loading}>
      <section aria-label="กองทุน">{summary}</section>

      {/* modal เปิดอยู่ไม่ render ส่วนนี้ เพราะ DataGrid เก็บ page/q/sort ใน URL สอง grid ในหน้าเดียวจะใช้ state ร่วมกัน */}
      {!fund && data && data.funds.length > 0 && (
        <>
          <Panel title="หมวดค่าใช้จ่าย (บาท) · ทุกกองทุน">
            <CategoryList categories={data.categories} income={income} onIncome={(code) => set({ income: code })} />
          </Panel>
          <Panel
            title="รายการรับบริการ"
            aside={income && <FilterChip label={data.categories.find((c) => c.income_code === income)?.income_name ?? income} onRemove={() => set({ income: null })} />}
          >
            <VisitGrid extraParams={income ? { start, end, income } : { start, end }} />
          </Panel>
        </>
      )}

      <DetailModal
        open={!!fund}
        onClose={close}
        size="wide"
        title={
          <>
            {selected?.fund_name ?? fund}{" "}
            <span className="ml-1 font-normal whitespace-nowrap text-muted">{rangeText(start, end)}</span>
          </>
        }
      >
        {detail}
      </DetailModal>
    </div>
  );
}

type FundDetailProps = {
  fund: FundSummary;
  pttype: string;
  income: string;
  start: string;
  end: string;
  onPttype: (code: string) => void;
  onIncome: (code: string) => void;
};

function FundDetail({ fund, pttype, income, start, end, onPttype, onIncome }: FundDetailProps) {
  const pt = fund.pttypes.find((p) => p.pttype === pttype);

  const params: Record<string, string> = { start, end, fund: fund.fund_code };
  if (pt) params.pttype = pt.pttype;
  if (income) params.income = income;

  return (
    <ScopeDetail
      visits={pt?.visits ?? fund.visits}
      patients={pt ? undefined : fund.patients}
      amount={pt?.amount ?? fund.amount}
      chipsLabel="สิทธิย่อย"
      chips={fund.pttypes.map((p) => ({
        code: p.pttype,
        label: (
          <>
            <span className="text-xs opacity-70">{p.pttype}</span> {p.pttype_name}
          </>
        ),
      }))}
      chip={pt?.pttype ?? ""}
      onChip={onPttype}
      categories={pt?.categories ?? fund.categories}
      income={income}
      onIncome={onIncome}
      gridParams={params}
    />
  );
}
