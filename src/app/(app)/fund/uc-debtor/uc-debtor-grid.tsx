"use client";

import type { MouseEvent, ReactNode } from "react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import type { GridPage } from "@/lib/grid-query";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { Money, focusRing, num, useUrlParams } from "../_components/ui";
import { UcDebtorDetail } from "./uc-debtor-detail";
import {
  DEBTOR_STATUSES, STATUS_LABEL,
  type DebtorStatus, type DebtorType, type UcDebtorRow, type UcDebtorSummary,
} from "@/app/api/fund/uc-debtor/debtor";

type Page = GridPage<UcDebtorRow> & { summary: UcDebtorSummary };

const FILTER_KEYS = ["type", "status"] as const;
const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium ${focusRing}`;
const nowrap = { className: "whitespace-nowrap" };
const dash = <span className="text-muted">–</span>;
const CHIP: Record<DebtorStatus, string> = {
  paid: "border-success-line bg-success-soft text-success",
  error: "border-danger-line bg-danger-soft text-danger",
  none: "border-warning-line bg-warning-soft text-warning",
};
const TYPES = [
  { value: "opd", label: "OPD" },
  { value: "ipd", label: "IPD" },
] as const satisfies readonly { value: DebtorType; label: string }[];

function Status({ row }: { row: UcDebtorRow }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`rounded border px-1.5 py-0.5 ${CHIP[row.status]}`}>{STATUS_LABEL[row.status]}</span>
      {row.error_codes.length > 0 && <span className="text-muted tabular-nums">{row.error_codes.join(", ")}</span>}
    </span>
  );
}

const col = gridColumnHelper<UcDebtorRow>();
const money = (key: "debtor" | "debt_amount" | "compensation" | "diff", header: string) =>
  col.accessor(key, { header, cell: (c) => <Money value={c.getValue()} />, meta: { className: num } });
const text = (key: "vn" | "an" | "hn" | "pttype_name" | "drg" | "rep_no", header: string) =>
  col.accessor(key, { header, cell: (c) => c.getValue() || dash, meta: { ...nowrap, filter: true } });
// shortcut: DataGrid ไม่เปิด modal ให้ cell เรียกได้ จึงกดปุ่ม "รายละเอียด" ของแถวเดียวกันแทน ถ้า DataGrid มี meta.openDetail ให้เปลี่ยนไปใช้
function openRowDetail(e: MouseEvent<HTMLButtonElement>) {
  e.currentTarget.closest("tr")?.querySelector<HTMLButtonElement>('td:first-child button[aria-haspopup="dialog"]')?.click();
}
const name = col.accessor("full_name", {
  header: "ชื่อ-สกุล",
  cell: (c) => (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={openRowDetail}
      className={`-mx-1 cursor-pointer rounded-sm px-1 text-left whitespace-nowrap text-accent-text underline-offset-2 hover:underline ${focusRing}`}
    >
      {c.getValue() || "–"}
    </button>
  ),
  meta: { filter: true },
});
const tail = [
  text("rep_no", "REP"),
  money("compensation", "ชดเชยสุทธิ (บาท)"),
  money("diff", "ส่วนต่าง (บาท)"),
  col.accessor("status", { header: "สถานะ", cell: (c) => <Status row={c.row.original} />, meta: { filter: true } }),
];
const date = (header: string) =>
  col.accessor("date", { header, cell: (c) => formatThaiDate(c.getValue()), meta: { className: "whitespace-nowrap tabular-nums", filter: { format: (v) => formatThaiDate(v) || v } } });

const COLUMNS = {
  opd: col.columns([
    date("วันที่รับบริการ"), text("vn", "VN"), text("hn", "HN"), name, text("pttype_name", "สิทธิ"),
    money("debtor", "ลูกหนี้ (บาท)"), money("debt_amount", "ใบลูกหนี้ (บาท)"), ...tail,
  ]),
  ipd: col.columns([
    date("วันจำหน่าย"), text("an", "AN"), text("hn", "HN"), name, text("pttype_name", "สิทธิ"), text("drg", "DRG"),
    col.accessor("adjrw", { header: "AdjRW", cell: (c) => c.getValue()?.toFixed(4) ?? dash, meta: { className: num } }),
    money("debtor", "ลูกหนี้ (บาท)"), ...tail,
  ]),
};

const renderDetail = (r: UcDebtorRow) => <UcDebtorDetail row={r} status={<Status row={r} />} />;
const detailTitle = (r: UcDebtorRow) => (
  <>
    {r.full_name} <span className="font-normal text-muted tabular-nums">{r.an ? `AN ${r.an}` : `VN ${r.vn}`}</span>
  </>
);

const Value = ({ children }: { children: ReactNode }) => <span className="font-semibold text-foreground">{children}</span>;
const dot = <span aria-hidden="true"> · </span>;

const renderSummary = ({ summary: s }: Page) => (
  <p className="text-muted tabular-nums">
    <Value>{formatCount(s.count)}</Value> ราย{dot}
    ลูกหนี้รวม <Value>{formatBaht(s.debtor)}</Value> บาท{dot}
    ชดเชยรวม <Value>{formatBaht(s.compensation)}</Value> บาท{dot}
    ส่วนต่างรวม <Value>{formatBaht(s.diff)}</Value> บาท
    <span className="mx-2 text-line" aria-hidden="true">|</span>
    {DEBTOR_STATUSES.map((k, i) => (
      <span key={k}>
        {i > 0 && dot}
        {STATUS_LABEL[k]} <Value>{formatCount(s.status[k])}</Value>
      </span>
    ))}
  </p>
);

export function UcDebtorGrid() {
  const { start, end } = useDateRange();
  const { type: typeRaw, status, set } = useUrlParams(["type", "status", "sort", "dir"]);
  const type: DebtorType = typeRaw === "ipd" ? "ipd" : "opd";
  const statusValue = (DEBTOR_STATUSES as readonly string[]).includes(status) ? status : "";

  return (
    <DataGrid<UcDebtorRow, Page>
      endpoint="/api/fund/uc-debtor"
      params={{ start, end }}
      filterKeys={FILTER_KEYS}
      toolbar={
        <>
          <div role="radiogroup" aria-label="ประเภทผู้ป่วย" className="flex h-9 items-center gap-0.5 rounded-md border border-line bg-surface px-0.5">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={type === t.value}
                // คอลัมน์ที่ sort ได้ต่างกันระหว่าง OPD/IPD จึงล้าง sort ไปด้วย
                onClick={() => type !== t.value && set({ type: t.value === "opd" ? null : t.value, sort: null, dir: null })}
                className={`h-8 rounded-md px-3 ${focusRing} ${type === t.value ? "bg-accent-soft font-medium text-accent-text" : "text-muted hover:bg-hover hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <DateRangeFilter />
          <label className="flex items-center gap-2">
            <span className="text-muted">สถานะ</span>
            <select value={statusValue} onChange={(e) => set({ status: e.target.value })} className={SELECT_CLASS}>
              <option value="">ทั้งหมด</option>
              {DEBTOR_STATUSES.map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </>
      }
      columns={COLUMNS[type]}
      getRowId={(r) => r.key}
      renderDetail={renderDetail}
      detailTitle={detailTitle}
      detailSize="medium"
      renderSummary={renderSummary}
      exportPlacement="summary"
    />
  );
}
