"use client";

import { useState, useTransition, type ReactNode } from "react";
import { formatCount } from "@/lib/number-format";
import { THAI_MONTHS_SHORT, formatThaiDate, todayIso } from "@/lib/thai-date";
import { Money, Notice, Skeleton, btn, focusRing, num, useJson } from "@/app/(app)/fund/_components/ui";
import { UC_OP_ACCOUNTS, ledgerMonths, type PatientType } from "@/app/api/fund/ar-sync/ledger";
import type { ArAccount, ArAccountsData, Unassigned } from "@/app/api/admin/ar-accounts/route";
import type { SyncLog } from "@/app/api/fund/ar-sync/sync";

const SELECT_CLASS = `h-9 min-w-0 rounded-md border border-line bg-surface pr-8 pl-3 ${focusRing}`;
const TH = "px-3 py-2.5 font-medium";
const TD = "px-3 py-1.5";
const primary = `inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-wait disabled:opacity-60 ${focusRing}`;
const monthLabel = (m: string) => `${THAI_MONTHS_SHORT[+m.slice(5, 7) - 1]} ${+m.slice(0, 4) + 543}`;

async function send(url: string, init: RequestInit): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init }).catch(() => null);
  const body = await res?.json().catch(() => null);
  return res?.ok ? { ok: true, body } : { ok: false, error: body?.error ?? `ไม่สำเร็จ${res ? ` (HTTP ${res.status})` : ""}` };
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <h2 className="text-title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    // relative: หัวคอลัมน์ sr-only (absolute) ต้องอยู่ในกล่องที่เลื่อน ไม่ดันหน้ากว้างเกินจอ
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

/* ---------- backfill ---------- */

type MonthState = { month: string; status: "pending" | "running" | "done" | "error"; text?: string };

