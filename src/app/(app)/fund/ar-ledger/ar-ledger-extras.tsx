"use client";

import { useState, useTransition, type ReactNode } from "react";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { Money, Notice, Skeleton, btn, focusRing, num, useJson } from "../_components/ui";
import type { ArJournal } from "@/app/api/fund/ar-journal/route";
import { CASH_NAME } from "@/app/api/fund/ar-journal/journal";
import type { AdjustData } from "@/app/api/fund/ar-adjust/route";

const TH = "px-3 py-2.5 font-medium";
const TD = "px-3 py-1.5 align-top";
const FIELD = `h-9 min-w-0 rounded-md border border-line bg-surface px-3 ${focusRing}`;
const primary = `inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-wait disabled:opacity-60 ${focusRing}`;
const thaiDateTime = (s: string) => `${formatThaiDate(s)} ${s.slice(11, 16)} น.`;
const missing = <span className="text-warning">ยังไม่กำหนด</span>;

async function send(url: string, init: RequestInit): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init }).catch(() => null);
  const body = await res?.json().catch(() => null);
  return res?.ok ? { ok: true } : { ok: false, error: body?.error ?? `ไม่สำเร็จ${res ? ` (HTTP ${res.status})` : ""}` };
}

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface text-left text-grid-head text-muted">
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/* ---------- สมุดรายวัน ---------- */

