"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { DataGrid, gridColumnHelper, type SummaryGrid } from "@/components/data-grid/data-grid";
import { ThaiDatePicker } from "@/components/thai-date-picker/thai-date-picker";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate, todayIso } from "@/lib/thai-date";
import { Money, focusRing, num } from "@/app/(app)/fund/_components/ui";
import { FilterStat } from "@/app/(app)/ipd/admissions/admissions-grid";
import { LEDGER_START } from "@/app/api/fund/ar-sync/ledger";
import {
  GROUP_LABEL, MAX_RECEIPT_NO, SETTLE_GROUPS, STATUS_LABEL, repGateReason,
  type PreviewRow, type SettlePreviewPage, type SettleResult, type SettleStatus, type SettleSummary,
} from "@/app/api/fund/ar-settle/settle";

const primary = `inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const secondary = `inline-flex h-9 items-center justify-center rounded-md border border-line bg-surface px-3 text-sm font-medium hover:bg-hover disabled:opacity-50 ${focusRing}`;
const checkbox = `size-4 cursor-pointer accent-[var(--accent)] ${focusRing}`;
const input = `h-9 w-44 rounded-md border border-line bg-surface px-2.5 ${focusRing}`;
const nowrap = "whitespace-nowrap tabular-nums";
const dash = <span className="text-muted">–</span>;
const cents = (v: number | null) => Math.round((v ?? 0) * 100);

const TONE: Record<SettleStatus, string> = {
  match: "border-success-line bg-success-soft text-success",
  settled: "border-success-line bg-success-soft text-success",
  under: "border-warning-line bg-warning-soft text-warning",
  recall: "border-warning-line bg-warning-soft text-warning",
  partial: "border-warning-line bg-warning-soft text-warning",
  over: "border-accent-line bg-accent-soft text-accent-text",
  missing: "border-danger-line bg-danger-soft text-danger",
  no_ref: "border-line bg-surface-sunken text-muted",
  no_debt: "border-line bg-surface-sunken text-muted",
  not_stm: "border-line bg-surface-sunken text-muted",
  no_account: "border-line bg-surface-sunken text-muted",
  zero: "border-line bg-surface-sunken text-muted",
};
const StatusChip = ({ status }: { status: SettleStatus }) => (
  <span className={`inline-block rounded border px-1.5 py-0.5 whitespace-nowrap ${TONE[status]}`}>{STATUS_LABEL[status]}</span>
);

/** checkbox ปิดส่วนต่างที่ผู้ใช้เปลี่ยนจากค่าเริ่มต้น (key -> แถวตอนกด) ; ค่าเริ่มต้นอยู่ที่ server (close_default) */
type Toggles = { changed: Map<string, { on: boolean; row: PreviewRow }>; set: (row: PreviewRow, on: boolean) => void; clear: () => void };
const ToggleContext = createContext<Toggles>({ changed: new Map(), set: () => {}, clear: () => {} });

function CloseBox({ row }: { row: PreviewRow }) {
  const { changed, set } = useContext(ToggleContext);
  if (!row.closable) return null;
  return (
    <input
      type="checkbox"
      aria-label={`ปิดส่วนต่าง ${row.ref ?? ""}`}
      checked={changed.get(row.key)?.on ?? row.close_default}
      onChange={(e) => set(row, e.target.checked)}
      className={checkbox}
    />
  );
}

const col = gridColumnHelper<PreviewRow>();
/** doc = ชื่อเอกสารที่จ่าย (STM / REP) ในหัวคอลัมน์ยอดจ่าย */
const columns = (pt: "OP" | "IP", doc: string) =>
  col.columns([
    col.accessor("status", {
      header: "สถานะ",
      enableSorting: false,
      cell: (c) => <StatusChip status={c.getValue()} />,
      meta: { filter: { format: (v) => STATUS_LABEL[v as SettleStatus] ?? v } },
    }),
    col.accessor("ref", { header: pt === "OP" ? "VN" : "AN", cell: (c) => c.getValue() ?? dash, meta: { className: nowrap } }),
    col.accessor("hn", { header: "HN", cell: (c) => c.getValue() ?? dash, meta: { className: nowrap } }),
    col.accessor("rep_no", {
      header: "REP",
      cell: (c) => {
        const r = c.row.original;
        return (
          <span className="whitespace-nowrap tabular-nums" title={r.lines > 1 ? `${formatCount(r.lines)} รายการใน STM` : undefined}>
            {r.rep_no ?? dash} {r.tran_id && <span className="text-muted">{r.tran_id}</span>}
            {r.lines > 1 && <span className="text-muted"> ×{formatCount(r.lines)}</span>}
          </span>
        );
      },
    }),
    col.accessor("account_code", { header: "บัญชี", cell: (c) => c.getValue() ?? dash, meta: { className: nowrap, filter: true } }),
    col.accessor("balance", { header: "หนี้คงเหลือ (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
    col.accessor("paid", { header: `${doc} จ่าย (บาท)`, cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
    col.accessor("remaining", { header: "คงเหลือหลังตัด (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
    col.display({ id: "close", header: "ปิดส่วนต่าง", cell: (c) => <CloseBox row={c.row.original} /> }),
  ]);
const COLUMNS = {
  stm: { OP: columns("OP", "STM"), IP: columns("IP", "STM") },
  rep: { OP: columns("OP", "REP"), IP: columns("IP", "REP") },
};

function renderSummary({ summary: s }: SettlePreviewPage, grid: SummaryGrid) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* REP ไม่มีกลุ่ม "REP งวดนี้ STM ไม่จ่าย" (ตัวเอกสารคือ REP) */}
      {SETTLE_GROUPS.filter((g) => s.doc !== "rep" || g !== "missing").map((g) => (
        <FilterStat
          key={g}
          grid={grid}
          col="group"
          values={[g]}
          label={GROUP_LABEL[g]}
          n={s.groups[g].n}
          title={`${g === "missing" ? "" : `${s.doc === "rep" ? "REP" : "STM"} จ่าย ${formatBaht(s.groups[g].paid)} บาท · `}หนี้คงเหลือ ${formatBaht(s.groups[g].balance)} บาท`}
        />
      ))}
    </div>
  );
}

async function post(body: unknown): Promise<{ ok: true; data: SettleResult } | { ok: false; error: string }> {
  const res = await fetch("/api/fund/ar-settle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = await res?.json().catch(() => null);
  if (!res?.ok) return { ok: false, error: data?.error ?? (res ? `ตัดลูกหนี้ไม่สำเร็จ (HTTP ${res.status})` : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้") };
  return { ok: true, data };
}

const Value = ({ children }: { children: ReactNode }) => <span className="font-semibold text-foreground">{children}</span>;

/** วันที่/เลขที่ใบเสร็จ + ยอดที่จะลงตาม checkbox ปัจจุบัน แล้วยืนยันก่อนลง ar_ledger ทุกครั้ง */
function SettleForm({ s, grid, onChanged }: { s: SettleSummary; grid: SummaryGrid; onChanged: () => void }) {
  const { changed, clear } = useContext(ToggleContext);
  const today = todayIso();
  // ค่าเริ่มต้นจากใบเสร็จเงินโอน SMT งวดเดียวกันที่ลงรับแล้ว (/fund/ar-transfer) แก้ได้
  const fromTransfer = s.transfer_receipt;
  // REP: ตัดได้เมื่อเงินโอน SMT ของ REP ลงรับแล้วและยอดตรง ใบเสร็จ = ของเงินโอน แก้ไม่ได้ (server ใช้ค่านี้เอง)
  const gate = s.doc === "rep" ? s.rep_gate : undefined;
  const gateReason = gate ? repGateReason(gate, formatBaht) : null;
  const [date, setDate] = useState(gate?.receipt?.receipt_date ?? fromTransfer?.receipt_date ?? today);
  const [receipt, setReceipt] = useState(gate?.receipt?.receipt_no ?? fromTransfer?.receipt_no ?? "");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  let closeN = s.plan.close_n;
  let closeC = cents(s.plan.close_amount);
  for (const { on, row } of changed.values()) {
    closeN += on ? 1 : -1;
    closeC += (on ? -1 : 1) * cents(row.remaining);
  }
  const settleN = s.plan.settle_n;
  const needReceipt = !gate && settleN > 0 && !receipt.trim();
  const shifted = s.open_from && date < s.open_from;
  const plan = (
    <>
      รับชำระ <Value>{formatCount(settleN)}</Value> ราย <Value>{formatBaht(s.plan.settle_amount)}</Value> บาท
      <span aria-hidden="true"> · </span>
      ปิดส่วนต่าง <Value>{formatCount(closeN)}</Value> ราย <Value>{formatBaht(closeC / 100)}</Value> บาท
    </>
  );

  async function save() {
    setSaving(true);
    setError(null);
    const pick = (on: boolean) => [...changed].filter(([, v]) => v.on === on).map(([k]) => k);
    const r = await post({ [s.doc === "rep" ? "rep_no" : "stm_file_id"]: s.file.id, receipt_date: date, receipt_no: receipt, close: pick(true), keep: pick(false) });
    setSaving(false);
    setConfirming(false);
    if (!r.ok) return setError(r.error);
    const d = r.data;
    setDone(
      `ชุด #${d.batch_id}: รับชำระ ${formatCount(d.settle)} รายการ ${formatBaht(d.settle_amount)} บาท · ปิดส่วนต่าง ${formatCount(d.diff)} รายการ ${formatBaht(d.diff_amount)} บาท` +
        (d.shifted ? ` · เลื่อนเข้างวดเปิด ${formatCount(d.shifted)} รายการ` : "") +
        (d.skipped ? ` · ข้าม ${formatCount(d.skipped)} รายการที่ลงไว้แล้ว` : ""),
    );
    clear();
    grid.reload();
    onChanged();
  }

  return (
    <div className="space-y-2 text-base">
      {done && (
        <p role="status" className="text-success">
          {done}
        </p>
      )}
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (confirming) save();
          else setConfirming(true);
        }}
      >
        {gate ? (
          <span className="tabular-nums">
            <span className="text-muted">ใบเสร็จเงินโอน </span>
            {gate.receipt ? (
              <>
                <Value>{gate.receipt.receipt_no ?? "–"}</Value> <span className="text-muted">วันที่</span> <Value>{formatThaiDate(gate.receipt.receipt_date)}</Value>
                {gate.receipt.receipts > 1 && <span className="text-sm text-muted"> (ใบล่าสุดจาก {formatCount(gate.receipt.receipts)} ใบ)</span>}
              </>
            ) : (
              dash
            )}
            <span className="text-muted"> · ยอดโอน </span>
            {gate.status === "none" ? dash : <Value>{formatBaht(gate.transfer_total)}</Value>}
            <span className="text-muted"> / ยอด REP </span>
            <Value>{formatBaht(gate.rep_total)}</Value>
          </span>
        ) : (
          <>
            <ThaiDatePicker label="วันที่ออกใบเสร็จ" value={date} onChange={setDate} min={LEDGER_START} max={today} />
            <label className="flex items-center gap-2">
              <span className="text-muted">เลขที่ใบเสร็จ</span>
              <input value={receipt} onChange={(e) => setReceipt(e.target.value)} maxLength={MAX_RECEIPT_NO} className={input} disabled={confirming} />
            </label>
          </>
        )}
        {fromTransfer && receipt === fromTransfer.receipt_no && date === fromTransfer.receipt_date && (
          <span className="text-sm text-muted">ตามใบเสร็จเงินโอน SMT งวด {fromTransfer.period}</span>
        )}
        <p className="text-muted tabular-nums">{plan}</p>
        {confirming ? (
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} disabled={saving} className={secondary}>
              แก้ไข
            </button>
            <button type="submit" disabled={saving} className={primary}>
              {saving ? "กำลังบันทึก…" : "ยืนยันตัดลูกหนี้"}
            </button>
          </span>
        ) : (
          <button
            type="submit"
            disabled={(!settleN && !closeN) || needReceipt || !!gateReason}
            title={needReceipt ? "กรอกเลขที่ใบเสร็จ" : undefined}
            aria-describedby={gateReason ? "settle-gate" : undefined}
            className={`ml-auto ${primary}`}
          >
            ตัดลูกหนี้
          </button>
        )}
      </form>
      {gateReason && (
        <p id="settle-gate" className="text-warning">
          {gateReason}
          {gate?.status !== "mismatch" && (
            <>
              {" · "}
              <Link href="/fund/ar-transfer" className={`rounded underline underline-offset-2 ${focusRing}`}>ไปหน้าเงินโอนที่ได้รับ</Link>
            </>
          )}
        </p>
      )}
      {confirming && (
        <p role="alert" className="text-warning">
          ลงสมุดลูกหนี้วันที่ {formatThaiDate(date)} ใบเสร็จ {receipt.trim() || "–"}: {plan} แก้หรือลบภายหลังไม่ได้ ต้องขอปรับปรุงลูกหนี้
        </p>
      )}
      {shifted && (
        <p className="text-warning">
          วันที่ใบเสร็จอยู่ในงวดที่ปิดแล้ว รายการจะลงวันที่ {formatThaiDate(s.open_from)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {s.batches.length > 0 && (
        <details className="text-muted">
          <summary className={`w-fit cursor-pointer rounded ${focusRing}`}>ประวัติการตัด {formatCount(s.batches.length)} ชุด</summary>
          <ul className="mt-1 space-y-0.5 tabular-nums">
            {s.batches.map((b) => (
              <li key={b.id}>
                #{b.id} · {formatThaiDate(b.receipt_date)} · ใบเสร็จ {b.receipt_no ?? "–"} · รับชำระ {formatBaht(b.counts.settle_amount ?? 0)} บาท · ปิดส่วนต่าง{" "}
                {formatCount(b.counts.diff ?? 0)} รายการ · {b.settled_by} {formatThaiDate(b.settled_at)} {b.settled_at.slice(11, 16)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** ตัวอย่างการตัดของไฟล์ STM (doc stm, id = stm_file.id) หรือ REP (doc rep, id = rep_no) + ฟอร์มตัดลูกหนี้ (ใน DetailModal wide) */
export function SettleFile({ doc, id, patientType, onChanged }: { doc: "stm" | "rep"; id: string; patientType: "OP" | "IP"; onChanged: () => void }) {
  const [changed, setChanged] = useState<Toggles["changed"]>(new Map());
  const toggles: Toggles = {
    changed,
    set: (r, on) => {
      const next = new Map(changed);
      if (on === r.close_default) next.delete(r.key);
      else next.set(r.key, { on, row: r });
      setChanged(next);
    },
    clear: () => setChanged(new Map()),
  };
  return (
    <ToggleContext.Provider value={toggles}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 text-base">
        <DataGrid<PreviewRow, SettlePreviewPage>
          endpoint="/api/fund/ar-settle/preview"
          params={doc === "rep" ? { rep: id } : { id }}
          localState={{ pageSize: "100" }}
          columns={COLUMNS[doc][patientType]}
          getRowId={(r) => r.key}
          renderSummary={renderSummary}
          renderFooter={(d, grid) => <SettleForm s={d.summary} grid={grid} onChanged={onChanged} />}
          exportPlacement="summary"
          searchSize="compact"
          fitScreen
          pinColumns={2}
        />
      </div>
    </ToggleContext.Provider>
  );
}
