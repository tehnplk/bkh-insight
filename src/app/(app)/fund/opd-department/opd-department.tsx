"use client";

import { useState, type ReactNode } from "react";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { MultiSelect } from "@/components/multi-select/multi-select";
import { usePersistedFilter } from "@/lib/persisted-filter";
import type { CodeOptionGroup, DepartmentSummary, DepartmentSummaryResponse } from "@/app/api/fund/types";
import { CategoryList } from "../_components/category-list";
import { ScopeDetail, rangeText } from "../_components/scope-detail";
import { SummaryTable, type SummaryRow } from "../_components/summary-table";
import { FilterChip, Notice, Panel, Skeleton, btn, useJson, useUrlParams } from "../_components/ui";
import { VisitGrid } from "../_components/visit-grid";

// q = ช่องค้นหาของ DataGrid ล้างตอนเปิด/ปิด modal ให้ grid ใน modal เริ่มใหม่ (page ล้างใน set อยู่แล้ว)
// deps/pttypes = ตัวกรองแผนก/สิทธิ (คั่นด้วย ",") คนละตัวกับ dep/fund ของ modal
// via=queue = modal ขอบเขต visit ที่ส่งเข้าคิวแผนก (opd_dep_queue) แทนแผนกหลัก
const PARAMS = ["dep", "fund", "income", "q", "via", "deps", "pttypes"] as const;
const FILTERS = ["deps", "pttypes"] as const;

type Options = { pttypeOptions: CodeOptionGroup[]; depOptions: CodeOptionGroup[] };
type Summary = DepartmentSummaryResponse & Options;

const split = (v: string) => (v ? v.split(",") : []);

const toRows = (deps: DepartmentSummary[]): SummaryRow[] =>
  deps.map((d) => ({
    code: d.dep_code,
    name: d.dep_name,
    visits: d.visits,
    patients: d.patients,
    queued: d.queued,
    queuedAmount: d.queuedAmount,
    amount: d.amount,
    children: d.funds.map((f) => ({ code: f.fund_code, name: f.fund_name, visits: f.visits, amount: f.amount, queued: f.queued, queuedAmount: f.queuedAmount })),
  }));

export function OpdDepartment({ title }: { title: ReactNode }) {
  usePersistedFilter("fund/opd-department", FILTERS);
  const { start, end } = useDateRange();
  const { dep, fund, income, q, via, deps, pttypes, set } = useUrlParams(PARAMS);
  const queue = via === "queue";
  const filter = { deps, pttypes };
  const query = new URLSearchParams(Object.entries({ start, end, ...filter }).filter(([, v]) => v));
  const { loading, data, error, retry } = useJson<Summary>(`/api/fund/opd-department/summary?${query}`);
  // ตัวเลือกล่าสุดค้างไว้ระหว่างโหลดใหม่ ปุ่มจะได้ไม่กลายเป็นรหัสทุกครั้งที่เปลี่ยนตัวกรอง
  const [options, setOptions] = useState<Options>();
  if (data && data.pttypeOptions !== options?.pttypeOptions) setOptions({ pttypeOptions: data.pttypeOptions, depOptions: data.depOptions });

  const selected = data?.departments.find((d) => d.dep_code === dep);

  // เลือกกองทุน (จากตารางหรือใน modal) หมวดที่เลือกไว้ไม่มีในขอบเขตใหม่ให้ล้าง เปลี่ยนแผนกหรือโหมด = เปิด modal ใหม่ ล้างคำค้น
  function selectFund(depCode: string, code: string, mode = via) {
    const d = data?.departments.find((x) => x.dep_code === depCode);
    const s = code ? d?.funds.find((f) => f.fund_code === code) : d;
    const scope = (mode === "queue" ? s?.queuedCategories : s?.categories) ?? [];
    const keepIncome = income && scope.some((c) => c.income_code === income);
    set({ dep: depCode, fund: code, via: mode, income: keepIncome ? income : null, q: depCode === dep && mode === via ? q : null });
  }
  const close = () => set({ dep: null, fund: null, income: null, q: null, via: null });

  let summary: ReactNode;
  if (error) {
    summary = (
      <Notice title="โหลดข้อมูลไม่สำเร็จ" detail={error} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
    );
  } else if (!data) {
    summary = <Skeleton />;
  } else if (data.departments.length === 0) {
    summary = <Notice title={deps || pttypes ? "ไม่มีการรับบริการตามแผนกและสิทธิที่เลือก" : "ไม่มีการรับบริการในช่วงนี้"} detail={rangeText(start, end)} />;
  } else {
    summary = (
      <SummaryTable
        key={`${start}|${end}|${deps}|${pttypes}`}
        rows={toRows(data.departments)}
        totals={data.totals}
        header="แผนก"
        expandLabel="แยกตามกองทุน"
        hideRowCode
        queuedHeader="ส่งเข้าแผนก"
        queuedAmountHeader="มูลค่าที่ส่งเข้าแผนก (บาท)"
        selected={dep}
        selectedChild={fund}
        onSelect={(code) => (code ? selectFund(code, "", "") : close())}
        onSelectChild={(depCode, code) => selectFund(depCode, code, "")}
        onSelectQueued={(depCode, code) => selectFund(depCode, code, "queue")}
      />
    );
  }

  let detail: ReactNode;
  if (selected) {
    detail = <DepartmentDetail dep={selected} queue={queue} fund={fund} income={income} start={start} end={end} filter={filter} onFund={(code) => selectFund(selected.dep_code, code)} onIncome={(code) => set({ income: code })} />;
  } else if (error) {
    detail = <Notice title="โหลดข้อมูลไม่สำเร็จ" detail={error} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />;
  } else if (!data) {
    detail = <Skeleton rows={8} />;
  } else {
    detail = <Notice title="ไม่พบแผนกนี้ในช่วงวันที่ที่เลือก" detail={rangeText(start, end)} />;
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {title}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <MultiSelect label="แผนก" groups={options?.depOptions ?? []} value={split(deps)} onChange={(v) => set({ deps: v.join(",") })} />
          <MultiSelect label="สิทธิ" groups={options?.pttypeOptions ?? []} value={split(pttypes)} onChange={(v) => set({ pttypes: v.join(",") })} />
          <DateRangeFilter />
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-8" aria-busy={loading}>
        <section aria-label="แผนก">{summary}</section>

        {/* modal เปิดอยู่ไม่ render ส่วนนี้ เพราะ DataGrid เก็บ page/q/sort ใน URL สอง grid ในหน้าเดียวจะใช้ state ร่วมกัน */}
        {!dep && data && data.departments.length > 0 && (
          <>
            <Panel title={`หมวดค่าใช้จ่าย (บาท) · ${deps ? "แผนกที่เลือก" : "ทุกแผนก"}`}>
              <CategoryList categories={data.categories} income={income} onIncome={(code) => set({ income: code })} />
            </Panel>
            <Panel
              title="รายการรับบริการ"
              aside={income && <FilterChip label={data.categories.find((c) => c.income_code === income)?.income_name ?? income} onRemove={() => set({ income: null })} />}
            >
              {/* ค่าว่างใน params DataGrid ไม่ส่ง */}
              <VisitGrid extraParams={{ start, end, income, ...filter }} showDepartment />
            </Panel>
          </>
        )}

        <DetailModal
          open={!!dep}
          onClose={close}
          size="wide"
          title={
            <>
              {selected?.dep_name ?? dep}
              {queue && " · ส่งเข้าแผนก"}{" "}
              <span className="ml-1 font-normal whitespace-nowrap text-muted">{rangeText(start, end)}</span>
            </>
          }
        >
          {detail}
        </DetailModal>
      </div>
    </>
  );
}

