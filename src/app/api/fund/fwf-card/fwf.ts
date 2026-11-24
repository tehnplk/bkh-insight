// บัตรประกันสุขภาพต่างด้าว (/fund/fwf-card) แบบ pure (ไม่มี import ค่า) ทดสอบด้วย node ได้ตรง (fwf.test.mjs) ยอดคิดเป็นสตางค์
// เงินรับล่วงหน้า (2103010103.502) = ผลรวมค่าบริการทางการแพทย์ของบัตรที่ขาย ใช้ร่วมกันทั้งก้อน (ตัดหนี้ผู้ถือบัตรคนใดก็ได้ แม้เกินมูลค่าบัตรของตัวเอง)
// ตัดหนี้สิ้นเดือน: หนี้ .501/.502 ที่คงเหลือ เรียงวันรับบริการ ตัดเท่าที่ pool เหลือ ส่วนที่เกินลงส่วนต่าง (diff) ; ไม่มีบัตรที่ใช้ได้ = ต้องตรวจ ไม่ตัด

/** วันแรกที่นับบัตรเข้า pool shortcut: ยังรอเจ้าหน้าที่ยืนยันวันเริ่ม pool, เปลี่ยนที่นี่ที่เดียวเมื่อได้คำตอบ */
export const POOL_START = "2024-10-01";
/** สิทธิผู้ถือบัตรใน HOSxP และบัญชีลูกหนี้ของสิทธินี้ */
export const FWF_PTTYPE = "99";
export const FWF_ACCOUNTS = { OP: "1102050101.501", IP: "1102050101.502" } as const;
export const HN_RE = /^\d{1,9}$/;
export const MAX_REASON = 500;

type Num = string | number;
type PatientType = "OP" | "IP";
export const cents = (v: Num | null | undefined) => Math.round(Number(v ?? 0) * 100);
export const baht = (c: number) => (c / 100).toFixed(2);

/* ---------- วันที่ (ISO YYYY-MM-DD, UTC) ---------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** บวกเดือนแบบปัดเป็นวันสุดท้ายของเดือนเมื่อวันเกิน (31 ม.ค. + 1 เดือน = 28/29 ก.พ.) */
export function addMonths(d: string, n: number) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + n, day = +d.slice(8, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10);
}
/** วันสุดท้ายของเดือน YYYY-MM */
export const monthEnd = (month: string) => addDays(addMonths(`${month}-01`, 1), -1);
export const monthOf = (d: string) => d.slice(0, 7);
/** เดือน YYYY-MM จาก from ถึง to (รวมปลาย) */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = monthOf(from); m <= monthOf(to); m = monthOf(addMonths(`${m}-01`, 1))) out.push(m);
  return out;
}
/** month YYYY-MM ตั้งแต่เดือนของ min ถึงเดือนของ today */
export const validMonth = (month: unknown, today: string, min = POOL_START): month is string =>
  typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= monthOf(min) && month <= monthOf(today);

/* ---------- ชนิดบัตรและอายุบัตร ---------- */

export type CardType = { id: string; icode: string; unit_price: Num; label: string; months: number; pool_amount: Num | null; active: boolean; note?: string | null };

/** ชนิดบัตรจาก (icode, ราคาต่อหน่วย) เฉพาะชนิดที่ใช้อยู่ ; ไม่ตรง = ไม่ใช่บัตร (เช่น 3002154 ราคา 500 = ค่าตรวจสุขภาพ) */
export function matchType(types: CardType[], icode: string, unitprice: Num): CardType | null {
  return types.find((t) => t.active && t.icode === icode && cents(t.unit_price) === cents(unitprice)) ?? null;
}

/** อายุบัตรค่าเริ่มต้น: วันขาย ถึง วันขาย + months − 1 วัน */
export const defaultValidity = (saleDate: string, months: number) => ({ valid_from: saleDate, valid_to: addDays(addMonths(saleDate, months), -1) });