function Backfill() {
  const months = ledgerMonths(todayIso()).reverse(); // เก่าไปใหม่
  const [from, setFrom] = useState(months[0]);
  const [to, setTo] = useState(months[0]);
  const [states, setStates] = useState<MonthState[]>([]);
  const [running, setRunning] = useState(false);

  // ทีละเดือนจากเก่าไปใหม่ ให้ยกเลิกหนี้ของเดือนหลังเจอหนี้ที่ตั้งในเดือนก่อน หยุดที่เดือนแรกที่ error
  async function run() {
    const list = months.filter((m) => m >= from && m <= to);
    setStates(list.map((month) => ({ month, status: "pending" })));
    setRunning(true);
    for (const [i, month] of list.entries()) {
      const update = (s: Partial<MonthState>) => setStates((prev) => prev.map((x, j) => (j === i ? { ...x, ...s } : x)));
      update({ status: "running" });
      const r = await send("/api/fund/ar-sync", { method: "POST", body: JSON.stringify({ mode: "backfill", month }) });
      if (!r.ok) {
        update({ status: "error", text: r.error });
        break;
      }
      const c = (r.body as SyncLog).counts;
      const n = (k: string) => formatCount(c[k] ?? 0);
      update({ status: "done", text: `OPD ${n("opd_set")} ราย · IPD ${n("ipd_set")} ราย · ปรับปรุง ${formatCount((c.opd_adjust ?? 0) + (c.ipd_adjust ?? 0))} · ยกเลิก ${n("opd_cancel")} · กลับรายการ ${n("ipd_reverse")}` });
    }
    setRunning(false);
  }

  const STATUS = { pending: "รอ", running: "กำลังดึง…", done: "เสร็จ", error: "ไม่สำเร็จ" } as const;
  return (
    <Section title="ดึงยอดย้อนหลัง">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted">ตั้งแต่</span>
          <select value={from} disabled={running} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} className={SELECT_CLASS}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted">ถึง</span>
          <select value={to} disabled={running} onChange={(e) => setTo(e.target.value)} className={SELECT_CLASS}>
            {months.filter((m) => m >= from).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <button type="button" onClick={run} disabled={running} className={primary}>
          {running ? "กำลังดึงยอด…" : "ดึงย้อนหลัง"}
        </button>
      </div>
      {states.length > 0 && (
        <ol aria-live="polite" className="flex flex-col gap-1 text-sm tabular-nums">
          {states.map((s) => (
            <li key={s.month} className="flex flex-wrap gap-x-3">
              <span className="w-20 font-medium">{monthLabel(s.month)}</span>
              <span className={s.status === "error" ? "text-danger" : s.status === "done" ? "text-success" : "text-muted"}>{STATUS[s.status]}</span>
              {s.text && <span className={s.status === "error" ? "text-danger" : "text-muted"}>{s.text}</span>}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/* ---------- mapping ---------- */

type Draft = { by: "hipdata_code" | "pttype"; value: string; patient_type: PatientType; account_code: string };
const EMPTY: Draft = { by: "hipdata_code", value: "", patient_type: "OP", account_code: "" };
const ACCOUNT_ID = "ar-map-account";
const UC_OP_REASON = "HOSxP ไม่ได้บันทึกหน่วยบริการประจำหรือจังหวัด จึงแยกบัญชีตามหน่วยบริการประจำไม่ได้";

function MapForm({ data, draft, setDraft, onSaved }: { data: ArAccountsData; draft: Draft; setDraft: (d: Draft) => void; onSaved: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<{ ok: boolean; text: string }>();
  const options = draft.by === "pttype" ? data.pttypes.map((p) => ({ code: p.code, name: `${p.code} ${p.name}` })) : data.funds.map((f) => ({ code: f.code, name: `${f.code} ${f.name}` }));
  const ucOp = draft.by === "hipdata_code" && draft.value === "UCS" && draft.patient_type === "OP";
  const ucOpPttype = draft.by === "pttype" && draft.patient_type === "OP" && data.pttypes.find((p) => p.code === draft.value)?.fund === "UCS";

  function save() {
    setError(undefined);
    setSaved(undefined);
    const existed = data.maps.some((m) => (draft.by === "pttype" ? m.pttype : m.pttype == null && m.hipdata_code) === draft.value && m.patient_type === draft.patient_type);
    startTransition(async () => {
      const r = await send("/api/admin/ar-accounts", {
        method: "POST",
        body: JSON.stringify({ [draft.by]: draft.value, patient_type: draft.patient_type, account_code: draft.account_code }),
      });
      if (!r.ok) return setError(r.error);
      setDraft(EMPTY);
      // recompute ใส่บัญชีเฉพาะรายการที่ account_code ยังเป็น NULL จึงทำต่อจากบันทึกได้เลย ผู้ใช้ไม่ต้องจำกดเอง
      const c = await send("/api/admin/ar-accounts/recompute", { method: "POST" });
      setSaved(
        c.ok
          ? { ok: true, text: `บันทึกแล้ว · ใส่บัญชีให้รายการที่ยังไม่มีบัญชี ${formatCount((c.body as { updated: number }).updated)} รายการ${existed ? " (รายการที่มีบัญชีแล้วคงบัญชีเดิม)" : ""}` }
          : { ok: false, text: `บันทึกแล้ว แต่ใส่บัญชีให้รายการเดิมไม่สำเร็จ: ${c.error} · กด คำนวณบัญชีใหม่` },
      );
      onSaved();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-wrap items-end gap-3 text-sm"
    >
      <label className="flex flex-col gap-1">
        <span className="text-muted">จับคู่ตาม</span>
        <select value={draft.by} onChange={(e) => setDraft({ ...draft, by: e.target.value as Draft["by"], value: "" })} className={SELECT_CLASS}>
          <option value="hipdata_code">กองทุน</option>
          <option value="pttype">สิทธิ (pttype)</option>
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-muted">{draft.by === "pttype" ? "สิทธิ" : "กองทุน"}</span>
        <select required value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} className={`${SELECT_CLASS} max-w-72`}>
          <option value="" disabled>เลือก</option>
          {options.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">ประเภท</span>
        <select value={draft.patient_type} onChange={(e) => setDraft({ ...draft, patient_type: e.target.value as PatientType })} className={SELECT_CLASS}>
          <option value="OP">OP</option>
          <option value="IP">IP</option>
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-muted">บัญชี</span>
        <select id={ACCOUNT_ID} required value={draft.account_code} onChange={(e) => setDraft({ ...draft, account_code: e.target.value })} className={`${SELECT_CLASS} max-w-96`}>
          <option value="" disabled>เลือก</option>
          {data.accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
        </select>
      </label>
      <button type="submit" disabled={pending || ucOp} className={primary}>
        {pending ? "กำลังบันทึก…" : "บันทึก"}
      </button>
      {ucOp && <p className="w-full text-warning">UCS OP แยกบัญชีตามหน่วยบริการประจำ ถ้าต้องการกำหนดเองให้จับคู่ราย pttype</p>}
      {ucOpPttype && <p className="w-full text-xs text-muted">กติการาย pttype ใช้ก่อนกติกาอื่น ทุก visit ของสิทธิ {draft.value} จะลงบัญชีนี้ รวมรายที่มีหน่วยบริการประจำนอก CUP</p>}
      {error && <p role="alert" className="w-full text-danger">{error}</p>}
      {saved && <p role={saved.ok ? "status" : "alert"} className={`w-full ${saved.ok ? "text-success" : "text-danger"}`}>{saved.text}</p>}
    </form>
  );
}

function Maps({ data, reload }: { data: ArAccountsData; reload: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const accountName = new Map(data.accounts.map((a) => [a.code, a.name]));
  const fundName = new Map(data.funds.map((f) => [f.code, f.name]));
  const pttypeName = new Map(data.pttypes.map((p) => [p.code, p.name]));
  // โฟกัสช่องบัญชีให้ฟอร์มเลื่อนเข้าจอ (ปุ่มจับคู่อยู่ใต้ตาราง)
  const pick = (d: Draft) => {
    setDraft(d);
    document.getElementById(ACCOUNT_ID)?.focus();
  };

  function remove(id: string) {
    setError(undefined);
    startTransition(async () => {
      const r = await send(`/api/admin/ar-accounts?${new URLSearchParams({ id })}`, { method: "DELETE" });
      if (!r.ok) setError(r.error);
      reload();
    });
  }
  const account = (code: string) => (
    <>
      <span className="whitespace-nowrap tabular-nums">{code}</span> <span className="text-muted">{accountName.get(code)}</span>
    </>
  );

  return (
    <Section title="การจับคู่บัญชี">
      <MapForm data={data} draft={draft} setDraft={setDraft} onSaved={reload} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Table
        head={
          <>
            <th className={TH}>กองทุน / สิทธิ</th>
            <th className={TH}>ประเภท</th>
            <th className={TH}>บัญชี</th>
            <th className={TH}>แก้ไขล่าสุด</th>
            <th className={TH}><span className="sr-only">จัดการ</span></th>
          </>
        }
      >
        <tr className="border-t border-line">
          <td className={TD}>UCS <span className="text-muted">{fundName.get("UCS")}</span></td>
          <td className={TD}>OP</td>
          <td className={TD}>
            <ul className="flex flex-col gap-0.5">
              <li>ใน CUP: {account(UC_OP_ACCOUNTS.cup)}</li>
              <li>นอกสังกัด สธ.: {account(UC_OP_ACCOUNTS.nonMoph)}</li>
              <li>ในจังหวัด: {account(UC_OP_ACCOUNTS.province)}</li>
              <li>ต่างจังหวัด: {account(UC_OP_ACCOUNTS.other)}</li>
            </ul>
          </td>
          <td className={`${TD} text-muted`}>ตามหน่วยบริการประจำ</td>
          <td />
        </tr>
        {data.maps.map((m) => {
          const label = m.pttype ? `สิทธิ ${m.pttype}` : (m.hipdata_code ?? "");
          return (
            <tr key={m.id} className="border-t border-line hover:bg-surface-sunken">
              <td className={TD}>
                {m.pttype ? (
                  <>สิทธิ <span className="tabular-nums">{m.pttype}</span> <span className="text-muted">{pttypeName.get(m.pttype)}</span></>
                ) : (
                  <>{m.hipdata_code} <span className="text-muted">{fundName.get(m.hipdata_code ?? "")}</span></>
                )}
              </td>
              <td className={TD}>{m.patient_type}</td>
              <td className={TD}>{account(m.account_code)}</td>
              <td className={`${TD} whitespace-nowrap text-muted tabular-nums`}>
                {m.updated_by === "migration" ? "ค่าเริ่มต้นของระบบ" : `${formatThaiDate(m.updated_at)} · ${m.updated_by ?? "–"}`}
              </td>
              <td className={`${TD} text-right whitespace-nowrap`}>
                <button
                  type="button"
                  aria-label={`แก้ไข ${label} ${m.patient_type}`}
                  onClick={() => pick({ by: m.pttype ? "pttype" : "hipdata_code", value: m.pttype ?? m.hipdata_code ?? "", patient_type: m.patient_type, account_code: m.account_code })}
                  className={`${btn} h-7 px-2.5`}
                >
                  แก้ไข
                </button>{" "}
                <button type="button" disabled={pending} aria-label={`ลบ ${label} ${m.patient_type}`} onClick={() => remove(m.id)} className={`${btn} h-7 px-2.5 text-danger disabled:opacity-50`}>
                  ลบ
                </button>
              </td>
            </tr>
          );
        })}
      </Table>
      <UnassignedList data={data} reload={reload} onPick={pick} />
    </Section>
  );
}

/* ---------- unassigned ---------- */

/** สาเหตุที่รายการยังไม่มีบัญชี และฟอร์มที่ปุ่ม "จับคู่" เติมให้ (ไม่มี pick = จับคู่ไม่ได้) ลำดับเดียวกับ accountFor */
function fixFor(u: Unassigned, data: ArAccountsData): { reason: string; fix: string; pick?: Draft } {
  const draft = (by: Draft["by"], value: string): Draft => ({ by, value, patient_type: u.patient_type, account_code: "" });
  const ucOp = u.hipdata_code === "UCS" && u.patient_type === "OP";
  const pt = u.pttype && data.pttypes.some((p) => p.code === u.pttype) ? u.pttype : null;
  const ruled = data.maps.some(
    (m) => m.patient_type === u.patient_type && ((u.pttype != null && m.pttype === u.pttype) || (!ucOp && m.pttype == null && m.hipdata_code === u.hipdata_code)),
  );
  if (ruled) return { reason: "มีกติกาแล้ว แต่รายการนี้ยังไม่ได้คำนวณบัญชี", fix: "กด คำนวณบัญชีใหม่" };
  if (ucOp) return pt ? { reason: UC_OP_REASON, fix: "จับคู่ราย pttype", pick: draft("pttype", pt) } : { reason: UC_OP_REASON, fix: "ไม่มีรหัสสิทธิ จึงจับคู่ราย pttype ไม่ได้" };
  if (u.hipdata_code && data.funds.some((f) => f.code === u.hipdata_code))
    return { reason: `กองทุน ${u.hipdata_code} ยังไม่ได้กำหนดบัญชี`, fix: "จับคู่ตามกองทุน", pick: draft("hipdata_code", u.hipdata_code) };
  const reason = u.hipdata_code ? `ไม่รู้จักกองทุน ${u.hipdata_code}` : "สิทธินี้ไม่ได้ระบุกองทุน";
  return pt ? { reason, fix: "จับคู่ราย pttype", pick: draft("pttype", pt) } : { reason, fix: "ไม่พบรหัสสิทธิใน HOSxP จึงจับคู่ไม่ได้" };
}

function UnassignedList({ data, reload, onPick }: { data: ArAccountsData; reload: () => void; onPick: (d: Draft) => void }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const pttypeName = new Map(data.pttypes.map((p) => [p.code, p.name]));

  function recompute() {
    setResult(undefined);
    startTransition(async () => {
      const r = await send("/api/admin/ar-accounts/recompute", { method: "POST" });
      setResult(r.ok ? { ok: true, text: `ใส่บัญชีแล้ว ${formatCount((r.body as { updated: number }).updated)} รายการ` } : { ok: false, text: r.error });
      reload();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">ยังไม่มีบัญชี</h3>
        <div className="flex items-center gap-3 text-sm">
          {result && <span role={result.ok ? "status" : "alert"} className={result.ok ? "text-success" : "text-danger"}>{result.text}</span>}
          <button type="button" onClick={recompute} disabled={pending} className={`${btn} disabled:cursor-wait disabled:opacity-60`}>
            {pending ? "กำลังคำนวณ…" : "คำนวณบัญชีใหม่"}
          </button>
        </div>
      </div>
      {data.unassigned.length === 0 ? (
        <p className="text-sm text-muted">ทุกรายการในสมุดลูกหนี้มีบัญชีแล้ว</p>
      ) : (
        <Table
          head={
            <>
              <th className={TH}>สิทธิ</th>
              <th className={TH}>กองทุน</th>
              <th className={TH}>ประเภท</th>
              <th className={`${TH} ${num}`}>จำนวนราย</th>
              <th className={`${TH} ${num}`}>คงเหลือ (บาท)</th>
              <th className={TH}>สาเหตุ</th>
              <th className={TH}><span className="sr-only">จับคู่</span></th>
            </>
          }
        >
          {data.unassigned.map((u) => {
            const { reason, fix, pick } = fixFor(u, data);
            return (
              <tr key={`${u.pttype}-${u.hipdata_code}-${u.patient_type}`} className="border-t border-line hover:bg-surface-sunken">
                <td className={TD}>
                  {u.pttype ? <><span className="tabular-nums">{u.pttype}</span> <span className="text-muted">{pttypeName.get(u.pttype)}</span></> : <span className="text-muted">–</span>}
                </td>
                <td className={TD}>{u.hipdata_code ?? <span className="text-muted">–</span>}</td>
                <td className={TD}>{u.patient_type}</td>
                <td className={`${TD} ${num}`}>{formatCount(u.refs)}</td>
                <td className={`${TD} ${num}`}><Money value={Number(u.amount)} /></td>
                <td className={`${TD} min-w-56`}>
                  {reason}
                  <span className="block text-muted">{fix}</span>
                </td>
                <td className={`${TD} text-right whitespace-nowrap`}>
                  {pick && (
                    <button type="button" onClick={() => onPick(pick)} aria-label={`จับคู่บัญชี${pick.by === "pttype" ? "ราย pttype" : "ตามกองทุน"} ${pick.value} ${u.patient_type}`} className={`${btn} h-7 px-2.5`}>
                      จับคู่
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

/* ---------- บัญชีคู่ (สมุดรายวัน) และการตัดหนี้ด้วย STM ---------- */

type SettingDraft = Pick<ArAccount, "code" | "revenue_code" | "diff_under_code" | "diff_over_code" | "settles_by_stm">;
const INPUT = `h-8 w-36 rounded-md border border-line bg-surface px-2 tabular-nums ${focusRing}`;

function AccountSettings({ data, reload }: { data: ArAccountsData; reload: () => void }) {
  const [draft, setDraft] = useState<SettingDraft>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const used = new Set(data.used);
  // บัญชีที่มีรายการใน ledger หรือตั้งค่าไว้แล้ว (ผังบัญชีมี ~70 บัญชี ส่วนใหญ่ไม่ได้ใช้)
  const rows = data.accounts.filter((a) => used.has(a.code) || a.revenue_code || a.settles_by_stm);

  function save() {
    if (!draft) return;
    setError(undefined);
    startTransition(async () => {
      const r = await send("/api/admin/ar-accounts/settings", { method: "POST", body: JSON.stringify(draft) });
      if (!r.ok) return setError(r.error);
      setDraft(undefined);
      reload();
    });
  }
  const code = (v: string | null) => (v ? <span className="tabular-nums">{v}</span> : <span className="text-warning">ยังไม่กำหนด</span>);
  const input = (k: "revenue_code" | "diff_under_code" | "diff_over_code", label: string) => (
    <input aria-label={label} value={draft?.[k] ?? ""} onChange={(e) => setDraft({ ...draft!, [k]: e.target.value })} className={INPUT} />
  );

  return (
    <Section title="บัญชีคู่และการตัดหนี้ด้วย STM">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Table
        head={
          <>
            <th className={TH}>บัญชีลูกหนี้</th>
            <th className={TH}>รายได้คู่</th>
            <th className={TH}>ส่วนต่าง ได้รับต่ำกว่า (Dr)</th>
            <th className={TH}>ส่วนต่าง ได้รับสูงกว่า (Cr)</th>
            <th className={TH}>ตัดหนี้ด้วย STM</th>
            <th className={TH}><span className="sr-only">จัดการ</span></th>
          </>
        }
      >
        {rows.map((a) => {
          const editing = draft?.code === a.code;
          return (
            <tr key={a.code} className="border-t border-line hover:bg-surface-sunken">
              <td className={TD}><span className="whitespace-nowrap tabular-nums">{a.code}</span> <span className="text-muted">{a.name}</span></td>
              <td className={TD}>{editing ? input("revenue_code", `รายได้คู่ของ ${a.code}`) : code(a.revenue_code)}</td>
              <td className={TD}>{editing ? input("diff_under_code", `ส่วนต่างได้รับต่ำกว่าของ ${a.code}`) : a.diff_under_code ? code(a.diff_under_code) : <span className="text-muted">–</span>}</td>
              <td className={TD}>{editing ? input("diff_over_code", `ส่วนต่างได้รับสูงกว่าของ ${a.code}`) : a.diff_over_code ? code(a.diff_over_code) : <span className="text-muted">–</span>}</td>
              <td className={TD}>
                {editing ? (
                  <input type="checkbox" aria-label={`ตัดหนี้ ${a.code} ด้วย STM`} checked={draft.settles_by_stm} onChange={(e) => setDraft({ ...draft, settles_by_stm: e.target.checked })} className="size-4 accent-accent" />
                ) : a.settles_by_stm ? "ตัด" : <span className="text-muted">ไม่ตัด</span>}
              </td>
              <td className={`${TD} text-right whitespace-nowrap`}>
                {editing ? (
                  <>
                    <button type="button" onClick={save} disabled={pending} className={`${primary} h-7`}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>{" "}
                    <button type="button" onClick={() => setDraft(undefined)} className={`${btn} h-7 px-2.5`}>ยกเลิก</button>
                  </>
                ) : (
                  <button type="button" aria-label={`แก้ไขบัญชีคู่ ${a.code}`} onClick={() => setDraft(a)} className={`${btn} h-7 px-2.5`}>แก้ไข</button>
                )}
              </td>
            </tr>
          );
        })}
      </Table>
      <p className="text-xs text-muted">ส่วนต่างใช้เมื่อตัดหนี้ด้วย STM แล้วยอดที่ได้รับไม่เท่าลูกหนี้ บัญชีที่ไม่ตัดด้วย STM (เช่น .201 เหมาจ่ายรายหัว) ยอดจะคงอยู่จนกว่าจะตัดด้วยวิธีอื่น</p>
    </Section>
  );
}

export function ArAccounts() {
  const { data, error, retry } = useJson<ArAccountsData>("/api/admin/ar-accounts");
  const [shown, setShown] = useState<ArAccountsData>();
  if (data && data !== shown) setShown(data);

  return (
    <>
      <Backfill />
      {error && !shown ? (
        <Notice title={`โหลดข้อมูลไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
      ) : !shown ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <Maps data={shown} reload={retry} />
          <AccountSettings data={shown} reload={retry} />
        </>
      )}
    </>
  );
}
