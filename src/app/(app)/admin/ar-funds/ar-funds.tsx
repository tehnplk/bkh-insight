"use client";

import { Fragment, useState, useTransition, type ReactNode } from "react";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { MultiSelect } from "@/components/multi-select/multi-select";
import { formatCount } from "@/lib/number-format";
import { THAI_MONTHS_SHORT, formatThaiDate, todayIso } from "@/lib/thai-date";
import { Money, Notice, Skeleton, btn, focusRing, num, useJson } from "@/app/(app)/fund/_components/ui";
import { DataFreshness } from "@/app/(app)/fund/_components/freshness";
import type { ArFundsData } from "@/app/api/admin/ar-funds/route";
import type { FundCheckData } from "@/app/api/admin/ar-funds/check/route";
import type { FundItemsData } from "@/app/api/admin/ar-funds/items/route";
import type { SuggestData } from "@/app/api/admin/ar-funds/suggest/route";
import { CASE_LIMIT, ruleReady, type CheckCase, type FundRule, type IcdScope, type MatchMode, type RuleCheck } from "@/app/api/admin/ar-funds/rules";

const FIELD = `h-9 min-w-0 rounded-md border border-line bg-surface px-3 ${focusRing}`;
const SELECT_CLASS = `${FIELD} pr-8`;
const TH = "px-3 py-2.5 font-medium";
const TD = "px-3 py-1.5 align-top";
const primary = `inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-wait disabled:opacity-60 ${focusRing}`;
const monthLabel = (m: string) => `${THAI_MONTHS_SHORT[+m.slice(5, 7) - 1]} ${+m.slice(0, 4) + 543}`;
const muted = (t: string) => <span className="text-muted">{t}</span>;

/** เดือนตั้งแต่ ต.ค. 2567 (REP เดือนแรกที่นำเข้า) ถึงเดือนปัจจุบัน ใหม่ไปเก่า */
function months(): string[] {
  const out: string[] = [];
  const now = todayIso().slice(0, 7);
  for (let y = 2024, m = 10; `${y}-${String(m).padStart(2, "0")}` <= now; m === 12 ? (y++, (m = 1)) : m++) out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out.reverse();
}

async function send(url: string, init: RequestInit): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init }).catch(() => null);
  const body = await res?.json().catch(() => null);
  return res?.ok ? { ok: true } : { ok: false, error: body?.error ?? `ไม่สำเร็จ${res ? ` (HTTP ${res.status})` : ""}` };
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

/* ---------- กติกา ---------- */

type Draft = {
  code: string; name: string; match_mode: MatchMode; hipdata_codes: string[]; pttypes: string[]; incomes: string[]; icodes: string; icd10: string;
  icd_scope: IcdScope; required_icodes: string; rep_keys: string[]; account_op: string; account_ip: string;
};
const EMPTY: Draft = {
  code: "", name: "", match_mode: "items", hipdata_codes: ["UCS"], pttypes: [], incomes: [], icodes: "", icd10: "", icd_scope: "any", required_icodes: "",
  rep_keys: [], account_op: "", account_ip: "",
};
const toDraft = (r: FundRule): Draft => ({
  code: r.code, name: r.name, match_mode: r.match_mode, hipdata_codes: r.hipdata_codes, pttypes: r.pttypes, incomes: r.incomes, icodes: r.icodes.join(" "),
  icd10: r.icd10.join(" "), icd_scope: r.icd_scope, required_icodes: r.required_icodes.join(" "), rep_keys: r.rep_keys, account_op: r.account_op ?? "", account_ip: r.account_ip ?? "",
});
const MODE_TEXT: Record<MatchMode, string> = { items: "ตามรายการค่าบริการ/ยา", rights: "ทุก visit ของสิทธิที่เลือก", icd: "ทุก visit ที่มีรหัสโรคที่กำหนด" };
const ICD_HELP = "รหัสเดี่ยว = ขึ้นต้นด้วย (E11) หรือช่วง (C00-C96) คั่นด้วยช่องว่าง";
/** ตัวเลือกสิทธิแบ่งกลุ่มตามกองทุน (เฉพาะกองทุนที่เลือก) */
const pttypeGroups = (data: ArFundsData, funds: string[]) =>
  funds.map((f) => ({ value: f, label: data.funds.find((x) => x.code === f)?.name ?? f, options: data.pttypes.filter((p) => p.fund === f).map((p) => ({ value: p.code, label: p.name, hint: p.code })) }));
const CODE_ID = "ar-fund-code";

