"use client";

import { useEffect, useState, useTransition } from "react";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { formatBaht, formatCount } from "@/lib/number-format";
import { THAI_MONTHS, formatThaiDate, todayIso } from "@/lib/thai-date";
import { LEDGER_START } from "@/app/api/fund/ar-sync/ledger";
import { DEFAULT_SIGNERS, MAX_DAYS, REPORTS, type PatientType, type ReportKind, type Signer } from "@/app/api/fund/ar-report/report";
import type { ArReport } from "@/app/api/fund/ar-report/route";
import type { SignerList } from "@/app/api/fund/ar-report/signers/route";
import { Notice, Skeleton, btn, focusRing, num, useJson, useUrlParams } from "../_components/ui";
import { FIELD, MonthSelect, Status, primary, send } from "../fwf-card/shared";

const KINDS: { key: ReportKind; label: string }[] = [
  { key: "daily", label: "ลูกหนี้ประจำวัน" },
  { key: "balance", label: "คงเหลือประจำเดือน" },
];
const TYPES: { key: PatientType; label: string }[] = [
  { key: "OP", label: "ผู้ป่วยนอก (OP)" },
  { key: "IP", label: "ผู้ป่วยใน (IP)" },
];
const TH = "px-3 py-2 font-medium";
const TD = "px-3 py-1.5";
const BLANK_NAME = "..............................";

// ตอนพิมพ์: ซ่อน sidebar/topbar (:has ซ้อนกันไม่ได้ ซ้อนแล้วทั้งกฎถูกทิ้ง) ของ AppShell ให้เหลือแค่ <main> ปลดความสูง/scroll ของ shell ให้ตารางยาวขึ้นหน้าใหม่ได้
// และกระดาษเป็นธีมสว่างเสมอ (ค่าเดียวกับ :root ใน globals.css) แม้หน้าจอเปิดธีมมืด
const PRINT_CSS = `@media print {
  @page { size: A4 portrait; margin: 12mm; }
  :root, [data-theme="dark"] { color-scheme: light; --background: #ffffff; --surface: #ffffff; --surface-sunken: #f6f8f5; --line: #c9cfc6; --foreground: #18201b; --muted: #5c665f; }
  html, body { height: auto !important; background: var(--surface) !important; }
  :has(> #main) > :not(#main), :has(> aside + div > #main) > aside { display: none !important; }
  :has(> #main), :has(> aside + div > #main) { display: block !important; height: auto !important; overflow: visible !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; }
  #main { overflow: visible !important; padding: 0 !important; }
  tr, .ar-sign { break-inside: avoid; }
}`;

const tab = (on: boolean) => `h-8 rounded px-3 text-sm font-medium ${focusRing} ${on ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-hover"}`;
const bkkTime = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false });
const printedNow = () => `${formatThaiDate(todayIso())} ${bkkTime.format(new Date())} น.`;
const monthLong = (m: string) => `${THAI_MONTHS[+m.slice(5, 7) - 1]} ${+m.slice(0, 4) + 543}`;

/** เดือนเริ่มต้น = เดือนก่อน (เดือนล่าสุดที่จบแล้ว) ไม่ก่อนเดือนเริ่มสมุด */
function defaultMonth(today: string) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return prev < LEDGER_START.slice(0, 7) ? LEDGER_START.slice(0, 7) : prev;
}

