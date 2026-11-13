"use client";

import { createContext, useContext, useState } from "react";
import { ReceiptText } from "lucide-react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { MultiSelect } from "@/components/multi-select/multi-select";
import { FdhPreviewModal } from "@/components/fdh-preview/fdh-preview";
import { usePersistedFilter } from "@/lib/persisted-filter";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { CodeOptionGroup } from "@/app/api/fund/types";
import { MAX_EXPORT_VNS, OPD_MAX_DAYS, type ClaimStatus, type VisitRow, type VisitsPage } from "@/app/api/opd/admissions/admissions";
import { Money, btn, focusRing, num, useUrlParams } from "@/app/(app)/fund/_components/ui";
import { DebtorItems, Fact, Facts } from "@/app/(app)/fund/uc-debtor/uc-debtor-detail";
import { FundSelect } from "@/app/(app)/ipd/admissions/admissions-grid";

const FILTERS = ["pttypes", "deps", "unclosed"] as const;
const dash = <span className="text-muted">–</span>;
const nowrap = { className: "whitespace-nowrap" };
const CLAIM_LABEL: Record<ClaimStatus, string> = { closed: "ปิดสิทธิแล้ว", authen_only: "มีแค่ authen", none: "ยังไม่ปิดสิทธิ" };

/** ค่าหนึ่งฝั่ง ไม่มีค่า = ป้ายแดงสด (--c-fail) เฉพาะฝั่งนั้น ให้เห็นทันทีว่าขาดอะไร */
function Code({ value, missing }: { value: string | null; missing: string }) {
  if (value) return <>{value}</>;
  return (
    <span className="rounded bg-c-fail px-1.5 py-0.5 font-medium text-c-fail-fg">{missing}</span>
  );
}

/** Authen / ปิดสิทธิ คั่นด้วย "/" */
function Codes({ row }: { row: VisitRow }) {
  return (
    <span className="tabular-nums whitespace-nowrap">
      <Code value={row.auth_code} missing="ไม่พบ Authen" />
      <span className="mx-1 text-muted">/</span>
      <Code value={row.close_code} missing="ไม่พบเลขปิดสิทธิ" />
    </span>
  );
}

/** รหัส PDx พร้อมชื่อโรค ไม่มี PDx = ขาด */
function Pdx({ row }: { row: VisitRow }) {
  if (!row.pdx) return <span className="rounded bg-c-fail px-1.5 py-0.5 font-medium whitespace-nowrap text-c-fail-fg">ยังไม่มี PDx</span>;
  return (
    <span className="flex max-w-64 items-baseline gap-1.5" title={row.pdx_name ?? undefined}>
      <span className="font-medium tabular-nums">{row.pdx}</span>
      {row.pdx_name && <span className="truncate text-muted">{row.pdx_name}</span>}
    </span>
  );
}

/** visit ที่เลือกส่ง FDH: VN -> ชื่อ (คงอยู่ข้ามหน้าและข้ามตัวกรอง จนกว่าจะล้าง) */
type Selection = { picked: Map<string, string>; toggle: (rows: VisitRow[], on: boolean) => void };
const SelectionContext = createContext<Selection>({ picked: new Map(), toggle: () => {} });
const checkbox = `size-4 cursor-pointer accent-[var(--accent)] ${focusRing}`;

function SelectRow({ row }: { row: VisitRow }) {
  const { picked, toggle } = useContext(SelectionContext);
  return (
    <input
      type="checkbox"
      aria-label={`เลือก VN ${row.vn} ส่ง FDH`}
      checked={picked.has(row.vn)}
      onChange={(e) => toggle([row], e.target.checked)}
      className={checkbox}
    />
  );
}

function SelectPage({ rows }: { rows: VisitRow[] }) {
  const { picked, toggle } = useContext(SelectionContext);
  const n = rows.filter((r) => picked.has(r.vn)).length;
  return (
    <input
      type="checkbox"
      aria-label="เลือกทุกแถวในหน้านี้"
      checked={rows.length > 0 && n === rows.length}
      ref={(el) => {
        if (el) el.indeterminate = n > 0 && n < rows.length;
      }}
      onChange={(e) => toggle(rows, e.target.checked)}
      className={checkbox}
    />
  );
}

const col = gridColumnHelper<VisitRow>();
// ทุกคอลัมน์ (ยกเว้นเงิน) กรองจากหัวคอลัมน์ได้ ค่าและรายการมาจาก /api/opd/admissions?facet=<id>
const filterable = { ...nowrap, filter: true } as const;
const timeCell = { className: "whitespace-nowrap tabular-nums", filter: true } as const;
const text = (key: "vn" | "hn" | "patient_name" | "pttype_name" | "dep_name", header: string, sortable = true) =>
  col.accessor(key, { header, cell: (c) => c.getValue() || dash, meta: filterable, enableSorting: sortable });
