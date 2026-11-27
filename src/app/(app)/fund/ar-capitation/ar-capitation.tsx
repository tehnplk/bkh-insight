"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { copyable } from "@/components/copy-button/copy-button";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate, todayIso } from "@/lib/thai-date";
import { LEDGER_START } from "@/app/api/fund/ar-sync/ledger";
import type { CapRow } from "@/app/api/fund/ar-capitation/capitation";
import type { CapAccountPreview, CapPreview, CapResult } from "@/app/api/fund/ar-capitation/route";
import type { CapDebtPage } from "@/app/api/fund/ar-capitation/debts/route";
import { Money, Notice, Skeleton, btn, focusRing, num, useJson, useUrlParams } from "../_components/ui";
import { MonthSelect, Status, monthLabel, primary, send } from "../fwf-card/shared";

const TH = "px-3 py-2 font-medium";
const TD = "px-3 py-1.5";
type Result = { ok: boolean; text: string };

/** เดือนเริ่มต้น = เดือนก่อน (เดือนล่าสุดที่จบแล้ว) */
function lastEndedMonth(today: string) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const col = gridColumnHelper<CapRow>();
const off = { enableSorting: false } as const;
const COLUMNS = col.columns([
  col.accessor("ref_date", { ...off, header: "วันที่ตั้งหนี้", cell: (c) => formatThaiDate(c.getValue()), meta: { className: "whitespace-nowrap tabular-nums" } }),
  col.display({
    id: "key",
    header: "VN/AN",
    cell: (c) => {
      const r = c.row.original;
      return <span className="whitespace-nowrap">{r.patient_type} {copyable(r.an ?? r.vn ?? r.ref, r.an ? "AN" : "VN")}</span>;
    },
  }),
  col.accessor("balance", { ...off, header: "คงเหลือ (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
  col.accessor("settle", { ...off, header: "ตัดด้วยเหมาจ่าย (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
  col.accessor("diff", { ...off, header: "ส่วนต่าง (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
]);

function Figures({ items }: { items: [string, number, string?][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 xl:grid-cols-7">
      {items.map(([label, v, tone]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted">{label}</dt>
          <dd className={`text-base font-semibold tabular-nums ${tone ?? ""}`}><Money value={v} /></dd>
        </div>
      ))}
    </dl>
  );
}

function AccountSection({ a, data, onOpen, onDone }: { a: CapAccountPreview; data: CapPreview; onOpen: () => void; onDone: (r: Result) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const t = a.totals;

  function confirm() {
    startTransition(async () => {
      const r = await send<CapResult>("/api/fund/ar-capitation", "POST", { month: data.month, account: a.code });
      setConfirming(false);
      if (!r.ok) return onDone({ ok: false, text: `${a.code}: ${r.error}` });
      const x = r.body;
      onDone({
        ok: true,
        text: `ชุด #${x.batch_id} ${a.code}: ตัดด้วยเหมาจ่าย ${formatCount(x.settle_n)} ราย ${formatBaht(x.settle_amount)} บาท · ลงส่วนต่าง ${formatCount(x.diff_n)} ราย ${formatBaht(x.diff_amount)} บาท${x.shifted ? ` · ${formatCount(x.shifted)} รายการลงวันแรกของงวดที่เปิด` : ""}`,
      });
    });
  }

  return (
    <section aria-labelledby={`cap-${a.code}`} className="flex flex-col gap-3 rounded-lg border border-line px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`cap-${a.code}`} className="text-title">{a.code} {a.name}</h2>
        <span className="text-sm text-muted tabular-nums">
          ตัดกับ {a.clear_code} · ส่วนต่าง {a.clear_short_code ?? <span className="text-warning">ยังไม่กำหนด</span>}
        </span>
      </div>
      <Figures
        items={[
          [`รับโอนในปีงบถึง ${formatThaiDate(data.month_end)} (บาท)`, a.pool_received],
          ["ตัดหนี้ไปแล้วในปีงบ (บาท)", a.pool_used],
          ["ใช้ตัดได้ (บาท)", a.pool_before],
          [`หนี้คงเหลือ ${formatCount(t.n)} ราย (บาท)`, t.balance],
          ["ตัดด้วยเหมาจ่าย (บาท)", t.settle],
          ["ลงส่วนต่าง (บาท)", t.diff, t.diff > 0 ? "text-danger" : undefined],
          ["เหมาจ่ายคงเหลือหลังตัด (บาท)", a.pool_after],
        ]}
      />
      {a.pending_n > 0 && (
        <p className="text-sm text-warning tabular-nums">
          เงินโอนเข้า {a.clear_code} ที่โอนถึง {formatThaiDate(data.month_end)} รอออกใบเสร็จ {formatCount(a.pending_n)} รายการ {formatBaht(a.pending)} บาท ยังไม่นับในยอดใช้ตัดได้ ·{" "}
          <Link href="/fund/ar-transfer" className={`rounded underline underline-offset-2 ${focusRing}`}>ลงรับที่หน้าเงินโอนที่ได้รับ</Link>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {t.n > 0 && <button type="button" onClick={onOpen} className={btn}>ดูรายหนี้ {formatCount(t.n)} ราย</button>}
        {a.can_confirm ? (
          confirming ? (
            <>
              <span className="text-sm">
                ยืนยันตัดหนี้ {a.code} สิ้นเดือน {monthLabel(data.month)}: ตัดด้วยเหมาจ่าย {formatBaht(t.settle)} บาท และลงส่วนต่าง {formatBaht(t.diff)} บาท
              </span>
              <button type="button" disabled={pending} onClick={confirm} className={primary}>{pending ? "กำลังบันทึก…" : "ยืนยันตัดหนี้"}</button>
              <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={btn}>ยังไม่ตัด</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={primary}>ตัดหนี้สิ้นเดือน {monthLabel(data.month)}</button>
          )
        ) : (
          data.ended && a.blocked && (
            <>
              <button type="button" disabled aria-describedby={`cap-${a.code}-blocked`} className={primary}>ตัดหนี้สิ้นเดือน {monthLabel(data.month)}</button>
              {/* รายละเอียดเงินรอออกใบเสร็จอยู่ในบรรทัดเตือนด้านบนแล้ว */}
              <span id={`cap-${a.code}-blocked`} className="text-sm text-muted">{a.pending_n > 0 && !(data.closed_through && data.month <= data.closed_through) ? "ลงรับเงินโอนก่อนตัดหนี้" : a.blocked}</span>
            </>
          )
        )}
      </div>
    </section>
  );
}

export function ArCapitation() {
  const today = todayIso();
  const { month, set } = useUrlParams(["month"] as const);
  const m = month && month >= LEDGER_START.slice(0, 7) && month <= today.slice(0, 7) ? month : lastEndedMonth(today);
  const { data, error, loading, retry } = useJson<CapPreview>(`/api/fund/ar-capitation?${new URLSearchParams({ month: m })}`);
  const [result, setResult] = useState<Result>();
  const [open, setOpen] = useState<CapAccountPreview | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <MonthSelect value={m} from={LEDGER_START} onChange={(v) => (set({ month: v }), setResult(undefined))} label="สิ้นเดือน" />
      <Status result={result} />
      {error ? (
        <Notice title={`โหลดข้อมูลไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
      ) : !data ? (
        <Skeleton rows={6} />
      ) : (
        <div aria-busy={loading} className="flex flex-col gap-4">
          {!data.ended && <p className="text-sm text-muted">เดือนนี้ยังไม่จบ แสดงตัวอย่างถึงวันนี้ ยืนยันได้เมื่อจบเดือน</p>}
          {data.accounts.length === 0 && <Notice title="ยังไม่มีบัญชีลูกหนี้ที่กำหนดบัญชีตัดเหมาจ่าย" />}
          {data.accounts.map((a) => (
            <AccountSection key={`${a.code}:${data.month}`} a={a} data={data} onOpen={() => setOpen(a)} onDone={(r) => (setResult(r), retry())} />
          ))}
          {data.batches.length > 0 && (
            <section aria-labelledby="cap-batches" className="flex flex-col gap-2">
              <h2 id="cap-batches" className="text-title">ชุดที่ตัดแล้ว</h2>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full border-collapse text-sm tabular-nums">
                  <caption className="sr-only">ชุดตัดหนี้ด้วยเงินเหมาจ่าย (บาท)</caption>
                  <thead className="bg-surface text-left text-grid-head text-muted">
                    <tr>
                      <th className={TH}>ชุด</th>
                      <th className={TH}>สิ้นเดือน</th>
                      <th className={TH}>บัญชีลูกหนี้</th>
                      <th className={`${TH} ${num}`}>ใช้ตัดได้ (บาท)</th>
                      <th className={`${TH} ${num}`}>ตัดด้วยเหมาจ่าย (บาท)</th>
                      <th className={`${TH} ${num}`}>ส่วนต่าง (บาท)</th>
                      <th className={TH}>ผู้ตัด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.batches.map((b) => (
                      <tr key={b.id} className="border-t border-line">
                        <td className={TD}>#{b.id}</td>
                        <td className={TD}>{monthLabel(b.month)}</td>
                        <td className={TD}>{b.account_code}<span className="block text-xs text-muted">{b.clear_code} · {b.clear_short_code}</span></td>
                        <td className={`${TD} ${num}`}><Money value={Number(b.pool_before)} /></td>
                        <td className={`${TD} ${num}`}>{formatBaht(b.counts.settle_amount ?? 0)}<span className="block text-xs text-muted">{formatCount(b.counts.settle_n ?? 0)} ราย</span></td>
                        <td className={`${TD} ${num}`}>{formatBaht(b.counts.diff_amount ?? 0)}<span className="block text-xs text-muted">{formatCount(b.counts.diff_n ?? 0)} ราย</span></td>
                        <td className={TD}>{b.created_by}<span className="block text-xs text-muted">{formatThaiDate(b.created_at)} {b.created_at.slice(11, 16)} น.</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
      <DetailModal open={!!open} onClose={() => setOpen(null)} size="wide" title={open ? `${open.code} · แผนตัดหนี้สิ้นเดือน ${monthLabel(m)}` : ""}>
        {open && (
          <div className="flex min-h-0 flex-1 flex-col">
            <DataGrid<CapRow, CapDebtPage>
              key={`${open.code}:${m}`}
              endpoint="/api/fund/ar-capitation/debts"
              params={{ month: m, account: open.code }}
              localState={{ pageSize: "50" }}
              columns={COLUMNS}
              getRowId={(r) => `${r.patient_type}:${r.ref}`}
              searchSize="compact"
              fitScreen
            />
          </div>
        )}
      </DetailModal>
    </div>
  );
}
