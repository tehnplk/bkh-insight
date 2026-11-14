"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { Segmented } from "@/app/(app)/quality/pending/segmented";
import { Money, btn, focusRing, num, useUrlParams } from "../_components/ui";
import {
  CLAIM_STATUSES, MAX_NOTE, MAX_REFS, STATUS_LABEL, STATUS_TONE,
  type ClaimStatus, type StpClaimPage, type StpClaimRow,
} from "@/app/api/fund/stp-claim/claim";

type Type = "op" | "ip";
const MAX_DAYS = 366; // ต้องตรงกับ MAX_DAYS ใน route
const FILTER_KEYS = ["type", "show"] as const;
const TYPES = [
  { value: "op", label: "OPD" },
  { value: "ip", label: "IPD" },
] as const;
const DATE_LABEL = { op: "วันที่รับบริการ", ip: "วันที่จำหน่าย" } as const;
const REF_LABEL = { op: "VN", ip: "AN" } as const;
const HIS_STATUS_HINT = "ผลตรวจจาก API ของ UC ใน HOSxP ไม่ครอบคลุมกองทุน STP";

const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium ${focusRing}`;
const primary = `inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const checkbox = `size-4 cursor-pointer accent-[var(--accent)] ${focusRing}`;
const dash = <span className="text-muted">–</span>;
const CHIP: Record<(typeof STATUS_TONE)[ClaimStatus], string> = {
  danger: "border-danger-line bg-danger-soft text-danger",
  warning: "border-warning-line bg-warning-soft text-warning",
  accent: "border-accent-line bg-accent-soft text-accent-text",
  success: "border-success-line bg-success-soft text-success",
  muted: "border-line text-muted",
};
const StatusChip = ({ status }: { status: ClaimStatus }) => (
  <span className={`inline-block rounded border px-1.5 py-0.5 whitespace-nowrap ${CHIP[STATUS_TONE[status]]}`}>{STATUS_LABEL[status]}</span>
);
/** timestamptz จาก insight ("2026-11-14 21:10:05.123+07") เป็น "14 พ.ย. 2569 21:10" */
const dateTime = (ts: string) => `${formatThaiDate(ts)} ${ts.slice(11, 16)}`;

/** รายที่เลือก (คงอยู่ข้ามหน้าและตัวกรองของ grid) */
type Selection = { picked: Set<string>; toggle: (refs: string[], on: boolean) => void };
const SelectionContext = createContext<Selection>({ picked: new Set(), toggle: () => {} });

function SelectRow({ row }: { row: StpClaimRow }) {
  const { picked, toggle } = useContext(SelectionContext);
  return (
    <input type="checkbox" aria-label={`เลือก ${row.ref}`} checked={picked.has(row.ref)} onChange={(e) => toggle([row.ref], e.target.checked)} className={checkbox} />
  );
}

function SelectPage({ rows }: { rows: StpClaimRow[] }) {
  const { picked, toggle } = useContext(SelectionContext);
  const n = rows.filter((r) => picked.has(r.ref)).length;
  return (
    <input
      type="checkbox"
      aria-label="เลือกทุกแถวในหน้านี้"
      checked={rows.length > 0 && n === rows.length}
      ref={(el) => {
        if (el) el.indeterminate = n > 0 && n < rows.length;
      }}
      onChange={(e) => toggle(rows.map((r) => r.ref), e.target.checked)}
      className={checkbox}
    />
  );
}

