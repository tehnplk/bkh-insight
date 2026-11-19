"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { ThaiDatePicker } from "@/components/thai-date-picker/thai-date-picker";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate, todayIso } from "@/lib/thai-date";
import { Money, btn, focusRing, num } from "@/app/(app)/fund/_components/ui";
import { ClaimBadge } from "@/app/(app)/fund/_components/claim-badge";
import {
  BATCH_STATUS_LABEL, CHANNEL_SHORT, CLAIM_LABEL, CLAIM_STATUSES, MAX_BATCH_NOTE, MAX_CONFIRM_IDS,
  type BatchItemRow, type BatchItemsPage, type BatchPage, type BatchRow, type BatchStatus, type Channel, type ClaimStatusKey,
} from "@/app/api/fdh/claim-batch/claim";

const MAX_DAYS = 366; // ต้องตรงกับ MAX_DAYS ใน route
const primary = `inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const danger = `inline-flex h-9 items-center justify-center rounded-md border border-danger-line bg-danger-soft px-3 text-sm font-medium text-danger hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const checkbox = `size-4 cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;
const textarea = `block w-full rounded-md border border-line bg-surface px-3 py-2 ${focusRing}`;
const nowrap = "whitespace-nowrap tabular-nums";
const dash = <span className="text-muted">–</span>;
const TONE: Record<BatchStatus, string> = {
  pending: "border-warning-line bg-warning-soft text-warning",
  confirmed: "border-success-line bg-success-soft text-success",
  cancelled: "border-line bg-surface-sunken text-muted",
};
const StatusChip = ({ status }: { status: BatchStatus }) => (
  <span className={`inline-block rounded border px-1.5 py-0.5 whitespace-nowrap ${TONE[status]}`}>{BATCH_STATUS_LABEL[status]}</span>
);
/** "2026-11-19 14:19" (เวลาไทยจาก route) เป็น "19 พ.ย. 2569 14:19" */
const dateTime = (ts: string) => `${formatThaiDate(ts)} ${ts.slice(11, 16)}`;
const channelLabel = (v: string) => CHANNEL_SHORT[v as Channel] ?? v;

async function patch(body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const res = await fetch("/api/fdh/claim-batch", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = await res?.json().catch(() => null);
  if (!res?.ok) return { ok: false, error: data?.error ?? (res ? `บันทึกไม่สำเร็จ (HTTP ${res.status})` : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้") };
  return { ok: true, data };
}

/** ชุดที่เลือก (คงอยู่ข้ามหน้าและตัวกรอง) เลือกได้เฉพาะชุดที่รอยืนยัน */
type Selection = { picked: Set<string>; toggle: (ids: string[], on: boolean) => void };
const SelectionContext = createContext<Selection>({ picked: new Set(), toggle: () => {} });

function SelectRow({ row }: { row: BatchRow }) {
  const { picked, toggle } = useContext(SelectionContext);
  const pending = row.status === "pending";
  return (
    <input
      type="checkbox"
      aria-label={`เลือกชุด ${row.id}`}
      disabled={!pending}
      checked={pending && picked.has(row.id)}
      onChange={(e) => toggle([row.id], e.target.checked)}
      className={checkbox}
    />
  );
}

function SelectPage({ rows }: { rows: BatchRow[] }) {
  const { picked, toggle } = useContext(SelectionContext);
  const ids = rows.filter((r) => r.status === "pending").map((r) => r.id);
  const n = ids.filter((id) => picked.has(id)).length;
  return (
    <input
      type="checkbox"
      aria-label="เลือกทุกชุดที่รอยืนยันในหน้านี้"
      disabled={!ids.length}
      checked={ids.length > 0 && n === ids.length}
      ref={(el) => {
        if (el) el.indeterminate = n > 0 && n < ids.length;
      }}
      onChange={(e) => toggle(ids, e.target.checked)}
      className={checkbox}
    />
  );
}

/** สถานะพร้อมหลักฐาน: ยืนยันแล้ว = วันที่อัปโหลด + ผู้ยืนยัน, ยกเลิก = เวลา + ผู้ยกเลิก */
function StatusCell({ row }: { row: BatchRow }) {
  const by =
    row.status === "confirmed" ? `อัปโหลด ${formatThaiDate(row.submitted_on)} · ${row.confirmed_by ?? ""}`
    : row.status === "cancelled" && row.cancelled_at ? `${dateTime(row.cancelled_at)} · ${row.cancelled_by ?? ""}`
    : null;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <StatusChip status={row.status} />
      {by && <span className="text-muted tabular-nums">{by}</span>}
    </span>
  );
}

const col = gridColumnHelper<BatchRow>();
const COLUMNS = col.columns([
  col.display({
    id: "select",
    header: (h) => <SelectPage rows={h.table.getRowModel().rows.map((r) => r.original)} />,
    cell: (c) => <SelectRow row={c.row.original} />,
  }),
  col.accessor("created_at", { header: "วันที่ส่งออก", cell: (c) => dateTime(c.getValue()), meta: { className: nowrap } }),
  col.accessor("id", { header: "ชุด", enableSorting: false, cell: (c) => `#${c.getValue()}`, meta: { className: nowrap } }),
  col.accessor("channel", { header: "ช่องทาง", enableSorting: false, cell: (c) => CHANNEL_SHORT[c.getValue()], meta: { className: "whitespace-nowrap", filter: { format: channelLabel } } }),
  col.accessor("patient_type", { header: "OP/IP", enableSorting: false, meta: { filter: true } }),
  col.accessor("item_count", { header: "จำนวนราย", cell: (c) => formatCount(c.getValue()), meta: { className: num } }),
  col.accessor("total_amount", { header: "ยอดรวม (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
  col.accessor("created_by", { header: "ผู้ส่งออก", meta: { className: "whitespace-nowrap", filter: true } }),
  col.accessor("status", {
    header: "สถานะ",
    enableSorting: false,
    cell: (c) => <StatusCell row={c.row.original} />,
    meta: { filter: { format: (v) => BATCH_STATUS_LABEL[v as BatchStatus] ?? v } },
  }),
  col.accessor("note", { header: "หมายเหตุ", enableSorting: false, cell: (c) => c.getValue() || dash, meta: { className: "min-w-48 whitespace-pre-line" } }),
]);

