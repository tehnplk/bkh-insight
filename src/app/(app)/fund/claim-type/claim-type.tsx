"use client";

import { useState } from "react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { formatBaht, formatCompactBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { CLAIM_LABEL, type ClaimStatusKey } from "@/app/api/fdh/claim-batch/claim";
import {
  CATEGORIES, MAX_DAYS, STATUS_GROUPS,
  type CategoryDef, type CategorySummary, type ClaimTypePage, type ClaimTypeRow, type ClaimTypeSummary, type Destination,
} from "@/app/api/fund/claim-type/claim-type";
import { ClaimBadge } from "../_components/claim-badge";
import { Money, Notice, Skeleton, btn, num, useJson } from "../_components/ui";

const dash = <span className="text-muted">–</span>;
const nowrap = { className: "whitespace-nowrap" };
const DEST_TONE: Record<Destination, string> = {
  FDH: "border-accent-line bg-accent-soft text-accent-text",
  "e-Claim": "border-line bg-surface-sunken text-foreground",
  อื่นๆ: "border-line bg-surface-sunken text-muted",
};

const col = gridColumnHelper<ClaimTypeRow>();
const COLUMNS = col.columns([
  col.accessor("vstdate", { header: "วันที่รับบริการ", cell: (c) => formatThaiDate(c.getValue()), meta: { className: "whitespace-nowrap tabular-nums" } }),
  col.accessor("vn", { header: "VN", meta: nowrap }),
  col.accessor("hn", { header: "HN", meta: nowrap }),
  col.accessor("patient_name", { header: "ชื่อ-สกุล", meta: nowrap }),
  col.accessor("pttype_name", { header: "สิทธิ", cell: (c) => c.getValue() || dash, meta: { filter: true } }),
  col.accessor("hospmain", {
    header: "HCODE หลัก",
    cell: (c) => {
      const r = c.row.original;
      return r.hospmain ? <span title={r.hosp_name ?? undefined}>{r.hospmain} <span className="text-muted">{r.hosp_name}</span></span> : dash;
    },
    meta: { filter: true },
  }),
  col.accessor("amount", { header: "ลูกหนี้สิทธิ (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
  col.display({
    id: "claim",
    header: "สถานะเคลม",
    cell: (c) => <ClaimBadge claim={c.row.original.claim} type="OP" />,
    meta: { filter: { format: (v) => CLAIM_LABEL[v as ClaimStatusKey] ?? v } },
  }),
]);

function Card({ def, sum, note, onOpen }: { def: CategoryDef; sum: CategorySummary; note?: string; onOpen: () => void }) {
  const empty = sum.visits === 0;
  return (
    // ปุ่มชื่อประเภทขยายเต็มการ์ด (after:inset-0) กดได้ทั้งใบ แต่ screen reader อ่านเฉพาะชื่อเป็นปุ่ม
    <article className={`relative flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring ${empty ? "" : "hover:bg-hover"}`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0">
          <button
            type="button"
            aria-haspopup="dialog"
            disabled={empty}
            onClick={onOpen}
            className={`text-left font-medium outline-none after:absolute after:inset-0 after:rounded-lg enabled:cursor-pointer ${empty ? "text-muted" : ""}`}
          >
            {def.label}
          </button>
          {note && <span className="block text-xs text-muted">{note}</span>}
        </h2>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-xs whitespace-nowrap ${DEST_TONE[def.dest]}`}>{def.dest}</span>
      </div>
      <p className={`flex flex-wrap items-baseline justify-between gap-x-3 tabular-nums ${empty ? "text-muted" : ""}`}>
        <span className="text-title">
          {formatCount(sum.visits)} <span className="text-sm font-normal text-muted">ราย</span>
        </span>
        <span className="text-sm text-muted" title={`ลูกหนี้สิทธิ ${formatBaht(sum.amount)} บาท`}>
          {formatCompactBaht(sum.amount)}
        </span>
      </p>
      {def.tracked && !empty && (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-line pt-2 text-sm tabular-nums">
          {STATUS_GROUPS.map((g) => (
            <div key={g.key} className="contents">
              <dt className="text-muted">{g.label}</dt>
              <dd className="text-right">
                {g.key === "unsent" && sum.overdue > 0 && (
                  <span className="mr-2 text-xs font-medium text-danger">เกินกำหนด {formatCount(sum.overdue)}</span>
                )}
                <span className={sum.counts[g.key] ? "font-medium" : "text-muted"}>{formatCount(sum.counts[g.key])}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}

export function ClaimType() {
  const { start, end } = useDateRange(MAX_DAYS);
  const { data, error, retry } = useJson<ClaimTypeSummary>(`/api/fund/claim-type?${new URLSearchParams({ start, end })}`);
  const [open, setOpen] = useState<CategoryDef | null>(null);
  const byKey = new Map(data?.cats.map((c) => [c.key, c]));

  return (
    <div className="flex flex-col gap-4">
      <DateRangeFilter maxDays={MAX_DAYS} hideLabels labels={{ preset: "ช่วงวันที่รับบริการ", start: "วันที่รับบริการ ตั้งแต่", end: "วันที่รับบริการ ถึง" }} />
      {error ? (
        <Notice title={`โหลดข้อมูลไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
      ) : !data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          {data.claim_error && <p role="alert" className="text-sm text-danger">โหลดสถานะเคลมไม่สำเร็จ จำนวนรายและยอดยังถูกต้อง</p>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {CATEGORIES.map((def) => (
              <Card
                key={def.key}
                def={def}
                sum={byKey.get(def.key)!}
                note={def.key === "ucs_cup" ? `CUP ${formatCount(data.cup_size)} หน่วยบริการ` : "note" in def ? def.note : undefined}
                onOpen={() => setOpen(def)}
              />
            ))}
          </div>
        </>
      )}
      <DetailModal open={!!open} onClose={() => setOpen(null)} size="wide" title={open ? `${open.label} · ${formatThaiDate(start)} – ${formatThaiDate(end)}` : ""}>
        {open && (
          <div className="flex min-h-0 flex-1 flex-col">
            <DataGrid<ClaimTypeRow, ClaimTypePage>
              key={`${open.key}:${start}:${end}`}
              endpoint="/api/fund/claim-type"
              params={{ start, end, cat: open.key }}
              localState={{ pageSize: "100" }}
              columns={COLUMNS}
              getRowId={(r) => r.vn}
              searchSize="compact"
              fitScreen
              pinColumns={2}
            />
          </div>
        )}
      </DetailModal>
    </div>
  );
}
