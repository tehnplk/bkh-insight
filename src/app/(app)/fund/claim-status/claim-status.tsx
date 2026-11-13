"use client";

import { useDateRange } from "@/components/date-range-filter/date-range-filter";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { formatThaiDate } from "@/lib/thai-date";
import type { GridPage } from "@/lib/grid-query";
import { FilterChip, Money, focusRing, num, useUrlParams } from "../_components/ui";
import { VisitItems } from "../_components/visit-items";
import { STATUS } from "../_components/claim-status";
import type { ClaimStatus, PendingRow } from "@/app/api/fund/types";

const PARAMS = ["fund", "dep", "status"] as const;

function StatusBadge({ status }: { status: ClaimStatus }) {
  const s = STATUS[status];
  return <span className={`inline-flex h-5 items-center rounded border px-1.5 text-xs whitespace-nowrap ${s.badge}`}>{s.label}</span>;
}

const orDash = (v: string | null) => v || <span className="text-muted">–</span>;
const col = gridColumnHelper<PendingRow>();
const columns = col.columns([
  col.accessor("vstdate", { header: "วันที่", cell: (c) => formatThaiDate(c.getValue()), meta: { className: "whitespace-nowrap", filter: { format: (v) => formatThaiDate(v) || v } } }),
  col.accessor("hn", { header: "HN", meta: { className: "whitespace-nowrap", filter: true } }),
  col.accessor("full_name", { header: "ชื่อ-นามสกุล", meta: { className: "whitespace-nowrap", filter: true } }),
  col.accessor("fund_name", { header: "กองทุน", enableSorting: false, meta: { filter: true } }), // API ไม่รับ sort=fund_name
  col.accessor("dep_name", { header: "แผนก", meta: { filter: true } }),
  col.accessor("authen_code", { header: "authen", cell: (c) => orDash(c.getValue()), enableSorting: false, meta: { className: "whitespace-nowrap", filter: true } }),
  col.accessor("status", { header: "สถานะ", cell: (c) => <StatusBadge status={c.getValue()} />, enableSorting: false, meta: { filter: true } }),
  col.accessor("amount", { header: "มูลค่า (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
]);
const renderDetail = (row: PendingRow) => <VisitItems vn={row.vn} />;
const detailTitle = (row: PendingRow) => `${row.full_name} · HN ${row.hn}`;

const STATUS_FILTERS = [
  { id: "", label: "ยังไม่ปิดสิทธิ" },
  { id: "authen_only", label: STATUS.authen_only.label },
  { id: "none", label: STATUS.none.label },
] as const;

/** status ใน URL ที่ API ไม่รับ (เช่น link เก่า) ถือเป็นค่าเริ่มต้น "" = pending */
const validStatus = (v: string) => (STATUS_FILTERS.some((f) => f.id === v) ? v : "");

function StatusFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = validStatus(value);
  return (
    <div role="radiogroup" aria-label="สถานะ" className="flex flex-wrap rounded-md border border-line p-0.5 text-sm">
      {STATUS_FILTERS.map((f) => (
        <button
          key={f.id || "pending"}
          type="button"
          role="radio"
          aria-checked={current === f.id}
          onClick={() => onChange(f.id)}
          className={`h-7 rounded px-2.5 ${focusRing} ${current === f.id ? "bg-accent-soft font-medium text-accent-text" : "text-muted hover:bg-hover hover:text-foreground"}`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

export function ClaimStatusGrid() {
  const { start, end } = useDateRange();
  const { fund, dep, status, set } = useUrlParams(PARAMS);

  const params: Record<string, string> = { start, end, status: validStatus(status) || "pending" };
  if (fund) params.fund = fund;
  if (dep) params.dep = dep;

  // ชื่อกองทุน/แผนกเอาจากแถวแรก (ทุกแถวตรง filter เดียวกัน) ไม่ต้องยิง API สรุปแค่เพื่อชื่อ ไม่มีแถวแสดงรหัส
  const renderChips = (d: GridPage<PendingRow>) => (
    <>
      {fund && <FilterChip label={`กองทุน ${d.rows[0]?.fund_name || fund}`} onRemove={() => set({ fund: null })} />}
      {dep && <FilterChip label={`แผนก ${d.rows[0]?.dep_name || dep}`} onRemove={() => set({ dep: null })} />}
    </>
  );

  return (
    <DataGrid<PendingRow>
      endpoint="/api/fund/claim-overview/pending"
      params={params}
      liveSearch
      filters={<StatusFilter value={status} onChange={(v) => set({ status: v || null })} />}
      renderSummary={fund || dep ? renderChips : undefined}
      columns={columns}
      getRowId={(r) => r.vn}
      renderDetail={renderDetail}
      detailMode="modal"
      detailTitle={detailTitle}
    />
  );
}