const money = (key: "income" | "uc_money", header: string) =>
  col.accessor(key, { header, cell: (c) => <Money value={c.getValue()} />, meta: { className: num } });

const columns = col.columns([
  col.display({
    id: "select",
    header: (h) => <SelectPage rows={h.table.getRowModel().rows.map((r) => r.original)} />,
    cell: (c) => <SelectRow row={c.row.original} />,
  }),
  text("vn", "VN"),
  text("hn", "HN"),
  text("patient_name", "ชื่อ-สกุล", false),
  col.accessor("fund", { header: "กองทุน", meta: filterable, enableSorting: false }),
  text("pttype_name", "สิทธิ"),
  col.display({ id: "codes", header: "Authen/ปิดสิทธิ", cell: (c) => <Codes row={c.row.original} />, meta: { filter: true } }),
  col.accessor("vstdate", { header: "วันที่มา", cell: (c) => formatThaiDate(c.getValue()) || dash, meta: { ...timeCell, filter: { format: (v) => formatThaiDate(v) || v } } }),
  col.accessor("vsttime", { header: "เวลา", cell: (c) => c.getValue() || dash, meta: timeCell }),
  text("dep_name", "แผนก"),
  col.accessor("pdx", { header: "PDx", cell: (c) => <Pdx row={c.row.original} />, meta: { filter: true } }),
  col.accessor("ovst_status", {
    header: "สถานะผู้ป่วย",
    // ชี้ดูชื่อสถานะใน HOSxP (เช่น "Admit แผนกอายุรกรรม", "รอผลตรวจ")
    cell: (c) => (c.getValue() ? <span title={c.row.original.ovst_status_detail ?? undefined}>{c.getValue()}</span> : dash),
    meta: filterable,
  }),
  col.accessor("rcpt_no", { header: "เลขที่ใบเสร็จ", cell: (c) => c.getValue() || dash, meta: timeCell, enableSorting: false }),
  money("income", "มูลค่า (บาท)"),
  money("uc_money", "ลูกหนี้สิทธิ (บาท)"),
]);

const renderDetail = (r: VisitRow) => (
  <div className="text-sm">
    <Facts>
      <Fact label="HN">{r.hn}</Fact>
      <Fact label="สิทธิ">{r.pttype_name ? `${r.pttype_name} (${r.fund})` : r.fund}</Fact>
      <Fact label="วันที่มา">{`${formatThaiDate(r.vstdate)} ${r.vsttime ?? ""}`.trim()}</Fact>
      <Fact label="แผนก">{r.dep_name}</Fact>
      <Fact label="Authen">{r.auth_code}</Fact>
      <Fact label="ปิดสิทธิ">{r.close_code}</Fact>
      <Fact label="สถานะปิดสิทธิ">{CLAIM_LABEL[r.claim_status]}</Fact>
      <Fact label="สถานะผู้ป่วย">{r.ovst_status && r.ovst_status_detail && r.ovst_status !== r.ovst_status_detail ? `${r.ovst_status} (${r.ovst_status_detail})` : r.ovst_status}</Fact>
      <Fact label="เลขที่ใบเสร็จ">{r.rcpt_no}</Fact>
      <Fact label="PDx">{r.pdx ? `${r.pdx} ${r.pdx_name ?? ""}`.trim() : null}</Fact>
      <Fact label="มูลค่า (บาท)">
        <span className="font-semibold">{formatBaht(r.income)}</span>
      </Fact>
      <Fact label="ลูกหนี้สิทธิ (บาท)">
        <span className="font-semibold">{formatBaht(r.uc_money)}</span>
      </Fact>
    </Facts>
    <DebtorItems vn={r.vn} an={null} debtor={r.uc_money} />
  </div>
);
const detailTitle = (r: VisitRow) => (
  <>
    {r.patient_name || "–"} <span className="font-normal text-muted tabular-nums">VN {r.vn}</span>
  </>
);

const renderSummary = (d: VisitsPage) => (
  <div className="flex flex-col gap-1.5">
    <p className="flex flex-wrap items-center gap-2 tabular-nums">
      <span className="inline-flex items-baseline gap-1.5 rounded-md border border-line bg-surface-sunken px-2.5 py-1">
        <span className="text-sm">จำนวน</span>
        <span className="font-semibold">{formatCount(d.total)}</span> visit
      </span>
    </p>
  </div>
);

const split = (v: string) => (v ? v.split(",") : []);

