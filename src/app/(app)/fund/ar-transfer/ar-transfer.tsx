"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Download, Plus } from "lucide-react";
import { AccountPicker, type AccountOption } from "@/components/account-picker/account-picker";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { ThaiDatePicker } from "@/components/thai-date-picker/thai-date-picker";
import { formatBaht, formatCount } from "@/lib/number-format";
import { usePersistedFilter } from "@/lib/persisted-filter";
import { THAI_MONTHS_SHORT, formatThaiDate, todayIso } from "@/lib/thai-date";
import { FY_BACK, fiscalYearOf } from "@/app/api/fund/uc-dashboard/dashboard";
import { LEDGER_START } from "@/app/api/fund/ar-sync/ledger";
import type { TransferRow, TransferStatus, FundMapRow } from "@/app/api/fund/ar-transfer/data";
import type { ArTransferSummary } from "@/app/api/fund/ar-transfer/summary/route";
import type { ImportResult } from "@/app/api/fund/ar-transfer/import/route";
import { ACCOUNT_RE, MAX_NOTE, SOURCE_LABEL, STATUS_LABEL, type ImportCounts } from "@/app/api/fund/ar-transfer/transfer";
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
  active: "border-success-line bg-success-soft text-success",
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

const Account = ({ code, name }: { code: string | null; name?: string | null }) =>
  code ? (
    <>
      <span className="whitespace-nowrap tabular-nums">{code}</span>
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
  col.accessor("account_code", { header: "บัญชี", cell: (c) => <Account code={c.getValue()} name={c.row.original.account_name} />, meta: { filter: true } }),
  col.accessor("amount", { header: "จำนวนเงิน (บาท)", cell: (c) => <Amount row={c.row.original} />, meta: { className: num } }),
  col.accessor("source", { header: "ที่มา", cell: (c) => SOURCE_LABEL[c.getValue()], meta: { filter: { format: (v) => SOURCE_LABEL[v as TransferRow["source"]] ?? v } } }),
  col.accessor("note", { header: "หมายเหตุ", cell: (c) => c.getValue() || dash, enableSorting: false }),
  col.accessor("status", { header: "สถานะ", cell: (c) => <Status status={c.getValue()} />, meta: { filter: { format: (v) => STATUS_LABEL[v as TransferStatus] ?? v } } }),
]);

const by = (name: string | null, at: string | null) => (name ? `${name}${at ? ` · ${formatThaiDate(at)} ${at.slice(11, 16)} น.` : ""}` : null);
const closedIn = (date: string, through: string | null) => !!through && date.slice(0, 7) <= through;

/* ---------- ฟอร์มรายการ (เพิ่มเอง/แก้) ---------- */

type Draft = { transfer_date: string; ref_doc_no: string; account_code: string; amount: string; note: string };

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
        <button type="submit" disabled={pending} className={primary}>{pending ? "กำลังบันทึก…" : submitText}</button>
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </form>
  );
}

const payload = (d: Draft) => ({ transfer_date: d.transfer_date, account_code: d.account_code.trim(), amount: Number(d.amount), note: d.note });

function CancelForm({ id, onDone }: { id: string; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(undefined);
        startTransition(async () => {
          const r = await send("/api/fund/ar-transfer", { method: "PATCH", body: JSON.stringify({ id, action: "cancel", reason }) });
          if (!r.ok) return setError(r.error);
          onDone("ยกเลิกรายการแล้ว");
        });
      }}
      className="flex flex-col gap-2 text-sm"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-muted">เหตุผลที่ยกเลิก</span>
          <input required maxLength={MAX_NOTE} value={reason} onChange={(e) => setReason(e.target.value)} className={`${FIELD} min-w-56`} />
        </label>
        <button type="submit" disabled={pending || !reason.trim()} className={`${btn} border-danger-line text-danger disabled:opacity-60`}>{pending ? "กำลังยกเลิก…" : "ยกเลิกรายการ"}</button>
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </form>
  );
}

