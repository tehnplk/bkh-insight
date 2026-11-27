"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { Money, focusRing, num } from "@/app/(app)/fund/_components/ui";
import { SCHEMES, periodLabel, runBadge } from "@/app/(app)/fund/stm-import/labels";
import { REP_GATE_LABEL, REP_SETTLE_ENABLED, type SettleFileRow, type SettleRepRow } from "@/app/api/fund/ar-settle/settle";
import { SettleFile } from "./settle-file";

const nowrap = "whitespace-nowrap tabular-nums";
const dash = <span className="text-muted">–</span>;

const settled = (n: number, paid: number, unit: string) => (
  <span title={`ตัดแล้ว / รายการที่ ${unit} จ่าย`}>
    {formatCount(n)} <span className="text-muted">/ {formatCount(paid)}</span>
  </span>
);
const receipt = (no: string | null, date: string | null) =>
  no ? (
    <span className="whitespace-nowrap">
      {no} <span className="text-muted">{formatThaiDate(date)}</span>
    </span>
  ) : (
    dash
  );

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
    cell: (c) => settled(c.getValue(), c.row.original.paid_rows, "STM"),
    meta: { className: num },
  }),
  col.accessor("settled_amount", { header: "รับชำระแล้ว (บาท)", cell: (c) => <Money value={Number(c.getValue())} />, meta: { className: num } }),
  col.accessor("last_receipt_no", {
    header: "ใบเสร็จล่าสุด",
    enableSorting: false,
    cell: (c) => receipt(c.getValue(), c.row.original.last_receipt_date),
  }),
]);

/** สถานะเงินโอน SMT ของ REP (ตัดได้เมื่อ "พร้อมตัด") */
const TRANSFER_TONE: Record<SettleRepRow["transfer_status"], string> = {
  ready: "border-success-line bg-success-soft text-success",
  done: "border-line bg-surface-sunken text-muted",
  pending: "border-warning-line bg-warning-soft text-warning",
  mismatch: "border-danger-line bg-danger-soft text-danger",
  other_account: "border-danger-line bg-danger-soft text-danger",
  none: "border-line bg-surface-sunken text-muted",
};
const TRANSFER_LABEL: Record<SettleRepRow["transfer_status"], string> = { ...REP_GATE_LABEL, done: "ตัดแล้ว" };

const repCol = gridColumnHelper<SettleRepRow>();
const REP_COLUMNS = repCol.columns([
  repCol.accessor("rep_no", { header: "เลขที่ REP", meta: { className: nowrap } }),
  repCol.accessor("scheme", { header: "สิทธิ", enableSorting: false, cell: (c) => SCHEMES[c.getValue()] ?? c.getValue() }),
  repCol.accessor("patient_type", { header: "OP/IP" }),
  repCol.accessor("rep_type", { header: "ชนิด REP", enableSorting: false, meta: { className: nowrap } }),
  repCol.accessor("printed_on", { header: "วันที่ออกรายงาน", cell: (c) => formatThaiDate(c.getValue()) || dash, meta: { className: nowrap } }),
  repCol.accessor("row_count", { header: "รายการ", cell: (c) => formatCount(c.getValue()), meta: { className: num } }),
  repCol.accessor("net_total", { header: "ชดเชยสุทธิ (บาท)", cell: (c) => <Money value={Number(c.getValue())} />, meta: { className: num } }),
  repCol.accessor("transfer_status", {
    header: "เงินโอน SMT",
    enableSorting: false,
    cell: (c) => <span className={`inline-block rounded border px-1.5 py-0.5 whitespace-nowrap ${TRANSFER_TONE[c.getValue()]}`}>{TRANSFER_LABEL[c.getValue()]}</span>,
  }),
  repCol.accessor("transfer_total", { header: "ยอดโอน SMT (บาท)", enableSorting: false, cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
  repCol.accessor("settled_rows", { header: "ตัดแล้ว (รายการ)", cell: (c) => settled(c.getValue(), c.row.original.paid_rows, "REP"), meta: { className: num } }),
  repCol.accessor("settled_amount", { header: "รับชำระแล้ว (บาท)", cell: (c) => <Money value={Number(c.getValue())} />, meta: { className: num } }),
  repCol.accessor("last_receipt_no", { header: "ใบเสร็จล่าสุด", enableSorting: false, cell: (c) => receipt(c.getValue(), c.row.original.last_receipt_date) }),
]);

/** เอกสารที่ใช้ตัด: STM (UC/OFC/BMT) หรือ REP ของสิทธิที่ไม่มี STM (อปท.) ; อยู่ใน URL ?doc=rep */
const DOCS = [
  { key: "stm", label: "STM", href: "/fund/ar-settle" },
  { key: "rep", label: "REP อปท.", href: "/fund/ar-settle?doc=rep" },
] as const;
const tab = (on: boolean) =>
  `inline-flex h-8 items-center rounded px-3 text-sm font-medium ${focusRing} ${on ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-hover"}`;

export function SettleGrid() {
  const docParam = useSearchParams().get("doc");
  const doc = REP_SETTLE_ENABLED && docParam === "rep" ? "rep" : "stm";
  // เปลี่ยนค่านี้เพื่อให้ DataGrid โหลดใหม่หลังตัดหนี้ (route ไม่อ่าน param นี้)
  const [version, setVersion] = useState(0);
  const onChanged = () => setVersion((v) => v + 1);
  const v = { v: version ? String(version) : "" };
  return (
    <div className="flex flex-col gap-4">
      {REP_SETTLE_ENABLED && (
        <nav aria-label="เอกสารที่ใช้ตัด" className="inline-flex w-fit rounded-md border border-line p-0.5">
          {DOCS.map((d) => (
            <Link key={d.key} href={d.href} aria-current={doc === d.key ? "page" : undefined} className={tab(doc === d.key)}>
              {d.label}
            </Link>
          ))}
        </nav>
      )}
      {doc === "rep" ? (
        <DataGrid<SettleRepRow>
          key="rep"
          endpoint="/api/fund/ar-settle/rep"
          params={v}
          columns={REP_COLUMNS}
          getRowId={(r) => `${r.scheme}:${r.rep_no}`}
          renderDetail={(r) => <SettleFile doc="rep" id={r.rep_no} patientType={r.patient_type} onChanged={onChanged} />}
          detailTitle={(r) => `ตัดลูกหนี้ REP ${r.rep_no}`}
          detailSize="wide"
          searchSize="compact"
        />
      ) : (
        <DataGrid<SettleFileRow>
          key="stm"
          endpoint="/api/fund/ar-settle"
          params={v}
          columns={COLUMNS}
          getRowId={(r) => r.id}
          renderDetail={(r) => <SettleFile doc="stm" id={r.id} patientType={r.patient_type} onChanged={onChanged} />}
          detailTitle={(r) => `ตัดลูกหนี้ ${r.doc_no}`}
          detailSize="wide"
          searchSize="compact"
        />
      )}
    </div>
  );
}
