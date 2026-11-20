// ตัดลูกหนี้ด้วย STM แบบ manual (/fund/ar-settle) แบบ pure (import แค่ type) ทดสอบด้วย node ได้ตรง (settle.test.mjs) ยอดคิดเป็นสตางค์
// หลัก (ผู้ใช้เลือก 20 พ.ย. 2569): ตัดตามยอดที่ STM จ่าย คงเหลือเก็บไว้รอ STM งวดถัดไป ("รับบางส่วน")
//   ปิดส่วนต่างให้คงเหลือ 0 เฉพาะรายที่ผู้ใช้ติ๊ก (ค่าเริ่มต้นติ๊กเมื่อคงเหลือติดลบ = ได้รับสูงกว่า) ; ตัดเฉพาะบัญชีที่ settles_by_stm
import type { GridPage } from "@/lib/grid-query";
import type { Entry, PatientType, RefState } from "../ar-sync/ledger";

/** แถวของรายการไฟล์ STM (GET /api/fund/ar-settle) ยอดเป็น string จาก numeric */
export type SettleFileRow = {
  id: string; period_month: string; run_no: number; scheme: string; patient_type: PatientType; doc_no: string; transfer_date: string;
  row_count: number; net_total: string; paid_rows: number; settled_rows: number; settled_amount: string;
  last_receipt_no: string | null; last_receipt_date: string | null;
};
export type SettleCounts = { settle: number; diff: number; settle_amount: number; diff_amount: number; shifted: number; skipped: number };
export type SettleBatch = { id: string; receipt_date: string; receipt_no: string | null; settled_by: string; settled_at: string; counts: Partial<SettleCounts> };
/** ผลของ POST /api/fund/ar-settle */
export type SettleResult = SettleCounts & { batch_id: string };
export type SettleSummary = {
  file: Pick<SettleFileRow, "id" | "scheme" | "patient_type" | "doc_no" | "period_month" | "run_no" | "transfer_date" | "net_total">;
  /** วันแรกของงวดที่ยังเปิด (null = ยังไม่เคยปิดงวด) วันใบเสร็จก่อนนี้จะถูกเลื่อนเป็นวันนี้ */
  open_from: string | null;
  groups: Record<SettleGroup, { n: number; paid: number; balance: number }>;
  /** ตามค่าเริ่มต้นของ checkbox: รับชำระทุกรายที่จับคู่ได้ + ปิดส่วนต่างของรายที่ติ๊กไว้ (close_amount = ยอดสุทธิของแถว diff) */
  plan: { settle_n: number; settle_amount: number; close_n: number; close_amount: number };
  batches: SettleBatch[];
};
export type SettlePreviewPage = GridPage<PreviewRow> & { summary: SettleSummary };

/** บรรทัด STM ของไฟล์ (SQL S2) vn/an จาก stm_row หรือ rep_row ด้วย tran_id ; done = ลง ar_ledger แล้ว */
export type StmLine = {
  id: string; patient_type: PatientType; rep_no: string; tran_id: string | null; hn: string | null;
  vn: string | null; an: string | null; paid_total: string | number; done: boolean;
};
/** หนี้ของ VN/AN (SQL S3) balance = บาท รวมทุก source ของหนี้ (HOSxP + stm + manual) */
export type DebtRow = Omit<RefState, "balance" | "cancelled"> & { settles_by_stm: boolean; balance: string | number };
/** หนี้ใน REP งวดนี้ที่ STM ไม่จ่าย (SQL S4) */
export type MissingRow = { tran_id: string; rep_no: string; hn: string | null; vn?: string | null; an?: string | null; ref: string; account_code: string | null; balance: string | number };
export type SettleEntry = Omit<Entry, "source" | "kind"> & { source: "stm"; kind: "settle" | "diff"; stm_row_id: string };

