"use client";

import { useState, useTransition, type ReactNode } from "react";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { copyable } from "@/components/copy-button/copy-button";
import { ThaiDatePicker } from "@/components/thai-date-picker/thai-date-picker";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate, todayIso } from "@/lib/thai-date";
import { Money, Notice, Skeleton, btn, num, useJson } from "../_components/ui";
import { LEDGER_START } from "@/app/api/fund/ar-sync/ledger";
import { PLAN_STATUS, type PlanStatus } from "@/app/api/fund/fwf-card/fwf";
import type { PoolCard, PoolData } from "@/app/api/fund/fwf-card/pool/route";
import type { MonthEndPreview, MonthEndResult } from "@/app/api/fund/fwf-card/month-end/route";
import type { CardTypeRow } from "@/app/api/fund/fwf-card/data";
import { FIELD, Flag, MonthSelect, Status, dash, monthLabel, primary, send } from "./shared";

const TH = "px-3 py-2 font-medium";
const TD = "px-3 py-1.5 align-top";
type Result = { ok: boolean; text: string };

function Table({ caption, head, children }: { caption: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface text-left text-grid-head text-muted">
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const loadError = (error: string, retry: () => void) => (
  <Notice title={`โหลดข้อมูลไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
);
const hnName = (hn: string | null, name: string | null) => (
  <>
    <span className="tabular-nums">{hn ?? dash}</span>
    <span className="block text-xs text-subtle">{name ?? "–"}</span>
  </>
);

/* ---------- เงินรับล่วงหน้า ---------- */

function Figures({ items }: { items: [string, number | null, string?][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-line px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([label, v, tone]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted">{label}</dt>
          <dd className={`text-base font-semibold tabular-nums ${tone ?? ""}`}><Money value={v} /></dd>
        </div>
      ))}
    </dl>
  );
}

function ReleaseForm({ card, onDone }: { card: PoolCard; onDone: (text: string) => void }) {
  const [amount, setAmount] = useState(card.remaining.toFixed(2));
  const [date, setDate] = useState(todayIso);
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>();
  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setResult(undefined);
          const r = await send("/api/fund/fwf-card/release", "POST", { card_id: card.id, amount: Number(amount), released_on: date, ref, note });
          if (!r.ok) return setResult({ ok: false, text: r.error });
          onDone(`บันทึกโอน ${formatBaht(Number(amount))} บาทของบัตร HN ${card.hn} ไปเงินบำรุงแล้ว`);
        });
      }}
    >
      <p>
        {card.type_label} · หมดอายุ {formatThaiDate(card.valid_to)} · คงเหลือ <span className="font-semibold tabular-nums">{formatBaht(card.remaining)}</span> บาท
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-muted">จำนวนเงิน (บาท)</span>
          <input required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${FIELD} w-36 text-right tabular-nums`} />
        </label>
        <ThaiDatePicker label="วันที่โอน" value={date} onChange={setDate} max={todayIso()} stepper={false} />
        <label className="flex flex-col gap-1">
          <span className="text-muted">เลขที่อ้างอิง</span>
          <input maxLength={50} value={ref} onChange={(e) => setRef(e.target.value)} className={`${FIELD} w-40`} />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-muted">หมายเหตุ</span>
          <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${FIELD} min-w-48`} />
        </label>
      </div>
      <div>
        <button type="submit" disabled={pending} className={primary}>{pending ? "กำลังบันทึก…" : "บันทึกโอนไปเงินบำรุง"}</button>
      </div>
      <Status result={result} />
    </form>
  );
}

export function PoolTab() {
  const { data, error, retry } = useJson<PoolData>("/api/fund/fwf-card/pool");
  const [releasing, setReleasing] = useState<PoolCard | null>(null);
  const [result, setResult] = useState<Result>();
  if (error) return loadError(error, retry);
  if (!data) return <Skeleton rows={6} />;
  const s = data.summary;
  return (
    <div className="flex flex-col gap-4">
      <Figures
        items={[
          ["รับจากบัตร (บาท)", s.pool_in],
          ["ตัดหนี้แล้ว (บาท)", s.settled],
          ["โอนเงินบำรุง (บาท)", s.released],
          ["คงเหลือ (บาท)", s.balance, s.balance < 0 ? "text-danger" : undefined],
          ["ส่วนต่างที่ไม่พอ (บาท)", s.lost, s.lost > 0 ? "text-danger" : undefined],
        ]}
      />
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        บัตรใช้งาน {formatCount(s.cards)} ใบ ณ {formatThaiDate(data.today)}
        {s.unset > 0 && <Flag tone="warning">ชนิดบัตรยังไม่กำหนดยอด {formatCount(s.unset)} ใบ ไม่นับในคงเหลือ</Flag>}
      </p>
      <Status result={result} />
      <section className="flex flex-col gap-2">
        <h2 className="text-title">บัตรหมดอายุที่ยังมีเงินคงเหลือ {data.expired.length > 0 && <span className="text-warning">· {formatCount(data.expired.length)} ใบ</span>}</h2>
        {data.expired.length === 0 ? (
          <p className="text-sm text-muted">ไม่มีบัตรหมดอายุที่ยังมีเงินคงเหลือ</p>
        ) : (
          <Table
            caption="บัตรหมดอายุที่ยังมีเงินคงเหลือ (บาท)"
            head={
              <>
                <th className={TH}>HN / ชื่อ</th>
                <th className={TH}>ชนิดบัตร</th>
                <th className={TH}>หมดอายุ</th>
                <th className={`${TH} ${num}`}>เงินรับล่วงหน้า (บาท)</th>
                <th className={`${TH} ${num}`}>ใช้แล้ว (บาท)</th>
                <th className={`${TH} ${num}`}>โอนแล้ว (บาท)</th>
                <th className={`${TH} ${num}`}>คงเหลือ (บาท)</th>
                <th className={TH}><span className="sr-only">โอน</span></th>
              </>
            }
          >
            {data.expired.map((c) => (
              <tr key={c.id} className="border-t border-line hover:bg-surface-sunken">
                <td className={TD}>{hnName(c.hn, c.name)}</td>
                <td className={TD}>{c.type_label}</td>
                <td className={`${TD} whitespace-nowrap`}>{formatThaiDate(c.valid_to)}</td>
                <td className={`${TD} ${num}`}><Money value={Number(c.pool_amount)} /></td>
                <td className={`${TD} ${num}`}><Money value={c.usage} /></td>
                <td className={`${TD} ${num}`}><Money value={c.released} /></td>
                <td className={`${TD} font-semibold ${num}`}><Money value={c.remaining} /></td>
                <td className={`${TD} text-right`}>
                  <button type="button" onClick={() => setReleasing(c)} className={`${btn} h-7 px-2.5`}>บันทึกโอน</button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
      <DetailModal open={!!releasing} onClose={() => setReleasing(null)} title={releasing ? <>โอนไปเงินบำรุง · HN {copyable(releasing.hn, "HN")}</> : ""}>
        {releasing && (
          <ReleaseForm
            card={releasing}
            onDone={(text) => {
              setReleasing(null);
              setResult({ ok: true, text });
              retry();
            }}
          />
        )}
      </DetailModal>
    </div>
  );
}

/* ---------- ใช้สิทธิต่อคน ---------- */

export function Holders() {
  const { data, error, retry } = useJson<PoolData>("/api/fund/fwf-card/pool");
  if (error) return loadError(error, retry);
  if (!data) return <Skeleton rows={6} />;
  return (
    <div className="flex flex-col gap-5">
      <CheckList rows={data.check} />
      <section className="flex flex-col gap-2">
        <h2 className="text-title">การใช้สิทธิต่อผู้ถือบัตร</h2>
        {data.holders.length === 0 ? (
          <p className="text-sm text-muted">ยังไม่มีการตัดหนี้ด้วยเงินรับล่วงหน้า</p>
        ) : (
          <Table
            caption="การใช้สิทธิต่อผู้ถือบัตร (บาท)"
            head={
              <>
                <th className={TH}>HN / ชื่อ</th>
                <th className={`${TH} ${num}`}>บัตร (ใบ)</th>
                <th className={`${TH} ${num}`}>เงินรับล่วงหน้า (บาท)</th>
                <th className={`${TH} ${num}`}>ใช้แล้ว (บาท)</th>
                <th className={`${TH} ${num}`}>โอนเงินบำรุง (บาท)</th>
                <th className={`${TH} ${num}`}>คงเหลือ (บาท)</th>
                <th className={`${TH} ${num}`}>ใช้เกิน (บาท)</th>
              </>
            }
          >
            {data.holders.map((h) => (
              <tr key={h.hn} className="border-t border-line hover:bg-surface-sunken">
                <td className={TD}>{hnName(h.hn, h.name)}</td>
                <td className={`${TD} ${num}`}>{formatCount(h.cards)}{h.unset > 0 && <span className="block"><Flag tone="warning">ยังไม่กำหนดยอด {h.unset}</Flag></span>}</td>
                <td className={`${TD} ${num}`}><Money value={h.pool} /></td>
                <td className={`${TD} ${num}`}><Money value={h.usage} /></td>
                <td className={`${TD} ${num}`}><Money value={h.released} /></td>
                <td className={`${TD} ${num}`}><Money value={h.remaining} /></td>
                <td className={`${TD} ${num} ${h.loss > 0 ? "font-semibold text-danger" : ""}`}>{h.loss > 0 ? formatBaht(h.loss) : <span className="text-muted">0.00</span>}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}

function CheckList({ rows }: { rows: PoolData["check"] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-title">ต้องตรวจ {rows.length > 0 && <span className="text-danger">· {formatCount(rows.length)} ราย</span>}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">ไม่มีหนี้ผู้ถือบัตรที่ต้องตรวจ</p>
      ) : (
        <PlanTable rows={rows} caption="หนี้ที่ต้องตรวจสิทธิใน HOSxP" />
      )}
    </section>
  );
}

const STATUS_TONE: Record<PlanStatus, "warning" | "danger" | "info" | "muted" | null> = { settle: null, partial: "warning", diff: "danger", check: "danger", blocked: "warning" };

function PlanTable({ rows, caption }: { rows: MonthEndPreview["rows"]; caption: string }) {
  return (
    <Table
      caption={`${caption} (บาท)`}
      head={
        <>
          <th className={TH}>วันรับบริการ</th>
          <th className={TH}>HN / ชื่อ</th>
          <th className={TH}>VN/AN</th>
          <th className={TH}>บัญชี</th>
          <th className={`${TH} ${num}`}>คงเหลือ (บาท)</th>
          <th className={`${TH} ${num}`}>ตัดด้วยเงินรับล่วงหน้า (บาท)</th>
          <th className={`${TH} ${num}`}>ส่วนต่าง (บาท)</th>
          <th className={TH}>ผล</th>
        </>
      }
    >
      {rows.map((r) => {
        const tone = STATUS_TONE[r.status];
        return (
          <tr key={r.key} className="border-t border-line hover:bg-surface-sunken">
            <td className={`${TD} whitespace-nowrap`}>{r.service_date ? formatThaiDate(r.service_date) : dash}</td>
            <td className={TD}>{hnName(r.hn, r.name)}</td>
            <td className={`${TD} whitespace-nowrap`}>{r.patient_type} {r.an ?? r.vn ?? r.ref}</td>
            <td className={`${TD} whitespace-nowrap`}>{r.account_code ?? dash}</td>
            <td className={`${TD} ${num}`}><Money value={r.balance} /></td>
            <td className={`${TD} ${num}`}>{r.settle ? formatBaht(r.settle) : dash}</td>
            <td className={`${TD} ${num}`}>{r.diff ? formatBaht(r.diff) : dash}</td>
            <td className={`${TD} min-w-40`}>
              {tone ? <Flag tone={tone}>{PLAN_STATUS[r.status]}</Flag> : PLAN_STATUS[r.status]}
              {r.reason && <span className="block text-xs text-muted">{r.reason}</span>}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

/* ---------- ตัดหนี้สิ้นเดือน ---------- */

/** เดือนเริ่มต้น = เดือนก่อน (เดือนล่าสุดที่จบแล้ว) */
function lastEndedMonth(today: string) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function MonthEnd({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const today = todayIso();
  const m = month && month >= LEDGER_START.slice(0, 7) && month <= today.slice(0, 7) ? month : lastEndedMonth(today);
  const { data, error, loading, retry } = useJson<MonthEndPreview>(`/api/fund/fwf-card/month-end?${new URLSearchParams({ month: m })}`);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>();

  function confirm() {
    startTransition(async () => {
      setResult(undefined);
      const r = await send<MonthEndResult>("/api/fund/fwf-card/month-end", "POST", { month: m });
      setConfirming(false);
      if (!r.ok) setResult({ ok: false, text: r.error });
      else {
        const x = r.body;
        setResult({
          ok: true,
          text: `ชุด #${x.batch_id}: ตัดด้วยเงินรับล่วงหน้า ${formatCount(x.settle)} ราย ${formatBaht(x.settle_amount)} บาท · ส่วนต่าง ${formatCount(x.diff)} ราย ${formatBaht(x.diff_amount)} บาท · ต้องตรวจ ${formatCount(x.check)} ราย${x.shifted ? ` · ${formatCount(x.shifted)} รายการลงวันแรกของงวดที่เปิดเพราะงวดนี้ปิดแล้ว` : ""}`,
        });
      }
      retry();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <MonthSelect value={m} from={LEDGER_START} onChange={(v) => (setMonth(v), setConfirming(false))} label="สิ้นเดือน" />
      </div>
      <Status result={result} />
      {error ? loadError(error, retry) : !data ? <Skeleton rows={6} /> : (
        <div aria-busy={loading} className={`flex flex-col gap-4 ${loading ? "opacity-60" : ""}`}>
          <Figures
            items={[
              [`เงินรับล่วงหน้า ณ ${formatThaiDate(data.month_end)} (บาท)`, data.pool_before, data.pool_before < 0 ? "text-danger" : undefined],
              ["ตัดด้วยเงินรับล่วงหน้า (บาท)", data.totals.settle],
              ["ลงส่วนต่าง (บาท)", data.totals.diff, data.totals.diff > 0 ? "text-danger" : undefined],
              ["คงเหลือหลังตัด (บาท)", data.pool_after],
            ]}
          />
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            ตัด {formatCount(data.totals.settle_n)} ราย · ส่วนต่าง {formatCount(data.totals.diff_n)} ราย
            {data.totals.check_n > 0 && <Flag tone="danger">ต้องตรวจ {formatCount(data.totals.check_n)} ราย ไม่ตัด</Flag>}
            {data.unset_cards > 0 && <Flag tone="warning">บัตรชนิดที่ยังไม่กำหนดยอด {formatCount(data.unset_cards)} ใบ</Flag>}
          </p>
          {data.blocked.map((b) => <p key={b} role="alert" className="text-sm text-warning">{b}</p>)}
          {!data.ended && <p className="text-sm text-muted">เดือนนี้ยังไม่จบ แสดงตัวอย่างถึงวันนี้ ยืนยันได้เมื่อจบเดือน</p>}
          {data.can_confirm && (
            <div className="flex flex-wrap items-center gap-2">
              {confirming ? (
                <>
                  <span className="text-sm">ยืนยันตัดหนี้ {monthLabel(m)}: {formatBaht(data.totals.settle)} บาท และส่วนต่าง {formatBaht(data.totals.diff)} บาท</span>
                  <button type="button" disabled={pending} onClick={confirm} className={primary}>{pending ? "กำลังบันทึก…" : "ยืนยันตัดหนี้"}</button>
                  <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={btn}>ยังไม่ตัด</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className={primary}>ตัดหนี้สิ้นเดือน {monthLabel(m)}</button>
              )}
            </div>
          )}
          {data.rows.length === 0 ? <p className="text-sm text-muted">ไม่มีหนี้ผู้ถือบัตรที่คงเหลือถึงสิ้นเดือนนี้</p> : <PlanTable rows={data.rows} caption={`แผนตัดหนี้ ${monthLabel(m)}`} />}
          {data.batches.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-title">ชุดที่ตัดแล้ว</h2>
              <Table
                caption="ชุดตัดหนี้ด้วยเงินรับล่วงหน้า (บาท)"
                head={
                  <>
                    <th className={TH}>ชุด</th>
                    <th className={TH}>เดือน</th>
                    <th className={`${TH} ${num}`}>ตัด (บาท)</th>
                    <th className={`${TH} ${num}`}>ส่วนต่าง (บาท)</th>
                    <th className={TH}>ผู้ตัด</th>
                  </>
                }
              >
                {data.batches.map((b) => (
                  <tr key={b.id} className="border-t border-line">
                    <td className={TD}>#{b.id}</td>
                    <td className={TD}>{monthLabel(b.month)}</td>
                    <td className={`${TD} ${num}`}><Money value={b.counts.settle_amount ?? 0} /></td>
                    <td className={`${TD} ${num}`}><Money value={b.counts.diff_amount ?? 0} /></td>
                    <td className={TD}>{b.created_by}<span className="block text-xs text-muted">{formatThaiDate(b.created_at)} {b.created_at.slice(11, 16)} น.</span></td>
                  </tr>
                ))}
              </Table>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- ชนิดบัตร (admin) ---------- */

function TypeRow({ t, onSaved }: { t: CardTypeRow; onSaved: (r: Result) => void }) {
  const [label, setLabel] = useState(t.label);
  const [months, setMonths] = useState(String(t.months));
  const [pool, setPool] = useState(t.pool_amount == null ? "" : Number(t.pool_amount).toFixed(2));
  const [active, setActive] = useState(t.active);
  const [note, setNote] = useState(t.note ?? "");
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      const r = await send<{ filled: number }>("/api/fund/fwf-card/card-type", "PATCH", { id: t.id, label, months: Number(months), pool_amount: pool === "" ? null : Number(pool), active, note });
      onSaved(r.ok ? { ok: true, text: `บันทึก ${label} แล้ว${r.body.filled ? ` · เติมยอดให้บัตร ${formatCount(r.body.filled)} ใบที่ยังไม่มียอด` : ""}` } : { ok: false, text: r.error });
    });
  return (
    <tr className="border-t border-line">
      <td className={`${TD} whitespace-nowrap`}>{t.icode}<span className="block text-xs text-muted">{formatBaht(Number(t.unit_price))} บาท</span></td>
      <td className={TD}><input aria-label="ชื่อชนิดบัตร" value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} className={`${FIELD} w-56`} /></td>
      <td className={TD}><input aria-label="อายุบัตร (เดือน)" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} className={`${FIELD} w-16 text-right`} /></td>
      <td className={TD}>
        <input aria-label="เงินรับล่วงหน้าต่อใบ (บาท)" inputMode="decimal" value={pool} onChange={(e) => setPool(e.target.value)} className={`${FIELD} w-28 text-right ${pool === "" ? "border-warning-line" : ""}`} />
        {pool === "" && <span className="mt-1 block"><Flag tone="warning">ยังไม่กำหนด</Flag></span>}
      </td>
      <td className={TD}><input type="checkbox" aria-label="ใช้งาน" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-accent" /></td>
      <td className={TD}><input aria-label="หมายเหตุ" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className={`${FIELD} w-56`} /></td>
      <td className={`${TD} whitespace-nowrap text-xs text-muted`}>{t.updated_by ?? ""}<span className="block">{formatThaiDate(t.updated_at)}</span></td>
      <td className={`${TD} text-right`}><button type="button" disabled={pending} onClick={save} className={`${btn} h-8 px-2.5 disabled:opacity-50`}>บันทึก</button></td>
    </tr>
  );
}

