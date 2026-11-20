"use client";

import { useState, useSyncExternalStore } from "react";
import { AuthNotice } from "@/components/auth-card/auth-card";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { ClosePage, CloseRow } from "@/app/api/fund/close-privilege/route";
import { DISPENSE_LABEL, type DispenseStatus } from "@/app/api/fund/close-privilege/dispense";
import { msUntilMidnight } from "@/app/api/fund/close-privilege/nhso";
import { Money, btn, focusRing, num, useJson, useUrlParams } from "../_components/ui";
import { CloseConfirm, CloseResults, ZONE_LABEL, blockedReasons, primary, runClose, tally, type CloseItem } from "./close-run";

const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium ${focusRing}`;
const TH = "px-3 py-2.5 font-medium whitespace-nowrap";
const TD = "px-3 py-1.5 whitespace-nowrap";
const WARN_BEFORE_MS = 2 * 3_600_000; // เตือนตั้งแต่ 22.00 น.

// นาทีปัจจุบัน (ปัดลง 30 วินาที) ฝั่ง server คืน null จึงไม่ต้องกลัว hydration ไม่ตรง
const TICK_MS = 30_000;
const subscribe = (cb: () => void) => {
  const id = setInterval(cb, TICK_MS);
  return () => clearInterval(id);
};
const useNowTick = () => useSyncExternalStore(subscribe, () => Math.floor(Date.now() / TICK_MS) * TICK_MS, () => null);

const BADGE = "rounded border px-1.5 py-0.5 text-sm whitespace-nowrap";
const DISPENSE_TONE: Record<Exclude<DispenseStatus, "none">, string> = {
  dispensed: "border-success-line bg-success-soft text-success",
  er: "border-line text-muted",
  self: "border-line text-muted",
  pending: "border-warning-line bg-warning-soft text-warning",
};

// แสดงอย่างเดียว ไม่กันการปิดสิทธิ
function Dispense({ row }: { row: CloseRow }) {
  if (row.dispense === "none")
    return (
      <span className="text-muted" title={DISPENSE_LABEL.none} aria-label={DISPENSE_LABEL.none}>
        –
      </span>
    );
  const at = row.dispensed_at;
  const title =
    row.dispense === "dispensed" ? (at ? `จ่ายยา ${formatThaiDate(at)} ${at.slice(11, 16)}` : undefined) : row.dispense === "pending" ? undefined : "ไม่มีบันทึกจ่ายยาที่ห้องยา";
  return (
    <span className={`${BADGE} ${DISPENSE_TONE[row.dispense]}`} title={title}>
      {DISPENSE_LABEL[row.dispense]}
    </span>
  );
}

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
  const [run, setRun] = useState<CloseItem[] | null>(null);
  const now = useNowTick();

  const rows = data?.rows ?? [];
  const chosen = rows.filter((r) => selected.has(r.vn));
  const sending = run?.some((i) => i.state !== "done") ?? false;
  const blocked = data ? blockedReasons(data) : [];
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

  async function send() {
    await runClose(chosen.map((r) => r.vn), setRun);
    setSelected(new Set());
    retry();
  }

  const { ok: okCount, fail: failCount } = tally(run);

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
                <th className={TH}>รับยา</th>
                <th className={TH}>รหัส Authen</th>
                <th className={`${TH} ${num}`}>ยอดลูกหนี้สิทธิ (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <tr className="border-t border-line">
                  <td colSpan={10} className="px-3 py-6 text-center text-muted">
                    กำลังโหลด…
                  </td>
                </tr>
              ) : !rows.length ? (
                <tr className="border-t border-line">
                  <td colSpan={10} className="px-3 py-6 text-center text-muted">
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
                      <td className={TD}>
                        <Dispense row={r} />
                      </td>
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
        {data && !run && <CloseConfirm zone={data.zone} count={chosen.length} unit="ราย" onCancel={() => setOpen(false)} onConfirm={send} />}
        {run && <CloseResults run={run} onClose={() => setOpen(false)} />}
      </DetailModal>
    </div>
  );
}