/** ก ตรงยอด / ข มีส่วนต่าง / ค ไม่พบหนี้ที่ตัดได้ / ง REP งวดนี้ STM ไม่จ่าย / ตัดแล้ว */
export const SETTLE_GROUPS = ["match", "diff", "none", "missing", "done"] as const;
export type SettleGroup = (typeof SETTLE_GROUPS)[number];
export const GROUP_LABEL: Record<SettleGroup, string> = {
  match: "ตรงยอด", diff: "มีส่วนต่าง", none: "ไม่พบหนี้ที่ตัดได้", missing: "REP งวดนี้ STM ไม่จ่าย", done: "ตัดแล้ว",
};
export const STATUS_LABEL = {
  match: "ตรงยอด", under: "ได้รับต่ำกว่า", over: "ได้รับสูงกว่า", recall: "ถูกเรียกคืน",
  no_ref: "ไม่พบ VN/AN", no_debt: "ยังไม่ลงสมุด", not_stm: "บัญชีไม่ตัดด้วย STM", no_account: "ยังไม่ระบุบัญชี", zero: "STM จ่าย 0",
  missing: "STM ไม่จ่าย", settled: "ตัดครบ", partial: "รับบางส่วน",
} as const;
export type SettleStatus = keyof typeof STATUS_LABEL;

/** หนึ่งแถวต่อหนี้ของ VN/AN (รวมทุกบรรทัด STM ของรายนั้นในไฟล์) ยอดเป็นบาท */
export type PreviewRow = {
  key: string; // "OP:<vn>" | "IP:<an>" ; บรรทัดที่ไม่มี VN/AN = "row:<stm_row id>"
  patient_type: PatientType;
  ref: string | null; // VN หรือ AN
  hn: string | null;
  rep_no: string | null;
  tran_id: string | null;
  lines: number;
  group: SettleGroup;
  status: SettleStatus;
  account_code: string | null;
  /** หนี้คงเหลือตอนนี้ (บัญชีที่ตัดได้ ; ค = ทุกบัญชี) null = ไม่มีหนี้ */
  balance: number | null;
  /** ยอด STM ที่ยังไม่ได้ตัด (ตัดแล้ว = ยอดที่ตัดไปแล้วไม่นับ) null = ง */
  paid: number | null;
  /** คงเหลือหลังตัดรอบนี้ (ก/ข/ตัดแล้ว) */
  remaining: number | null;
  /** ติ๊กปิดส่วนต่างได้ และค่าเริ่มต้นของ checkbox */
  closable: boolean;
  close_default: boolean;
};

const cents = (v: string | number) => Math.round(Number(v) * 100);
const baht = (c: number) => (c / 100).toFixed(2);
const keyOf = (pt: PatientType, l: { vn?: string | null; an?: string | null }) => {
  const id = pt === "OP" ? l.vn : l.an;
  return id ? `${pt}:${id}` : null;
};

type Debt = Omit<DebtRow, "balance"> & { balance: number };
type Item = { key: string; pt: PatientType; ref: string | null; lines: StmLine[]; all: Debt[]; debts: Debt[] };

/** จัดบรรทัดตามหนี้ (VN/AN) ; debts = เฉพาะบัญชีที่ตัดด้วย STM ได้ (balance สตางค์) ลำดับตามบรรทัดแรก */
function itemsOf(lines: StmLine[], debtRows: DebtRow[]): Item[] {
  const debtsBy = new Map<string, Debt[]>();
  for (const d of debtRows) {
    const k = keyOf(d.patient_type, d);
    if (k) debtsBy.set(k, [...(debtsBy.get(k) ?? []), { ...d, balance: cents(d.balance) }]);
  }
  const items = new Map<string, Item>();
  for (const l of [...lines].sort((a, b) => Number(a.id) - Number(b.id))) {
    const k = keyOf(l.patient_type, l) ?? `row:${l.id}`;
    const item = items.get(k);
    if (item) {
      item.lines.push(l);
      continue;
    }
    const all = debtsBy.get(k) ?? [];
    items.set(k, { key: k, pt: l.patient_type, ref: (l.patient_type === "OP" ? l.vn : l.an) ?? null, lines: [l], all, debts: all.filter((d) => d.settles_by_stm) });
  }
  return [...items.values()];
}

const pendingOf = (item: Item) => item.lines.filter((l) => !l.done && cents(l.paid_total) !== 0);
const sumBalance = (ds: Debt[]) => ds.reduce((s, d) => s + d.balance, 0);

