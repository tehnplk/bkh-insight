"use client";

import { useState, useTransition, type ReactNode } from "react";
import { formatBaht, formatCount } from "@/lib/number-format";
import { THAI_MONTHS_SHORT, formatThaiDate, todayIso } from "@/lib/thai-date";
import { Money, Notice, Skeleton, btn, focusRing, num, useJson } from "@/app/(app)/fund/_components/ui";
import { LOCS, LOC_LABEL, ledgerMonths, type Loc, type PatientType } from "@/app/api/fund/ar-sync/ledger";
import type { ArAccount, ArAccountsData, Edited, RuleRow, Unassigned } from "@/app/api/admin/ar-accounts/route";
import type { RecomputeResult, SyncLog } from "@/app/api/fund/ar-sync/sync";
import { AccountPicker } from "@/components/account-picker/account-picker";

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

/* ---------- กติกาบัญชี ---------- */

type RuleDraft = { right_code: string; patient_type: PatientType; loc: Loc; account_code: string; cap: string; debt_pct: string };
const EMPTY: RuleDraft = { right_code: "", patient_type: "OP", loc: "any", account_code: "", cap: "", debt_pct: "" };
const ACCOUNT_ID = "ar-rule-account";
const RULE_FORM_ID = "ar-rule-form";
const ptSelectId = (pttype: string) => `ar-pttype-${pttype}`;