type DepartmentDetailProps = {
  dep: DepartmentSummary;
  /** ขอบเขต visit ที่ส่งเข้าคิวแผนก: ตัวเลข/หมวดใช้ queued* และ grid กรองด้วย qdep */
  queue: boolean;
  fund: string;
  income: string;
  start: string;
  end: string;
  filter: { deps: string; pttypes: string };
  onFund: (code: string) => void;
  onIncome: (code: string) => void;
};

// grid โหมดปกติไม่มีคอลัมน์แผนก เพราะทุกแถวเป็นแผนกเดียวกัน ส่วนโหมดคิวแสดงแผนกหลักของ visit
function DepartmentDetail({ dep, queue, fund, income, start, end, filter, onFund, onIncome }: DepartmentDetailProps) {
  // chip เฉพาะกองทุนที่มีค่าในขอบเขตนั้น (กองทุนที่มีแต่คิวไม่โผล่ในโหมดปกติ)
  const funds = dep.funds.filter((x) => (queue ? x.queued > 0 || x.queuedAmount > 0 : x.visits > 0 || x.amount > 0));
  const f = funds.find((x) => x.fund_code === fund);
  const s = f ?? dep;

  // โหมดคิวไม่ส่ง deps: route กรอง deps ด้วย main_dep จะตัด visit ที่มาจากแผนกอื่นทิ้ง
  const params: Record<string, string> = queue
    ? { start, end, qdep: dep.dep_code, pttypes: filter.pttypes }
    : { start, end, dep: dep.dep_code, ...filter };
  if (f) params.fund = f.fund_code;
  if (income) params.income = income;

  return (
    <ScopeDetail
      visits={queue ? s.queued : s.visits}
      patients={f || queue ? undefined : dep.patients}
      amount={queue ? s.queuedAmount : s.amount}
      chipsLabel="กองทุน"
      chips={funds.map((x) => ({
        code: x.fund_code,
        label: (
          <>
            {x.fund_name} {x.fund_code !== "UNKNOWN" && <span className="text-xs opacity-70">{x.fund_code}</span>}
          </>
        ),
      }))}
      chip={f?.fund_code ?? ""}
      onChip={onFund}
      categories={queue ? s.queuedCategories : s.categories}
      income={income}
      onIncome={onIncome}
      gridParams={params}
      showDepartment={queue}
    />
  );
}