function RuleForm({ data, draft, setDraft, onSaved }: { data: ArFundsData; draft: Draft; setDraft: (d: Draft) => void; onSaved: () => void }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const existing = data.rules.some((r) => r.code === draft.code.trim().toUpperCase());
  const group = (label: string, options: { code: string; name: string }[]) => [{ value: label, label, options: options.map((o) => ({ value: o.code, label: o.name, hint: o.code })) }];

  function save() {
    setResult(undefined);
    startTransition(async () => {
      const r = await send("/api/admin/ar-funds", { method: "POST", body: JSON.stringify(draft) });
      if (!r.ok) return setResult({ ok: false, text: r.error });
      setResult({ ok: true, text: `บันทึก ${draft.code.toUpperCase()} แล้ว` });
      setDraft(EMPTY);
      onSaved();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-3 rounded-lg border border-line p-4 text-sm"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-muted">รหัส</span>
          <input id={CODE_ID} required value={draft.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} maxLength={16} pattern="[A-Za-z][A-Za-z0-9_]*" className={`${FIELD} w-28 uppercase`} />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-muted">ชื่อกองทุนย่อย</span>
          <input required value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} className={`${FIELD} min-w-56`} />
        </label>
        <MultiSelect label="กองทุนหลัก" groups={group("กองทุน", data.funds)} value={draft.hipdata_codes} onChange={(v) => set({ hipdata_codes: v, pttypes: draft.pttypes.filter((p) => v.includes(data.pttypes.find((x) => x.code === p)?.fund ?? "")) })} allLabel="เลือก" />
        <MultiSelect label="เฉพาะสิทธิ" groups={pttypeGroups(data, draft.hipdata_codes)} value={draft.pttypes} onChange={(v) => set({ pttypes: v })} allLabel="ทุกสิทธิในกองทุน" />
        <label className="flex flex-col gap-1">
          <span className="text-muted">วิธีคัด visit</span>
          <select value={draft.match_mode} onChange={(e) => set({ match_mode: e.target.value as MatchMode })} className={SELECT_CLASS}>
            {(Object.keys(MODE_TEXT) as MatchMode[]).map((m) => <option key={m} value={m}>{MODE_TEXT[m]}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-medium">
          {draft.match_mode === "items" ? "เงื่อนไขรายการ (ลูกหนี้สิทธิ paidst 02) อย่างใดอย่างหนึ่ง" : "ยอดตั้งเบิก = รายการลูกหนี้สิทธิทั้ง visit"}
        </legend>
        {draft.match_mode === "items" && (
        <div className="flex flex-wrap items-start gap-3">
          <MultiSelect label="หมวดรายรับ" groups={group("หมวดรายรับ", data.incomes)} value={draft.incomes} onChange={(v) => set({ incomes: v })} allLabel="ไม่ใช้" />
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-muted">รหัสรายการ (icode 7 หลัก คั่นด้วยช่องว่างหรือจุลภาค)</span>
            <textarea value={draft.icodes} onChange={(e) => set({ icodes: e.target.value })} rows={2} className={`${FIELD} h-auto min-w-64 py-2 font-mono tabular-nums`} />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-muted">รายการจำเป็น (แจ้งเมื่อ visit ที่เข้าเกณฑ์ขาดรายการนี้)</span>
            <textarea value={draft.required_icodes} onChange={(e) => set({ required_icodes: e.target.value })} rows={2} className={`${FIELD} h-auto min-w-64 py-2 font-mono tabular-nums`} />
          </label>
        </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-muted">{draft.match_mode === "icd" ? "รหัสโรค ICD-10" : "และมีรหัสโรค ICD-10 (ว่าง = ไม่กรอง)"} · {ICD_HELP}</span>
            <input required={draft.match_mode === "icd"} value={draft.icd10} onChange={(e) => set({ icd10: e.target.value.toUpperCase() })} className={`${FIELD} max-w-xl uppercase`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">เทียบรหัสโรค</span>
            <select value={draft.icd_scope} onChange={(e) => set({ icd_scope: e.target.value as IcdScope })} className={SELECT_CLASS}>
              <option value="any">โรคหลักและโรครอง</option>
              <option value="pdx">เฉพาะโรคหลัก (PDX)</option>
            </select>
          </label>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <MultiSelect label="เทียบกับคอลัมน์ REP" groups={[{ value: "rep", label: "คอลัมน์กองทุนใน REP ผู้ป่วยนอก", options: data.repKeys.map((k) => ({ value: k, label: k })) }]} value={draft.rep_keys} onChange={(v) => set({ rep_keys: v })} allLabel="ไม่เทียบ" />
        {(["account_op", "account_ip"] as const).map((k) => (
          <label key={k} className="flex min-w-0 flex-col gap-1">
            <span className="text-muted">บัญชี {k === "account_op" ? "OP" : "IP"}</span>
            <select value={draft[k]} onChange={(e) => set({ [k]: e.target.value })} className={`${SELECT_CLASS} max-w-80`}>
              <option value="">ยังไม่กำหนด</option>
              {data.accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>{pending ? "กำลังบันทึก…" : existing ? `บันทึกการแก้ไข ${draft.code}` : "เพิ่มกติกา"}</button>
        {(draft.code || draft.name) && <button type="button" onClick={() => { setDraft(EMPTY); setResult(undefined); }} className={btn}>ล้างฟอร์ม</button>}
        {result && <span role={result.ok ? "status" : "alert"} className={result.ok ? "text-success" : "text-danger"}>{result.text}</span>}
      </div>
    </form>
  );
}

function Rules({ data, reload }: { data: ArFundsData; reload: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const name = (list: { code: string; name: string }[]) => new Map(list.map((o) => [o.code, o.name]));
  const accountName = name(data.accounts);
  const incomeName = name(data.incomes);
  const [viewing, setViewing] = useState<FundRule>();
  const [acting, setActing] = useState<string>();
  const actingRule = data.rules.find((r) => r.code === acting);
  const edit = (r: FundRule) => {
    setDraft(toDraft(r));
    document.getElementById(CODE_ID)?.focus();
  };
  function remove(code: string) {
    if (!confirm(`ลบกติกา ${code}?`)) return;
    setError(undefined);
    startTransition(async () => {
      const r = await send(`/api/admin/ar-funds?${new URLSearchParams({ code })}`, { method: "DELETE" });
      if (!r.ok) setError(r.error);
      reload();
    });
  }
  const account = (code: string | null) => (code ? <><span className="whitespace-nowrap tabular-nums">{code}</span> <span className="text-muted">{accountName.get(code)}</span></> : muted("–"));

  return (
    <Section title="กติกา">
      <RuleForm data={data} draft={draft} setDraft={setDraft} onSaved={reload} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Table
        head={
          <>
            <th className={TH}>กองทุนย่อย</th>
            <th className={TH}>เงื่อนไข</th>
            <th className={TH}>คอลัมน์ REP</th>
            <th className={TH}>บัญชี OP / IP</th>
            <th className={TH}>แก้ไขล่าสุด</th>
            <th className={TH}><span className="sr-only">จัดการ</span></th>
          </>
        }
      >
        {data.rules.map((r) => (
          <tr key={r.code} className="border-t border-line hover:bg-surface-sunken">
            <td className={`${TD} min-w-48`}>
              <span className="font-medium">{r.code}</span> <span className="text-muted">{r.name}</span>
              <span className="block text-xs text-muted">{r.hipdata_codes.join(", ")}{r.pttypes.length > 0 && ` · สิทธิ ${r.pttypes.join(", ")}`}</span>
              <span className="block text-xs text-muted">{MODE_TEXT[r.match_mode]}</span>
            </td>
            <td className={`${TD} min-w-64`}>
              {!ruleReady(r) && <span className="block text-warning">ยังไม่มีเงื่อนไขรายการ</span>}
              {r.incomes.map((i) => <span key={i} className="block">หมวด {i} {muted(incomeName.get(i)?.replace(/^\d+\s*/, "") ?? "")}</span>)}
              {r.icodes.length > 0 && <span className="block">รหัสรายการ {formatCount(r.icodes.length)} รหัส</span>}
              {r.icd10.length > 0 && <span className="block">ICD-10 {r.icd10.join(", ")}{r.icd_scope === "pdx" && " (โรคหลัก)"}</span>}
              {r.required_icodes.length > 0 && <span className="block">รายการจำเป็น {formatCount(r.required_icodes.length)} รหัส</span>}
              {r.activities.length > 0 && <span className="block">กิจกรรมย่อย {formatCount(r.activities.filter((a) => a.active).length)} / {formatCount(r.activities.length)} {muted("(ใช้แทนเงื่อนไขรายการ)")}</span>}
            </td>
            <td className={`${TD} min-w-48`}>{r.rep_keys.length ? r.rep_keys.map((k) => <span key={k} className="block">{k}</span>) : muted("–")}</td>
            <td className={TD}>
              <span className="block">{account(r.account_op)}</span>
              <span className="block">{account(r.account_ip)}</span>
            </td>
            <td className={`${TD} whitespace-nowrap text-muted tabular-nums`}>{r.updated_by === "migration" ? "ค่าเริ่มต้นของระบบ" : `${formatThaiDate(r.updated_at)} · ${r.updated_by ?? "–"}`}</td>
            <td className={`${TD} text-right whitespace-nowrap`}>
              {r.match_mode === "items" && <><button type="button" aria-label={`กิจกรรมย่อยของ ${r.code}`} onClick={() => setActing(r.code)} className={`${btn} h-7 px-2.5`}>กิจกรรม</button>{" "}</>}
              {ruleReady(r) && r.match_mode === "items" && <><button type="button" aria-label={`ดูรายการของ ${r.code}`} onClick={() => setViewing(r)} className={`${btn} h-7 px-2.5`}>ดูรายการ</button>{" "}</>}
              <button type="button" aria-label={`แก้ไข ${r.code}`} onClick={() => edit(r)} className={`${btn} h-7 px-2.5`}>แก้ไข</button>{" "}
              <button type="button" disabled={pending} aria-label={`ลบ ${r.code}`} onClick={() => remove(r.code)} className={`${btn} h-7 px-2.5 text-danger disabled:opacity-50`}>ลบ</button>
            </td>
          </tr>
        ))}
      </Table>
      <DetailModal open={!!viewing} onClose={() => setViewing(undefined)} title={viewing ? `รายการของ ${viewing.code} ${viewing.name}` : ""} size="medium">
        {viewing && <FundItems code={viewing.code} incomeName={incomeName} />}
      </DetailModal>
      <DetailModal open={!!actingRule} onClose={() => setActing(undefined)} title={actingRule ? `กิจกรรมย่อยของ ${actingRule.code} ${actingRule.name}` : ""} size="medium">
        {actingRule && <Activities rule={actingRule} data={data} onSaved={reload} />}
      </DetailModal>
    </Section>
  );
}

type ActDraft = { id: string; name: string; items_mode: "any" | "all"; incomes: string[]; icodes: string; icd10: string; icd_scope: IcdScope; active: boolean };
const ACT_EMPTY: ActDraft = { id: "", name: "", items_mode: "any", incomes: [], icodes: "", icd10: "", icd_scope: "any", active: true };

/** กิจกรรมย่อย (เช่น PP: ฝากครรภ์) visit ผ่านกิจกรรมใดกิจกรรมหนึ่งครบทั้งรายการและรหัสโรคของกิจกรรมนั้น */
function Activities({ rule, data, onSaved }: { rule: FundRule; data: ArFundsData; onSaved: () => void }) {
  const [draft, setDraft] = useState<ActDraft>(ACT_EMPTY);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const set = (p: Partial<ActDraft>) => setDraft({ ...draft, ...p });
  const incomeOptions = [{ value: "income", label: "หมวดรายรับ", options: data.incomes.map((o) => ({ value: o.code, label: o.name, hint: o.code })) }];
  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okText: string) {
    setResult(undefined);
    startTransition(async () => {
      const r = await fn();
      setResult(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error });
      if (r.ok) {
        setDraft(ACT_EMPTY);
        onSaved();
      }
    });
  }
  const save = () => run(() => send("/api/admin/ar-funds/activities", { method: "POST", body: JSON.stringify({ ...draft, rule_code: rule.code }) }), `บันทึกกิจกรรม ${draft.name} แล้ว`);
  const remove = (id: string, name: string) => confirm(`ลบกิจกรรม ${name}?`) && run(() => send(`/api/admin/ar-funds/activities?${new URLSearchParams({ id })}`, { method: "DELETE" }), `ลบกิจกรรม ${name} แล้ว`);

  return (
    <div className="flex flex-col gap-4 text-sm">
      {rule.activities.length === 0 ? <p className="text-muted">ยังไม่มีกิจกรรมย่อย กติกานี้ใช้เงื่อนไขรายการระดับกติกา</p> : (
        <Table
          head={
            <>
              <th className={TH}>กิจกรรม</th>
              <th className={TH}>รายการ</th>
              <th className={TH}>รหัสโรค</th>
              <th className={TH}><span className="sr-only">จัดการ</span></th>
            </>
          }
        >
          {rule.activities.map((a) => (
            <tr key={a.id} className={`border-t border-line hover:bg-surface-sunken ${a.active ? "" : "text-muted"}`}>
              <td className={TD}>{a.name}{!a.active && <span className="ml-2 text-xs">ปิดใช้</span>}</td>
              <td className={TD}>
                {a.items_mode === "all" ? "ต้องมีครบ: " : "มีอย่างใดอย่างหนึ่ง: "}
                {[...a.incomes.map((i) => `หมวด ${i}`), ...a.icodes].join(", ")}
              </td>
              <td className={TD}>{a.icd10.length ? `${a.icd10.join(", ")}${a.icd_scope === "pdx" ? " (โรคหลัก)" : ""}` : muted("–")}</td>
              <td className={`${TD} text-right whitespace-nowrap`}>
                <button type="button" onClick={() => setDraft({ ...a, icodes: a.icodes.join(" "), icd10: a.icd10.join(" ") })} className={`${btn} h-7 px-2.5`}>แก้ไข</button>{" "}
                <button type="button" disabled={pending} onClick={() => remove(a.id, a.name)} className={`${btn} h-7 px-2.5 text-danger disabled:opacity-50`}>ลบ</button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-3 rounded-lg border border-line p-4"
      >
        <h3 className="font-semibold">{draft.id ? `แก้ไขกิจกรรม ${draft.name}` : "เพิ่มกิจกรรม"}</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-muted">ชื่อกิจกรรม</span>
            <input required maxLength={200} value={draft.name} onChange={(e) => set({ name: e.target.value })} className={`${FIELD} min-w-48`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">เงื่อนไขรายการ</span>
            <select value={draft.items_mode} onChange={(e) => set({ items_mode: e.target.value as ActDraft["items_mode"] })} className={SELECT_CLASS}>
              <option value="any">มีรายการใดรายการหนึ่ง</option>
              <option value="all">ต้องมีครบทุกรายการ</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} className="size-4 accent-accent" />
            เปิดใช้
          </label>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <MultiSelect label="หมวดรายรับ" groups={incomeOptions} value={draft.incomes} onChange={(v) => set({ incomes: v })} allLabel="ไม่ใช้" />
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-muted">รหัสรายการ (icode 7 หลัก)</span>
            <textarea value={draft.icodes} onChange={(e) => set({ icodes: e.target.value })} rows={2} className={`${FIELD} h-auto min-w-56 py-2 font-mono tabular-nums`} />
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-muted">รหัสโรคของกิจกรรม (ว่าง = ไม่กรอง) · {ICD_HELP}</span>
            <input value={draft.icd10} onChange={(e) => set({ icd10: e.target.value.toUpperCase() })} className={`${FIELD} uppercase`} />
          </label>
          <select aria-label="เทียบรหัสโรคของกิจกรรม" value={draft.icd_scope} onChange={(e) => set({ icd_scope: e.target.value as IcdScope })} className={SELECT_CLASS}>
            <option value="any">โรคหลักและโรครอง</option>
            <option value="pdx">เฉพาะโรคหลัก (PDX)</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={primary}>{pending ? "กำลังบันทึก…" : draft.id ? "บันทึกการแก้ไข" : "เพิ่มกิจกรรม"}</button>
          {draft.id && <button type="button" onClick={() => setDraft(ACT_EMPTY)} className={btn}>ยกเลิก</button>}
          {result && <span role={result.ok ? "status" : "alert"} className={result.ok ? "text-success" : "text-danger"}>{result.text}</span>}
        </div>
      </form>
    </div>
  );
}

/** รายการใน HOSxP ที่กติกาครอบคลุม (หมวดรายรับ + icode) รวมรายการที่ยกเลิกแล้ว เพราะ visit เก่ายังอาจมีรายการนั้น */
function FundItems({ code, incomeName }: { code: string; incomeName: Map<string, string> }) {
  const { data, error, retry } = useJson<FundItemsData>(`/api/admin/ar-funds/items?${new URLSearchParams({ code })}`);
  if (error) return <Notice title={`โหลดรายการไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />;
  if (!data) return <Skeleton rows={6} />;
  const active = data.items.filter((i) => i.istatus === "Y").length;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="tabular-nums">
        {formatCount(data.items.length)} รายการ {muted(`(ใช้งาน ${formatCount(active)} · ยกเลิกแล้ว ${formatCount(data.items.length - active)})`)}
      </p>
      <Table
        head={
          <>
            <th className={TH}>รหัส</th>
            <th className={TH}>ชื่อรายการ</th>
            <th className={TH}>หมวดรายรับ</th>
            <th className={TH}>หน่วย</th>
            <th className={`${TH} ${num}`}>ราคา (บาท)</th>
            <th className={TH}>รหัส ADP</th>
          </>
        }
      >
        {data.items.map((i) => (
          <tr key={i.icode} className={`border-t border-line hover:bg-surface-sunken ${i.istatus === "Y" ? "" : "text-muted"}`}>
            <td className={`${TD} tabular-nums`}>{i.icode}</td>
            <td className={TD}>{i.name}{i.istatus !== "Y" && <span className="ml-2 text-xs">ยกเลิก</span>}</td>
            <td className={`${TD} tabular-nums`} title={i.income ? incomeName.get(i.income) : undefined}>{i.income || "–"}</td>
            <td className={TD}>{i.units || "–"}</td>
            <td className={`${TD} ${num}`}><Money value={i.unitprice == null ? null : Number(i.unitprice)} /></td>
            <td className={`${TD} tabular-nums`}>{i.nhso_adp_code || "–"}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

/* ---------- ตรวจเทียบ REP ---------- */

function Cases({ title, side, total, amountOf }: { title: string; side: RuleCheck["hisOnly"]; total: number; amountOf: (c: CheckCase) => number }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <h4 className="font-medium">{title} {muted(`${formatCount(total)} ราย`)}</h4>
      {side.cases.length === 0 ? muted("ไม่มี") : (
        <ol className="grid max-h-72 grid-cols-[auto_auto] content-start justify-start gap-x-6 overflow-y-auto text-xs tabular-nums">
          {side.cases.map((c) => (
            <li key={c.vn} className="col-span-2 grid grid-cols-subgrid">
              <span>VN {c.vn}{c.reason && <span className="ml-2 text-muted">{c.reason}</span>}</span>
              <span className="text-right"><Money value={amountOf(c)} /></span>
            </li>
          ))}
        </ol>
      )}
      {total > CASE_LIMIT && <span className="text-xs text-muted">แสดง {formatCount(CASE_LIMIT)} รายที่ยอดสูงสุด</span>}
    </div>
  );
}

/** รายการที่พบบ่อยในเคสที่ REP จ่ายกองทุนนี้ กด "เพิ่ม" = ใส่ icode เข้ากติกา (บันทึกทันที) */
function Suggest({ rule, month, onAdded }: { rule: FundRule; month: string; onAdded: () => void }) {
  const { data, error, retry } = useJson<SuggestData>(`/api/admin/ar-funds/suggest?${new URLSearchParams({ code: rule.code, month })}`);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  function add(icode: string) {
    setResult(undefined);
    startTransition(async () => {
      const r = await send("/api/admin/ar-funds", { method: "POST", body: JSON.stringify({ ...rule, icodes: [...rule.icodes, icode] }) });
      setResult(r.ok ? { ok: true, text: `เพิ่ม ${icode} เข้า ${rule.code} แล้ว` } : { ok: false, text: r.error });
      if (r.ok) onAdded();
    });
  }
  return (
    <div className="flex flex-col gap-2">
      <h4 className="font-medium">
        รายการที่พบบ่อยในเคสที่ REP จ่าย {data && muted(`จาก ${formatCount(data.paid)} ราย (พบตั้งแต่ 20%)${data.unpaid ? ` เทียบกับเคสที่มีรายการตามกติกาแต่ REP ไม่จ่าย ${formatCount(data.unpaid)} ราย` : ""}`)}
      </h4>
      {error ? (
        <Notice title={`โหลดไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
      ) : !data ? (
        <Skeleton rows={4} />
      ) : data.paid < data.minPaid ? (
        muted(`เคสที่ REP จ่ายน้อยกว่า ${data.minPaid} ราย ยังสรุปรายการที่พบบ่อยไม่ได้`)
      ) : data.items.length === 0 ? (
        muted("ไม่มีรายการที่พบบ่อย")
      ) : (
        <Table
          head={
            <>
              <th className={TH}>รหัส</th>
              <th className={TH}>ชื่อรายการ</th>
              <th className={TH}>หมวดรายรับ</th>
              <th className={`${TH} ${num}`}>พบ (ราย)</th>
              <th className={`${TH} ${num}`}>ในเคสได้รับ</th>
              <th className={`${TH} ${num}`}>ในเคสไม่ได้รับ</th>
              <th className={TH}><span className="sr-only">เพิ่มเข้ากติกา</span></th>
            </>
          }
        >
          {data.items.map((i) => (
            <tr key={i.icode} className="border-t border-line hover:bg-surface-sunken">
              <td className={`${TD} tabular-nums`}>{i.icode}</td>
              <td className={TD}>{i.name}</td>
              <td className={`${TD} tabular-nums`}>{i.income ?? "–"}</td>
              <td className={`${TD} ${num}`}>{formatCount(i.vns)}</td>
              <td className={`${TD} ${num}`}>{(i.share * 100).toFixed(0)}%</td>
              <td className={`${TD} ${num}`}>{i.unpaidShare == null ? muted("–") : `${(i.unpaidShare * 100).toFixed(0)}%`}</td>
              <td className={`${TD} text-right whitespace-nowrap`}>
                {rule.icodes.includes(i.icode) || rule.incomes.includes(i.income ?? "") ? muted("อยู่ในกติกาแล้ว") : (
                  <button type="button" disabled={pending} onClick={() => add(i.icode)} aria-label={`เพิ่ม ${i.icode} เข้ากติกา ${rule.code}`} className={`${btn} h-7 px-2.5 disabled:opacity-50`}>เพิ่ม</button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {result && <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-success" : "text-danger"}>{result.text}</p>}
      <p className="text-xs text-muted">รายการทั่วไป (เช่น ค่าบริการพยาบาล) พบในเคสส่วนใหญ่อยู่แล้ว ให้เลือกเพิ่มเฉพาะรายการที่เป็นของกองทุนนี้</p>
    </div>
  );
}

function Check({ data, version, onChanged }: { data: ArFundsData; version: string; onChanged: () => void }) {
  const list = months();
  const [month, setMonth] = useState(data.repLatest && list.includes(data.repLatest) ? data.repLatest : list[0]);
  const [open, setOpen] = useState<string>();
  const { data: check, error, loading, retry } = useJson<FundCheckData>(`/api/admin/ar-funds/check?${new URLSearchParams({ month, v: version })}`);
  const names = new Map(data.rules.map((r) => [r.code, r.name]));
  const openCheck = check?.checks.find((c) => c.code === open);
  const openRule = data.rules.find((r) => r.code === open);
  const noRep = data.repLatest != null && month > data.repLatest;

  return (
    <Section
      title="ตรวจเทียบกับ REP"
      aside={
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">เดือนที่รับบริการ</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={SELECT_CLASS}>
            {list.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      }
    >
      <DataFreshness />
      {noRep && <p className="text-sm text-warning">REP ผู้ป่วยนอกที่นำเข้ามีถึง {monthLabel(data.repLatest!)} เดือนนี้ฝั่ง REP จึงยังไม่มีข้อมูล</p>}
      {error ? (
        <Notice title={`ตรวจเทียบไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
      ) : !check || loading ? (
        <Skeleton rows={4} />
      ) : (
        <Table
          head={
            <>
              <th className={TH}>กองทุนย่อย</th>
              <th className={`${TH} ${num}`}>HOSxP ราย</th>
              <th className={`${TH} ${num}`}>ตั้งเบิก (บาท)</th>
              <th className={`${TH} ${num}`}>REP ราย</th>
              <th className={`${TH} ${num}`}>REP จ่าย (บาท)</th>
              <th className={`${TH} ${num}`}>ตรงกัน ราย</th>
              <th className={`${TH} ${num}`}>ไม่ได้รับ ราย</th>
              <th className={`${TH} ${num}`}>REP จ่ายแต่ไม่เข้าเกณฑ์ ราย</th>
              <th className={TH}><span className="sr-only">รายละเอียด</span></th>
            </>
          }
        >
          {check.checks.map((c) => (
            <Fragment key={c.code}>
              <tr className="border-t border-line hover:bg-surface-sunken">
                <td className={`${TD} min-w-48`}><span className="font-medium">{c.code}</span> <span className="text-muted">{names.get(c.code)}</span></td>
                {c.ready ? (
                  <>
                    <td className={`${TD} ${num}`}>{formatCount(c.his.vns)}</td>
                    <td className={`${TD} ${num}`}><Money value={c.his.amount} /></td>
                  </>
                ) : (
                  <td colSpan={2} className={`${TD} text-right text-warning`}>ยังไม่มีเงื่อนไข</td>
                )}
                <td className={`${TD} ${num}`}>{formatCount(c.rep.vns)}</td>
                <td className={`${TD} ${num}`}><Money value={c.rep.amount} /></td>
                <td className={`${TD} ${num}`}>{c.ready ? formatCount(c.both) : muted("–")}</td>
                <td className={`${TD} ${num} ${c.hisOnly.vns ? "text-danger" : ""}`}>{c.ready ? formatCount(c.hisOnly.vns) : muted("–")}</td>
                <td className={`${TD} ${num} ${c.ready && c.repOnly.vns ? "text-warning" : ""}`}>{c.ready ? formatCount(c.repOnly.vns) : muted("–")}</td>
                <td className={`${TD} text-right`}>
                  {((c.ready && c.hisOnly.vns + c.repOnly.vns > 0) || c.rep.vns > 0) && (
                    <button type="button" aria-expanded={open === c.code} onClick={() => setOpen(open === c.code ? undefined : c.code)} className={`${btn} h-7 px-2.5 whitespace-nowrap`}>
                      {open === c.code ? "ซ่อนราย" : "ดูราย"}
                    </button>
                  )}
                </td>
              </tr>
            </Fragment>
          ))}
        </Table>
      )}
      {check && !loading && openCheck && openRule && (
        <div className="flex flex-col gap-4 rounded-lg border border-line p-4 text-sm">
          <h3 className="text-base font-semibold">{openCheck.code} {names.get(openCheck.code)} · {monthLabel(month)}</h3>
          {openCheck.ready && (
            <div className="flex flex-wrap gap-6">
              <Cases title="เข้าเกณฑ์แต่ REP ไม่จ่าย (ยอดตั้งเบิก)" side={openCheck.hisOnly} total={openCheck.hisOnly.vns} amountOf={(x) => x.his} />
              <Cases title="REP จ่ายแต่ไม่เข้าเกณฑ์ (ยอด REP)" side={openCheck.repOnly} total={openCheck.repOnly.vns} amountOf={(x) => x.rep} />
            </div>
          )}
          {Object.keys(openCheck.activityVns).length > 0 && (
            <p>ผ่านกิจกรรม: {Object.entries(openCheck.activityVns).map(([name, n]) => `${name} ${formatCount(n)} ราย`).join(" · ")}</p>
          )}
          {openCheck.missingRequired.vns > 0 && (
            <div className="flex flex-col gap-1">
              <h4 className="font-medium">เข้าเกณฑ์แต่ขาดรายการจำเป็น {muted(`${formatCount(openCheck.missingRequired.vns)} ราย`)}</h4>
              <ul className="max-h-48 overflow-y-auto text-xs tabular-nums">
                {openCheck.missingRequired.cases.map((c) => <li key={c.vn}>VN {c.vn} <span className="text-muted">ขาด {c.missing.join(", ")}</span></li>)}
              </ul>
            </div>
          )}
          {openCheck.itemStats.length > 0 && (
            <details>
              <summary className="cursor-pointer font-medium">อัตราได้รับเงินรายรายการ {muted(`${formatCount(openCheck.itemStats.length)} รายการ`)}</summary>
              <div className="mt-2">
                <Table
                  head={
                    <>
                      <th className={TH}>รหัส</th>
                      <th className={`${TH} ${num}`}>พบใน (ราย)</th>
                      <th className={`${TH} ${num}`}>ได้รับเงิน (ราย)</th>
                      <th className={`${TH} ${num}`}>อัตรา</th>
                    </>
                  }
                >
                  {openCheck.itemStats.map((s) => (
                    <tr key={s.icode} className="border-t border-line hover:bg-surface-sunken">
                      <td className={`${TD} tabular-nums`}>{s.icode}</td>
                      <td className={`${TD} ${num}`}>{formatCount(s.vns)}</td>
                      <td className={`${TD} ${num}`}>{formatCount(s.paid)}</td>
                      <td className={`${TD} ${num} ${s.paid === 0 ? "text-danger" : ""}`}>{((s.paid / s.vns) * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </Table>
              </div>
            </details>
          )}
          {openCheck.rep.vns > 0 && <Suggest rule={openRule} month={month} onAdded={onChanged} />}
        </div>
      )}
    </Section>
  );
}

export function ArFunds() {
  const { data, error, retry } = useJson<ArFundsData>("/api/admin/ar-funds");
  const [shown, setShown] = useState<ArFundsData>();
  if (data && data !== shown) setShown(data);

  if (error && !shown) return <Notice title={`โหลดข้อมูลไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />;
  if (!shown) return <Skeleton rows={6} />;
  return (
    <>
      <Rules data={shown} reload={retry} />
      <Check data={shown} version={shown.rules.map((r) => `${r.code}${r.updated_at}${r.icodes.length}${r.incomes.length}`).join()} onChanged={retry} />
    </>
  );
}
