"use client";

import { useState, useSyncExternalStore } from "react";
import { AuthNotice } from "@/components/auth-card/auth-card";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { ClosePage, CloseResult } from "@/app/api/fund/close-privilege/route";
import { msUntilMidnight } from "@/app/api/fund/close-privilege/nhso";
import { Money, btn, focusRing, num, useJson, useUrlParams } from "../_components/ui";

const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium ${focusRing}`;
const primary = `inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const TH = "px-3 py-2.5 font-medium whitespace-nowrap";
const TD = "px-3 py-1.5 whitespace-nowrap";
const ZONE_LABEL = { test: "Test Zone", prod: "Production" } as const;
const WARN_BEFORE_MS = 2 * 3_600_000; // เตือนตั้งแต่ 22.00 น.

// นาทีปัจจุบัน (ปัดลง 30 วินาที) ฝั่ง server คืน null จึงไม่ต้องกลัว hydration ไม่ตรง
const TICK_MS = 30_000;
const subscribe = (cb: () => void) => {
  const id = setInterval(cb, TICK_MS);
  return () => clearInterval(id);
};
const useNowTick = () => useSyncExternalStore(subscribe, () => Math.floor(Date.now() / TICK_MS) * TICK_MS, () => null);

type Item = { vn: string; state: "wait" | "sending" | "done"; result?: CloseResult };