export function CardTypes() {
  const { data, error, retry } = useJson<{ types: CardTypeRow[] }>("/api/fund/fwf-card/card-type");
  const [result, setResult] = useState<Result>();
  if (error) return loadError(error, retry);
  if (!data) return <Skeleton rows={6} />;
  return (
    <div className="flex flex-col gap-3">
      <Status result={result} />
      <Table
        caption="ชนิดบัตร"
        head={
          <>
            <th className={TH}>icode / ราคา</th>
            <th className={TH}>ชื่อ</th>
            <th className={TH}>อายุ (เดือน)</th>
            <th className={TH}>เงินรับล่วงหน้าต่อใบ (บาท)</th>
            <th className={TH}>ใช้งาน</th>
            <th className={TH}>หมายเหตุ</th>
            <th className={TH}>แก้ล่าสุด</th>
            <th className={TH}><span className="sr-only">บันทึก</span></th>
          </>
        }
      >
        {data.types.map((t) => (
          <TypeRow key={`${t.id}:${t.updated_at}`} t={t} onSaved={(r) => (setResult(r), r.ok && retry())} />
        ))}
      </Table>
      <p className="text-xs text-muted">ตั้งยอดแล้วบัตรชนิดนี้ที่ยังไม่มียอดจะได้ยอดตามจำนวนใบ บัตรที่มียอดแล้วไม่เปลี่ยน</p>
    </div>
  );
}