/** pool ของบัตร = pool ของชนิด × จำนวน (ชนิดยังไม่กำหนด = null) */
export const cardPool = (type: Pick<CardType, "pool_amount">, qty: number) => (type.pool_amount == null ? null : baht(cents(type.pool_amount) * qty));

/* ---------- บัตรที่ใช้ได้และยอดคงเหลือ ---------- */

export type Card = { id: string; hn: string; sale_date: string; valid_from: string; valid_to: string; status: "active" | "void"; pool_amount: Num | null };

/** บัตรที่ใช้ได้ในวันนั้น: active และ valid_from ≤ date ≤ valid_to ; หลายใบ = ใบที่หมดอายุก่อน (เท่ากันใช้ id น้อย) */
export function coveringCard<C extends Card>(cards: C[], hn: string, date: string): C | null {
  let best: C | null = null;
  for (const c of cards) {
    if (c.status !== "active" || c.hn !== hn || c.valid_from > date || c.valid_to < date) continue;
    if (!best || c.valid_to < best.valid_to || (c.valid_to === best.valid_to && Number(c.id) < Number(best.id))) best = c;
  }
  return best;
}

/** ยอดของบัตร (บาท): usage = หนี้ของผู้ถือที่ตัดโดยอ้างบัตรนี้ (settle + diff) ; null pool = ยังไม่กำหนด */
export function cardBalance(pool: Num | null, usage: Num, released: Num) {
  const p = cents(pool), u = cents(usage), r = cents(released);
  return { remaining: pool == null ? null : (p - u - r) / 100, loss: pool == null ? null : Math.max(0, u - p) / 100 };
}

/**
 * ยอดเงินรับล่วงหน้า ณ วันที่ (บาท): pool ของบัตร active ที่ขาย POOL_START ≤ sale_date ≤ date − ยอดที่ตัดหนี้แล้วทั้งหมด − ยอดที่โอนไปเงินบำรุงทั้งหมด
 * ยอดตัด/โอนไม่กรองวัน (นับทุกครั้งที่ลงแล้ว) ตัดย้อนเดือนก่อนหน้าจึงใช้ pool ซ้ำไม่ได้ ; unset = จำนวนบัตรที่ยังไม่กำหนด pool
 */
export function poolBalance(cards: Card[], settled: Num, released: Num, date: string) {
  let pool = 0, unset = 0;
  for (const c of cards) {
    if (c.status !== "active" || c.sale_date < POOL_START || c.sale_date > date) continue;
    if (c.pool_amount == null) unset++;
    else pool += cents(c.pool_amount);
  }
  return { pool_in: pool / 100, settled: cents(settled) / 100, released: cents(released) / 100, balance: (pool - cents(settled) - cents(released)) / 100, unset };
}

/* ---------- ตัดหนี้สิ้นเดือน ---------- */

/** หนี้ .501/.502 ที่คงเหลือ (แถว set + ยอดคงเหลือทุก source) hn/service_date จาก HOSxP (null = หาไม่พบ) */
export type PlanDebt = {
  source: "rcpt_debt" | "ipt"; ref: string; vn: string | null; an: string | null; patient_type: PatientType; ref_date: string | null;
  pttype: string | null; hipdata_code: string | null; hospmain: string | null; hospmain_chwpart: string | null; account_code: string | null;
  balance: Num; hn: string | null; service_date: string | null; missing_reason?: string;
  /** สิทธิของ visit ใน HOSxP ตอนนี้ (OP) ไม่ใช่ 99 แล้ว = ต้องตรวจ */
  his_pttype?: string | null;
};
export const PLAN_STATUS = { settle: "ตัดเต็มยอด", partial: "ตัดบางส่วน + ส่วนต่าง", diff: "pool หมด ลงส่วนต่าง", check: "ต้องตรวจ", blocked: "ชนิดบัตรยังไม่กำหนดยอด" } as const;
export type PlanStatus = keyof typeof PLAN_STATUS;
export type PlanRow = {
  key: string; patient_type: PatientType; ref: string; vn: string | null; an: string | null; hn: string | null; service_date: string | null;
  account_code: string | null; balance: number; status: PlanStatus; card_id: string | null; settle: number; diff: number; reason: string | null;
};
/** แถวที่จะลง ar_ledger (source fwf) amount เป็นบาท string ; fwf_card_id = บัตรที่ใช้ */
export type FwfEntry = Omit<PlanDebt, "source" | "balance" | "hn" | "service_date" | "missing_reason" | "his_pttype"> & {
  source: "fwf"; kind: "settle" | "diff"; entry_date: string; amount: string; note: string; fwf_card_id: string;
};
export type MonthEndPlan = {
  month_end: string;
  pool_before: number; pool_after: number;
  rows: PlanRow[]; entries: FwfEntry[];
  totals: { settle: number; diff: number; settle_n: number; diff_n: number; check_n: number; blocked_n: number };
  /** เหตุที่ยืนยันไม่ได้ (ว่าง = ยืนยันได้) */
  blocked: string[];
};

