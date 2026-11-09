"use client";

import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import type { GridPage } from "@/lib/grid-query";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { DmRemissionRow, DmRemissionSummary } from "@/app/api/visit/dm-remission/remission";

type Page = GridPage<DmRemissionRow> & { summary: DmRemissionSummary };

const num = "text-right tabular-nums whitespace-nowrap";
const nowrap = { className: "whitespace-nowrap" };

/** วันที่ + ค่า HbA1c ในช่องเดียว */
function Result({ date, value }: { date: string; value: number }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {formatThaiDate(date)} <span className="ml-1 font-semibold">{value.toFixed(1)}%</span>
    </span>
  );
}

const col = gridColumnHelper<DmRemissionRow>();
const columns = col.columns([
  col.accessor("hn", { header: "HN", meta: nowrap }),
  col.accessor("full_name", { header: "ชื่อ-สกุล", meta: nowrap }),
  col.accessor("age", { header: "อายุ (ปี)", meta: { className: num } }),
  col.accessor("prev_date", { header: "HbA1c ครั้งก่อน", cell: (c) => <Result date={c.getValue()} value={c.row.original.prev_value} /> }),
  col.accessor("date", { header: "HbA1c ที่ผ่านเกณฑ์", cell: (c) => <Result date={c.getValue()} value={c.row.original.value} /> }),
  col.accessor("days", { header: "ห่าง (วัน)", cell: (c) => formatCount(c.getValue()), meta: { className: num } }),
  col.accessor("kind", { header: "ประเภท", meta: nowrap }),
  col.accessor("amount", { header: "จำนวนเงิน (บาท)", cell: (c) => formatBaht(c.getValue()), meta: { className: num } }),
]);

const renderSummary = ({ summary }: Page) => (
  <p className="text-muted tabular-nums">
    ครั้งแรก <span className="font-semibold text-foreground">{formatCount(summary.first)}</span> ราย
    <span aria-hidden="true"> · </span>
    เพิ่มเติม <span className="font-semibold text-foreground">{formatCount(summary.extra)}</span> ราย
    <span aria-hidden="true"> · </span>
    ยอดรวม <span className="text-base font-semibold text-foreground">{formatBaht(summary.amount)}</span> บาท
  </p>
);

export function DmRemissionGrid() {
  const { start, end } = useDateRange();
  return (
    <DataGrid<DmRemissionRow, Page>
      endpoint="/api/visit/dm-remission"
      params={{ start, end }}
      toolbar={<DateRangeFilter />}
      columns={columns}
      getRowId={(r) => r.id}
      renderSummary={renderSummary}
      exportPlacement="summary"
    />
  );
}