function Detail({ row, accounts, closedThrough, onDone }: { row: TransferRow; accounts: AccountOption[]; closedThrough: string | null; onDone: (msg: string) => void }) {
  const locked = closedIn(row.transfer_date, closedThrough);
  return (
    <div className="flex flex-col gap-5">
      <Facts>
        <Fact label="จำนวนเงิน (บาท)"><span className="font-semibold"><Amount row={row} /></span></Fact>
        <Fact label="ยอดจาก SMT (บาท)"><Money value={row.smt_amount} /></Fact>
        <Fact label="บัญชี (เครดิต)"><Account code={row.account_code} name={row.account_name} /></Fact>
        <Fact label="กองทุน">{row.fund_name}</Fact>
        <Fact label="งบปี">{row.budget_year}</Fact>
        <Fact label="ที่มา">{SOURCE_LABEL[row.source]}</Fact>
        <Fact label="สถานะ"><Status status={row.status} /></Fact>
        <Fact label="หมายเหตุ">{row.note}</Fact>
        <Fact label={row.source === "smt" ? "นำเข้าโดย" : "เพิ่มโดย"}>{by(row.created_by, row.created_at)}</Fact>
        <Fact label="แก้ล่าสุดโดย">{by(row.updated_by, row.updated_at)}</Fact>
        {row.status === "cancelled" && <Fact label="ยกเลิกโดย">{by(row.cancelled_by, row.cancelled_at)}</Fact>}
        {row.status === "cancelled" && <Fact label="เหตุผลที่ยกเลิก">{row.cancel_reason}</Fact>}
      </Facts>
      {row.status === "active" &&
        (locked ? (
          <p className="text-sm text-muted">งวดของวันที่โอนนี้ปิดแล้ว แก้หรือยกเลิกไม่ได้</p>
        ) : (
          <>
            <section className="flex flex-col gap-2 border-t border-line pt-4">
              <h3 className="text-sm font-semibold">แก้รายการ</h3>
              <TransferForm
                id={`transfer-${row.id}`}
                initial={{ transfer_date: row.transfer_date, ref_doc_no: "", account_code: row.account_code, amount: String(row.amount), note: row.note ?? "" }}
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
              <CancelForm id={row.id} onDone={onDone} />
            </section>
          </>
        ))}
    </div>
  );
}

/* ---------- ยอดรับต่อบัญชีต่อเดือน ---------- */