function rowOf(item: Item): PreviewRow {
  const first = item.lines[0];
  const pending = pendingOf(item);
  const paid = pending.reduce((s, l) => s + cents(l.paid_total), 0);
  const base = {
    key: item.key, patient_type: item.pt, ref: item.ref, hn: first.hn, rep_no: first.rep_no, tran_id: first.tran_id, lines: item.lines.length,
    account_code: (item.debts[0] ?? item.all[0])?.account_code ?? null, paid: paid / 100, closable: false, close_default: false,
  };
  const none = (status: SettleStatus): PreviewRow => ({
    ...base, group: "none", status, balance: item.all.length ? sumBalance(item.all) / 100 : null, remaining: null,
  });
  if (!item.ref) return none("no_ref");
  if (!item.all.length) return none("no_debt");
  if (!item.debts.length) return none(item.all.every((d) => !d.account_code) ? "no_account" : "not_stm");
  const balance = sumBalance(item.debts);
  const remaining = balance - paid;
  const left = (r: number): SettleStatus => (r > 0 ? "partial" : r < 0 ? "over" : "settled");
  let group: SettleGroup, status: SettleStatus;
  if (!pending.length) {
    if (!item.lines.some((l) => l.done)) return none("zero");
    [group, status] = ["done", left(remaining)];
  } else if (remaining === 0) [group, status] = ["match", "match"];
  else [group, status] = ["diff", paid < 0 ? "recall" : remaining > 0 ? "under" : "over"];
  return { ...base, group, status, balance: balance / 100, remaining: remaining / 100, closable: remaining !== 0, close_default: remaining < 0 };
}

/** แถวตัวอย่างของไฟล์: บรรทัด STM ต่อหนี้ + หนี้ใน REP งวดนี้ที่ STM ไม่จ่าย (หนึ่งแถวต่อ VN/AN) */
export function previewRows(lines: StmLine[], debts: DebtRow[], missing: MissingRow[], pt: PatientType): PreviewRow[] {
  const rows = itemsOf(lines, debts).map(rowOf);
  const miss = new Map<string, PreviewRow>();
  for (const m of missing) {
    const k = keyOf(pt, m);
    if (!k) continue;
    const prev = miss.get(k);
    if (prev) {
      prev.balance = Math.round((prev.balance ?? 0) * 100 + cents(m.balance)) / 100;
      prev.remaining = prev.balance;
      continue;
    }
    const b = cents(m.balance) / 100;
    miss.set(k, {
      key: k, patient_type: pt, ref: (pt === "OP" ? m.vn : m.an) ?? null, hn: m.hn, rep_no: m.rep_no, tran_id: m.tran_id, lines: 0,
      group: "missing", status: "missing", account_code: m.account_code, balance: b, paid: null, remaining: b, closable: false, close_default: false,
    });
  }
  return [...rows, ...miss.values()];
}

/** จำนวนและยอดต่อกลุ่ม + แผนตามค่าเริ่มต้น (บาท ปัดที่สตางค์) */
export function summarize(rows: PreviewRow[]): Pick<SettleSummary, "groups" | "plan"> {
  const c = (v: number | null) => Math.round((v ?? 0) * 100);
  const g = Object.fromEntries(SETTLE_GROUPS.map((k) => [k, { n: 0, paid: 0, balance: 0 }])) as SettleSummary["groups"];
  const p = { settle_n: 0, settle_amount: 0, close_n: 0, close_amount: 0 };
  for (const r of rows) {
    const x = g[r.group];
    x.n++;
    x.paid += c(r.paid);
    x.balance += c(r.balance);
    if (r.group === "match" || r.group === "diff") [p.settle_n, p.settle_amount] = [p.settle_n + 1, p.settle_amount + c(r.paid)];
    if (r.closable && r.close_default) [p.close_n, p.close_amount] = [p.close_n + 1, p.close_amount - c(r.remaining)];
  }
  for (const x of Object.values(g)) [x.paid, x.balance] = [x.paid / 100, x.balance / 100];
  return { groups: g, plan: { ...p, settle_amount: p.settle_amount / 100, close_amount: p.close_amount / 100 } };
}

/** ปิดส่วนต่างของรายนี้ไหม: ติ๊กเอง (close) หรือค่าเริ่มต้นที่ไม่ได้เอาติ๊กออก (keep) */
export const shouldClose = (r: PreviewRow, close: Set<string>, keep: Set<string>) =>
  r.closable && (close.has(r.key) || (r.close_default && !keep.has(r.key)));

