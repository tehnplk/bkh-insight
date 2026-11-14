"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { Money, focusRing, num, useUrlParams } from "../_components/ui";
import {
  CHECK_RESULTS, RESULT_LABEL, RESULT_TONE,
  type CheckResult, type StpCheckPage, type StpCheckRow,
} from "@/app/api/fund/stp-check/check";

const FILTER_KEYS = ["show"] as const;
const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium ${focusRing}`;
const dash = <span className="text-muted">–</span>;
const CHIP: Record<(typeof RESULT_TONE)[CheckResult], string> = {
  danger: "border-danger-line bg-danger-soft text-danger",
  warning: "border-warning-line bg-warning-soft text-warning",
  success: "border-success-line bg-success-soft text-success",
  muted: "border-line text-muted",
};

const col = gridColumnHelper<StpCheckRow>();
const money = (key: "unitprice" | "sum_price" | "rate" | "excess", header: string) =>
  col.accessor(key, { header, cell: (c) => <Money value={c.getValue()} />, meta: { className: num } });

const COLUMNS = col.columns([
  col.accessor("vstdate", { header: "วันที่รับบริการ", cell: (c) => formatThaiDate(c.getValue()), meta: { className: "whitespace-nowrap tabular-nums" } }),
  col.accessor("hn", { header: "HN", meta: { className: "whitespace-nowrap tabular-nums" } }),
  col.accessor("vn", { header: "VN", meta: { className: "whitespace-nowrap tabular-nums" } }),
  col.accessor("item_name", {
    header: "รายการ",
    cell: (c) => (
      <span className="block min-w-48">
        {c.getValue()} <span className="text-muted tabular-nums">{c.row.original.icode}</span>
      </span>
    ),
  }),
  col.accessor("code", { header: "รหัสเบิก (ADP/GPU)", cell: (c) => c.getValue() || dash, meta: { className: "whitespace-nowrap tabular-nums" } }),
  col.accessor("qty", { header: "จำนวน", cell: (c) => formatCount(c.getValue()), meta: { className: num } }),
  money("unitprice", "ราคาต่อหน่วย (บาท)"),
  money("sum_price", "รวม (บาท)"),
  money("rate", "อัตรา STP (บาท)"),
  money("excess", "ส่วนเกิน (บาท)"),
  col.accessor("result", {
    header: "ผลตรวจ",
    cell: (c) => (
      <span className={`inline-block rounded border px-1.5 py-0.5 whitespace-nowrap ${CHIP[RESULT_TONE[c.getValue()]]}`}>{RESULT_LABEL[c.getValue()]}</span>
    ),
    meta: { filter: { format: (v) => RESULT_LABEL[v as CheckResult] ?? v } },
  }),
  col.accessor("fix", { header: "วิธีแก้", enableSorting: false, cell: (c) => c.getValue() || dash, meta: { className: "min-w-56" } }),
]);

const Value = ({ children }: { children: ReactNode }) => <span className="font-semibold text-foreground">{children}</span>;
const dot = <span aria-hidden="true"> · </span>;

const NOTICE: Record<NonNullable<StpCheckPage["notice"]>, ReactNode> = {
  no_pttype: "ไม่พบสิทธิที่ผูกกองทุน STP (hipdata_code) ใน HOSxP",
  no_catalog: (
    <>
      ยังไม่ได้นำเข้ารายการเบิกกองทุน STP{" "}
      <Link href="/catalog/service-catalog?tab=stp" className={`rounded-sm text-accent-text underline underline-offset-2 ${focusRing}`}>
        นำเข้าที่ Service catalog
      </Link>
    </>
  ),
};

const renderSummary = ({ summary: s, notice }: StpCheckPage) =>
  notice ? (
    <p className="text-warning">{NOTICE[notice]}</p>
  ) : (
    <div className="space-y-1 text-muted tabular-nums">
      <p>
        <Value>{formatCount(s.visits)}</Value> visit{dot}
        <Value>{formatCount(s.items)}</Value> รายการ{dot}
        มูลค่ารวม <Value>{formatBaht(s.amount)}</Value> บาท{dot}
        ส่วนเกินรวม <Value>{formatBaht(s.excess)}</Value> บาท
      </p>
      <p>
        {CHECK_RESULTS.filter((k) => s.groups[k].count > 0).map((k, i) => (
          <span key={k}>
            {i > 0 && dot}
            {RESULT_LABEL[k]} <Value>{formatCount(s.groups[k].count)}</Value> ({formatBaht(s.groups[k].amount)} บาท)
          </span>
        ))}
      </p>
    </div>
  );

export function StpCheckGrid() {
  const { start, end } = useDateRange();
  const { show, set } = useUrlParams(["show"]);

  return (
    <DataGrid<StpCheckRow, StpCheckPage>
      endpoint="/api/fund/stp-check"
      params={{ start, end }}
      filterKeys={FILTER_KEYS}
      toolbar={
        <>
          <DateRangeFilter />
          <label className="flex items-center gap-2">
            <span className="text-muted">แสดง</span>
            <select value={show === "all" ? "all" : ""} onChange={(e) => set({ show: e.target.value })} className={SELECT_CLASS}>
              <option value="">ต้องแก้</option>
              <option value="all">ทั้งหมด</option>
            </select>
          </label>
        </>
      }
      columns={COLUMNS}
      getRowId={(r) => r.id}
      renderSummary={renderSummary}
      exportPlacement="summary"
    />
  );
}