function SummaryTable({ data }: { data: ArTransferSummary }) {
  const names = new Map(data.accounts.map((a) => [a.code, a.name]));
  const monthTotal = (m: string) => Math.round(data.summary.reduce((s, r) => s + (r.months[m] ?? 0) * 100, 0)) / 100;
  const grand = Math.round(data.summary.reduce((s, r) => s + r.total * 100, 0)) / 100;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">ยอดรับต่อบัญชีต่อเดือน ปีงบ {data.fy} (บาท)</caption>
        <thead className="bg-surface text-left text-grid-head text-muted">
          <tr>
            <th scope="col" className={TH}>บัญชี</th>
            {data.months.map((m) => (
              <th key={m} scope="col" className={`${TH} text-right whitespace-nowrap`}>{monthLabel(m)}</th>
            ))}
            <th scope="col" className={`${TH} text-right whitespace-nowrap`}>รวม (บาท)</th>
          </tr>
        </thead>
        <tbody>
          {data.summary.map((r) => (
            <tr key={r.account_code} className="border-t border-line">
              <th scope="row" className={`${TD} text-left font-normal`}><Account code={r.account_code} name={names.get(r.account_code)} /></th>
              {data.months.map((m) => (
                <td key={m} className={`${TD} ${num}`}><Money value={r.months[m]} /></td>
              ))}
              <td className={`${TD} ${num} font-semibold`}>{formatBaht(r.total)}</td>
            </tr>
          ))}
          {data.summary.length > 1 && (
            <tr className="border-t border-line bg-surface-sunken font-semibold">
              <th scope="row" className={`${TD} text-left`}>รวม</th>
              {data.months.map((m) => (
                <td key={m} className={`${TD} ${num}`}>{data.summary.some((r) => m in r.months) ? formatBaht(monthTotal(m)) : dash}</td>
              ))}
              <td className={`${TD} ${num}`}>{formatBaht(grand)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- กองทุนใน SMT ---------- */

function FundRow({ f, accounts, admin, onSaved }: { f: FundMapRow; accounts: AccountOption[]; admin: boolean; onSaved: () => void }) {
  const smtCode = f.fund_key.split("|")[1] || null;
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(f.account_code ?? smtCode ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const save = (account_code: string | null, ignore: boolean) => {
    setError(undefined);
    startTransition(async () => {
      const r = await send("/api/fund/ar-transfer/fund-map", { method: "POST", body: JSON.stringify({ fund_key: f.fund_key, account_code, ignore }) });
      if (!r.ok) return setError(r.error);
      setEditing(false);
      onSaved();
    });
  };
  const bad = code !== "" && !ACCOUNT_RE.test(code.trim());
  const pickerId = `fund-${f.fund_key.replace(/[^0-9A-Za-z]/g, "-")}`;
  return (
    <tr className="border-t border-line align-top">
      <td className={TD}>
        {f.fund_name || dash}
        <span className="block text-grid-sub text-subtle tabular-nums">{f.fund_key}</span>
      </td>
      <td className={TD}><Account code={smtCode} name={f.smt_account_name} /></td>
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
            <button type="button" disabled={pending} onClick={() => save(null, true)} className={btn}>ไม่ใช้กองทุนนี้</button>
            <button type="button" disabled={pending} onClick={() => setEditing(false)} className={btn}>ยกเลิก</button>
          </form>
        ) : f.ignore ? (
          <span className="text-muted">ไม่ใช้</span>
        ) : f.account_code ? (
          <Account code={f.account_code} name={accounts.find((a) => a.code === f.account_code)?.name} />
        ) : (
          <span className="text-warning">ยังไม่จับคู่</span>
        )}
        {error && <p role="alert" className="mt-1 text-danger">{error}</p>}
      </td>
      {admin && (
        <td className={`${TD} text-right`}>
          {!editing && (
            <button type="button" onClick={() => setEditing(true)} className={btn} aria-label={`จับคู่บัญชีของ ${f.fund_name ?? f.fund_key}`}>
              จับคู่บัญชี
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

function FundMap({ data, onSaved }: { data: ArTransferSummary; onSaved: () => void }) {
  const unmapped = data.funds.filter((f) => !f.account_code && !f.ignore).length;
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
              <FundRow key={`${f.fund_key}|${f.account_code}|${f.ignore}`} f={f} accounts={data.accounts} admin={data.admin} onSaved={onSaved} />
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
  ["new", "เพิ่มใหม่"], ["updated", "อัปเดตตาม SMT"], ["unchanged", "เหมือนเดิม"], ["kept", "แก้/ยกเลิกแล้ว ไม่ทับ"],
  ["unmapped", "กองทุนยังไม่จับคู่"], ["ignored", "กองทุนที่ไม่ใช้"], ["pending", "รอโอน"], ["closed", "อยู่ในงวดที่ปิดแล้ว"],
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
            <span className="text-muted">ปีงบ (วันที่โอน)</span>
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
            initial={{ transfer_date: todayIso(), ref_doc_no: "", account_code: "", amount: "", note: "" }}
            accounts={d.accounts}
            withRef
            submitText="เพิ่มรายการ"
            onSubmit={async (x) => {
              if (closedIn(x.transfer_date, d.closed_through)) return `งวดถึงเดือน ${d.closed_through} ปิดแล้ว เลือกวันที่ในงวดที่เปิด`;
              const r = await send("/api/fund/ar-transfer", { method: "POST", body: JSON.stringify({ ...payload(x), ref_doc_no: x.ref_doc_no }) });
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
          <section className="flex flex-col gap-2">
            <h2 className="text-title">ยอดรับต่อบัญชี ปีงบ {d.fy}</h2>
            <SummaryTable data={d} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-title">รายการโอน</h2>
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