const col = gridColumnHelper<StpClaimRow>();
const nowrap = "whitespace-nowrap tabular-nums";
const columnsFor = (type: Type) =>
  col.columns([
    col.display({
      id: "select",
      header: (h) => <SelectPage rows={h.table.getRowModel().rows.map((r) => r.original)} />,
      cell: (c) => <SelectRow row={c.row.original} />,
    }),
    col.accessor("date", { header: DATE_LABEL[type], cell: (c) => formatThaiDate(c.getValue()), meta: { className: nowrap } }),
    col.accessor("hn", { header: "HN", meta: { className: nowrap } }),
    col.accessor("ref", { header: REF_LABEL[type], meta: { className: nowrap } }),
    col.accessor("pttype_name", { header: "สิทธิ", meta: { className: "min-w-40" } }),
    col.accessor("authen_code", { header: "Authen Code", cell: (c) => c.getValue() ?? dash, meta: { className: nowrap } }),
    col.accessor("claim_amount", { header: "มูลค่าเบิก (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
    col.accessor("has_pdx", { header: "มี PDX", cell: (c) => (c.getValue() ? "มี" : <span className="text-danger">ไม่มี</span>), meta: { className: "whitespace-nowrap" } }),
    col.accessor("status", {
      header: "สถานะ",
      cell: (c) => <StatusChip status={c.getValue()} />,
      meta: { filter: { format: (v) => STATUS_LABEL[v as ClaimStatus] ?? v } },
    }),
    col.accessor("status_at", {
      header: "บันทึกล่าสุด",
      cell: (c) => {
        const at = c.getValue();
        return at ? (
          <span className="block whitespace-nowrap tabular-nums">
            {dateTime(at)} <span className="text-muted">{c.row.original.status_by}</span>
          </span>
        ) : (
          dash
        );
      },
    }),
    col.accessor("note", { header: "หมายเหตุ", cell: (c) => c.getValue() || dash, meta: { className: "min-w-48" } }),
    col.accessor("his_status", {
      header: "สถานะจาก HOSxP",
      cell: (c) =>
        c.getValue() ? (
          <span className="block min-w-40 text-muted" title={HIS_STATUS_HINT}>
            {c.getValue()}
          </span>
        ) : (
          dash
        ),
    }),
  ]);
const COLUMNS = { op: columnsFor("op"), ip: columnsFor("ip") };

const Value = ({ children }: { children: ReactNode }) => <span className="font-semibold text-foreground">{children}</span>;
const dot = <span aria-hidden="true"> · </span>;

const renderSummary = ({ summary: s }: StpClaimPage) => (
  <div className="space-y-1 text-muted tabular-nums">
    <p>
      ยังไม่กดส่งเคลม <Value>{formatCount(s.pending.count)}</Value> ราย มูลค่าเบิก <Value>{formatBaht(s.pending.amount)}</Value> บาท{dot}
      ทั้งหมด <Value>{formatCount(s.total)}</Value> ราย
    </p>
    <p>
      {CLAIM_STATUSES.filter((k) => s.counts[k] > 0).map((k, i) => (
        <span key={k}>
          {i > 0 && dot}
          {STATUS_LABEL[k]} <Value>{formatCount(s.counts[k])}</Value>
        </span>
      ))}
    </p>
  </div>
);

function renderDetail(r: StpClaimRow) {
  if (!r.history.length) return <p className="text-base text-muted">ยังไม่มีการบันทึกสถานะ</p>;
  return (
    <ol className="divide-y divide-line rounded-lg border border-line text-base">
      {r.history.map((h, i) => (
        <li key={i} className="space-y-1 px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusChip status={h.status} />
            <span className="tabular-nums">{dateTime(h.created_at)}</span>
            <span className="text-muted">{h.recorded_by}</span>
          </div>
          {h.note && <p className="whitespace-pre-line">{h.note}</p>}
        </li>
      ))}
    </ol>
  );
}

function SaveDialog({
  open, onClose, refs, type, start, end, onSaved,
}: { open: boolean; onClose: () => void; refs: string[]; type: Type; start: string; end: string; onSaved: () => void }) {
  const [status, setStatus] = useState<ClaimStatus | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/fund/stp-claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, start, end, refs, status, note }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError(body?.error ?? (res ? `บันทึกไม่สำเร็จ (HTTP ${res.status})` : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"));
      return;
    }
    setStatus("");
    setNote("");
    onSaved();
  }

  return (
    <DetailModal open={open} onClose={onClose} title={`บันทึกสถานะ ${formatCount(refs.length)} ราย`}>
      <form
        className="space-y-4 text-base"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-muted">สถานะ</span>
          <select required value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus)} className={`${SELECT_CLASS} block w-full`}>
            <option value="" disabled>
              –
            </option>
            {CLAIM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-muted">หมายเหตุ</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX_NOTE}
            rows={3}
            className={`block w-full rounded-md border border-line bg-surface px-3 py-2 ${focusRing}`}
          />
        </label>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btn}>
            ยกเลิก
          </button>
          <button type="submit" disabled={!status || saving} className={primary}>
            {saving ? "กำลังบันทึก…" : `บันทึก ${formatCount(refs.length)} ราย`}
          </button>
        </div>
      </form>
    </DetailModal>
  );
}

