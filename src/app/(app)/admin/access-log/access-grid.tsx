"use client";

import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { formatThaiDate } from "@/lib/thai-date";
import type { AccessRow } from "@/app/api/admin/access-log/route";
import { ACCESS_MAX_DAYS } from "@/app/api/admin/access-log/config";

const col = gridColumnHelper<AccessRow>();
// query string ที่ encode ไว้ ให้อ่านภาษาไทยได้ (ค่าที่ decode ไม่ได้แสดงตามเดิม)
const readable = (q: string) => {
  try {
    return decodeURIComponent(q.replace(/\+/g, " "));
  } catch {
    return q;
  }
};
const filter = { filter: true } as const;
const columns = col.columns([
  col.accessor("at", {
    header: "เวลา",
    cell: (c) => <span className="whitespace-nowrap tabular-nums">{formatThaiDate(c.getValue())} {c.getValue().slice(11)}</span>,
  }),
  col.accessor("user_name", { header: "ผู้ใช้", cell: (c) => c.getValue() ?? "–", meta: filter }),
  col.accessor("role", { header: "role", enableSorting: false, cell: (c) => c.getValue() ?? "–", meta: filter }),
  col.accessor("method", { header: "method", meta: filter }),
  col.accessor("path", { header: "path", meta: filter }),
  col.accessor("query", {
    header: "query",
    enableSorting: false,
    cell: (c) => <span title={c.getValue() ?? ""} className="block max-w-md truncate text-muted">{c.getValue() ? readable(c.getValue()!) : "–"}</span>,
  }),
]);

export function AccessGrid() {
  const range = useDateRange(ACCESS_MAX_DAYS);
  return (
    <DataGrid
      endpoint="/api/admin/access-log"
      columns={columns}
      getRowId={(r) => r.id}
      params={range}
      toolbar={<DateRangeFilter maxDays={ACCESS_MAX_DAYS} hideLabels labels={{ preset: "ช่วงวันที่", start: "ตั้งแต่", end: "ถึง" }} />}
    />
  );
}
