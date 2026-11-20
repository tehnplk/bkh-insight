"use client";

import { useState } from "react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { Money, num } from "@/app/(app)/fund/_components/ui";
import { SCHEMES, periodLabel, runBadge } from "@/app/(app)/fund/stm-import/labels";
import type { SettleFileRow } from "@/app/api/fund/ar-settle/settle";
import { SettleFile } from "./settle-file";

const nowrap = "whitespace-nowrap tabular-nums";
const dash = <span className="text-muted">–</span>;

const col = gridColumnHelper<SettleFileRow>();
const COLUMNS = col.columns([
  col.accessor("period_month", {
    header: "งวด",
    cell: (c) => (
      <span className="whitespace-nowrap">
        {periodLabel(c.getValue())}
        <span className={runBadge}>{String(c.row.original.run_no).padStart(2, "0")}</span>
      </span>
    ),
  }),
  col.accessor("scheme", { header: "สิทธิ", cell: (c) => SCHEMES[c.getValue()] ?? c.getValue(), meta: { filter: { format: (v) => SCHEMES[v] ?? v } } }),
  col.accessor("patient_type", { header: "OP/IP", meta: { filter: true } }),
  col.accessor("doc_no", { header: "เลขที่เอกสาร", meta: { className: nowrap } }),
  col.accessor("transfer_date", { header: "วันที่ออก STM", cell: (c) => formatThaiDate(c.getValue()), meta: { className: nowrap } }),
  col.accessor("row_count", { header: "รายการ", cell: (c) => formatCount(c.getValue()), meta: { className: num } }),
  col.accessor("net_total", { header: "ยอดโอนสุทธิ (บาท)", cell: (c) => <Money value={Number(c.getValue())} />, meta: { className: num } }),
  col.accessor("settled_rows", {
    header: "ตัดแล้ว (รายการ)",
    cell: (c) => (
      <span title="ตัดแล้ว / รายการที่ STM จ่าย">
        {formatCount(c.getValue())} <span className="text-muted">/ {formatCount(c.row.original.paid_rows)}</span>
      </span>
    ),
    meta: { className: num },
  }),
  col.accessor("settled_amount", { header: "รับชำระแล้ว (บาท)", cell: (c) => <Money value={Number(c.getValue())} />, meta: { className: num } }),
  col.accessor("last_receipt_no", {
    header: "ใบเสร็จล่าสุด",
    enableSorting: false,
    cell: (c) =>
      c.getValue() ? (
        <span className="whitespace-nowrap">
          {c.getValue()} <span className="text-muted">{formatThaiDate(c.row.original.last_receipt_date)}</span>
        </span>
      ) : (
        dash
      ),
  }),
]);

export function SettleGrid() {
  // เปลี่ยนค่านี้เพื่อให้ DataGrid โหลดใหม่หลังตัดหนี้ (route ไม่อ่าน param นี้)
  const [version, setVersion] = useState(0);
  return (
    <DataGrid<SettleFileRow>
      endpoint="/api/fund/ar-settle"
      params={{ v: version ? String(version) : "" }}
      columns={COLUMNS}
      getRowId={(r) => r.id}
      renderDetail={(r) => <SettleFile row={r} onChanged={() => setVersion((v) => v + 1)} />}
      detailTitle={(r) => `ตัดลูกหนี้ ${r.doc_no}`}
      detailSize="wide"
      searchSize="compact"
    />
  );
}