const Value = ({ children }: { children: ReactNode }) => <span className="font-semibold text-foreground">{children}</span>;
const dot = <span aria-hidden="true"> · </span>;
const renderSummary = ({ summary: s }: BatchPage) => (
  <p className="text-muted tabular-nums">
    {BATCH_STATUS_LABEL.pending} <Value>{formatCount(s.pending)}</Value> ชุด{dot}
    {BATCH_STATUS_LABEL.confirmed} <Value>{formatCount(s.confirmed)}</Value>{dot}
    {BATCH_STATUS_LABEL.cancelled} <Value>{formatCount(s.cancelled)}</Value>
  </p>
);

/** วันที่อัปโหลด (ค่าเริ่มต้นวันนี้ ไม่ก่อนวันส่งออก) + หมายเหตุ แล้วยืนยันส่งแล้ว ; ข้ามชุดที่ยกเลิก/ยืนยันไปแล้ว */
function ConfirmForm({ ids, min, onDone }: { ids: string[]; min?: string; onDone: (msg: string) => void }) {
  const today = todayIso();
  const [on, setOn] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError(null);
    const r = await patch({ action: "confirm", ids, submitted_on: on, note });
    setSaving(false);
    if (!r.ok) return setError(r.error);
    const done = (r.data.confirmed as string[]).length;
    const skipped = (r.data.skipped as string[]).length;
    if (!done) return setError("ยืนยันไม่ได้: ชุดถูกยกเลิก ยืนยันไปแล้ว หรือส่งออกหลังวันที่อัปโหลด");
    onDone(`ยืนยันส่งแล้ว ${formatCount(done)} ชุด${skipped ? ` (ข้าม ${formatCount(skipped)} ชุดที่ยกเลิก ยืนยันไปแล้ว หรือส่งออกหลังวันที่อัปโหลด)` : ""}`);
  }
  return (
    <form
      className="space-y-3 text-base"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <ThaiDatePicker label="วันที่อัปโหลด" value={on} onChange={setOn} min={min && min > today ? today : min} max={today} />
      <label className="block space-y-1.5">
        <span className="text-muted">หมายเหตุ</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={MAX_BATCH_NOTE} rows={2} className={textarea} />
      </label>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={saving} className={primary}>
        {saving ? "กำลังบันทึก…" : ids.length > 1 ? `ยืนยันส่งแล้ว ${formatCount(ids.length)} ชุด` : "ยืนยันส่งแล้ว"}
      </button>
    </form>
  );
}

