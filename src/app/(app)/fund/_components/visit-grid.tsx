"use client";

import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { formatThaiDate } from "@/lib/thai-date";
import type { FundVisitRow } from "@/app/api/fund/types";
import { Money, num } from "./ui";
import { VisitItems } from "./visit-items";

const col = gridColumnHelper<FundVisitRow>();
const date = col.accessor("vstdate", { header: "วันที่", cell: (c) => formatThaiDate(c.getValue()), meta: { className: "whitespace-nowrap" } });
const hn = col.accessor("hn", { header: "HN", meta: { className: "whitespace-nowrap" } });
const name = col.accessor("full_name", { header: "ชื่อ-นามสกุล", meta: { className: "whitespace-nowrap" } });
const dep = col.accessor("dep_name", { header: "แผนก" });
const pttype = col.accessor("pttype_name", { header: "สิทธิ" });
const amount = col.accessor("amount", { header: "มูลค่า (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } });
const columns = col.columns([date, hn, name, pttype, amount]);
const columnsWithDep = col.columns([date, hn, name, dep, pttype, amount]);

const renderDetail = (row: FundVisitRow) => <VisitItems vn={row.vn} />;
const detailTitle = (row: FundVisitRow) => `${row.full_name} · HN ${row.hn}`;

/** รายการ visit จาก /api/fund/opd-fund/visits (filter ส่งผ่าน params ของ DataGrid) กดแถวเปิดรายการค่าใช้จ่าย
 *  ใน modal ของกองทุนก็เปิด modal ซ้อนชั้นบน (DetailModal รองรับ dialog ซ้อน) */
export function VisitGrid({ extraParams, showDepartment }: { extraParams: Record<string, string>; showDepartment?: boolean }) {
  return (
    <DataGrid<FundVisitRow>
      endpoint="/api/fund/opd-fund/visits"
      params={extraParams}
      liveSearch
      columns={showDepartment ? columnsWithDep : columns}
      getRowId={(r) => r.vn}
      renderDetail={renderDetail}
      detailTitle={detailTitle}
      detailSize="medium"
    />
  );
}
