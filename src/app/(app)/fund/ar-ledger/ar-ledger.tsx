"use client";

import { useState, useTransition, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import type { GridPage } from "@/lib/grid-query";
import { formatBaht, formatCount } from "@/lib/number-format";
import { THAI_MONTHS_SHORT, formatThaiDate } from "@/lib/thai-date";
import { Money, Notice, Skeleton, btn, focusRing, num, useJson, useUrlParams } from "../_components/ui";
import { DebtorItems, Fact, Facts } from "../uc-debtor/uc-debtor-detail";
import { fiscalYearOf } from "@/app/api/fund/uc-dashboard/dashboard";
import { KIND_LABEL } from "@/app/api/fund/ar-sync/ledger";
import type { AccountBalance, ArLedgerSummary } from "@/app/api/fund/ar-ledger/route";
import type { LedgerEntry } from "@/app/api/fund/ar-ledger/entries/route";
import type { SyncLog } from "@/app/api/fund/ar-sync/sync";

const TITLE = "ลูกหนี้ตามผังบัญชี";
const NONE = "none";
const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium ${focusRing}`;
const BALANCE_COLS = [
  ["opening", "ยกมา"],
  ["increase", "ตั้งเพิ่ม"],
  ["decrease", "ลดหนี้"],
  ["closing", "คงเหลือ"],
] as const;

const monthLabel = (m: string) => `${THAI_MONTHS_SHORT[+m.slice(5, 7) - 1]} ${+m.slice(0, 4) + 543}`;
/** "YYYY-MM-DD HH:MI" -> "9 พ.ย. 2569 14:05 น." */
const thaiDateTime = (s: string) => `${formatThaiDate(s)} ${s.slice(11, 16)} น.`;
const accountKey = (r: Pick<AccountBalance, "code">) => r.code ?? NONE;

/** เดือนแบ่งกลุ่มตามปีงบ (ใหม่ไปเก่า) */
function groupByFiscalYear(months: string[]) {
  const groups = new Map<number, string[]>();
  for (const m of months) {
    const fy = fiscalYearOf(`${m}-01`);
    groups.set(fy, [...(groups.get(fy) ?? []), m]);
  }
  return [...groups];
}

function syncResult(log: SyncLog) {
  const c = log.counts;
  const n = (k: string) => formatCount(c[k] ?? 0);
  return `ตั้งหนี้ใหม่ OPD ${n("opd_set")} IPD ${n("ipd_set")} · ปรับปรุง ${formatCount((c.opd_adjust ?? 0) + (c.ipd_adjust ?? 0))} · ยกเลิก ${n("opd_cancel")} · กลับรายการ ${n("ipd_reverse")}`;
}

function SyncButton({ onDone }: { onDone: (log: SyncLog | null, error?: string) => void }) {
  const [pending, startTransition] = useTransition();
  function sync() {
    startTransition(async () => {
      const res = await fetch("/api/fund/ar-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "daily" }),
      }).catch(() => null);
      const body = await res?.json().catch(() => null);
      if (!res?.ok) onDone(body?.id ? body : null, body?.error ?? `ดึงยอดไม่สำเร็จ${res ? ` (HTTP ${res.status})` : ""}`);
      else onDone(body);
    });
  }
  return (
    <button type="button" onClick={sync} disabled={pending} className={`${btn} gap-1.5 disabled:cursor-wait disabled:opacity-60`}>
      <RefreshCw aria-hidden className={`size-4 ${pending ? "animate-spin motion-reduce:animate-none" : ""}`} />
      {pending ? "กำลังดึงยอด…" : "ดึงยอดล่าสุด"}
    </button>
  );
}

function BalanceTable({ data, selected, onSelect }: { data: ArLedgerSummary; selected: string; onSelect: (key: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">ยอดลูกหนี้ตามรหัสบัญชี งวด {monthLabel(data.month)} (บาท)</caption>
        <thead className="bg-surface text-left text-grid-head text-muted">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-medium">บัญชี</th>
            {BALANCE_COLS.map(([k, label]) => (
              <th key={k} scope="col" className={`px-3 py-2.5 font-medium ${num}`}>
                {label} (บาท)
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => {
            const key = accountKey(r);
            const isSelected = key === selected;
            return (
              <tr key={key} className={`border-t border-line ${isSelected ? "bg-accent-soft" : "hover:bg-surface-sunken"}`}>
                <th scope="row" className="px-3 py-1.5 text-left font-normal">
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelect(isSelected ? "" : key)}
                    className={`-mx-1 flex flex-col rounded px-1 py-0.5 text-left hover:underline sm:flex-row sm:gap-2 ${focusRing}`}
                  >
                    {r.code ? (
                      <>
                        <span className={`whitespace-nowrap ${isSelected ? "font-semibold text-accent-text" : "font-medium"}`}>{r.code}</span>
                        <span className="text-muted">{r.name}</span>
                      </>
                    ) : (
                      <span className={`font-medium ${isSelected ? "text-accent-text" : "text-warning"}`}>ไม่ระบุบัญชี</span>
                    )}
                  </button>
                </th>
                {BALANCE_COLS.map(([k]) => (
                  <td key={k} className={`px-3 py-1.5 ${num} ${k === "closing" ? "font-medium" : ""}`}>
                    <Money value={r[k]} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line font-semibold">
            <th scope="row" className="px-3 py-2 text-left">รวม</th>
            {BALANCE_COLS.map(([k]) => (
              <td key={k} className={`px-3 py-2 ${num}`}>
                <Money value={data.totals[k]} />
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

type EntriesPage = GridPage<LedgerEntry> & { summary: { amount: number } };
const col = gridColumnHelper<LedgerEntry>();
const nowrap = { className: "whitespace-nowrap" };
const dash = <span className="text-muted">–</span>;
// ตัวกรองหัวคอลัมน์จาก /api/fund/ar-ledger/entries?facet=<id> (ยกเว้นจำนวนเงิน)
const filterable = { ...nowrap, filter: true } as const;
const dateFilter = { className: "whitespace-nowrap tabular-nums", filter: { format: (v: string) => formatThaiDate(v) || v } } as const;
const columns = col.columns([
  col.accessor("entry_date", { header: "วันที่ลงบัญชี", cell: (c) => formatThaiDate(c.getValue()), meta: dateFilter }),
  col.accessor("kind", { header: "ประเภท", cell: (c) => KIND_LABEL[c.getValue()], meta: filterable }),
  col.accessor("patient_type", { header: "OP/IP", meta: filterable }),
  col.accessor("vn", { header: "VN/AN", cell: (c) => c.getValue() ?? c.row.original.an, meta: { className: "whitespace-nowrap tabular-nums", filter: true } }),
  col.accessor("ref", { header: "เลขที่ลูกหนี้", cell: (c) => (c.row.original.patient_type === "OP" ? c.getValue() : dash), meta: { className: "whitespace-nowrap tabular-nums", filter: true } }),
  col.accessor("ref_date", { header: "วันตั้งหนี้/จำหน่าย", cell: (c) => formatThaiDate(c.getValue()) || dash, meta: dateFilter }),
  col.accessor("pttype", { header: "สิทธิ", cell: (c) => c.getValue() ?? dash, meta: filterable }),
  col.accessor("hipdata_code", { header: "กองทุน", cell: (c) => c.getValue() ?? dash, meta: filterable }),
  col.accessor("hospmain", { header: "หน่วยบริการประจำ", cell: (c) => c.getValue() ?? dash, meta: filterable }),
  col.accessor("amount", { header: "จำนวนเงิน (บาท)", cell: (c) => <Money value={Number(c.getValue())} />, meta: { className: num } }),
  col.accessor("note", { header: "เหตุผล", enableSorting: false, cell: (c) => c.getValue() ?? dash, meta: { filter: true } }),
]);
const renderSummary = ({ total, summary }: EntriesPage) => (
  <p className="text-muted tabular-nums">
    <span className="font-semibold text-foreground">{formatCount(total)}</span> รายการ<span aria-hidden="true"> · </span>
    รวม <span className="font-semibold text-foreground">{formatBaht(summary.amount)}</span> บาท
  </p>
);

const detailTitle = (r: LedgerEntry) => `${r.an ? `AN ${r.an}` : r.vn ? `VN ${r.vn}` : r.ref} · ${r.patient_type}`;

function LedgerDetail({ row, account }: { row: LedgerEntry; account: ReactNode }) {
  return (
    <div className="text-sm">
      <Facts>
        <Fact label="วันที่ลงบัญชี">{formatThaiDate(row.entry_date)}</Fact>
        <Fact label="ประเภท">{KIND_LABEL[row.kind]}</Fact>
        {row.patient_type === "OP" && <Fact label="เลขที่ลูกหนี้">{row.ref}</Fact>}
        <Fact label="วันตั้งหนี้/จำหน่าย">{formatThaiDate(row.ref_date)}</Fact>
        <Fact label="สิทธิ">{row.pttype}</Fact>
        <Fact label="กองทุน">{row.hipdata_code}</Fact>
        <Fact label="หน่วยบริการประจำ">{row.hospmain}</Fact>
        <Fact label="บัญชี">{account}</Fact>
        <Fact label="จำนวนเงิน (บาท)"><span className="font-semibold"><Money value={Number(row.amount)} /></span></Fact>
        <Fact label="เหตุผล">{row.note}</Fact>
      </Facts>
      {(row.vn || row.an) && (
        // ยอดของ adjust/cancel/reverse ไม่ใช่ยอดหนี้ทั้งก้อน จึงเทียบส่วนต่างเฉพาะแถวตั้งหนี้
        <DebtorItems vn={row.vn} an={row.an} debtor={row.kind === "set" ? Number(row.amount) : undefined} />
      )}
    </div>
  );
}

export function ArLedger() {
  const { month, account, set } = useUrlParams(["month", "account"]);
  const { data, error, loading, retry } = useJson<ArLedgerSummary>(`/api/fund/ar-ledger${month ? `?${new URLSearchParams({ month })}` : ""}`);
  // ระหว่างโหลดงวดใหม่ คงตารางเดิมไว้แบบจาง
  const [shown, setShown] = useState<ArLedgerSummary>();
  if (data && data !== shown) setShown(data);
  const [result, setResult] = useState<{ log: SyncLog | null; error?: string }>();
  const [gridKey, setGridKey] = useState(0);

  const d = shown;
  const selected = d?.rows.find((r) => accountKey(r) === account);
  const lastFailed = d?.lastSync?.error && !result ? d.lastSync : null;
  const accountCode = selected?.code ?? (account === NONE ? "ไม่ระบุบัญชี" : account);
  const accountLabel = (
    <>
      {accountCode}
      {selected?.name && <span className="ml-2 font-normal text-muted">{selected.name}</span>}
    </>
  );
  const renderDetail = (r: LedgerEntry) => <LedgerDetail row={r} account={accountLabel} />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title text-balance">{TITLE}</h1>
        {d && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted">งวด</span>
              <select value={d.month} onChange={(e) => set({ month: e.target.value })} className={SELECT_CLASS}>
                {groupByFiscalYear(d.months).map(([fy, ms]) => (
                  <optgroup key={fy} label={`ปีงบ ${fy}`}>
                    {ms.map((m) => (
                      <option key={m} value={m}>
                        {monthLabel(m)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <span className="text-xs text-muted tabular-nums">
              {d.lastSuccessAt ? `ดึงล่าสุด ${thaiDateTime(d.lastSuccessAt)}` : "ยังไม่เคยดึงยอด"}
            </span>
            <SyncButton
              onDone={(log, err) => {
                setResult({ log, error: err });
                retry();
                setGridKey((k) => k + 1);
              }}
            />
          </div>
        )}
      </div>

      {result && (
        <p role={result.error ? "alert" : "status"} className={`text-sm ${result.error ? "text-danger" : "text-muted"}`}>
          {result.error ? `ดึงยอดไม่สำเร็จ: ${result.error} · กดดึงยอดล่าสุดอีกครั้งได้ รายการที่ลงแล้วจะไม่ลงซ้ำ` : result.log && syncResult(result.log)}
        </p>
      )}
      {lastFailed && (
        <p role="alert" className="text-sm text-danger">
          ดึงยอดเมื่อ {thaiDateTime(lastFailed.started_at)} ไม่สำเร็จ: {lastFailed.error}
        </p>
      )}

      {error ? (
        <Notice
          title={`โหลดข้อมูลไม่สำเร็จ: ${error}`}
          action={
            <button type="button" className={btn} onClick={retry}>
              ลองอีกครั้ง
            </button>
          }
        />
      ) : !d ? (
        <Skeleton rows={8} />
      ) : (
        <div aria-busy={loading} className={`flex flex-col gap-5 transition-opacity duration-200 ${loading ? "opacity-60" : ""}`}>
          {d.rows.length ? (
            <BalanceTable data={d} selected={account} onSelect={(key) => set({ account: key })} />
          ) : (
            <Notice
              title={`ไม่มียอดลูกหนี้ในงวด ${monthLabel(d.month)}`}
              detail={d.lastSuccessAt ? undefined : "กดดึงยอดล่าสุดเพื่อตั้งลูกหนี้จาก HOSxP"}
            />
          )}
          {account && (
            <section className="flex flex-col gap-2">
              <h2 className="text-title">{accountLabel}</h2>
              <DataGrid<LedgerEntry, EntriesPage>
                key={gridKey}
                endpoint="/api/fund/ar-ledger/entries"
                params={{ month: d.month, account }}
                columns={columns}
                getRowId={(r) => r.id}
                renderSummary={renderSummary}
                exportPlacement="summary"
                renderDetail={renderDetail}
                detailMode="modal"
                detailTitle={detailTitle}
                detailSize="medium"
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