/** ยกเลิกชุดที่ส่งออกผิดหรือไม่ได้อัปโหลด (ต้องมีเหตุผล) ; ชุดที่ยืนยันแล้ว server ยอมเฉพาะผู้ยืนยันหรือผู้ดูแลระบบ */
function CancelForm({ id, onDone }: { id: string; onDone: (msg: string) => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError(null);
    const r = await patch({ action: "cancel", id, note });
    setSaving(false);
    if (!r.ok) return setError(r.error);
    onDone(`ยกเลิกชุด #${id} แล้ว รายในชุดไม่นับเป็นส่งออกแล้ว`);
  }
  return (
    <form
      className="space-y-3 text-base"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-muted">เหตุผลที่ยกเลิก</span>
        <textarea required value={note} onChange={(e) => setNote(e.target.value)} maxLength={MAX_BATCH_NOTE} rows={2} className={textarea} />
      </label>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={saving || !note.trim()} className={danger}>
        {saving ? "กำลังบันทึก…" : "ยกเลิกชุดนี้"}
      </button>
    </form>
  );
}

// ---- รายในชุด (DataGrid แบบ localState ใน modal) ----
const SETTLED: ClaimStatusKey[] = ["paid", "rep_pass", "rep_c", "rep_deny"];
const itemCol = gridColumnHelper<BatchItemRow>();
const itemColumns = (type: "OP" | "IP") =>
  itemCol.columns([
    itemCol.accessor("ref", { header: type === "OP" ? "VN" : "AN", meta: { className: nowrap } }),
    itemCol.accessor("hn", { header: "HN", meta: { className: nowrap } }),
    itemCol.accessor("service_date", { header: type === "OP" ? "วันที่รับบริการ" : "วันที่จำหน่าย", cell: (c) => formatThaiDate(c.getValue()) || dash, meta: { className: nowrap } }),
    itemCol.accessor("scheme", {
      header: "สิทธิ",
      cell: (c) => (c.getValue() ? <span className="whitespace-nowrap">{c.getValue()} <span className="text-muted">{c.row.original.subtype}</span></span> : dash),
      meta: { filter: true },
    }),
    itemCol.accessor("hospmain", { header: "HCODE", cell: (c) => c.getValue() ?? dash, meta: { className: nowrap, filter: true } }),
    itemCol.accessor("pdx", { header: "PDx", enableSorting: false, cell: (c) => c.getValue() ?? dash, meta: { className: nowrap } }),
    itemCol.accessor("cht_total", { header: "CHT (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
    itemCol.display({
      id: "claim",
      header: "สถานะเคลม",
      cell: (c) => <ClaimBadge claim={c.row.original.claim} type={type} />,
      meta: { filter: { format: (v) => CLAIM_LABEL[v as ClaimStatusKey] ?? v } },
    }),
  ]);
const ITEM_COLUMNS = { OP: itemColumns("OP"), IP: itemColumns("IP") };

function itemsSummary(itemCount: number) {
  return function ItemsSummary({ summary: s }: BatchItemsPage) {
    const settled = SETTLED.reduce((n, k) => n + (s.counts[k] ?? 0), 0);
    return (
      <div className="space-y-1 text-muted tabular-nums">
        <p>
          มี REP แล้ว <Value>{formatCount(settled)}</Value>{dot}ยังไม่มี REP <Value>{formatCount(itemCount - settled)}</Value> จาก {formatCount(itemCount)} ราย
        </p>
        <p>
          {CLAIM_STATUSES.filter((k) => s.counts[k]).map((k, i) => (
            <span key={k}>
              {i > 0 && dot}
              {CLAIM_LABEL[k]} <Value>{formatCount(s.counts[k] ?? 0)}</Value>
            </span>
          ))}
        </p>
        {s.error && (
          <p role="alert" className="text-danger">
            {s.error}
          </p>
        )}
      </div>
    );
  };
}

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-0.5">
    <dt className="text-muted">{label}</dt>
    <dd>{children}</dd>
  </div>
);

/** รายละเอียดชุด: ข้อมูลชุด, ยืนยัน/ยกเลิก และรายในชุดพร้อมสถานะเคลมปัจจุบัน ; done = ผลการกดล่าสุด (row เป็นค่าตอนเปิด modal) */
function BatchDetail({ row, onChanged }: { row: BatchRow; onChanged: () => void }) {
  const [done, setDone] = useState<string | null>(null);
  const finish = (msg: string) => {
    setDone(msg);
    onChanged();
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 text-base">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="ส่งออก">
          <span className="tabular-nums">{dateTime(row.created_at)}</span> <span className="text-muted">{row.created_by}</span>
        </Fact>
        <Fact label="ช่องทาง">
          {CHANNEL_SHORT[row.channel]} · {row.patient_type}
        </Fact>
        <Fact label="สถานะ">
          <StatusCell row={row} />
        </Fact>
        <Fact label="หมายเหตุ">
          <span className="whitespace-pre-line">{row.note || dash}</span>
        </Fact>
      </dl>
      {done ? (
        <p role="status" className="text-success">
          {done}
        </p>
      ) : (
        row.status !== "cancelled" && (
          <div className="grid gap-4 rounded-lg border border-line p-3 md:grid-cols-2">
            {row.status === "pending" && <ConfirmForm ids={[row.id]} min={row.created_at.slice(0, 10)} onDone={finish} />}
            <CancelForm id={row.id} onDone={finish} />
          </div>
        )
      )}
      <DataGrid<BatchItemRow, BatchItemsPage>
        endpoint="/api/fdh/claim-batch/items"
        params={{ id: row.id }}
        localState={{ pageSize: "100" }}
        columns={ITEM_COLUMNS[row.patient_type]}
        getRowId={(r) => r.ref}
        renderSummary={itemsSummary(row.item_count)}
        exportPlacement="summary"
        searchSize="compact"
        fitScreen
        pinColumns={2}
      />
    </div>
  );
}

export function ClaimBatchGrid() {
  const { start, end } = useDateRange(MAX_DAYS);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setPicked(next);
  };
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // เปลี่ยนค่านี้เพื่อให้ DataGrid โหลดใหม่หลังบันทึก (route ไม่อ่าน param นี้)
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const n = picked.size;

  return (
    <SelectionContext.Provider value={{ picked, toggle }}>
      <DetailModal open={open} onClose={() => setOpen(false)} title={`ยืนยันส่งแล้ว ${formatCount(n)} ชุด`}>
        {/* ชุดที่เลือกอาจส่งออกต่างวัน: server ข้ามชุดที่ส่งออกหลังวันที่อัปโหลด */}
        <ConfirmForm
          key={version}
          ids={[...picked]}
          onDone={(msg) => {
            setOpen(false);
            setPicked(new Set());
            setNotice(msg);
            reload();
          }}
        />
      </DetailModal>
      {notice && (
        <p role="status" className="mb-3 text-base text-success">
          {notice}
        </p>
      )}
      <DataGrid<BatchRow, BatchPage>
        endpoint="/api/fdh/claim-batch"
        params={{ start, end, v: version ? String(version) : "" }}
        toolbar={<DateRangeFilter maxDays={MAX_DAYS} hideLabels labels={{ preset: "ช่วงวันที่ส่งออก", start: "วันที่ส่งออก ตั้งแต่", end: "วันที่ส่งออก ถึง" }} />}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        renderDetail={(r) => <BatchDetail row={r} onChanged={reload} />}
        detailTitle={(r) => `ชุดส่งออก #${r.id}`}
        detailSize="wide"
        renderSummary={renderSummary}
        exportPlacement="summary"
        summaryActions={
          <>
            {n > 0 && (
              <button type="button" onClick={() => setPicked(new Set())} className={btn}>
                ล้างที่เลือก
              </button>
            )}
            <button
              type="button"
              disabled={!n || n > MAX_CONFIRM_IDS}
              onClick={() => setOpen(true)}
              title={n > MAX_CONFIRM_IDS ? `ยืนยันได้ครั้งละไม่เกิน ${formatCount(MAX_CONFIRM_IDS)} ชุด` : undefined}
              className={primary}
            >
              {`ยืนยันส่งแล้ว${n ? ` ${formatCount(n)} ชุด` : ""}`}
            </button>
          </>
        }
        searchSize="compact"
        hideable
      />
    </SelectionContext.Provider>
  );
}
