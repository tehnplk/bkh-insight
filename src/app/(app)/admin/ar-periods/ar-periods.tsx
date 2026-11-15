"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { THAI_MONTHS_SHORT, formatThaiDate } from "@/lib/thai-date";
import { Money, Notice, Skeleton, btn, focusRing, num, useJson } from "@/app/(app)/fund/_components/ui";
import type { ArPeriod, ArPeriodsData } from "@/app/api/admin/ar-periods/route";

const SELECT_CLASS = `h-9 min-w-0 rounded-md border border-line bg-surface pr-8 pl-3 ${focusRing}`;
const TH = "px-3 py-2.5 font-medium";
const TD = "px-3 py-1.5 align-top";
const primary = `inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-wait disabled:opacity-60 ${focusRing}`;
const monthLabel = (m: string) => `${THAI_MONTHS_SHORT[+m.slice(5, 7) - 1]} ${+m.slice(0, 4) + 543}`;
const thaiDateTime = (s: string) => `${formatThaiDate(s)} ${s.slice(11, 16)} น.`;

type Result = { ok: boolean; text: string; unassigned?: boolean };

async function send(method: string, body: unknown): Promise<{ ok: true; body: { months?: string[] } } | { ok: false; error: string; unassigned?: boolean }> {
  const res = await fetch("/api/admin/ar-periods", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = await res?.json().catch(() => null);
  return res?.ok ? { ok: true, body: data } : { ok: false, error: data?.error ?? `ไม่สำเร็จ${res ? ` (HTTP ${res.status})` : ""}`, unassigned: Boolean(data?.unassigned) };
}

function Close({ data, onDone }: { data: ArPeriodsData; onDone: () => void }) {
  const last = data.closable.at(-1) ?? "";
  const [picked, setPicked] = useState("");
  const target = data.closable.includes(picked) ? picked : last;
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>();
  const count = data.closable.filter((m) => m <= target).length;

  function close() {
    setResult(undefined);
    startTransition(async () => {
      const r = await send("POST", { through: target });
      if (!r.ok) return setResult({ ok: false, text: r.error, unassigned: r.unassigned });
      setResult({ ok: true, text: `ปิดงวด ${(r.body.months ?? []).map(monthLabel).join(", ")} แล้ว` });
      onDone();
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm">
        {data.through ? <>ปิดงวดถึง <span className="font-semibold">{monthLabel(data.through)}</span></> : <span className="text-muted">ยังไม่เคยปิดงวด</span>}
      </p>
      {data.closable.length === 0 ? (
        <p className="text-sm text-muted">ไม่มีเดือนที่จบแล้วที่ยังไม่ปิด</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">ปิดถึง</span>
            <select value={target} disabled={pending} onChange={(e) => setPicked(e.target.value)} className={SELECT_CLASS}>
              {data.closable.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
          <button type="button" onClick={close} disabled={pending} className={primary}>
            {pending ? "กำลังปิดงวด…" : count > 1 ? `ปิดงวด ${monthLabel(data.closable[0])} ถึง ${monthLabel(target)}` : `ปิดงวด ${monthLabel(target)}`}
          </button>
        </div>
      )}
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>
          {result.text}
          {result.unassigned && (
            <>
              {" "}
              <Link href="/admin/ar-accounts" className={`rounded underline underline-offset-2 ${focusRing}`}>ไปหน้า บัญชีลูกหนี้ตามสิทธิ</Link>
            </>
          )}
        </p>
      )}
    </section>
  );
}

function Unlock({ period, onClose, onDone }: { period: ArPeriod | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  function submit() {
    if (!period) return;
    setError("");
    startTransition(async () => {
      const r = await send("PATCH", { month: period.month, reason });
      if (!r.ok) return setError(r.error);
      setReason("");
      onDone();
    });
  }
  return (
    <DetailModal open={Boolean(period)} onClose={onClose} title={period ? `เปิดงวด ${monthLabel(period.month)}` : ""}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3 text-sm"
      >
        <p className="text-muted">รายการที่ถูกเลื่อนวันที่ลงบัญชีเข้างวดถัดไประหว่างที่ปิดอยู่ จะไม่ถูกเลื่อนกลับ</p>
        <label className="flex flex-col gap-1">
          <span className="text-muted">เหตุผล</span>
          <textarea
            required
            maxLength={500}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={`min-w-0 rounded-md border border-line bg-surface px-3 py-2 ${focusRing}`}
          />
        </label>
        {error && <p role="alert" className="text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btn}>ยกเลิก</button>
          <button type="submit" disabled={pending || !reason.trim()} className={primary}>{pending ? "กำลังเปิดงวด…" : "เปิดงวด"}</button>
        </div>
      </form>
    </DetailModal>
  );
}

export function ArPeriods() {
  const { data, error, retry } = useJson<ArPeriodsData>("/api/admin/ar-periods");
  const [unlocking, setUnlocking] = useState<ArPeriod | null>(null);
  if (error) return <Notice title={`โหลดงวดไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />;
  if (!data) return <Skeleton rows={4} />;

  return (
    <>
      <Close data={data} onDone={retry} />
      <section className="flex flex-col gap-2">
        <h2 className="text-title">ประวัติการปิดงวด</h2>
        {data.history.length === 0 ? (
          <p className="text-sm text-muted">ยังไม่มีงวดที่ปิด</p>
        ) : (
          <div className="relative overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-surface text-left text-grid-head text-muted">
                <tr>
                  <th scope="col" className={TH}>งวด</th>
                  <th scope="col" className={TH}>ปิดโดย</th>
                  <th scope="col" className={`${TH} ${num}`}>ยอดยกไป (บาท)</th>
                  <th scope="col" className={TH}>สถานะ</th>
                  <th scope="col" className={TH}><span className="sr-only">เปิดงวด</span></th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((p) => (
                  <tr key={p.id} className="border-t border-line hover:bg-surface-sunken">
                    <th scope="row" className={`${TD} text-left font-medium whitespace-nowrap`}>{monthLabel(p.month)}</th>
                    <td className={`${TD} whitespace-nowrap`}>
                      {p.locked_by}
                      <span className="block text-xs text-muted tabular-nums">{thaiDateTime(p.locked_at)}</span>
                    </td>
                    <td className={`${TD} ${num}`}><Money value={p.totals?.closing_dr} /></td>
                    <td className={`${TD} min-w-48`}>
                      {p.unlocked_at ? (
                        <>
                          <span className="text-muted">เปิดแล้ว โดย {p.unlocked_by}</span>
                          <span className="block text-xs text-muted tabular-nums">{thaiDateTime(p.unlocked_at)}</span>
                          <span className="block text-xs text-muted">เหตุผล: {p.unlock_reason}</span>
                        </>
                      ) : (
                        <span className="text-success">ปิดอยู่</span>
                      )}
                    </td>
                    <td className={`${TD} text-right whitespace-nowrap`}>
                      {!p.unlocked_at && p.month === data.through && (
                        <button type="button" onClick={() => setUnlocking(p)} className={`${btn} h-7 px-2.5`}>เปิดงวด</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.history.length > 0 && <p className="text-xs text-muted">ยอดยกไปคือยอดรวมเดบิตของงบทดลอง ณ เวลาปิด (เท่ากับยอดรวมเครดิต)</p>}
      </section>
      <Unlock
        period={unlocking}
        onClose={() => setUnlocking(null)}
        onDone={() => {
          setUnlocking(null);
          retry();
        }}
      />
    </>
  );
}
