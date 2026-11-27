"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Download, Plus } from "lucide-react";
import { AccountPicker } from "@/components/account-picker/account-picker";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { ThaiDatePicker } from "@/components/thai-date-picker/thai-date-picker";
import { formatBaht, formatCount } from "@/lib/number-format";
import { usePersistedFilter } from "@/lib/persisted-filter";
import { THAI_MONTHS_SHORT, formatThaiDate, todayIso } from "@/lib/thai-date";
import { FY_BACK, fiscalYearOf } from "@/app/api/fund/uc-dashboard/dashboard";
import { LEDGER_START } from "@/app/api/fund/ar-sync/ledger";
import type { AccountOption, TransferRow, TransferStatus, FundMapRow } from "@/app/api/fund/ar-transfer/data";
import type { ArTransferSummary } from "@/app/api/fund/ar-transfer/summary/route";
import type { ImportResult } from "@/app/api/fund/ar-transfer/import/route";
import type { FundDetailResult } from "@/app/api/fund/ar-transfer/fund-detail/route";
import type { ReceiptResult } from "@/app/api/fund/ar-transfer/receipt/route";
import { ACCOUNT_RE, MAX_NOTE, MAX_RECEIPT_NO, PRIOR_YEAR_ACCOUNT, SOURCE_LABEL, STATUS_LABEL, type ImportCounts, type PendingBatch } from "@/app/api/fund/ar-transfer/transfer";
import { Money, Notice, Skeleton, btn, focusRing, num, useJson, useUrlParams } from "../_components/ui";
import { Fact, Facts } from "../uc-debtor/uc-debtor-detail";