function timeLeft(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`;
}

export function ClosePrivilege({ funds }: { funds: { code: string; name: string }[] }) {
  const { fund: fundParam, set } = useUrlParams(["fund"] as const);
  const fund = fundParam || "UCS";
  const { data, error, loading, retry } = useJson<ClosePage>(`/api/fund/close-privilege?fund=${encodeURIComponent(fund)}`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState<Item[] | null>(null);
  const now = useNowTick();

  const rows = data?.rows ?? [];
  const chosen = rows.filter((r) => selected.has(r.vn));
  const sending = run?.some((i) => i.state !== "done") ?? false;
  const blocked = data ? [...(data.missing.length ? [`ยังไม่ได้ตั้งค่า ${data.missing.join(", ")}`] : []), ...(data.recorderError ? [data.recorderError] : [])] : [];
  const left = now === null ? null : msUntilMidnight(now);
  const allOn = rows.length > 0 && chosen.length === rows.length;

  function toggle(vn: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(vn)) next.delete(vn);
      else next.add(vn);
      return next;
    });
  }

  // ทีละรายตามลำดับ หนึ่ง POST ต่อราย ให้เห็นผลรายต่อราย ; error ทั้งคำขอ (เช่น ยังไม่ตั้งค่า) หยุดรายที่เหลือ
  async function send() {
    const vns = chosen.map((r) => r.vn);
    const items: Item[] = vns.map((vn) => ({ vn, state: "wait" }));
    const update = (i: number, patch: Partial<Item>) => {
      items[i] = { ...items[i], ...patch };
      setRun([...items]);
    };
    setRun([...items]);
    for (let i = 0; i < vns.length; i++) {
      update(i, { state: "sending" });
      const res = await fetch("/api/fund/close-privilege", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vns: [vns[i]] }),
      }).catch(() => null);
      const body = await res?.json().catch(() => null);
      const result: CloseResult | undefined = res?.ok ? body?.results?.[0] : undefined;
      if (result) {
        update(i, { state: "done", result });
        continue;
      }
      const msg = body?.error ?? (res ? `ส่งไม่สำเร็จ (HTTP ${res.status})` : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
      update(i, { state: "done", result: { vn: vns[i], ok: false, error: msg } });
      for (let j = i + 1; j < vns.length; j++) update(j, { state: "done", result: { vn: vns[j], ok: false, error: "ไม่ได้ส่ง" } });
      break;
    }
    setSelected(new Set());
    retry();
  }

  const okCount = run?.filter((i) => i.result?.ok).length ?? 0;
  const failCount = run?.filter((i) => i.result && !i.result.ok).length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="กองทุน" value={fund} onChange={(e) => set({ fund: e.target.value === "UCS" ? null : e.target.value })} className={SELECT_CLASS}>
          {funds.map((f) => (
            <option key={f.code} value={f.code}>
              {f.code === f.name ? f.code : `${f.code} ${f.name}`}
            </option>
          ))}
        </select>
        {data && <span className="text-sm text-muted">วันที่รับบริการ <span className="font-medium text-foreground">{formatThaiDate(data.date)}</span></span>}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {run && (
            <button type="button" onClick={() => setOpen(true)} className={btn}>
              {sending ? `กำลังส่ง ${formatCount(okCount + failCount)}/${formatCount(run.length)} ราย` : `ผลการส่งล่าสุด: สำเร็จ ${formatCount(okCount)} ไม่สำเร็จ ${formatCount(failCount)}`}
            </button>
          )}
          {data && (
            <span className={`rounded border px-1.5 py-0.5 text-sm ${data.zone === "test" ? "border-warning-line bg-warning-soft text-warning" : "border-line text-muted"}`}>
              {ZONE_LABEL[data.zone]}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setRun(null);
              setOpen(true);
            }}
            disabled={!chosen.length || blocked.length > 0 || sending}
            className={primary}
          >
            ปิดสิทธิ {formatCount(chosen.length)} รายที่เลือก
          </button>
        </div>
      </div>

      {blocked.map((m) => (
        <AuthNotice key={m} tone="warning">
          ปิดสิทธิยังไม่ได้: {m}
        </AuthNotice>
      ))}
      {left !== null && left <= WARN_BEFORE_MS && (
        <AuthNotice tone="danger">ปิดสิทธิ visit ของวันนี้ได้อีก {timeLeft(left)} (ถึง 24.00 น.)</AuthNotice>
      )}

      {error ? (
        <p role="alert" className="flex items-center gap-3 text-sm text-danger">
          {error}
          <button type="button" onClick={retry} className={btn}>
            ลองใหม่
          </button>
        </p>
      ) : (
        <div className={`overflow-x-auto rounded-lg border border-line ${loading && data ? "opacity-60" : ""}`}>
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead className="bg-surface text-left text-grid-head text-muted">
              <tr>
                <th className="w-0 py-2.5 pr-1 pl-3">
                  <input
                    type="checkbox"
                    aria-label="เลือกทุกรายที่แสดง"
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = chosen.length > 0 && !allOn;
                    }}
                    disabled={!rows.length}
                    onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.vn)))}
                    className="block size-4 accent-accent"
                  />
                </th>
                <th className={TH}>เวลามา</th>
                <th className={TH}>VN</th>
                <th className={TH}>HN</th>
                <th className={TH}>สิทธิ</th>
                <th className={TH}>แผนกหลัก</th>
                <th className={TH}>สถานะ/แผนกปัจจุบัน</th>
                <th className={TH}>รหัส Authen</th>
                <th className={`${TH} ${num}`}>ยอดลูกหนี้สิทธิ (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <tr className="border-t border-line">
                  <td colSpan={9} className="px-3 py-6 text-center text-muted">
                    กำลังโหลด…
                  </td>
                </tr>
              ) : !rows.length ? (
                <tr className="border-t border-line">
                  <td colSpan={9} className="px-3 py-6 text-center text-muted">
                    ไม่มี visit ที่จบบริการแล้วและยังไม่ปิดสิทธิ
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const on = selected.has(r.vn);
                  return (
                    <tr key={r.vn} onClick={() => toggle(r.vn)} className={`cursor-pointer border-t border-line ${on ? "bg-accent-soft" : "hover:bg-surface-sunken"}`}>
                      <td className="py-1.5 pr-1 pl-3">
                        <input
                          type="checkbox"
                          aria-label={`เลือก VN ${r.vn}`}
                          checked={on}
                          onChange={() => toggle(r.vn)}
                          onClick={(e) => e.stopPropagation()}
                          className="block size-4 accent-accent"
                        />
                      </td>
                      <td className={TD}>{r.vsttime}</td>
                      <td className={TD}>{r.vn}</td>
                      <td className={TD}>{r.hn}</td>
                      <td className="min-w-40 px-3 py-1.5">{r.pttype_name}</td>
                      <td className="min-w-36 px-3 py-1.5">{r.main_dep}</td>
                      <td className="min-w-36 px-3 py-1.5">{r.cur_dep}</td>
                      <td className={TD}>{r.auth_code ?? <span className="text-muted">–</span>}</td>
                      <td className={`px-3 py-1.5 ${num}`}>
                        <Money value={r.privilege_amount} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
      {data && rows.length > 0 && (
        <p className="text-sm text-muted">
          เลือก {formatCount(chosen.length)} จาก {formatCount(rows.length)} ราย
        </p>
      )}

      <DetailModal open={open} onClose={() => setOpen(false)} title={run ? "ผลการปิดสิทธิ" : `ปิดสิทธิ ${formatCount(chosen.length)} ราย`}>
        {data && !run && (
          <div className="space-y-4 text-base">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted">จำนวน</dt>
              <dd className="font-medium">{formatCount(chosen.length)} ราย</dd>
              <dt className="text-muted">ส่งไปที่</dt>
              <dd className="font-medium">{ZONE_LABEL[data.zone]}</dd>
            </dl>
            <AuthNotice tone="warning">ผลการปิดจากหน้านี้ไม่แสดงใน HOSxP ห้ามกดปิดสิทธิรายเดียวกันซ้ำใน HOSxP</AuthNotice>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className={btn}>
                ยกเลิก
              </button>
              <button type="button" onClick={send} disabled={!chosen.length} className={primary}>
                ยืนยันปิดสิทธิ {formatCount(chosen.length)} ราย
              </button>
            </div>
          </div>
        )}
        {run && (
          <div className="space-y-3 text-base">
            <ol aria-live="polite" className="divide-y divide-line rounded-lg border border-line">
              {run.map((i) => (
                <li key={i.vn} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2">
                  <span className="tabular-nums">VN {i.vn}</span>
                  {i.state === "wait" && <span className="text-muted">รอส่ง</span>}
                  {i.state === "sending" && <span className="text-muted">กำลังส่ง…</span>}
                  {i.result?.ok && <span className="font-medium text-success">สำเร็จ {i.result.authenCode}</span>}
                  {i.result && !i.result.ok && <span className="text-danger">ไม่สำเร็จ: {i.result.error}</span>}
                </li>
              ))}
            </ol>
            {!sending && (
              <div className="flex items-center justify-between gap-3">
                <p role="status" className="font-medium">
                  สำเร็จ {formatCount(okCount)} ราย · ไม่สำเร็จ {formatCount(failCount)} ราย
                </p>
                <button type="button" onClick={() => setOpen(false)} className={btn}>
                  ปิด
                </button>
              </div>
            )}
          </div>
        )}
      </DetailModal>
    </div>
  );
}