/**
 * แถวที่จะลง ar_ledger: แต่ละบรรทัด STM ที่ยังไม่ตัด แบ่งยอดให้หนี้ที่คงเหลือมากก่อน ส่วนเกินลงหนี้สุดท้าย (คงเหลือเก็บไว้)
 * แล้วรายที่ปิดส่วนต่าง ลง diff ให้ทุกหนี้ที่ยังคงเหลือเป็น 0 อ้างบรรทัดสุดท้ายของรายในไฟล์ (unique (stm_row_id, ref, kind))
 * entryDate = วันออกใบเสร็จ ; ไม่มีแถว amount 0 (constraint ar_ledger amount <> 0)
 */
export function planSettle(lines: StmLine[], debts: DebtRow[], opts: { entryDate: string; close: (r: PreviewRow) => boolean }): SettleEntry[] {
  const entries: SettleEntry[] = [];
  for (const item of itemsOf(lines, debts)) {
    if (!item.debts.length) continue;
    const r = rowOf(item);
    const doClose = r.closable && opts.close(r);
    const row = (d: Debt, kind: "settle" | "diff", amount: number, note: string, lineId: string): SettleEntry => ({
      source: "stm", kind, ref: d.ref, vn: d.vn, an: d.an, patient_type: d.patient_type, ref_date: d.ref_date, entry_date: opts.entryDate,
      pttype: d.pttype, hipdata_code: d.hipdata_code, hospmain: d.hospmain, hospmain_chwpart: d.hospmain_chwpart, account_code: d.account_code,
      amount: baht(amount), note, stm_row_id: lineId,
    });
    for (const line of pendingOf(item)) {
      let rest = cents(line.paid_total);
      const sorted = [...item.debts].sort((a, b) => b.balance - a.balance || a.ref.localeCompare(b.ref));
      sorted.forEach((d, i) => {
        const alloc = i === sorted.length - 1 ? rest : Math.min(Math.max(d.balance, 0), rest);
        rest -= alloc;
        if (alloc !== 0) entries.push(row(d, "settle", -alloc, alloc > 0 ? "รับชำระตาม STM" : "STM เรียกคืน", line.id));
        d.balance -= alloc;
      });
    }
    if (!doClose) continue;
    const last = item.lines[item.lines.length - 1].id;
    for (const d of item.debts)
      if (d.balance !== 0) entries.push(row(d, "diff", -d.balance, d.balance > 0 ? "ได้รับต่ำกว่าลูกหนี้" : "ได้รับสูงกว่าลูกหนี้", last));
  }
  return entries;
}

export const MAX_RECEIPT_NO = 50;
const MAX_KEYS = 10_000;
const KEY_RE = /^(OP:\d{12}|IP:\d{1,12})$/;
export type SettleBody = { stm_file_id: string; receipt_date: string; receipt_no: string | null; close: Set<string>; keep: Set<string> };

/** body ของ POST /api/fund/ar-settle ; receipt_date ตั้งแต่ min (วันเริ่มสมุด) ถึง today ; receipt_no ว่าง = null (route บังคับเมื่อมีรับชำระ) */
export function parseSettleBody(raw: unknown, today: string, min: string): SettleBody | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const id = String(b.stm_file_id ?? "");
  if (!/^\d{1,15}$/.test(id)) return { error: "stm_file_id ไม่ถูกต้อง" };
  const date = b.receipt_date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || date < min || date > today)
    return { error: "วันที่ออกใบเสร็จต้องอยู่ระหว่างวันเริ่มสมุดลูกหนี้ถึงวันนี้" };
  if (b.receipt_no != null && typeof b.receipt_no !== "string") return { error: "เลขที่ใบเสร็จไม่ถูกต้อง" };
  const no = (b.receipt_no ?? "").trim();
  if (no.length > MAX_RECEIPT_NO) return { error: `เลขที่ใบเสร็จยาวได้ไม่เกิน ${MAX_RECEIPT_NO} ตัวอักษร` };
  const keys = (v: unknown) => (v == null ? [] : Array.isArray(v) && v.length <= MAX_KEYS && v.every((k) => typeof k === "string" && KEY_RE.test(k)) ? (v as string[]) : null);
  const close = keys(b.close), keep = keys(b.keep);
  if (!close || !keep) return { error: "รายการปิดส่วนต่างไม่ถูกต้อง" };
  return { stm_file_id: id, receipt_date: date, receipt_no: no || null, close: new Set(close), keep: new Set(keep) };
}