const TITLE = "เงินโอนที่ได้รับ";
const FILTER_KEYS = ["fy"] as const;
const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium ${focusRing}`;
const FIELD = `h-9 min-w-0 rounded-md border border-line bg-surface px-3 ${focusRing}`;
const primary = `inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-wait disabled:opacity-60 ${focusRing}`;
const TH = "px-3 py-2.5 font-medium";
const TD = "px-3 py-1.5";
const dash = <span className="text-muted">–</span>;
const monthLabel = (m: string) => `${THAI_MONTHS_SHORT[+m.slice(5, 7) - 1]} ${String(+m.slice(0, 4) + 543).slice(2)}`;
const amountOk = (s: string) => /^-?\d+(\.\d{1,2})?$/.test(s.trim()) && Number(s) !== 0;

async function send<T = unknown>(url: string, init: RequestInit): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init }).catch(() => null);
  const body = await res?.json().catch(() => null);
  return res?.ok ? { ok: true, body } : { ok: false, error: body?.error ?? `ไม่สำเร็จ${res ? ` (HTTP ${res.status})` : ""}` };
}

const STATUS_CHIP: Record<TransferStatus, string> = {
  pending: "border-warning-line bg-warning-soft text-warning",
  received: "border-success-line bg-success-soft text-success",
  cancelled: "border-line bg-surface-sunken text-muted",
};
const Status = ({ status }: { status: TransferStatus }) => (
  <span className={`rounded border px-1.5 py-0.5 whitespace-nowrap ${STATUS_CHIP[status]}`}>{STATUS_LABEL[status]}</span>
);

/** ยอด + ป้าย "แก้แล้ว" เมื่อการเงินแก้จากยอด SMT (title บอกยอดเดิม) */
function Amount({ row }: { row: TransferRow }) {
  return (
    <span className={row.status === "cancelled" ? "text-muted line-through" : undefined}>
      {row.edited && (
        <span title={`ยอดจาก SMT ${formatBaht(row.smt_amount ?? 0)} บาท`} className="mr-1.5 rounded border border-warning-line bg-warning-soft px-1 text-xs text-warning">
          แก้แล้ว
        </span>
      )}
      {formatBaht(row.amount)}
    </span>
  );
}

/** stm = บัญชีลูกหนี้ที่ตัดรายตัว (STM หรือ REP ของ อปท.): เงินโอนใช้กระทบยอดเท่านั้น ไม่ลงสมุดรายวัน (ลงตอนตัดรายตัว) */
const Account = ({ code, name, stm }: { code: string | null; name?: string | null; stm?: boolean }) =>
  code ? (
    <>
      <span className="whitespace-nowrap tabular-nums">{code}</span>
      {stm && (
        <span title="เงินโอนนี้ลงบัญชีตอนตัดลูกหนี้รายตัวด้วย STM หรือ REP ที่หน้าตัดลูกหนี้" className="ml-1.5 rounded border border-line bg-surface-sunken px-1 text-xs whitespace-nowrap text-muted">
          ไม่ลงสมุดรายวัน · ตัดรายตัว (STM/REP)
        </span>
      )}
      {name && <span className="block text-grid-sub text-subtle">{name}</span>}
    </>
  ) : (
    dash
  );

const col = gridColumnHelper<TransferRow>();
const COLUMNS = col.columns([
  col.accessor("transfer_date", { header: "วันที่โอน", cell: (c) => formatThaiDate(c.getValue()), meta: { className: "whitespace-nowrap tabular-nums" } }),
  col.accessor("ref_doc_no", { header: "เลขที่เอกสาร", cell: (c) => c.getValue() || dash }),
  col.accessor("fund_name", { header: "กองทุน", cell: (c) => c.getValue() || dash, meta: { filter: true } }),
  col.accessor("budget_year", { header: "งบปี", cell: (c) => c.getValue() ?? dash, enableSorting: false, meta: { className: "tabular-nums" } }),
  col.accessor("account_code", { header: "บัญชี", cell: (c) => <Account code={c.getValue()} name={c.row.original.account_name} stm={c.row.original.stm} />, meta: { filter: true } }),
  col.accessor("amount", { header: "จำนวนเงิน (บาท)", cell: (c) => <Amount row={c.row.original} />, meta: { className: num } }),
  col.accessor("source", { header: "ที่มา", cell: (c) => SOURCE_LABEL[c.getValue()], meta: { filter: { format: (v) => SOURCE_LABEL[v as TransferRow["source"]] ?? v } } }),
  col.accessor("note", { header: "หมายเหตุ", cell: (c) => c.getValue() || dash, enableSorting: false }),
  col.accessor("status", { header: "สถานะ", cell: (c) => <Status status={c.getValue()} />, meta: { filter: { format: (v) => STATUS_LABEL[v as TransferStatus] ?? v } } }),
  col.accessor("receipt_no", { header: "เลขที่ใบเสร็จ", cell: (c) => c.getValue() || dash, meta: { className: "whitespace-nowrap tabular-nums" } }),
  col.accessor("receipt_date", { header: "วันที่ใบเสร็จ", cell: (c) => (c.getValue() ? formatThaiDate(c.getValue()) : dash), meta: { className: "whitespace-nowrap tabular-nums" } }),
]);

const by = (name: string | null, at: string | null) => (name ? `${name}${at ? ` · ${formatThaiDate(at)} ${at.slice(11, 16)} น.` : ""}` : null);
const closedIn = (date: string, through: string | null) => !!through && date.slice(0, 7) <= through;

/* ---------- ฟอร์มรายการ (เพิ่มเอง/แก้) ---------- */

type Draft = { transfer_date: string; ref_doc_no: string; account_code: string; amount: string; note: string; receipt_no: string; receipt_date: string };

/** withRef = ฟอร์มเพิ่มเอง: มีเลขที่เอกสาร และใบเสร็จ (ไม่กรอกเลขที่ใบเสร็จ = รอออกใบเสร็จ) */
function TransferForm({ id, initial, accounts, withRef, submitText, onSubmit }: {
  id: string; initial: Draft; accounts: AccountOption[]; withRef: boolean; submitText: string;
  onSubmit: (d: Draft) => Promise<string | null>;
}) {
  const [d, setD] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const badAccount = d.account_code !== "" && !ACCOUNT_RE.test(d.account_code.trim());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(undefined);
        if (badAccount) return setError("รหัสบัญชีต้องเป็นรูปแบบ 4301020105.214 เลือกจากรายการหรือพิมพ์ให้ครบ");
        if (!amountOk(d.amount)) return setError("จำนวนเงินต้องไม่เป็น 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง");
        startTransition(async () => setError((await onSubmit(d)) ?? undefined));
      }}
      className="flex flex-col gap-2 text-sm"
    >
      <div className="flex flex-wrap items-end gap-3">
        <ThaiDatePicker label="วันที่โอน" value={d.transfer_date} onChange={(transfer_date) => setD({ ...d, transfer_date })} min={LEDGER_START} max={todayIso()} stepper={false} />
        {withRef && (
          <label className="flex flex-col gap-1">
            <span className="text-muted">เลขที่เอกสาร</span>
            <input maxLength={MAX_NOTE} value={d.ref_doc_no} onChange={(e) => setD({ ...d, ref_doc_no: e.target.value })} className={`${FIELD} w-48`} />
          </label>
        )}
        <label htmlFor={`${id}-account`} className="flex flex-col gap-1">
          <span className="text-muted">บัญชี (เครดิต)</span>
          <AccountPicker id={`${id}-account`} accounts={accounts} value={d.account_code} invalid={badAccount} onChange={(account_code) => setD({ ...d, account_code })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">จำนวนเงิน (บาท) ถูกหักคืนใส่ลบ</span>
          <input required inputMode="decimal" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} aria-invalid={(d.amount !== "" && !amountOk(d.amount)) || undefined} className={`${FIELD} w-40 text-right tabular-nums aria-invalid:border-danger-line`} />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-muted">หมายเหตุ</span>
          <input maxLength={MAX_NOTE} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} className={`${FIELD} min-w-48`} />
        </label>
        {withRef && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-muted">เลขที่ใบเสร็จ</span>
              <input maxLength={MAX_RECEIPT_NO} value={d.receipt_no} onChange={(e) => setD({ ...d, receipt_no: e.target.value })} className={`${FIELD} w-36 tabular-nums`} />
            </label>
            {d.receipt_no.trim() && (
              <ThaiDatePicker label="วันที่ใบเสร็จ" value={d.receipt_date} onChange={(receipt_date) => setD({ ...d, receipt_date })} min={d.transfer_date} max={todayIso()} stepper={false} />
            )}
          </>
        )}
        <button type="submit" disabled={pending} className={primary}>{pending ? "กำลังบันทึก…" : submitText}</button>
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </form>
  );
}

const payload = (d: Draft) => ({ transfer_date: d.transfer_date, account_code: d.account_code.trim(), amount: Number(d.amount), note: d.note });

/** ฟอร์มเหตุผล + ปุ่มสีอันตราย (ยกเลิกรายการ / ยกเลิกการรับ) ; onSubmit คืนข้อความ error หรือ null */
function ReasonForm({ label, submitText, onSubmit }: { label: string; submitText: string; onSubmit: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(undefined);
        startTransition(async () => setError((await onSubmit(reason)) ?? undefined));
      }}
      className="flex flex-col gap-2 text-sm"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-muted">{label}</span>
          <input required maxLength={MAX_NOTE} value={reason} onChange={(e) => setReason(e.target.value)} className={`${FIELD} min-w-56`} />
        </label>
        <button type="submit" disabled={pending || !reason.trim()} className={`${btn} border-danger-line text-danger disabled:opacity-60`}>{pending ? "กำลังบันทึก…" : submitText}</button>
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </form>
  );
}

/** เลขที่/วันที่ใบเสร็จ (ค่าเริ่มต้นวันนี้ ไม่ก่อนวันที่โอน) แล้วลงรับ ; target = ชุดโอน { transfer_date, batch } หรือ { id } */
function ReceiptForm({ min, target, onDone }: { min: string; target: Record<string, string>; onDone: (msg: string) => void }) {
  const today = todayIso();
  const [no, setNo] = useState("");
  const [date, setDate] = useState(today < min ? min : today);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(undefined);
        startTransition(async () => {
          const r = await send<ReceiptResult>("/api/fund/ar-transfer/receipt", { method: "POST", body: JSON.stringify({ action: "receive", ...target, receipt_no: no, receipt_date: date }) });
          if (!r.ok) return setError(r.error);
          onDone(`ลงรับ ${formatCount(r.body.n)} รายการ ใบเสร็จ ${no.trim()} วันที่ ${formatThaiDate(date)} แล้ว`);
        });
      }}
      className="flex flex-col gap-2 text-sm"
    >
      {/* ป้ายอยู่หน้าช่องแบบเดียวกับ ThaiDatePicker */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-muted">เลขที่ใบเสร็จ</span>
          <input required maxLength={MAX_RECEIPT_NO} value={no} onChange={(e) => setNo(e.target.value)} className={`${FIELD} w-40 tabular-nums`} />
        </label>
        <ThaiDatePicker label="วันที่ใบเสร็จ" value={date} onChange={setDate} min={min} max={today} stepper={false} />
        <button type="submit" disabled={pending || !no.trim()} className={primary}>{pending ? "กำลังบันทึก…" : "ลงรับ"}</button>
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </form>
  );
}

function Detail({ row, accounts, closedThrough, onDone }: { row: TransferRow; accounts: AccountOption[]; closedThrough: string | null; onDone: (msg: string) => void }) {
  // แถวรอออกใบเสร็จยังไม่ลงบัญชี แก้ได้เสมอ ; แถวที่รับแล้วดูงวดของวันที่ใบเสร็จ (server ตรวจซ้ำรวมการใช้ตัดหนี้เหมาจ่าย)
  const locked = !!row.receipt_date && closedIn(row.receipt_date, closedThrough);
  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact label="จำนวนเงิน (บาท)"><span className="font-semibold"><Amount row={row} /></span></Fact>
        <Fact label="ยอดจาก SMT (บาท)"><Money value={row.smt_amount} /></Fact>
        <Fact label="บัญชี (เครดิต)"><Account code={row.account_code} name={row.account_name} stm={row.stm} /></Fact>
        <Fact label="กองทุน">{row.fund_name}</Fact>
        <Fact label="งบปี">{row.budget_year}</Fact>
        <Fact label="ที่มา">{SOURCE_LABEL[row.source]}</Fact>
        <Fact label="สถานะ"><Status status={row.status} /></Fact>
        <Fact label="ชุดโอน">{row.batch}</Fact>
        <Fact label="เลขที่ใบเสร็จ">{row.receipt_no}</Fact>
        <Fact label="วันที่ใบเสร็จ">{row.receipt_date && formatThaiDate(row.receipt_date)}</Fact>
        <Fact label="ลงรับโดย">{by(row.received_by, row.received_at)}</Fact>
        {row.unreceived_by && <Fact label="ยกเลิกการรับล่าสุดโดย">{by(row.unreceived_by, row.unreceived_at)}</Fact>}
        {row.unreceived_by && <Fact label="เหตุผลที่ยกเลิกการรับ">{row.unreceive_reason}</Fact>}
        <Fact label="หมายเหตุ">{row.note}</Fact>
        <Fact label={row.source === "smt" ? "นำเข้าโดย" : "เพิ่มโดย"}>{by(row.created_by, row.created_at)}</Fact>
        <Fact label="แก้ล่าสุดโดย">{by(row.updated_by, row.updated_at)}</Fact>
        {row.status === "cancelled" && <Fact label="ยกเลิกโดย">{by(row.cancelled_by, row.cancelled_at)}</Fact>}
        {row.status === "cancelled" && <Fact label="เหตุผลที่ยกเลิก">{row.cancel_reason}</Fact>}
      </Facts>
      {row.status !== "cancelled" &&
        (locked ? (
          <p className="text-sm text-muted">งวดของวันที่ใบเสร็จนี้ปิดแล้ว แก้หรือยกเลิกไม่ได้</p>
        ) : (
          <>
            {row.status === "pending" ? (
              <section className="flex flex-col gap-2 border-t border-line pt-4">
                <h3 className="text-sm font-semibold">ลงรับรายการนี้</h3>
                <ReceiptForm min={row.transfer_date} target={{ id: row.id }} onDone={onDone} />
              </section>
            ) : (
              <section className="flex flex-col gap-2 border-t border-line pt-4">
                <h3 className="text-sm font-semibold">ยกเลิกการรับ</h3>
                <ReasonForm
                  label="เหตุผลที่ยกเลิกการรับ"
                  submitText="ยกเลิกการรับ"
                  onSubmit={async (reason) => {
                    const r = await send("/api/fund/ar-transfer/receipt", { method: "POST", body: JSON.stringify({ action: "unreceive", id: row.id, reason }) });
                    if (!r.ok) return r.error;
                    onDone("ยกเลิกการรับแล้ว รายการกลับเป็นรอออกใบเสร็จ");
                    return null;
                  }}
                />
              </section>
            )}
            <section className="flex flex-col gap-2 border-t border-line pt-4">
              <h3 className="text-sm font-semibold">แก้รายการ</h3>
              <TransferForm
                id={`transfer-${row.id}`}
                initial={{ transfer_date: row.transfer_date, ref_doc_no: "", account_code: row.account_code, amount: String(row.amount), note: row.note ?? "", receipt_no: "", receipt_date: "" }}
                accounts={accounts}
                withRef={false}
                submitText="บันทึกการแก้ไข"
                onSubmit={async (d) => {
                  const r = await send("/api/fund/ar-transfer", { method: "PATCH", body: JSON.stringify({ id: row.id, action: "edit", ...payload(d) }) });
                  if (!r.ok) return r.error;
                  onDone("บันทึกการแก้ไขแล้ว");
                  return null;
                }}
              />
              {row.source === "smt" && <p className="text-xs text-muted">นำเข้าจาก SMT ครั้งถัดไปจะไม่ทับรายการที่แก้แล้ว</p>}
            </section>
            <section className="flex flex-col gap-2 border-t border-line pt-4">
              <h3 className="text-sm font-semibold">ยกเลิกรายการ</h3>
              <ReasonForm
                label="เหตุผลที่ยกเลิก"
                submitText="ยกเลิกรายการ"
                onSubmit={async (reason) => {
                  const r = await send("/api/fund/ar-transfer", { method: "PATCH", body: JSON.stringify({ id: row.id, action: "cancel", reason }) });
                  if (!r.ok) return r.error;
                  onDone("ยกเลิกรายการแล้ว");
                  return null;
                }}
              />
            </section>
          </>
        ))}
    </div>
  );
}

/* ---------- ยอดรับต่อบัญชีต่อเดือน ---------- */

/** current = ปีงบปัจจุบัน: แสดงคอลัมน์รอออกใบเสร็จ (ยอด ณ วันนี้ทุกปีงบ ไม่ผูกกับปีงบที่เลือก จึงไม่แสดงในปีงบก่อน) */
function SummaryTable({ data, current }: { data: ArTransferSummary; current: boolean }) {
  const byCode = new Map(data.accounts.map((a) => [a.code, a]));
  const monthTotal = (m: string) => Math.round(data.summary.reduce((s, r) => s + (r.months[m] ?? 0) * 100, 0)) / 100;
  const grand = Math.round(data.summary.reduce((s, r) => s + r.total * 100, 0)) / 100;
  const pendingGrand = Math.round(data.summary.reduce((s, r) => s + r.pending * 100, 0)) / 100;
  // 12 เดือน + รวม ต้องพอดีกรอบที่จอ 1920 (ปีงบ 2569 ล้น 88px ด้วย px-3) จึงลด padding ของคอลัมน์เดือน
  const MTH = "px-1.5 py-2.5 font-medium", MTD = "px-1.5 py-1.5";
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">ยอดรับต่อบัญชีต่อเดือน ปีงบ {data.fy} (บาท)</caption>
        <thead className="bg-surface text-left text-grid-head text-muted">
          <tr>
            <th scope="col" className={TH}>บัญชี</th>
            {data.months.map((m) => (
              <th key={m} scope="col" className={`${MTH} text-right whitespace-nowrap`}>{monthLabel(m)}</th>
            ))}
            <th scope="col" className={`${TH} text-right whitespace-nowrap`}>รวม (บาท)</th>
            {current && <th scope="col" className={`${TH} text-right`}>รอออกใบเสร็จ ณ วันนี้ (บาท)</th>}
          </tr>
        </thead>
        <tbody>
          {data.summary.map((r) => (
            <tr key={r.account_code} className="border-t border-line">
              <th scope="row" className={`${TD} text-left font-normal`}><Account code={r.account_code} name={byCode.get(r.account_code)?.name} stm={byCode.get(r.account_code)?.stm} /></th>
              {data.months.map((m) => (
                <td key={m} className={`${MTD} ${num}`}><Money value={r.months[m]} /></td>
              ))}
              <td className={`${TD} ${num} font-semibold`}>{formatBaht(r.total)}</td>
              {current && <td className={`${TD} ${num} ${r.pending ? "text-warning" : ""}`}>{r.pending ? formatBaht(r.pending) : dash}</td>}
            </tr>
          ))}
          {data.summary.length > 1 && (
            <tr className="border-t border-line bg-surface-sunken font-semibold">
              <th scope="row" className={`${TD} text-left`}>รวม</th>
              {data.months.map((m) => (
                <td key={m} className={`${MTD} ${num}`}>{data.summary.some((r) => m in r.months) ? formatBaht(monthTotal(m)) : dash}</td>
              ))}
              <td className={`${TD} ${num}`}>{formatBaht(grand)}</td>
              {current && <td className={`${TD} ${num}`}>{pendingGrand ? formatBaht(pendingGrand) : dash}</td>}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- รอออกใบเสร็จ ---------- */

const batchName = (b: PendingBatch) => (b.batch ? `ชุด ${b.batch}` : "รายการเพิ่มเอง");

/** ชุดโอนที่ยังไม่ลงรับ (ทุกปีงบ) ; กดแถวเปิด modal รายการในชุด + ฟอร์มใบเสร็จ */
function PendingReceipts({ data, onDone }: { data: ArTransferSummary; onDone: (msg: string) => void }) {
  const [openKey, setOpenKey] = useState<string>();
  const open = data.pending.find((b) => b.key === openKey);
  const total = Math.round(data.pending.reduce((s, b) => s + b.amount * 100, 0)) / 100;
  const byCode = new Map(data.accounts.map((a) => [a.code, a]));
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-title">
        รอออกใบเสร็จ
        {data.pending.length > 0 && (
          <span className="ml-2 text-sm font-normal text-warning tabular-nums">
            {formatCount(data.pending.length)} ชุด · {formatBaht(total)} บาท
          </span>
        )}
      </h2>
      {data.pending.length === 0 ? (
        <p className="text-sm text-muted">ลงรับครบทุกชุดแล้ว</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">ชุดโอนที่รอออกใบเสร็จ (บาท)</caption>
            <thead className="bg-surface text-left text-grid-head text-muted">
              <tr>
                <th scope="col" className={TH}>วันที่โอน</th>
                <th scope="col" className={TH}>ชุดโอน</th>
                <th scope="col" className={`${TH} text-right`}>รายการ</th>
                <th scope="col" className={TH}>เลขที่เอกสาร</th>
                <th scope="col" className={`${TH} text-right whitespace-nowrap`}>ยอดสุทธิของชุด (บาท)</th>
                <th scope="col" className={TH}><span className="sr-only">ลงรับ</span></th>
              </tr>
            </thead>
            <tbody>
              {data.pending.map((b) => (
                <tr key={b.key} className="border-t border-line align-middle">
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{formatThaiDate(b.transfer_date)}</td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>
                    {b.batch ?? <span className="text-muted">เพิ่มเอง</span>}
                    {b.batch_receipt_no && <span className="block text-grid-sub text-warning">รับแล้วบางรายการ · {b.batch_receipt_no}</span>}
                  </td>
                  <td className={`${TD} ${num}`}>{formatCount(b.n)}</td>
                  <td className={TD}>
                    {b.lines[0].ref_doc_no || b.lines[0].fund_name || dash}
                    {b.n > 1 && <span className="text-muted"> และอีก {formatCount(b.n - 1)} รายการ</span>}
                  </td>
                  <td className={`${TD} ${num} font-semibold`}>{formatBaht(b.amount)}</td>
                  <td className={`${TD} text-right`}>
                    <button type="button" className={btn} onClick={() => setOpenKey(b.key)} aria-label={`ลงรับ${batchName(b)} วันที่โอน ${formatThaiDate(b.transfer_date)}`}>
                      ลงรับ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DetailModal
        open={!!open}
        onClose={() => setOpenKey(undefined)}
        size="medium"
        title={open && <>{batchName(open)} <span className="font-normal text-muted">โอน {formatThaiDate(open.transfer_date)}</span></>}
      >
        {open && (
          <div className="flex flex-col gap-5">
            <Facts>
              <Fact label="ยอดสุทธิของชุด (บาท)"><span className="font-semibold">{formatBaht(open.amount)}</span></Fact>
              <Fact label="จำนวนรายการ">{formatCount(open.n)}</Fact>
              {open.batch_receipt_no && <Fact label="ลงรับไปแล้วบางรายการ"><span className="text-warning">ใบเสร็จ {open.batch_receipt_no}</span></Fact>}
            </Facts>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">รายการในชุด (บาท)</caption>
                <thead className="bg-surface text-left text-grid-head text-muted">
                  <tr>
                    <th scope="col" className={TH}>เลขที่เอกสาร</th>
                    <th scope="col" className={TH}>กองทุน</th>
                    <th scope="col" className={TH}>บัญชี (เครดิต)</th>
                    <th scope="col" className={`${TH} text-right whitespace-nowrap`}>จำนวนเงิน (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  {open.lines.map((l) => (
                    <tr key={l.id} className="border-t border-line align-top">
                      <td className={TD}>{l.ref_doc_no || dash}</td>
                      <td className={TD}>{l.fund_name || dash}</td>
                      <td className={TD}><Account code={l.account_code} name={byCode.get(l.account_code)?.name} stm={byCode.get(l.account_code)?.stm} /></td>
                      <td className={`${TD} ${num}`}>{formatBaht(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <section className="flex flex-col gap-2 border-t border-line pt-4">
              <h3 className="text-sm font-semibold">ใบเสร็จ</h3>
              <ReceiptForm
                key={open.key}
                min={open.transfer_date}
                target={open.batch ? { transfer_date: open.transfer_date, batch: open.batch } : { id: open.lines[0].id }}
                onDone={(msg) => {
                  setOpenKey(undefined);
                  onDone(msg);
                }}
              />
            </section>
          </div>
        )}
      </DetailModal>
    </section>
  );
}

/* ---------- กองทุนใน SMT ---------- */

const SIDE_LABEL = { OP: "ผู้ป่วยนอก (OP)", IP: "ผู้ป่วยใน (IP)" } as const;
/** แถว OP/IP ที่ยังไม่ตั้งบัญชีหรือไม่ใช้ = ใช้ตามแถว ALL (findMapping ใน transfer.ts) */
const inherits = (f: FundMapRow) => f.side !== "ALL" && !f.account_code && !f.ignore;

/** บัญชีที่ใช้ของแถว mapping */
function UsedAccount({ f, accounts }: { f: FundMapRow; accounts: AccountOption[] }) {
  if (f.ignore) return <span className="text-muted">ไม่ใช้</span>;
  const acc = accounts.find((a) => a.code === f.account_code);
  if (f.account_code) return <Account code={f.account_code} name={acc?.name} stm={acc?.stm} />;
  return inherits(f) ? <span className="text-muted">ใช้ตามบัญชีของกองทุน</span> : <span className="text-warning">ยังไม่จับคู่</span>;
}

/** รายการโอนจริงจาก SMT ของกองทุนในปีงบ (โหลดตอนเปิด modal) ; group = แถว ALL + แถว OP/IP ของกองทุน */
function FundDetailBody({ group, fy, accounts }: { group: FundMapRow[]; fy: number; accounts: AccountOption[] }) {
  const f = group[0];
  const r = useJson<FundDetailResult>(`/api/fund/ar-transfer/fund-detail?${new URLSearchParams({ fy: String(fy), fund_key: f.fund_key })}`);
  if (r.error) return <Notice title={r.error} action={<button type="button" className={btn} onClick={r.retry}>ลองอีกครั้ง</button>} />;
  if (!r.data) return <Skeleton rows={6} />;
  const d = r.data;
  const prior = d.lines.some((l) => l.prior_year && l.paid);
  const split = d.sides.length > 0;
  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact label="โอนแล้ว (รายการ)">{formatCount(d.n)}</Fact>
        <Fact label="ยอดโอนสุทธิ (บาท)"><span className="font-semibold">{formatBaht(d.total)}</span></Fact>
        {d.sides.map((s) => (
          <Fact key={s.side ?? "none"} label={`${s.side ? SIDE_LABEL[s.side] : "ไม่ระบุ OP/IP"} (บาท)`}>
            {formatBaht(s.total)} <span className="text-muted">· {formatCount(s.n)} รายการ</span>
          </Fact>
        ))}
        {d.years.map((y) => (
          <Fact key={y.budget_year ?? "none"} label={`งบปี ${y.budget_year ?? "ไม่ระบุ"} (บาท)`}>
            {formatBaht(y.total)} <span className="text-muted">· {formatCount(y.n)} รายการ</span>
          </Fact>
        ))}
        {d.pending > 0 && (
          <Fact label="รอโอน ไม่นับในยอด (บาท)">
            {formatBaht(d.pending_total)} <span className="text-muted">· {formatCount(d.pending)} รายการ</span>
          </Fact>
        )}
        <Fact label="บัญชีที่ SMT ระบุ"><Account code={f.fund_key.split("|")[1] || null} name={f.smt_account_name} /></Fact>
        {group.map((g) => (
          <Fact key={g.side} label={g.side === "ALL" ? "บัญชีที่ใช้ (เครดิต)" : `บัญชีที่ใช้ ${g.side}`}>
            <UsedAccount f={g} accounts={accounts} />
          </Fact>
        ))}
      </Facts>
      {prior && <p className="text-sm text-muted">รายการงบปีก่อนวันโอนลงบัญชี {PRIOR_YEAR_ACCOUNT.code} เมื่อนำเข้า ไม่ใช่บัญชีที่จับคู่</p>}
      {d.lines.length === 0 ? (
        <Notice title={`ไม่มีรายการโอนของกองทุนนี้ในปีงบ ${d.fy}`} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">รายการโอนจาก SMT ปีงบ {d.fy} (บาท)</caption>
            <thead className="bg-surface text-left text-grid-head text-muted">
              <tr>
                <th scope="col" className={TH}>วันที่โอน</th>
                <th scope="col" className={TH}>เลขที่เอกสาร</th>
                {split && <th scope="col" className={TH}>OP/IP</th>}
                <th scope="col" className={TH}>งบปี</th>
                <th scope="col" className={TH}>กองทุนย่อย</th>
                <th scope="col" className={`${TH} text-right whitespace-nowrap`}>ยอดก่อนหัก (บาท)</th>
                <th scope="col" className={`${TH} text-right whitespace-nowrap`}>ชะลอ/หักหนี้ (บาท)</th>
                <th scope="col" className={`${TH} text-right whitespace-nowrap`}>ยอดโอนสุทธิ (บาท)</th>
                <th scope="col" className={TH}>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={`${l.date}|${l.batch_no}|${l.ref_doc_no}|${l.mou_grp_code}`} className={`border-t border-line align-top ${l.paid ? "" : "text-muted"}`}>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{formatThaiDate(l.date)}</td>
                  <td className={TD}>
                    {l.ref_doc_no || dash}
                    <span className="block text-grid-sub whitespace-nowrap text-subtle tabular-nums">batch {l.batch_no}{l.count ? ` · ${formatCount(l.count)} รายการย่อย` : ""}</span>
                  </td>
                  {split && <td className={`${TD} whitespace-nowrap`}>{l.side ?? dash}</td>}
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>
                    {l.budget_year ?? dash}
                    {l.prior_year && (
                      <span title={`ลงบัญชี ${PRIOR_YEAR_ACCOUNT.code} เมื่อนำเข้า`} className="ml-1.5 rounded border border-warning-line bg-warning-soft px-1 text-xs text-warning">งบปีก่อน</span>
                    )}
                    <span className="block text-grid-sub text-subtle">{l.mou_grp_code}</span>
                  </td>
                  <td className={TD}>
                    {l.fund || dash}
                    {l.group && <span className="block text-grid-sub text-subtle">{l.group}</span>}
                  </td>
                  <td className={`${TD} ${num}`}>{formatBaht(l.amount)}</td>
                  <td className={`${TD} ${num}`} title={`ชะลอจ่าย ${formatBaht(l.wait)} · หักหนี้ ${formatBaht(l.debt)}`}>{formatBaht(l.wait + l.debt)}</td>
                  <td className={`${TD} ${num} font-semibold`}>{formatBaht(l.total)}</td>
                  <td className={`${TD} whitespace-nowrap`}>{l.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** แถวของ mapping หนึ่งแถว ; group = แถว ALL + OP/IP ของกองทุน (แถว ALL เปิด modal ได้ แถว OP/IP เป็นแถวย่อย) */
function FundRow({ f, group, fy, accounts, admin, onSaved }: { f: FundMapRow; group: FundMapRow[]; fy: number; accounts: AccountOption[]; admin: boolean; onSaved: () => void }) {
  const smtCode = f.fund_key.split("|")[1] || null;
  const all = f.side === "ALL";
  const split = group.length > 1;
  const name = f.fund_name || f.fund_key;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(f.account_code ?? (all ? smtCode : null) ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const save = (account_code: string | null, ignore: boolean) => {
    setError(undefined);
    startTransition(async () => {
      const r = await send("/api/fund/ar-transfer/fund-map", { method: "POST", body: JSON.stringify({ fund_key: f.fund_key, side: f.side, account_code, ignore }) });
      if (!r.ok) return setError(r.error);
      setEditing(false);
      onSaved();
    });
  };
  const bad = code !== "" && !ACCOUNT_RE.test(code.trim());
  const pickerId = `fund-${f.side}-${f.fund_key.replace(/[^0-9A-Za-z]/g, "-")}`;
  const target = all ? name : `${name} ${f.side}`;
  return (
    <tr className={`align-top ${all ? "border-t border-line" : "border-t border-dashed border-line"}`}>
      <td className={TD}>
        {all ? (
          <>
            <button type="button" onClick={() => setOpen(true)} className={`rounded text-left font-medium text-accent-text hover:underline ${focusRing}`} aria-label={`ดูรายการโอนของ ${name}`}>
              {name}
            </button>
            <span className="block text-grid-sub text-subtle tabular-nums">{f.fund_key}</span>
            {split && <span className="block text-grid-sub text-subtle">บัญชีนี้ใช้กับรายการที่ไม่ระบุ OP/IP และฝั่งที่ไม่ได้แยก</span>}
            <DetailModal
              open={open}
              onClose={() => setOpen(false)}
              size="wide"
              title={<>{f.fund_name || "กองทุน"} <span className="font-normal text-muted tabular-nums">{f.fund_key} · ปีงบ {fy}</span></>}
            >
              <div className="flex flex-col gap-5">
                <FundDetailBody group={group} fy={fy} accounts={accounts} />
                {admin && (
                  <div className="flex justify-end border-t border-line pt-4">
                    <button
                      type="button"
                      className={btn}
                      onClick={() => {
                        setOpen(false);
                        setEditing(true);
                      }}
                    >
                      จับคู่บัญชี
                    </button>
                  </div>
                )}
              </div>
            </DetailModal>
          </>
        ) : (
          <span className="block pl-4 text-muted">{SIDE_LABEL[f.side as "OP" | "IP"]}</span>
        )}
      </td>
      <td className={TD}>{all ? <Account code={smtCode} name={f.smt_account_name} /> : null}</td>
      <td className={TD}>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!bad && code.trim()) save(code.trim(), false);
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <AccountPicker id={pickerId} accounts={accounts} value={code} invalid={bad} onChange={setCode} />
            <button type="submit" disabled={pending || bad || !code.trim()} className={primary}>บันทึก</button>
            <button type="button" disabled={pending} onClick={() => save(null, true)} className={btn}>{all ? "ไม่ใช้กองทุนนี้" : `ไม่ใช้ฝั่ง ${f.side}`}</button>
            {!all && !inherits(f) && <button type="button" disabled={pending} onClick={() => save(null, false)} className={btn}>ใช้ตามบัญชีของกองทุน</button>}
            <button type="button" disabled={pending} onClick={() => setEditing(false)} className={btn}>ยกเลิก</button>
          </form>
        ) : (
          <UsedAccount f={f} accounts={accounts} />
        )}
        {error && <p role="alert" className="mt-1 text-danger">{error}</p>}
      </td>
      {admin && (
        <td className={`${TD} text-right`}>
          {!editing && (
            <button type="button" onClick={() => setEditing(true)} className={btn} aria-label={`จับคู่บัญชีของ ${target}`}>
              {all ? "จับคู่บัญชี" : `จับคู่ ${f.side}`}
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

function FundMap({ data, onSaved }: { data: ArTransferSummary; onSaved: () => void }) {
  const unmapped = data.funds.filter((f) => f.side === "ALL" && !f.account_code && !f.ignore).length;
  const groups = new Map<string, FundMapRow[]>(); // FUNDS_SQL เรียง ALL ก่อน OP/IP ของกองทุนเดียวกัน
  for (const f of data.funds) groups.set(f.fund_key, [...(groups.get(f.fund_key) ?? []), f]);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-title">
        กองทุนใน SMT
        {unmapped > 0 && <span className="ml-2 text-sm font-normal text-warning">ยังไม่จับคู่ {formatCount(unmapped)} กองทุน</span>}
      </h2>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface text-left text-grid-head text-muted">
            <tr>
              <th scope="col" className={TH}>กองทุน</th>
              <th scope="col" className={TH}>บัญชีที่ SMT ระบุ</th>
              <th scope="col" className={TH}>บัญชีที่ใช้ (เครดิต)</th>
              {data.admin && <th scope="col" className={TH}><span className="sr-only">จัดการ</span></th>}
            </tr>
          </thead>
          <tbody>
            {data.funds.map((f) => (
              <FundRow key={`${f.fund_key}|${f.side}|${f.account_code}|${f.ignore}`} f={f} group={groups.get(f.fund_key) ?? [f]} fy={data.fy} accounts={data.accounts} admin={data.admin} onSaved={onSaved} />
            ))}
          </tbody>
        </table>
      </div>
      {data.admin && unmapped > 0 && <p className="text-xs text-muted">จับคู่แล้วกดดึงจาก SMT อีกครั้งเพื่อนำเข้ารายการของกองทุนนั้น</p>}
    </section>
  );
}

/* ---------- ดึงจาก SMT ---------- */

const COUNT_TEXT: [keyof ImportCounts, string][] = [
  ["new", "เพิ่มใหม่ (รอออกใบเสร็จ)"], ["updated", "อัปเดตตาม SMT"], ["unchanged", "เหมือนเดิม"], ["kept", "แก้/ยกเลิก/รับแล้ว ไม่ทับ"],
  ["unmapped", "กองทุนยังไม่จับคู่"], ["ignored", "กองทุนที่ไม่ใช้"], ["pending", "รอโอน"],
];

function ImportSummary({ r }: { r: ImportResult }) {
  return (
    <div role="status" className="flex flex-col gap-1 text-sm">
      <p className="tabular-nums">
        ดึงจาก SMT ปีงบ {r.fy} <span className="font-semibold">{formatCount(r.fetched)}</span> รายการ
        {COUNT_TEXT.filter(([k]) => k === "new" || r.counts[k] > 0).map(([k, label]) => (
          <span key={k} className={k === "unmapped" ? "text-warning" : "text-muted"}>
            <span aria-hidden="true"> · </span>
            {label} <span className="font-semibold text-foreground">{formatCount(r.counts[k])}</span>
          </span>
        ))}
      </p>
      {r.unmapped.length > 0 && (
        <ul className="text-muted tabular-nums">
          {r.unmapped.map((u) => (
            <li key={u.fund_key}>
              {u.fund_name || u.fund_key} {formatCount(u.n)} รายการ {formatBaht(u.total)} บาท
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- หน้า ---------- */

export function ArTransfer() {
  usePersistedFilter("fund/ar-transfer", FILTER_KEYS);
  const { fy, set } = useUrlParams(FILTER_KEYS);
  const currentFy = fiscalYearOf(todayIso());
  const fyValue = fy || String(currentFy);
  const fyOptions = Array.from({ length: FY_BACK + 1 }, (_, i) => currentFy - i);
  const meta = useJson<ArTransferSummary>(`/api/fund/ar-transfer/summary?${new URLSearchParams({ fy: fyValue })}`);
  const [shown, setShown] = useState<ArTransferSummary>();
  if (meta.data && meta.data !== shown) setShown(meta.data);
  const [gridKey, setGridKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [importing, startImport] = useTransition();
  const [message, setMessage] = useState<{ fy: string; ok: boolean; node: ReactNode }>();

  const refresh = () => {
    meta.retry();
    setGridKey((k) => k + 1); // remount ให้ตารางโหลดใหม่ (ปิด modal รายละเอียดด้วย)
  };
  const done = (text: string) => {
    setMessage({ fy: fyValue, ok: true, node: text });
    refresh();
  };
  const runImport = () =>
    startImport(async () => {
      setMessage(undefined);
      const r = await send<ImportResult>(`/api/fund/ar-transfer/import?${new URLSearchParams({ fy: fyValue })}`, { method: "POST" });
      setMessage({ fy: fyValue, ok: r.ok, node: r.ok ? <ImportSummary r={r.body} /> : r.error });
      if (r.ok) refresh();
    });

  const d = shown;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title text-balance">{TITLE}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">ปีงบ</span>
            <select value={fyValue} onChange={(e) => set({ fy: e.target.value })} className={SELECT_CLASS}>
              {fyOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setAdding((a) => !a)} aria-expanded={adding} className={`${btn} gap-1.5`}>
            <Plus aria-hidden="true" className="size-4" />
            เพิ่มเอง
          </button>
          <button type="button" onClick={runImport} disabled={importing} className={primary}>
            <Download aria-hidden="true" className={`size-4 ${importing ? "motion-safe:animate-pulse" : ""}`} />
            {importing ? "กำลังดึง…" : "ดึงจาก SMT"}
          </button>
        </div>
      </div>

      {message?.fy === fyValue &&
        (message.ok ? message.node : <p role="alert" className="text-sm text-danger">{message.node}</p>)}

      {adding && d && (
        <section className="flex flex-col gap-2 rounded-lg border border-line p-4">
          <h2 className="text-title">เพิ่มรายการเอง</h2>
          <TransferForm
            id="transfer-new"
            initial={{ transfer_date: todayIso(), ref_doc_no: "", account_code: "", amount: "", note: "", receipt_no: "", receipt_date: todayIso() }}
            accounts={d.accounts}
            withRef
            submitText="เพิ่มรายการ"
            onSubmit={async (x) => {
              const receipt = x.receipt_no.trim() ? { receipt_no: x.receipt_no, receipt_date: x.receipt_date } : {};
              if (x.receipt_no.trim() && closedIn(x.receipt_date, d.closed_through)) return `งวดถึงเดือน ${d.closed_through} ปิดแล้ว เลือกวันที่ใบเสร็จในงวดที่เปิด`;
              const r = await send("/api/fund/ar-transfer", { method: "POST", body: JSON.stringify({ ...payload(x), ref_doc_no: x.ref_doc_no, ...receipt }) });
              if (!r.ok) return r.error;
              setAdding(false);
              done("เพิ่มรายการแล้ว");
              return null;
            }}
          />
        </section>
      )}

      {meta.error && !d ? (
        <Notice title={`โหลดข้อมูลไม่สำเร็จ: ${meta.error}`} action={<button type="button" className={btn} onClick={meta.retry}>ลองอีกครั้ง</button>} />
      ) : !d ? (
        <Skeleton rows={4} />
      ) : (
        <div aria-busy={meta.loading} className={`flex flex-col gap-5 transition-opacity duration-200 ${meta.loading ? "opacity-60" : ""}`}>
          <PendingReceipts data={d} onDone={done} />
          <section className="flex flex-col gap-2">
            <h2 className="text-title">ยอดรับต่อบัญชีตามวันที่ใบเสร็จ ปีงบ {d.fy}</h2>
            <SummaryTable data={d} current={d.fy === currentFy} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-title">รายการโอนตามวันที่โอน ปีงบ {d.fy}</h2>
            <DataGrid<TransferRow>
              key={gridKey}
              endpoint="/api/fund/ar-transfer"
              filterKeys={FILTER_KEYS}
              columns={COLUMNS}
              getRowId={(r) => r.id}
              renderDetail={(r) => <Detail row={r} accounts={d.accounts} closedThrough={d.closed_through} onDone={done} />}
              detailTitle={(r) => (
                <>
                  {r.ref_doc_no || "รายการโอน"} <span className="font-normal text-muted">{formatThaiDate(r.transfer_date)}</span>
                </>
              )}
              detailSize="medium"
            />
          </section>
          <FundMap data={d} onSaved={meta.retry} />
        </div>
      )}
    </div>
  );
}
