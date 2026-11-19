"use client";

import { useReducer, useRef, useState } from "react";
import { Check, CloudDownload, Copy, Download } from "lucide-react";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { formatCount } from "@/lib/number-format";
import { THAI_MONTHS_SHORT, formatThaiDate } from "@/lib/thai-date";
import * as sync from "../../../../../extension/eclaim-sync/lib/sync.js";
import type { Plan, Todo } from "../../../../../extension/eclaim-sync/lib/sync.js";
import manifest from "../../../../../extension/eclaim-sync/manifest.json";
import { btn, focusRing, num } from "../_components/ui";
import { detectExtension, pageIo } from "./eclaim-bridge";

/** นำเข้าแล้วอย่างน้อย 1 ไฟล์ REP: rep-import.tsx ฟังแล้วโหลดตารางใหม่ */
export const REP_IMPORTED_EVENT = "bkh:rep-imported";

type Phase = "idle" | "planning" | "planned" | "running" | "done";

const primary = `inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:pointer-events-none disabled:opacity-40 ${focusRing}`;
const selectCls = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium disabled:opacity-40 ${focusRing}`;
// เวอร์ชันที่ฝังตอน build ตรงกับ zip ที่ route ส่ง (อ่าน manifest.json ไฟล์เดียวกัน)
const EXT_VERSION = manifest.version;
const EXT_ZIP = "/api/fund/rep-import/extension";
const chip = "rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";
const RESULT: Record<string, { label: string; className: string }> = {
  pending: { label: "รอ", className: "border-line bg-surface-sunken text-muted" },
  active: { label: "กำลังนำเข้า", className: "border-accent bg-accent-soft text-accent-text" },
  imported: { label: "สำเร็จ", className: "border-success-line bg-success-soft text-success" },
  duplicate: { label: "นำเข้าแล้ว", className: "border-warning-line bg-warning-soft text-warning" },
  unsupported: { label: "ยังไม่รองรับ", className: "border-warning-line bg-warning-soft text-warning" },
  error: { label: "ไม่สำเร็จ", className: "border-danger-line bg-danger-soft text-danger" },
};
const COLS = [
  ["found", "พบ"],
  ["already", "นำเข้าไว้แล้ว"],
  ["pending", "รอนำเข้า"],
  ["imported", "นำเข้าใหม่"],
  ["skipped", "ข้าม"],
  ["failed", "ไม่สำเร็จ"],
] as const;

const monthLabel = (ym: string) => `${THAI_MONTHS_SHORT[Number(ym.slice(5, 7)) - 1]} ${Number(ym.slice(0, 4)) + 543}`;
const ymOf = ({ y, m }: { y: number; m: number }) => `${y}-${String(m).padStart(2, "0")}`;

/** เดือนให้เลือก: ต.ค. ของ 2 ปีงบก่อนถึงเดือนนี้ จัดกลุ่มตามปีงบ (พ.ศ.) */
function monthGroups(now: string) {
  const start = `${Number(sync.fiscalRange(now).from.slice(0, 4)) - 2}-10`;
  const groups = new Map<number, string[]>();
  for (const ym of sync.months(start, now).map(ymOf)) {
    const fy = sync.fiscalYear(ym) + 543;
    groups.set(fy, [...(groups.get(fy) ?? []), ym]);
  }
  return [...groups];
}

/** ข้อความหนึ่งบรรทัดพร้อมปุ่มคัดลอก (chrome:// เปิดจากลิงก์บนเว็บไม่ได้ ผู้ใช้ต้องวางเอง) */
function CopyLine({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 1500);
  }
  return (
    <div className="flex items-center gap-1 rounded-md border border-line bg-surface-sunken py-0.5 pr-0.5 pl-2">
      <code className="min-w-0 flex-1 truncate font-mono text-sm" title={text}>{text}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={`คัดลอก${label}`}
        title={state === "fail" ? "คัดลอกไม่ได้ ให้เลือกข้อความเอง" : `คัดลอก${label}`}
        className={`inline-flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-foreground ${focusRing}`}
      >
        {state === "ok" ? <Check className="size-3.5 text-success" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      </button>
      <span role="status" className="sr-only">{state === "ok" ? "คัดลอกแล้ว" : state === "fail" ? "คัดลอกไม่ได้" : ""}</span>
    </div>
  );
}

function DownloadExtension() {
  return (
    <a href={EXT_ZIP} download className={`${primary} w-fit`}>
      <Download className="size-4" aria-hidden="true" />
      ดาวน์โหลด extension (เวอร์ชัน {EXT_VERSION})
    </a>
  );
}

function InstallSteps() {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="rounded-md border border-warning-line bg-warning-soft px-3 py-2 text-warning">
        ยังไม่พบ extension BKH Insight – e-Claim sync ใน Chrome นี้
      </p>
      <ol className="flex list-decimal flex-col gap-3 pl-4">
        {/* li ต้องไม่เป็น flex ไม่งั้นเลขลำดับหาย */}
        <li>
          ดาวน์โหลดไฟล์ zip ของ extension
          <div className="mt-2">
            <DownloadExtension />
          </div>
        </li>
        <li>
          แตกไฟล์ zip ไว้ในโฟลเดอร์ถาวร เช่น <code className="font-mono">{String.raw`C:\bkh-insight\eclaim-sync`}</code> ห้ามลบหรือย้ายโฟลเดอร์ภายหลัง
          เพราะ Chrome โหลด extension จากโฟลเดอร์นี้ทุกครั้ง
        </li>
        <li>
          เปิดหน้าจัดการส่วนขยาย เปิด &quot;โหมดนักพัฒนาซอฟต์แวร์&quot; (Developer mode) มุมขวาบน แล้วกด
          &quot;โหลดส่วนขยายที่คลายการบีบอัดแล้ว&quot; (Load unpacked) เลือกโฟลเดอร์ที่แตกไว้ (โฟลเดอร์ที่มีไฟล์{" "}
          <code className="font-mono">manifest.json</code>)
          <div className="mt-1">
            <CopyLine text="chrome://extensions" label="ที่อยู่หน้าจัดการส่วนขยาย" />
          </div>
        </li>
        <li>
          รีเฟรชหน้านี้ แล้วกด &quot;นำเข้าอัตโนมัติ&quot; อีกครั้ง
          <div className="mt-2">
            <button type="button" className={btn} onClick={() => location.reload()}>
              รีเฟรชหน้า
            </button>
          </div>
        </li>
      </ol>
      <p className="text-muted">ทุกครั้งที่ใช้ ต้องเปิดแท็บ e-Claim ที่ login ThaiD ไว้ใน Chrome เดียวกัน</p>
    </div>
  );
}

/** ปุ่ม "นำเข้าอัตโนมัติ": ดึง REP/STM จากแท็บ e-Claim ผ่าน extension แล้วนำเข้าด้วย route นำเข้าเดิม */
export function AutoImport() {
  const [open, setOpen] = useState(false);
  // เดือนนี้อ่านตอนเปิด modal ไม่ใช่ตอน render (cacheComponents ห้าม new Date() ระหว่าง prerender)
  const [now, setNow] = useState("");
  const [ext, setExt] = useState<"unknown" | "checking" | "missing" | "ok">("unknown");
  const [extVersion, setExtVersion] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [active, setActive] = useState<Todo | null>(null);
  const [error, setError] = useState("");
  // plan/run แก้ตัวนับใน plan เดิม จึงสั่ง render เองหลังแต่ละไฟล์
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const abort = useRef<AbortController | null>(null);
  const busy = phase === "planning" || phase === "running";

  async function openModal() {
    setOpen(true);
    if (!now) {
      const n = sync.thaiMonthNow();
      setNow(n);
      setRange(sync.fiscalRange(n));
    }
    if (ext === "ok") return;
    setExt("checking");
    const v = await detectExtension();
    setExtVersion(v ?? "");
    setExt(v ? "ok" : "missing");
  }

  function pick(key: "from" | "to", ym: string) {
    // ช่วงกลับด้าน: เลื่อนอีกฝั่งตาม
    setRange((r) => (key === "from" ? { from: ym, to: ym > r.to ? ym : r.to } : { from: ym < r.from ? ym : r.from, to: ym }));
    setPlan(null);
    setPhase("idle");
    setError("");
  }

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  async function check() {
    const bad = sync.rangeError(range.from, range.to, now);
    if (bad) return setError(bad);
    abort.current = new AbortController();
    setError("");
    setPlan(null);
    setPhase("planning");
    setProgress({ done: 0, total: 0, label: "" });
    try {
      setPlan(await sync.plan(range, pageIo, { signal: abort.current.signal, onProgress: setProgress }));
      setPhase("planned");
    } catch (e) {
      fail(e);
      setPhase("idle");
    }
  }

  async function runImport() {
    if (!plan) return;
    abort.current = new AbortController();
    setError("");
    setPhase("running");
    let repImported = false;
    const next = () => setActive(plan.todo.find((t) => !t.result) ?? null);
    next();
    try {
      await sync.run(plan, pageIo, {
        signal: abort.current.signal,
        onItem: (t) => {
          if (t.result?.status === "imported" && t.path === "/api/fund/rep-import") repImported = true;
          next();
          rerender();
        },
      });
    } catch (e) {
      fail(e);
    } finally {
      setActive(null);
      setPhase("done");
      if (repImported) window.dispatchEvent(new Event(REP_IMPORTED_EVENT));
    }
  }

  // numeric: 1.0.10 ใหม่กว่า 1.0.9
  const outdated = extVersion.localeCompare(EXT_VERSION, undefined, { numeric: true }) < 0;
  const remaining = plan?.todo.filter((t) => !t.result).length ?? 0;
  const handled = (plan?.todo.length ?? 0) - remaining;
  const groups = plan ? Object.entries(plan.stats) : [];
  const pct = phase === "planning" ? (progress.total ? progress.done / progress.total : 0) : plan?.todo.length ? handled / plan.todo.length : 0;

  return (
    <>
      <button type="button" onClick={openModal} aria-haspopup="dialog" className={`${btn} gap-1.5`}>
        <CloudDownload className="size-4" aria-hidden="true" />
        นำเข้าอัตโนมัติ
      </button>
      <DetailModal open={open} onClose={() => setOpen(false)} title="นำเข้า REP และ STM จาก e-Claim" size="medium">
        {ext === "checking" || ext === "unknown" ? (
          <p className="text-sm text-muted">กำลังตรวจหา extension…</p>
        ) : ext === "missing" ? (
          <InstallSteps />
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap items-end gap-3">
              {(["from", "to"] as const).map((key) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-muted">{key === "from" ? "ตั้งแต่เดือน" : "ถึงเดือน"}</span>
                  <select value={range[key]} disabled={busy} onChange={(e) => pick(key, e.target.value)} className={selectCls}>
                    {monthGroups(now).map(([fy, ms]) => (
                      <optgroup key={fy} label={`ปีงบ ${fy}`}>
                        {ms.map((ym) => (
                          <option key={ym} value={ym}>{monthLabel(ym)}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              ))}
              {busy ? (
                <button type="button" className={btn} onClick={() => abort.current?.abort()}>
                  ยกเลิก
                </button>
              ) : (
                <>
                  <button type="button" className={plan ? btn : primary} onClick={check}>
                    {plan ? "ตรวจรายการใหม่" : "ตรวจรายการ"}
                  </button>
                  {plan && (
                    <button type="button" className={primary} disabled={!remaining} onClick={runImport}>
                      {handled ? "นำเข้าต่อ" : "นำเข้า"} {formatCount(remaining)} ไฟล์
                    </button>
                  )}
                </>
              )}
            </div>
            <p className="text-muted">
              ใช้แท็บ e-Claim ที่ login ThaiD ไว้ใน Chrome นี้ · STM OFC อ่าน zone/จังหวัดจากหน้า Statement OFC ที่เปิดค้างในแท็บนั้น ·
              extension เวอร์ชัน <span className="tabular-nums">{extVersion}</span>
            </p>
            {outdated && (
              <div className="flex flex-col gap-2 rounded-md border border-warning-line bg-warning-soft px-3 py-2 text-warning">
                <p>
                  มีเวอร์ชันใหม่ <span className="tabular-nums">{EXT_VERSION}</span> (ติดตั้งอยู่{" "}
                  <span className="tabular-nums">{extVersion}</span>) ดาวน์โหลดแล้วแตกไฟล์ทับโฟลเดอร์เดิม จากนั้นกด Reload ของ
                  extension ที่ chrome://extensions แล้วรีเฟรชหน้านี้
                </p>
                <DownloadExtension />
              </div>
            )}

            {(busy || phase === "done") && (
              <div className="flex flex-col gap-1.5" role="status">
                <p className="tabular-nums">
                  <span className="font-semibold">
                    {phase === "planning"
                      ? `กำลังอ่านรายการ ${formatCount(progress.done)}/${formatCount(progress.total)}`
                      : `${phase === "running" ? "กำลังนำเข้า" : "นำเข้าเสร็จ"} ${formatCount(handled)}/${formatCount(plan?.todo.length ?? 0)} ไฟล์`}
                  </span>
                  {phase === "planning" && progress.label && <span className="text-muted"> · {progress.label}</span>}
                  {phase === "running" && active && <span className="text-muted"> · {active.name}</span>}
                </p>
                <div className="h-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
                  <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(pct * 100)}%` }} />
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-danger">
                {error}
              </p>
            )}

            {plan && (
              <>
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-sunken text-muted">
                      <tr>
                        <th scope="col" className="px-3 py-1.5 text-left font-medium">กลุ่ม</th>
                        {COLS.map(([k, label]) => (
                          <th key={k} scope="col" className="px-3 py-1.5 text-right font-medium whitespace-nowrap">{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {groups.map(([g, s]) => (
                        <tr key={g}>
                          <th scope="row" className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{g}</th>
                          {COLS.map(([k]) => (
                            <td key={k} className={`px-3 py-1.5 ${num} ${s[k] ? "" : "text-muted"} ${k === "failed" && s[k] ? "font-semibold text-danger" : ""}`}>
                              {formatCount(s[k])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ul className="flex flex-col gap-1 text-muted">
                  {plan.skips.map((s) => (
                    <li key={`${s.g}|${s.reason}`}>ข้าม {s.g}: {s.reason}{s.n > 1 ? ` (${formatCount(s.n)} ไฟล์)` : ""}</li>
                  ))}
                  <li>{sync.STM_UNSUPPORTED}</li>
                  {plan.stats["STM OFC"]?.found ? <li className="text-warning">{sync.OFC_DATE_NOTE}</li> : null}
                </ul>

                {plan.failures.length > 0 && (
                  <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-danger">
                    {plan.failures.map((f, i) => (
                      <li key={i} className="break-words">ไม่สำเร็จ {f.g} {f.what}: {f.msg}</li>
                    ))}
                  </ul>
                )}

                {plan.todo.length > 0 && (
                  <ul aria-label="ไฟล์ที่จะนำเข้า" className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                    {plan.todo.map((t) => {
                      const r = RESULT[t === active ? "active" : (t.result?.status ?? "pending")] ?? RESULT.error;
                      return (
                        <li key={t.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                          <span className={`${chip} ${r.className}`}>{r.label}</span>
                          <span className="min-w-0 truncate font-medium">{t.name}</span>
                          {t.repNo && <span className="text-muted tabular-nums">REP {t.repNo}</span>}
                          {t.date && <span className="text-muted">ออก {formatThaiDate(t.date)}</span>}
                          {t.result?.status === "imported" && t.result.rows != null && (
                            <span className="text-muted tabular-nums">{formatCount(t.result.rows)} แถว</span>
                          )}
                          {t.result?.error && <span className="text-danger">{t.result.error}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </DetailModal>
    </>
  );
}