/**
 * แผนตัดหนี้ ณ สิ้นเดือน: หนี้ balance > 0 ที่วันรับบริการ ≤ monthEnd เรียงวันรับบริการแล้ว ref
 * ไม่มี HN/วันรับบริการ, สิทธิของ visit ใน HOSxP ไม่ใช่ 99 แล้ว หรือไม่มีบัตรที่ใช้ได้ในวันรับบริการ (IP ใช้วัน admit) = ต้องตรวจ ; บัตรที่ชนิดยังไม่กำหนด pool = ยืนยันไม่ได้
 * นอกนั้นตัด min(คงเหลือ, pool) ส่วนที่เหลือลง diff ให้หนี้เป็น 0
 */
export function planMonthEnd(debts: PlanDebt[], cards: Card[], pool: Num, end: string): MonthEndPlan {
  const blockedCards = new Set<string>();
  let left = cents(pool);
  const before = left;
  const rows: PlanRow[] = [], entries: FwfEntry[] = [];
  const sorted = debts
    .map((d) => ({ d, date: d.service_date ?? d.ref_date ?? "", bal: cents(d.balance) }))
    .filter((x) => x.bal > 0 && x.date && x.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.d.ref.localeCompare(b.d.ref));
  for (const { d, date, bal } of sorted) {
    const base = {
      key: `${d.patient_type}:${d.ref}`, patient_type: d.patient_type, ref: d.ref, vn: d.vn, an: d.an, hn: d.hn, service_date: d.service_date,
      account_code: d.account_code, balance: bal / 100, card_id: null, settle: 0, diff: 0, reason: null,
    };
    if (!d.hn || !d.service_date) {
      rows.push({ ...base, status: "check", reason: d.missing_reason ?? "ไม่พบ HN หรือวันรับบริการใน HOSxP" });
      continue;
    }
    if (d.his_pttype != null && d.his_pttype !== FWF_PTTYPE) {
      rows.push({ ...base, status: "check", reason: `สิทธิของ visit ใน HOSxP เป็น ${d.his_pttype || "ว่าง"} ไม่ใช่ ${FWF_PTTYPE} แล้ว แก้สิทธิหรือบัญชีลูกหนี้` });
      continue;
    }
    const card = coveringCard(cards, d.hn, date);
    if (!card) {
      rows.push({ ...base, status: "check", reason: "ไม่มีบัตรที่ใช้ได้ในวันรับบริการ ตรวจสิทธิใน HOSxP" });
      continue;
    }
    if (card.pool_amount == null) {
      rows.push({ ...base, card_id: card.id, status: "blocked", reason: "ชนิดบัตรยังไม่กำหนดค่าบริการทางการแพทย์" });
      blockedCards.add(card.id);
      continue;
    }
    const settle = Math.max(0, Math.min(bal, left));
    const diff = bal - settle;
    left -= settle;
    const status: PlanStatus = diff === 0 ? "settle" : settle > 0 ? "partial" : "diff";
    rows.push({ ...base, card_id: card.id, status, settle: settle / 100, diff: diff / 100 });
    const entry = (kind: "settle" | "diff", c: number, note: string): FwfEntry => ({
      source: "fwf", kind, ref: d.ref, vn: d.vn, an: d.an, patient_type: d.patient_type, ref_date: d.ref_date, pttype: d.pttype,
      hipdata_code: d.hipdata_code, hospmain: d.hospmain, hospmain_chwpart: d.hospmain_chwpart, account_code: d.account_code,
      entry_date: end, amount: baht(-c), note, fwf_card_id: card.id,
    });
    if (settle) entries.push(entry("settle", settle, "ตัดด้วยเงินรับล่วงหน้าบัตรประกันสุขภาพต่างด้าว"));
    if (diff) entries.push(entry("diff", diff, "เงินรับล่วงหน้าไม่พอ ลงส่วนต่าง"));
  }
  const sum = (k: "settle" | "diff") => Math.round(rows.reduce((s, r) => s + r[k] * 100, 0)) / 100;
  const count = (f: (r: PlanRow) => boolean) => rows.filter(f).length;
  const blockedN = count((r) => r.status === "blocked");
  return {
    month_end: end, pool_before: before / 100, pool_after: left / 100, rows, entries,
    totals: { settle: sum("settle"), diff: sum("diff"), settle_n: count((r) => r.settle > 0), diff_n: count((r) => r.diff > 0), check_n: count((r) => r.status === "check"), blocked_n: blockedN },
    blocked: blockedN ? [`บัตร ${blockedCards.size} ใบของหนี้ ${blockedN} รายเป็นชนิดที่ยังไม่กำหนดค่าบริการทางการแพทย์ ให้ผู้ดูแลกำหนดที่แท็บชนิดบัตรก่อน`] : [],
  };
}