export function StpClaimGrid() {
  const { start, end } = useDateRange(MAX_DAYS);
  const { type: typeParam, show, set } = useUrlParams(FILTER_KEYS);
  const type: Type = typeParam === "ip" ? "ip" : "op";
  // ที่เลือกผูกกับประเภทและช่วงวันที่ เปลี่ยนแล้วถือว่าว่าง (POST ตรวจว่าอยู่ในช่วงนี้)
  const scope = `${type}|${start}|${end}`;
  const [sel, setSel] = useState<{ scope: string; picked: Set<string> }>({ scope, picked: new Set() });
  const picked = sel.scope === scope ? sel.picked : new Set<string>();
  const toggle = (refs: string[], on: boolean) => {
    const next = new Set(picked);
    for (const r of refs) {
      if (on) next.add(r);
      else next.delete(r);
    }
    setSel({ scope, picked: next });
  };
  const [open, setOpen] = useState(false);
  // เปลี่ยนค่านี้เพื่อให้ DataGrid โหลดใหม่หลังบันทึก (route ไม่อ่าน param นี้)
  const [version, setVersion] = useState(0);
  const n = picked.size;

  return (
    <SelectionContext.Provider value={{ picked, toggle }}>
      <SaveDialog
        open={open}
        onClose={() => setOpen(false)}
        refs={[...picked]}
        type={type}
        start={start}
        end={end}
        onSaved={() => {
          setOpen(false);
          setSel({ scope, picked: new Set() });
          setVersion((v) => v + 1);
        }}
      />
      <DataGrid<StpClaimRow, StpClaimPage>
        endpoint="/api/fund/stp-claim"
        params={{ start, end, v: version ? String(version) : "" }}
        filterKeys={FILTER_KEYS}
        toolbar={
          <>
            <Segmented label="ประเภทผู้ป่วย" options={TYPES} value={type} onChange={(t) => set({ type: t === "op" ? null : t })} />
            <DateRangeFilter
              maxDays={MAX_DAYS}
              hideLabels
              labels={{ preset: `ช่วง${DATE_LABEL[type]}`, start: `${DATE_LABEL[type]} ตั้งแต่`, end: `${DATE_LABEL[type]} ถึง` }}
            />
            <label className="flex items-center gap-2">
              <span className="text-muted">แสดง</span>
              <select value={show === "all" ? "all" : ""} onChange={(e) => set({ show: e.target.value })} className={SELECT_CLASS}>
                <option value="">ยังไม่กดส่งเคลม</option>
                <option value="all">ทั้งหมด</option>
              </select>
            </label>
          </>
        }
        columns={COLUMNS[type]}
        getRowId={(r) => r.ref}
        renderDetail={renderDetail}
        detailTitle={(r) => `ประวัติสถานะ ${REF_LABEL[type]} ${r.ref}`}
        renderSummary={renderSummary}
        exportPlacement="summary"
        summaryActions={
          <>
            {n > 0 && (
              <button type="button" onClick={() => setSel({ scope, picked: new Set() })} className={btn}>
                ล้างที่เลือก
              </button>
            )}
            <button
              type="button"
              disabled={!n || n > MAX_REFS}
              onClick={() => setOpen(true)}
              title={n > MAX_REFS ? `บันทึกได้ครั้งละไม่เกิน ${formatCount(MAX_REFS)} ราย` : undefined}
              className={primary}
            >
              {`บันทึกสถานะ${n ? ` ${formatCount(n)} ราย` : ""}`}
            </button>
          </>
        }
        searchSize="compact"
        reorderable
        hideable
        fitScreen
        pinColumns={4}
      />
    </SelectionContext.Provider>
  );
}