function RuleForm({ data, draft, setDraft, onSaved }: { data: ArAccountsData; draft: RuleDraft; setDraft: (d: RuleDraft) => void; onSaved: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const badAccount = draft.account_code !== "" && !data.accounts.some((a) => a.code === draft.account_code);

  function save() {
    setError(undefined);
    if (badAccount) {
      setError(`ไม่พบบัญชี ${draft.account_code} ในผังบัญชี เลือกจากรายการ`);
      return document.getElementById(ACCOUNT_ID)?.focus();
    }
    startTransition(async () => {
      const r = await send("/api/admin/ar-accounts", { method: "POST", body: JSON.stringify(draft) });
      if (!r.ok) return setError(r.error);
      setDraft(EMPTY);
      onSaved();
    });
  }
  const amountInput = (k: "cap" | "debt_pct", label: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-muted">{label}</span>
      <input inputMode="decimal" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} className={`h-9 w-28 rounded-md border border-line bg-surface px-3 text-right tabular-nums ${focusRing}`} />
    </label>
  );

  return (
    <form
      id={RULE_FORM_ID}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-wrap items-end gap-3 text-sm"
    >
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-muted">กลุ่มสิทธิ</span>
        <select required value={draft.right_code} onChange={(e) => setDraft({ ...draft, right_code: e.target.value })} className={`${SELECT_CLASS} max-w-72`}>
          <option value="" disabled>เลือก</option>
          {data.rights.filter((r) => r.books_ar).map((r) => <option key={r.code} value={r.code}>{r.code} {r.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">ประเภท</span>
        <select value={draft.patient_type} onChange={(e) => setDraft({ ...draft, patient_type: e.target.value as PatientType })} className={SELECT_CLASS}>
          <option value="OP">OP</option>
          <option value="IP">IP</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">หน่วยบริการประจำ</span>
        <select value={draft.loc} onChange={(e) => setDraft({ ...draft, loc: e.target.value as Loc })} className={SELECT_CLASS}>
          {LOCS.map((l) => <option key={l} value={l}>{LOC_LABEL[l]}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-muted">บัญชี</span>
        <AccountPicker id={ACCOUNT_ID} accounts={data.accounts} value={draft.account_code} invalid={badAccount} onChange={(account_code) => setDraft({ ...draft, account_code })} />
      </label>
      {amountInput("cap", "เพดานลูกหนี้ (บาท)")}
      {amountInput("debt_pct", "ลูกหนี้ (%)")}
      <button type="submit" disabled={pending} className={primary}>
        {pending ? "กำลังบันทึก…" : "บันทึก"}
      </button>
      {error && <p role="alert" className="w-full text-danger">{error}</p>}
    </form>
  );
}

const edited = (e: Edited) => (e.updated_by === "migration" ? "ค่าเริ่มต้นของระบบ" : `${formatThaiDate(e.updated_at)} · ${e.updated_by ?? "–"}`);

function Rules({ data, reload }: { data: ArAccountsData; reload: () => void }) {
  const [draft, setDraft] = useState<RuleDraft>(EMPTY);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const accountName = new Map(data.accounts.map((a) => [a.code, a.name]));
  const rightName = new Map(data.rights.map((r) => [r.code, r.name]));
  const noAr = data.rights.filter((r) => !r.books_ar);

  function remove(r: RuleRow) {
    setError(undefined);
    startTransition(async () => {
      const res = await send(`/api/admin/ar-accounts?${new URLSearchParams({ right_code: r.right_code, patient_type: r.patient_type, loc: r.loc })}`, { method: "DELETE" });
      if (!res.ok) setError(res.error);
      reload();
    });
  }
  const pick = (d: RuleDraft) => {
    setDraft(d);
    document.getElementById(ACCOUNT_ID)?.focus();
  };

  return (
    <Section title="บัญชีตามกลุ่มสิทธิ">
      <RuleForm data={data} draft={draft} setDraft={setDraft} onSaved={reload} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Table
        head={
          <>
            <th className={TH}>กลุ่มสิทธิ</th>
            <th className={TH}>ประเภท</th>
            <th className={TH}>หน่วยบริการประจำ</th>
            <th className={TH}>บัญชี</th>
            <th className={TH}>ลูกหนี้</th>
            <th className={TH}>แก้ไขล่าสุด</th>
            <th className={TH}><span className="sr-only">จัดการ</span></th>
          </>
        }
      >
        {data.rules.map((r) => {
          const label = `${r.right_code} ${r.patient_type} ${LOC_LABEL[r.loc]}`;
          return (
            <tr key={`${r.right_code}-${r.patient_type}-${r.loc}`} className="border-t border-line hover:bg-surface-sunken">
              <td className={TD}>{r.right_code} <span className="text-muted">{rightName.get(r.right_code)}</span></td>
              <td className={TD}>{r.patient_type}</td>
              <td className={TD}>{LOC_LABEL[r.loc]}</td>
              <td className={TD}><span className="whitespace-nowrap tabular-nums">{r.account_code}</span> <span className="text-muted">{accountName.get(r.account_code)}</span></td>
              <td className={`${TD} whitespace-nowrap tabular-nums`}>
                {r.cap != null ? `ไม่เกิน ${formatBaht(Number(r.cap))} บาท` : r.debt_pct != null ? `${Number(r.debt_pct)}% ของค่ารักษา` : <span className="text-muted">เต็มจำนวน</span>}
              </td>
              <td className={`${TD} whitespace-nowrap text-muted tabular-nums`}>{edited(r)}</td>
              <td className={`${TD} text-right whitespace-nowrap`}>
                <button
                  type="button"
                  aria-label={`แก้ไข ${label}`}
                  onClick={() => pick({ right_code: r.right_code, patient_type: r.patient_type, loc: r.loc, account_code: r.account_code, cap: r.cap == null ? "" : String(Number(r.cap)), debt_pct: r.debt_pct == null ? "" : String(Number(r.debt_pct)) })}
                  className={`${btn} h-7 px-2.5`}
                >
                  แก้ไข
                </button>{" "}
                <button type="button" disabled={pending} aria-label={`ลบ ${label}`} onClick={() => remove(r)} className={`${btn} h-7 px-2.5 text-danger disabled:opacity-50`}>
                  ลบ
                </button>
              </td>
            </tr>
          );
        })}
      </Table>
      {noAr.length > 0 && <p className="text-sm text-muted">ไม่ตั้งลูกหนี้: {noAr.map((r) => `${r.code} ${r.name}`).join(", ")}</p>}
      <UnassignedList data={data} onPick={pick} />
    </Section>
  );
}

/* ---------- pttype -> กลุ่มสิทธิ ---------- */

function Pttypes({ data, reload }: { data: ArAccountsData; reload: () => void }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const mapped = new Map(data.rightPttypes.map((m) => [m.pttype, m]));
  const rows = unmappedOnly ? data.pttypes.filter((p) => !mapped.has(p.code)) : data.pttypes;

  function save(pttype: string, right_code: string) {
    setError(undefined);
    startTransition(async () => {
      const r = await send("/api/admin/ar-accounts", { method: "POST", body: JSON.stringify({ pttype, right_code: right_code || null }) });
      if (!r.ok) setError(r.error);
      reload();
    });
  }

  return (
    <Section
      title="กลุ่มสิทธิของ pttype"
      aside={
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={unmappedOnly} onChange={(e) => setUnmappedOnly(e.target.checked)} className="size-4 accent-accent" />
          เฉพาะที่ยังไม่จับคู่
        </label>
      }
    >
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Table
        head={
          <>
            <th className={TH}>pttype</th>
            <th className={TH}>กองทุน</th>
            <th className={TH}>กลุ่มสิทธิ</th>
            <th className={TH}>แก้ไขล่าสุด</th>
          </>
        }
      >
        {rows.map((p) => {
          const m = mapped.get(p.code);
          return (
            <tr key={p.code} className="border-t border-line hover:bg-surface-sunken">
              <td className={TD}><span className="tabular-nums">{p.code}</span> <span className="text-muted">{p.name}</span></td>
              <td className={TD}>{p.fund}</td>
              <td className={TD}>
                <select
                  id={ptSelectId(p.code)}
                  aria-label={`กลุ่มสิทธิของ pttype ${p.code}`}
                  disabled={pending}
                  value={m?.right_code ?? ""}
                  onChange={(e) => save(p.code, e.target.value)}
                  className={`${SELECT_CLASS} h-8 max-w-72 ${m ? "" : "text-warning"}`}
                >
                  <option value="">ยังไม่จับคู่</option>
                  {data.rights.map((r) => <option key={r.code} value={r.code}>{r.code} {r.name}</option>)}
                </select>
              </td>
              <td className={`${TD} whitespace-nowrap text-muted tabular-nums`}>{m ? edited(m) : "–"}</td>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}

/* ---------- ยังไม่มีบัญชี ---------- */

/** สาเหตุที่รายการยังไม่มีบัญชี ลำดับเดียวกับ resolve ; pick = เติมฟอร์มกติกา, pttype = ไปที่ช่องเลือกกลุ่มสิทธิ */
function fixFor(u: Unassigned, data: ArAccountsData): { reason: string; fix: string; pick?: RuleDraft; pttype?: string } {
  const right = u.pttype ? data.rightPttypes.find((m) => m.pttype === u.pttype)?.right_code : undefined;
  if (!u.pttype || !data.pttypes.some((p) => p.code === u.pttype)) return { reason: "ไม่พบรหัสสิทธิใน HOSxP", fix: "จับคู่ไม่ได้" };
  if (!right) return { reason: `pttype ${u.pttype} ยังไม่ได้จับคู่กลุ่มสิทธิ`, fix: "เลือกกลุ่มสิทธิในตาราง pttype", pttype: u.pttype };
  if (!data.rules.some((r) => r.right_code === right && r.patient_type === u.patient_type))
    return { reason: `กลุ่มสิทธิ ${right} ยังไม่มีบัญชี ${u.patient_type}`, fix: "เพิ่มกติกา", pick: { ...EMPTY, right_code: right, patient_type: u.patient_type } };
  return { reason: `กลุ่มสิทธิ ${right} มีกติกาแล้ว แต่ยังไม่ครอบคลุมรายการนี้หรือยังไม่ได้คำนวณ`, fix: "เพิ่มกติกาของหน่วยบริการประจำ หรือกด คำนวณบัญชีใหม่", pick: { ...EMPTY, right_code: right, patient_type: u.patient_type } };
}

function UnassignedList({ data, onPick }: { data: ArAccountsData; onPick: (d: RuleDraft) => void }) {
  const pttypeName = new Map(data.pttypes.map((p) => [p.code, p.name]));
  return (
    <div className="mt-4 flex flex-col gap-3">
      <h3 className="text-base font-semibold">ยังไม่มีบัญชี</h3>
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
              <th className={TH}><span className="sr-only">แก้ไข</span></th>
            </>
          }
        >
          {data.unassigned.map((u) => {
            const { reason, fix, pick, pttype } = fixFor(u, data);
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
                  {pttype ? (
                    <button type="button" onClick={() => document.getElementById(ptSelectId(pttype))?.focus()} aria-label={`จับคู่กลุ่มสิทธิของ pttype ${pttype}`} className={`${btn} h-7 px-2.5`}>จับคู่</button>
                  ) : pick ? (
                    <button type="button" onClick={() => onPick(pick)} aria-label={`เพิ่มกติกาบัญชี ${pick.right_code} ${u.patient_type}`} className={`${btn} h-7 px-2.5`}>เพิ่มกติกา</button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

/* ---------- คำนวณบัญชีใหม่: ดูผลก่อน แล้วยืนยัน ---------- */

function Recompute({ reload }: { reload: () => void }) {
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<RecomputeResult>();
  const [result, setResult] = useState<{ ok: boolean; text: string }>();

  const run = (apply: boolean) => {
    setResult(undefined);
    startTransition(async () => {
      const r = await send("/api/admin/ar-accounts/recompute", { method: "POST", body: JSON.stringify({ apply }) });
      if (!r.ok) return setResult({ ok: false, text: r.error });
      const body = r.body as RecomputeResult;
      if (!apply) return setPreview(body);
      setPreview(undefined);
      setResult({ ok: true, text: `ปรับสมุดแล้ว · ย้ายบัญชี ${formatCount(body.rows_moved)} แถว · ลงรายการใหม่ ${formatCount(body.rows_inserted)} แถว` });
      reload();
    });
  };

  // รวมทุกเดือน แสดงเฉพาะคู่ที่บัญชีเปลี่ยน
  const sum = <T, K extends string>(rows: T[], key: (r: T) => K, n: (r: T) => number, amt: (r: T) => number) => {
    const m = new Map<K, { row: T; n: number; amount: number }>();
    for (const r of rows) {
      const g = m.get(key(r)) ?? { row: r, n: 0, amount: 0 };
      m.set(key(r), { row: r, n: g.n + n(r), amount: g.amount + amt(r) });
    }
    return [...m.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  };
  const moves = preview ? sum(preview.moves.filter((m) => m.from !== m.to), (m) => `${m.from}>${m.to}`, (m) => m.refs, (m) => m.amount) : [];
  const diffs = preview ? sum(preview.diffs, (d) => `${d.account}`, (d) => d.n, (d) => d.amount) : [];
  const code = (c: string | null) => (c ? <span className="whitespace-nowrap tabular-nums">{c}</span> : <span className="text-warning">ไม่ระบุบัญชี</span>);
  const changes = moves.length + diffs.length + (preview?.reversed.refs ?? 0) + (preview?.coverage_updated ?? 0);

  return (
    <Section
      title="คำนวณบัญชีใหม่"
      aside={
        <div className="flex items-center gap-3 text-sm">
          {result && <span role={result.ok ? "status" : "alert"} className={result.ok ? "text-success" : "text-danger"}>{result.text}</span>}
          <button type="button" onClick={() => run(false)} disabled={pending} className={`${btn} disabled:cursor-wait disabled:opacity-60`}>
            {pending && !preview ? "กำลังคำนวณ…" : "ดูผลก่อนปรับ"}
          </button>
        </div>
      }
    >
      {preview && (
        <div className="flex flex-col gap-3 text-sm" aria-live="polite">
          <ul className="flex flex-wrap gap-x-6 gap-y-1 tabular-nums">
            <li>ย้ายบัญชี {formatCount(moves.reduce((s, m) => s + m.n, 0))} ราย</li>
            <li>ส่วนต่างตามเพดาน/สัดส่วน {formatCount(diffs.reduce((s, d) => s + d.n, 0))} รายการ</li>
            <li>กลับรายการสิทธิที่ไม่ตั้งลูกหนี้ {formatCount(preview.reversed.refs)} ราย · <Money value={preview.reversed.amount} /> บาท</li>
            <li>ไม่มีกติกา คงบัญชีเดิม {formatCount(preview.no_rule.refs)} ราย</li>
            <li>ตัดหนี้แล้ว ไม่ลงส่วนต่าง {formatCount(preview.settled_skipped)} ราย</li>
            <li>ข้อมูลสิทธิเปลี่ยนตาม HOSxP {formatCount(preview.coverage_updated)} ราย</li>
          </ul>
          {moves.length > 0 && (
            <Table head={<><th className={TH}>บัญชีเดิม</th><th className={TH}>บัญชีใหม่</th><th className={`${TH} ${num}`}>จำนวนราย</th><th className={`${TH} ${num}`}>ค่ารักษา (บาท)</th></>}>
              {moves.map(({ row, n, amount }) => (
                <tr key={`${row.from}>${row.to}`} className="border-t border-line">
                  <td className={TD}>{code(row.from)}</td>
                  <td className={TD}>{code(row.to)}</td>
                  <td className={`${TD} ${num}`}>{formatCount(n)}</td>
                  <td className={`${TD} ${num}`}><Money value={amount} /></td>
                </tr>
              ))}
            </Table>
          )}
          {diffs.length > 0 && (
            <Table head={<><th className={TH}>บัญชี (ส่วนต่างตามเพดาน/สัดส่วน)</th><th className={`${TH} ${num}`}>จำนวนรายการ</th><th className={`${TH} ${num}`}>ส่วนต่าง (บาท)</th></>}>
              {diffs.map(({ row, n, amount }) => (
                <tr key={`${row.account}`} className="border-t border-line">
                  <td className={TD}>{code(row.account)}</td>
                  <td className={`${TD} ${num}`}>{formatCount(n)}</td>
                  <td className={`${TD} ${num}`}><Money value={amount} /></td>
                </tr>
              ))}
            </Table>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {changes === 0 ? (
              <span className="text-muted">ไม่มีรายการที่ต้องปรับ</span>
            ) : (
              <button type="button" onClick={() => run(true)} disabled={pending} className={primary}>
                {pending ? "กำลังปรับสมุด…" : "ยืนยันปรับสมุดลูกหนี้"}
              </button>
            )}
            <button type="button" onClick={() => setPreview(undefined)} disabled={pending} className={btn}>ปิด</button>
          </div>
        </div>
      )}
    </Section>
  );
}

/* ---------- ตั้งค่าบัญชี: บัญชีคู่ (สมุดรายวัน), การตัดหนี้ด้วย STM, กลุ่มเรียกเก็บ ---------- */

type SettingDraft = Pick<ArAccount, "code" | "revenue_code" | "diff_under_code" | "diff_over_code" | "clear_code" | "settles_by_stm" | "collect_group">;
const INPUT = `h-8 w-36 rounded-md border border-line bg-surface px-2 tabular-nums ${focusRing}`;

function AccountSettings({ data, reload }: { data: ArAccountsData; reload: () => void }) {
  const [draft, setDraft] = useState<SettingDraft>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [all, setAll] = useState(false);
  const used = new Set(data.used);
  const groupName = new Map(data.groups.map((g) => [g.id, g.name]));
  // ค่าเริ่มต้นแสดงบัญชีที่มีรายการใน ledger หรือตั้งบัญชีคู่ไว้แล้ว (ผังบัญชีมี ~90 บัญชี ส่วนใหญ่ไม่ได้ใช้)
  const rows = all ? data.accounts : data.accounts.filter((a) => used.has(a.code) || a.revenue_code || a.clear_code || a.settles_by_stm);

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
  const dash = <span className="text-muted">–</span>;
  const input = (k: "revenue_code" | "diff_under_code" | "diff_over_code" | "clear_code", label: string) => (
    <input aria-label={label} value={draft?.[k] ?? ""} onChange={(e) => setDraft({ ...draft!, [k]: e.target.value })} className={INPUT} />
  );

  return (
    <Section
      title="ตั้งค่าบัญชี"
      aside={
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="size-4 accent-accent" />
          แสดงทุกบัญชี
        </label>
      }
    >
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Table
        head={
          <>
            <th className={TH}>บัญชีลูกหนี้</th>
            <th className={TH}>รายได้คู่</th>
            <th className={TH}>ส่วนต่างค่ารักษาสูงกว่าข้อตกลง (Dr)</th>
            <th className={TH}>ส่วนต่างค่ารักษาต่ำกว่าข้อตกลง (Cr)</th>
            <th className={TH}>ตัดหนี้ด้วย STM</th>
            <th className={TH}>กลุ่มเรียกเก็บ</th>
            <th className={TH}>ตัดอัตโนมัติ (Dr)</th>
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
              <td className={TD}>{editing ? input("diff_under_code", `ส่วนต่างค่ารักษาสูงกว่าข้อตกลงของ ${a.code}`) : a.diff_under_code ? code(a.diff_under_code) : dash}</td>
              <td className={TD}>{editing ? input("diff_over_code", `ส่วนต่างค่ารักษาต่ำกว่าข้อตกลงของ ${a.code}`) : a.diff_over_code ? code(a.diff_over_code) : dash}</td>
              <td className={TD}>
                {editing ? (
                  <input type="checkbox" aria-label={`ตัดหนี้ ${a.code} ด้วย STM`} checked={draft.settles_by_stm} onChange={(e) => setDraft({ ...draft, settles_by_stm: e.target.checked })} className="size-4 accent-accent" />
                ) : a.settles_by_stm ? "ตัด" : <span className="text-muted">ไม่ตัด</span>}
              </td>
              <td className={TD}>
                {editing ? (
                  <select
                    aria-label={`กลุ่มเรียกเก็บของ ${a.code}`}
                    value={draft.collect_group ?? ""}
                    onChange={(e) => setDraft({ ...draft, collect_group: e.target.value ? +e.target.value : null })}
                    className={`${SELECT_CLASS} h-8`}
                  >
                    <option value="">ไม่กำหนด</option>
                    {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                ) : a.collect_group ? <span className="whitespace-nowrap">{groupName.get(a.collect_group) ?? a.collect_group}</span> : dash}
              </td>
              <td className={TD}>{editing ? input("clear_code", `บัญชีตัดอัตโนมัติ (Dr) ของ ${a.code}`) : a.clear_code ? code(a.clear_code) : dash}</td>
              <td className={`${TD} text-right whitespace-nowrap`}>
                {editing ? (
                  <>
                    <button type="button" onClick={save} disabled={pending} className={`${primary} h-7`}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>{" "}
                    <button type="button" onClick={() => setDraft(undefined)} className={`${btn} h-7 px-2.5`}>ยกเลิก</button>
                  </>
                ) : (
                  <button type="button" aria-label={`แก้ไขการตั้งค่าบัญชี ${a.code}`} onClick={() => setDraft(a)} className={`${btn} h-7 px-2.5`}>แก้ไข</button>
                )}
              </td>
            </tr>
          );
        })}
      </Table>
      <p className="text-xs text-muted">ส่วนต่างใช้เมื่อตัดหนี้ด้วย STM แล้วยอดที่ได้รับไม่เท่าลูกหนี้ บัญชีที่ไม่ตัดด้วย STM (เช่น .201 เหมาจ่ายรายหัว) ยอดจะคงอยู่จนกว่าจะตัดด้วยวิธีอื่น ตัดอัตโนมัติ (Dr) คือบัญชีที่ลงเมื่อตัดหนี้โดยไม่ได้รับเงิน เช่น .201 ตัดด้วยเงินเหมาจ่ายรายหัว</p>
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
          <Recompute reload={retry} />
          <Rules data={shown} reload={retry} />
          <Pttypes data={shown} reload={retry} />
          <AccountSettings data={shown} reload={retry} />
        </>
      )}
    </>
  );
}