/* ---------- ตรวจ body ---------- */

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
export type ValidityBody = { valid_from: string; valid_to: string };
export function parseValidity(b: Record<string, unknown>): ValidityBody | { error: string } {
  const { valid_from, valid_to } = b;
  if (!isIsoDate(valid_from) || !isIsoDate(valid_to)) return { error: "วันเริ่มและวันหมดอายุต้องเป็นวันที่ YYYY-MM-DD" };
  if (valid_to < valid_from) return { error: "วันหมดอายุต้องไม่ก่อนวันเริ่ม" };
  return { valid_from, valid_to };
}

export type AddCardBody =
  | { kind: "manual"; hn: string; card_type_id: string; sale_date: string; validity: ValidityBody | null }
  | { kind: "hosxp"; hn: string; hos_guid: string };
/** POST เพิ่มบัตร: { hn, hos_guid } (แถวขายใน HOSxP) หรือ { hn, card_type_id, sale_date, valid_from?, valid_to? } (เพิ่มเอง) */
export function parseAddCard(raw: unknown, today: string): AddCardBody | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const hn = str(b.hn);
  if (!HN_RE.test(hn)) return { error: "HN ต้องเป็นตัวเลขไม่เกิน 9 หลัก" };
  if (b.hos_guid != null) {
    const g = str(b.hos_guid);
    return /^[\w{}-]{1,38}$/.test(g) ? { kind: "hosxp", hn, hos_guid: g } : { error: "hos_guid ไม่ถูกต้อง" };
  }
  const type = String(b.card_type_id ?? "");
  if (!/^\d{1,15}$/.test(type)) return { error: "เลือกชนิดบัตร" };
  if (!isIsoDate(b.sale_date) || b.sale_date < POOL_START || b.sale_date > today) return { error: "วันขายต้องอยู่ระหว่างวันเริ่ม pool ถึงวันนี้" };
  let validity: ValidityBody | null = null;
  if (b.valid_from != null || b.valid_to != null) {
    const v = parseValidity(b);
    if ("error" in v) return v;
    validity = v;
  }
  return { kind: "manual", hn, card_type_id: type, sale_date: b.sale_date, validity };
}