export function Journal({ month, monthText }: { month: string; monthText: string }) {
  const { data, error, retry } = useJson<ArJournal>(`/api/fund/ar-journal?${new URLSearchParams({ month })}`);
  const account = (code: string | null, name: string) => (
    <>
      {code ? <span className="whitespace-nowrap tabular-nums">{code}</span> : name === CASH_NAME ? null : missing} <span className="text-muted">{name}</span>
    </>
  );
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <h2 className="text-title">สมุดรายวัน · {monthText}</h2>
        {data && data.lines.length > 0 && (
          <a href={`/api/fund/ar-journal?${new URLSearchParams({ month, format: "xlsx" })}`} className={btn} download>
            ส่งออก Excel
          </a>
        )}
      </div>
      {error ? (
        <Notice title={`โหลดสมุดรายวันไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
      ) : !data ? (
        <Skeleton rows={4} />
      ) : data.lines.length === 0 ? (
        <p className="text-sm text-muted">ไม่มีรายการในงวดนี้</p>
      ) : (
        <>
          {data.missing > 0 && <p className="text-sm text-warning">{formatCount(data.missing)} รายการยังไม่มีบัญชีคู่ กำหนดได้ที่หน้า บัญชีลูกหนี้ตามสิทธิ (ผู้ดูแลระบบ)</p>}
          <Table
            head={
              <>
                <th className={TH}>รายการ</th>
                <th className={TH}>เดบิต</th>
                <th className={TH}>เครดิต</th>
                <th className={`${TH} ${num}`}>จำนวนรายการ</th>
                <th className={`${TH} ${num}`}>จำนวนเงิน (บาท)</th>
              </>
            }
          >
            {data.lines.map((l, i) => (
              <tr key={i} className="border-t border-line hover:bg-surface-sunken">
                <td className={`${TD} whitespace-nowrap`}>{l.kind}</td>
                <td className={TD}>{account(l.dr_code, l.dr_name)}</td>
                <td className={TD}>{account(l.cr_code, l.cr_name)}</td>
                <td className={`${TD} ${num}`}>{formatCount(l.n)}</td>
                <td className={`${TD} ${num}`}><Money value={l.amount} /></td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-muted">รับชำระลงเดบิตเงินฝากธนาคาร ให้งานบัญชีเลือกบัญชีเงินฝากที่รับโอนจริง</p>
        </>
      )}
    </section>
  );
}

/* ---------- คำขอปรับปรุงลูกหนี้ ---------- */

/** ฟอร์มขอปรับปรุงหนึ่งหนี้ (อยู่ใน modal รายละเอียดของแถวสมุดลูกหนี้) */
export function AdjustRequestForm({ patientType, debtRef }: { patientType: "OP" | "IP"; debtRef: string }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  function submit() {
    setResult(undefined);
    startTransition(async () => {
      const r = await send("/api/fund/ar-adjust", { method: "POST", body: JSON.stringify({ patient_type: patientType, ref: debtRef, amount: Number(amount), reason }) });
      if (!r.ok) return setResult({ ok: false, text: r.error });
      setResult({ ok: true, text: "ส่งคำขอแล้ว รอผู้ดูแลระบบอนุมัติ" });
      setAmount("");
      setReason("");
    });
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm"
    >
      <h3 className="font-semibold">ขอปรับปรุงลูกหนี้รายนี้</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-muted">จำนวนเงิน (บาท) เพิ่มหนี้ใส่บวก ลดหนี้ใส่ลบ</span>
          <input required inputMode="decimal" pattern="-?\d+(\.\d{1,2})?" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${FIELD} w-40 text-right tabular-nums`} />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-muted">เหตุผล</span>
          <input required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={`${FIELD} min-w-56`} />
        </label>
        <button type="submit" disabled={pending} className={primary}>{pending ? "กำลังส่ง…" : "ส่งคำขอ"}</button>
      </div>
      {result && <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-success" : "text-danger"}>{result.text}</p>}
    </form>
  );
}

const STATUS = { pending: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ไม่อนุมัติ" } as const;

/** รายการคำขอ: รออนุมัติทั้งหมด + ตัดสินแล้วล่าสุด ผู้ดูแลระบบอนุมัติ/ไม่อนุมัติได้ (ยกเว้นคำขอของตัวเอง) */
export function AdjustRequests() {
  const { data, error, retry } = useJson<AdjustData>("/api/fund/ar-adjust");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  if (error) return <Notice title={`โหลดคำขอปรับปรุงไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />;
  if (!data) return null;
  const waiting = data.requests.filter((r) => r.status === "pending").length;

  function decide(id: string, approve: boolean) {
    const note = approve ? "" : (prompt("เหตุผลที่ไม่อนุมัติ") ?? "");
    setResult(undefined);
    startTransition(async () => {
      const r = await send("/api/fund/ar-adjust", { method: "PATCH", body: JSON.stringify({ id, approve, note }) });
      setResult(r.ok ? { ok: true, text: approve ? `อนุมัติคำขอ #${id} และลงสมุดลูกหนี้แล้ว` : `ไม่อนุมัติคำขอ #${id}` } : { ok: false, text: r.error });
      retry();
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-title">
        คำขอปรับปรุงลูกหนี้ {waiting > 0 && <span className="text-warning">· รออนุมัติ {formatCount(waiting)}</span>}
      </h2>
      {result && <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.text}</p>}
      {data.requests.length === 0 ? (
        <p className="text-sm text-muted">ยังไม่มีคำขอ ส่งคำขอได้จากหน้ารายละเอียดของรายการในสมุดลูกหนี้</p>
      ) : (
        <Table
          head={
            <>
              <th className={TH}>#</th>
              <th className={TH}>ลูกหนี้</th>
              <th className={TH}>บัญชี</th>
              <th className={`${TH} ${num}`}>คงเหลือ (บาท)</th>
              <th className={`${TH} ${num}`}>ขอปรับ (บาท)</th>
              <th className={TH}>เหตุผล</th>
              <th className={TH}>ผู้ขอ</th>
              <th className={TH}>สถานะ</th>
              <th className={TH}><span className="sr-only">ตัดสิน</span></th>
            </>
          }
        >
          {data.requests.map((r) => (
            <tr key={r.id} className="border-t border-line hover:bg-surface-sunken">
              <td className={`${TD} tabular-nums`}>{r.id}</td>
              <td className={`${TD} whitespace-nowrap tabular-nums`}>{r.patient_type} {r.an ? `AN ${r.an}` : r.vn ? `VN ${r.vn}` : r.ref}</td>
              <td className={`${TD} tabular-nums`}>{r.account_code ?? "–"}</td>
              <td className={`${TD} ${num}`}><Money value={r.balance == null ? null : Number(r.balance)} /></td>
              <td className={`${TD} ${num}`}><Money value={Number(r.amount)} /></td>
              <td className={`${TD} min-w-48`}>{r.reason}{r.decision_note && <span className="block text-xs text-muted">หมายเหตุ: {r.decision_note}</span>}</td>
              <td className={`${TD} whitespace-nowrap`}>{r.requested_by}<span className="block text-xs text-muted tabular-nums">{thaiDateTime(r.requested_at)}</span></td>
              <td className={`${TD} whitespace-nowrap ${r.status === "pending" ? "text-warning" : r.status === "approved" ? "text-success" : "text-muted"}`}>
                {STATUS[r.status]}
                {r.decided_by && <span className="block text-xs text-muted">{r.decided_by}</span>}
              </td>
              <td className={`${TD} text-right whitespace-nowrap`}>
                {r.status === "pending" && data.canApprove && r.requested_by !== data.me && (
                  <>
                    <button type="button" disabled={pending} onClick={() => decide(r.id, true)} className={`${btn} h-7 px-2.5 disabled:opacity-50`}>อนุมัติ</button>{" "}
                    <button type="button" disabled={pending} onClick={() => decide(r.id, false)} className={`${btn} h-7 px-2.5 text-danger disabled:opacity-50`}>ไม่อนุมัติ</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}