function PreviewButton({ onOpen }: { onOpen: () => void }) {
  const { picked } = useContext(SelectionContext);
  const n = picked.size;
  return (
    <button
      type="button"
      disabled={!n || n > MAX_EXPORT_VNS}
      onClick={onOpen}
      title={n ? undefined : "ติ๊กเลือก visit ที่จะส่ง FDH ในตารางก่อน"}
      className={`${btn} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {`ดู 16 แฟ้ม${n ? ` ${formatCount(n)} visit` : ""}`}
    </button>
  );
}

function SelectionBar({ onClear }: { onClear: () => void }) {
  const { picked } = useContext(SelectionContext);
  const n = picked.size;
  if (!n) return null;
  return (
    <div className="mb-3 flex flex-col gap-1.5 rounded-lg border border-accent-line bg-accent-soft px-3 py-2 text-sm text-accent-text">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span>
          เลือกส่ง FDH <span className="font-semibold tabular-nums">{formatCount(n)}</span> visit
        </span>
        <button type="button" onClick={onClear} className={`rounded px-1.5 underline-offset-2 hover:underline ${focusRing}`}>
          ล้างที่เลือก
        </button>
      </div>
      {n > MAX_EXPORT_VNS && (
        <p role="alert" className="text-xs text-danger">
          เลือกได้ไม่เกิน {formatCount(MAX_EXPORT_VNS)} visit ต่อครั้ง
        </p>
      )}
    </div>
  );
}

export function VisitsGrid({ pttypeOptions, depOptions }: { pttypeOptions: CodeOptionGroup[]; depOptions: CodeOptionGroup[] }) {
  usePersistedFilter("opd/admissions", FILTERS);
  const { start, end } = useDateRange(OPD_MAX_DAYS);
  const { pttypes, deps, unclosed, set } = useUrlParams(FILTERS);
  const [picked, setPicked] = useState<Map<string, string>>(() => new Map());
  const toggle = (rows: VisitRow[], on: boolean) =>
    setPicked((prev) => {
      const next = new Map(prev);
      for (const r of rows) {
        if (on) next.set(r.vn, r.patient_name);
        else next.delete(r.vn);
      }
      return next;
    });
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <SelectionContext.Provider value={{ picked, toggle }}>
      <SelectionBar onClear={() => setPicked(new Map())} />
      <FdhPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        ids={[...picked.keys()]}
        idField="vns"
        previewUrl="/api/opd/fdh-export"
        checkUrl="/api/opd/fdh-check"
        zipPrefix="op"
        unit="visit"
      />
      <DataGrid<VisitRow, VisitsPage>
        endpoint="/api/opd/admissions"
        params={{ start, end, pttypes, deps, unclosed }}
        liveSearch
        // fragment: ตัวกรองทุกตัวอยู่แถวเดียวกับช่องค้นหาของ DataGrid (จอแคบขึ้นบรรทัดใหม่เอง)
        toolbar={
          <>
            <FundSelect groups={pttypeOptions} value={split(pttypes)} onChange={(v) => set({ pttypes: v.join(",") })} />
            <MultiSelect label="กรองตามสิทธิการรักษา" hideLabel groups={pttypeOptions} value={split(pttypes)} onChange={(v) => set({ pttypes: v.join(",") })} />
            <MultiSelect label="กรองตามแผนก" hideLabel groups={depOptions} value={split(deps)} onChange={(v) => set({ deps: v.join(",") })} />
            <div role="group" aria-label="วันที่รับบริการ" className="flex items-center gap-2">
              <DateRangeFilter
                maxDays={OPD_MAX_DAYS}
                hideLabels
                labels={{ preset: "ช่วงวันที่รับบริการ", start: "วันที่รับบริการ ตั้งแต่", end: "วันที่รับบริการ ถึง" }}
              />
            </div>
            <label className="flex h-9 cursor-pointer items-center gap-2 text-sm whitespace-nowrap">
              <input
                type="checkbox"
                checked={unclosed === "1"}
                onChange={(e) => set({ unclosed: e.target.checked ? "1" : null })}
                className={checkbox}
              />
              เฉพาะยังไม่ปิดสิทธิ
            </label>
          </>
        }
        columns={columns}
        getRowId={(r) => r.vn}
        renderDetail={renderDetail}
        detailTitle={detailTitle}
        detailSize="medium"
        renderSummary={renderSummary}
        exportPlacement="summary"
        summaryActions={<PreviewButton onOpen={() => setPreviewOpen(true)} />}
        searchSize="compact"
        detailIcon={<ReceiptText aria-hidden className="size-4" />}
        reorderable
      />
    </SelectionContext.Provider>
  );
}