function Tabs<K extends string>({ label, items, value, onChange }: { label: string; items: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-md border border-line p-0.5">
      {items.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === value} onClick={() => onChange(t.key)} className={tab(t.key === value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ReportSheet({ data, signers, printedAt }: { data: ArReport; signers: Signer[]; printedAt: string }) {
  const def = REPORTS[data.report];
  const type = TYPES.find((t) => t.key === data.patient_type)!.label;
  const s = formatThaiDate(data.start, "long"), e = formatThaiDate(data.end, "long");
  const title = `${def.title}${type}${data.month ? ` ประจำเดือน${monthLong(data.month)}` : ""}`;
  const sub = data.month ? `ณ วันที่ ${e}` : data.start === data.end ? `ประจำวันที่ ${s}` : `ระหว่างวันที่ ${s} ถึง ${e}`;

  return (
    <article aria-labelledby="ar-report-title" className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-0.5 text-center">
        <h2 id="ar-report-title" className="text-title">{title}</h2>
        <p className="text-base">{sub}</p>
        <p className="text-sm text-muted">พิมพ์เมื่อ {printedAt}</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line print:overflow-visible">
        <table className="w-full border-collapse text-sm tabular-nums">
          <caption className="sr-only">{title} {sub}</caption>
          <thead className="bg-surface-sunken text-left text-grid-head text-muted">
            <tr>
              <th scope="col" className={TH}>{def.code}</th>
              <th scope="col" className={`${TH} w-full`}>ชื่อบัญชี</th>
              <th scope="col" className={`${TH} ${num}`}>{def.count}</th>
              {def.money.map((m) => <th key={m.key} scope="col" className={`${TH} ${num}`}>{m.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.account_code ?? "null"} className="border-t border-line">
                <td className={`${TD} whitespace-nowrap`}>{r.account_code ?? <span className="text-muted">–</span>}</td>
                <td className={`${TD} ${r.account_code ? "" : "text-warning"}`}>{r.account_name}</td>
                <td className={`${TD} ${num}`}>{formatCount(r.n)}</td>
                {r.money.map((v, i) => <td key={i} className={`${TD} ${num}`}>{formatBaht(v)}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line font-semibold">
              <th scope="row" colSpan={2} className={`${TD} text-left`}>รวม</th>
              <td className={`${TD} ${num}`}>{formatCount(data.total.n)}</td>
              {data.total.money.map((v, i) => <td key={i} className={`${TD} ${num}`}>{formatBaht(v)}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="ar-sign mt-10 grid grid-cols-3 gap-6 text-center text-base">
        {signers.map((s) => (
          <div key={s.slot} className="flex flex-col items-center gap-1">
            <span>{s.role_label}</span>
            <span aria-hidden="true" className="mt-10 w-full max-w-56 border-b border-dotted border-foreground" />
            <span>({s.person_name ?? BLANK_NAME})</span>
            <span>{s.position ?? ""}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function SignerEditor({ initial, onSaved }: { initial: Signer[]; onSaved: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const [pending, startTransition] = useTransition();
  const edit = (slot: number, k: keyof Signer, v: string) => setDraft((d) => d.map((s) => (s.slot === slot ? { ...s, [k]: v } : s)));

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await send("/api/fund/ar-report/signers", "PUT", { signers: draft });
      setResult(r.ok ? { ok: true, text: "บันทึกผู้ลงนามแล้ว" } : { ok: false, text: r.error });
      if (r.ok) onSaved();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="grid gap-4 md:grid-cols-3">
        {draft.map((s) => (
          <fieldset key={s.slot} className="flex flex-col gap-2 rounded-lg border border-line px-3 py-3">
            <legend className="px-1 text-sm text-muted">ช่องที่ {s.slot}</legend>
            {([["role_label", "หัวข้อ"], ["person_name", "ชื่อ-สกุล"], ["position", "ตำแหน่ง"]] as const).map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1 text-sm">
                <span className="text-muted">{label}</span>
                <input value={s[k] ?? ""} required={k === "role_label"} maxLength={120} onChange={(e) => edit(s.slot, k, e.target.value)} className={FIELD} />
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>{pending ? "กำลังบันทึก…" : "บันทึกผู้ลงนาม"}</button>
        <Status result={result} />
      </div>
    </form>
  );
}

export function ArReportView() {
  const today = todayIso();
  const { report, type, month, set } = useUrlParams(["report", "type", "month"] as const);
  const kind: ReportKind = report === "balance" ? "balance" : "daily";
  const pt: PatientType = type === "IP" ? "IP" : "OP";
  const { start, end } = useDateRange(MAX_DAYS);
  const m = /^\d{4}-\d{2}$/.test(month) && month >= LEDGER_START.slice(0, 7) && month <= today.slice(0, 7) ? month : defaultMonth(today);
  const query = new URLSearchParams(kind === "daily" ? { report: kind, type: pt, start, end } : { report: kind, type: pt, month: m }).toString();
  const { data, error, loading, retry } = useJson<ArReport>(`/api/fund/ar-report?${query}`);
  const signers = useJson<SignerList>("/api/fund/ar-report/signers");
  const [printedAt, setPrintedAt] = useState(printedNow);

  useEffect(() => {
    const onPrint = () => setPrintedAt(printedNow());
    window.addEventListener("beforeprint", onPrint);
    return () => window.removeEventListener("beforeprint", onPrint);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Tabs label="รายงาน" items={KINDS} value={kind} onChange={(k) => set({ report: k === "daily" ? null : k })} />
        <Tabs label="ประเภทผู้ป่วย" items={TYPES} value={pt} onChange={(t) => set({ type: t === "OP" ? null : t })} />
        {kind === "daily" ? (
          <DateRangeFilter maxDays={MAX_DAYS} labels={{ start: "วันที่ตั้งหนี้ ตั้งแต่" }} />
        ) : (
          <MonthSelect value={m} from={LEDGER_START} onChange={(v) => set({ month: v })} />
        )}
        <div className="ml-auto flex items-center gap-2">
          <a href={`/api/fund/ar-report?${query}&format=xlsx`} download className={btn}>ส่งออก Excel</a>
          <button type="button" disabled={!data} onClick={() => window.print()} className={primary}>พิมพ์</button>
        </div>
      </div>
      <p className="text-sm text-muted print:hidden">สมุดลูกหนี้เริ่ม {formatThaiDate(LEDGER_START)} ไม่มียอดยกมาก่อนวันนั้น</p>
      {error ? (
        <Notice title={`โหลดข้อมูลไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
      ) : !data ? (
        <Skeleton rows={8} />
      ) : (
        <div aria-busy={loading}>
          <ReportSheet data={data} signers={signers.data?.signers ?? DEFAULT_SIGNERS} printedAt={printedAt} />
        </div>
      )}
      {signers.data?.can_edit && (
        <details className="rounded-lg border border-line px-4 py-3 print:hidden">
          <summary className={`cursor-pointer text-title ${focusRing}`}>ผู้ลงนามท้ายรายงาน</summary>
          <div className="mt-3">
            {signers.data.migrated ? (
              <SignerEditor key={JSON.stringify(signers.data.signers)} initial={signers.data.signers} onSaved={signers.retry} />
            ) : (
              <p className="text-sm text-muted">ยังไม่ได้รัน migration ผู้ลงนาม (202611252200_ar_report_signer.sql) ท้ายรายงานใช้หัวข้อเริ่มต้นและเว้นชื่อว่าง</p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