export type CardPatch = { id: string } & ({ action: "validity"; validity: ValidityBody } | { action: "void"; reason: string });
/** PATCH บัตร: { id, action: "validity", valid_from, valid_to } หรือ { id, action: "void", reason } (เหตุผลบังคับ) */
export function parseCardPatch(raw: unknown): CardPatch | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const id = String(b.id ?? "");
  if (!/^\d{1,15}$/.test(id)) return { error: "id ไม่ถูกต้อง" };
  if (b.action === "validity") {
    const v = parseValidity(b);
    return "error" in v ? v : { id, action: "validity", validity: v };
  }
  if (b.action === "void") {
    const reason = str(b.reason);
    if (!reason || reason.length > MAX_REASON) return { error: `ต้องระบุเหตุผลที่ยกเลิก ไม่เกิน ${MAX_REASON} ตัวอักษร` };
    return { id, action: "void", reason };
  }
  return { error: "action ต้องเป็น validity หรือ void" };
}

export type ReleaseBody = { card_id: string; amount: string; released_on: string; ref: string | null; note: string | null };
/** POST โอนคงเหลือไปเงินบำรุง: { card_id, amount (> 0 ทศนิยม ≤ 2), released_on (≤ วันนี้), ref?, note? } ; route ตรวจยอดกับบัตรและ pool */
export function parseRelease(raw: unknown, today: string): ReleaseBody | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const id = String(b.card_id ?? "");
  if (!/^\d{1,15}$/.test(id)) return { error: "card_id ไม่ถูกต้อง" };
  const n = Number(b.amount);
  if (!Number.isFinite(n) || n <= 0 || n >= 1e9 || Math.round(n * 100) !== n * 100) return { error: "จำนวนเงินต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง" };
  if (!isIsoDate(b.released_on) || b.released_on < POOL_START || b.released_on > today) return { error: "วันที่โอนต้องไม่เกินวันนี้" };
  const ref = str(b.ref), note = str(b.note);
  if (ref.length > 50 || note.length > MAX_REASON) return { error: "เลขที่อ้างอิงหรือหมายเหตุยาวเกินไป" };
  return { card_id: id, amount: n.toFixed(2), released_on: b.released_on, ref: ref || null, note: note || null };
}

export type TypePatch = { id: string; label: string; months: number; pool_amount: string | null; active: boolean; note: string | null };
/** PATCH ชนิดบัตร (admin): { id, label, months (1–60), pool_amount (null = ยังไม่กำหนด), active, note? } */
export function parseTypePatch(raw: unknown): TypePatch | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const id = String(b.id ?? "");
  if (!/^\d{1,15}$/.test(id)) return { error: "id ไม่ถูกต้อง" };
  const label = str(b.label);
  if (!label || label.length > 100) return { error: "ต้องระบุชื่อชนิดบัตร ไม่เกิน 100 ตัวอักษร" };
  const months = Number(b.months);
  if (!Number.isInteger(months) || months < 1 || months > 60) return { error: "อายุบัตรต้องเป็นจำนวนเดือน 1–60" };
  let pool: string | null = null;
  if (b.pool_amount != null && b.pool_amount !== "") {
    const n = Number(b.pool_amount);
    if (!Number.isFinite(n) || n < 0 || n >= 1e7 || Math.round(n * 100) !== n * 100) return { error: "ค่าบริการทางการแพทย์ต้องไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง" };
    pool = n.toFixed(2);
  }
  if (typeof b.active !== "boolean") return { error: "active ต้องเป็น true/false" };
  const note = str(b.note);
  if (note.length > MAX_REASON) return { error: "หมายเหตุยาวเกินไป" };
  return { id, label, months, pool_amount: pool, active: b.active, note: note || null };
}
