"use client";

import type { ReactNode } from "react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate, todayIso } from "@/lib/thai-date";
import { FY_BACK, fiscalYearOf } from "@/app/api/fund/uc-dashboard/dashboard";
import type { SmtReconcilePage } from "@/app/api/fund/smt-reconcile/route";
import { RECONCILE_STATUSES, STATUS_LABEL, type ReconcileRow, type ReconcileStatus } from "@/app/api/fund/smt-reconcile/reconcile";
import { Money, focusRing, num, useUrlParams } from "../_components/ui";
import { Fact, Facts } from "../uc-debtor/uc-debtor-detail";
import { periodLabel } from "../stm-import/labels";

const FILTER_KEYS = ["fy"] as const;
const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium ${focusRing}`;
const dash = <span className="text-muted">–</span>;
const thaiDate = (v: string | null) => (v ? formatThaiDate(v) : dash);
const CHIP: Record<ReconcileStatus, string> = {
  match: "border-success-line bg-success-soft text-success",
  diff: "border-danger-line bg-danger-soft text-danger",
  smt_only: "border-warning-line bg-warning-soft text-warning",
  stm_only: "border-warning-line bg-warning-soft text-warning",
};

const Status = ({ status }: { status: ReconcileStatus }) => (
  <span className={`rounded border px-1.5 py-0.5 whitespace-nowrap ${CHIP[status]}`}>{STATUS_LABEL[status]}</span>
);

const col = gridColumnHelper<ReconcileRow>();
const COLUMNS = col.columns([
  col.accessor("key", { header: "งวด", meta: { className: "whitespace-nowrap tabular-nums", filter: true } }),
  col.accessor("period_month", {
    header: "เดือนบริการ",
    cell: (c) => periodLabel(c.getValue()),
    meta: { className: "whitespace-nowrap", filter: { format: periodLabel } },
  }),
  col.accessor("patient_type", { header: "OP/IP", meta: { filter: true } }),
  col.accessor("smt_date", { header: "วันที่โอนล่าสุด", cell: (c) => thaiDate(c.getValue()), meta: { className: "whitespace-nowrap tabular-nums" } }),
  col.accessor("batches", { header: "ชุดโอน", cell: (c) => c.getValue() || dash, enableSorting: false, meta: { className: "whitespace-nowrap tabular-nums" } }),
  col.accessor("smt_total", { header: "ยอดโอน SMT (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
  col.accessor("stm_doc", { header: "เลขที่ STM", cell: (c) => c.getValue() || dash, meta: { className: "whitespace-nowrap", filter: true } }),
  col.accessor("stm_total", { header: "ยอดโอนสุทธิ STM (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
  col.accessor("diff", { header: "ส่วนต่าง (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: `${num} font-semibold` } }),
  col.accessor("status", {
    header: "สถานะ",
    cell: (c) => <Status status={c.getValue()} />,
    meta: { filter: { format: (v) => STATUS_LABEL[v as ReconcileStatus] ?? v } },
  }),
]);

function Detail({ row }: { row: ReconcileRow }) {
  return (
    <div className="flex flex-col gap-4">
      <Facts>
        <Fact label="ยอดโอน SMT (บาท)"><span className="font-semibold"><Money value={row.smt_total} /></span></Fact>
        <Fact label="ยอดโอนสุทธิ STM (บาท)"><span className="font-semibold"><Money value={row.stm_total} /></span></Fact>
        <Fact label="ส่วนต่าง (บาท)"><span className="font-semibold"><Money value={row.diff} /></span></Fact>
        <Fact label="สถานะ"><Status status={row.status} /></Fact>
        <Fact label="เลขที่ STM">{row.stm_doc ?? dash}</Fact>
        <Fact label="วันที่ออก STM">{thaiDate(row.stm_date)}</Fact>
      </Facts>
      {row.lines.length === 0 ? (
        <p className="text-muted">ไม่พบรายการโอนใน SMT ที่อ้างงวดนี้</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">รายการโอนใน SMT ของงวด {row.key}</caption>
            <thead className="bg-surface-sunken text-left text-muted">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">วันที่โอน</th>
                <th scope="col" className="px-2 py-1.5 font-medium">ชุด</th>
                <th scope="col" className="px-2 py-1.5 font-medium">เลขอ้างอิง</th>
                <th scope="col" className="px-2 py-1.5 font-medium">รายการ</th>
                <th scope="col" className="px-2 py-1.5 font-medium">รหัสบัญชี</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">ยอดจัดสรร (บาท)</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">รอโอน/หักหนี้ (บาท)</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">โอนสุทธิ (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {row.lines.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{formatThaiDate(l.date)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{l.batch_no}</td>
                  <td className="px-2 py-1.5">{l.ref}</td>
                  <td className="px-2 py-1.5">
                    {l.fund}
                    {!l.paid && <span className="ml-1.5 text-xs text-warning">รอโอน</span>}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-muted">{l.account ?? "–"}</td>
                  <td className={`px-2 py-1.5 ${num}`}>{formatBaht(l.amount)}</td>
                  <td className={`px-2 py-1.5 ${num}`}>{formatBaht(l.wait + l.debt)}</td>
                  <td className={`px-2 py-1.5 font-semibold ${num}`}>{formatBaht(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const renderDetail = (r: ReconcileRow) => <Detail row={r} />;
const detailTitle = (r: ReconcileRow) => (
  <>
    งวด {r.key} <span className="font-normal text-muted">{periodLabel(r.period_month)}</span>
  </>
);

const Value = ({ children }: { children: ReactNode }) => <span className="font-semibold text-foreground">{children}</span>;
const dot = <span aria-hidden="true"> · </span>;

const renderSummary = ({ summary: s, smt_error }: SmtReconcilePage) => (
  <div className="flex flex-col gap-1">
    {smt_error && (
      <p role="alert" className="text-danger">
        {smt_error} แสดงเฉพาะฝั่ง STM ลองโหลดใหม่ภายหลัง
      </p>
    )}
    <p className="text-muted tabular-nums">
      ยอดโอน SMT <Value>{formatBaht(s.smt_total)}</Value> บาท{dot}
      ยอดโอนสุทธิ STM <Value>{formatBaht(s.stm_total)}</Value> บาท{dot}
      ส่วนต่าง <Value>{formatBaht(s.diff)}</Value> บาท
      <span className="mx-2 text-line" aria-hidden="true">|</span>
      {RECONCILE_STATUSES.map((k, i) => (
        <span key={k}>
          {i > 0 && dot}
          {STATUS_LABEL[k]} <Value>{formatCount(s.count[k])}</Value>
        </span>
      ))}
    </p>
  </div>
);

export function SmtReconcile() {
  const { fy, set } = useUrlParams(FILTER_KEYS);
  const currentFy = fiscalYearOf(todayIso());
  const fyOptions = Array.from({ length: FY_BACK + 1 }, (_, i) => currentFy - i);

  return (
    <DataGrid<ReconcileRow, SmtReconcilePage>
      endpoint="/api/fund/smt-reconcile"
      filterKeys={FILTER_KEYS}
      toolbar={
        <label className="flex items-center gap-2">
          <span className="text-muted">ปีงบ (เดือนบริการ)</span>
          <select value={fy || String(currentFy)} onChange={(e) => set({ fy: e.target.value === String(currentFy) ? null : e.target.value })} className={SELECT_CLASS}>
            {fyOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      }
      columns={COLUMNS}
      getRowId={(r) => r.key}
      renderDetail={renderDetail}
      detailTitle={detailTitle}
      detailSize="medium"
      renderSummary={renderSummary}
      exportPlacement="summary"
    />
  );
}
