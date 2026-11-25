// เงินโอนที่ได้รับ (/fund/ar-transfer) แบบ pure ไม่มี import ค่า จึงรันทดสอบด้วย node ได้ตรง (transfer.test.mjs)
// แถว SMT (budgetSummaryByVendorReport/search) -> ar_transfer ; กองทุนจับคู่บัญชีด้วย fund_key ใน ar_transfer_fund_map

/** field ของแถว SMT ที่ใช้ (หนึ่งแถวต่อรายการโอนในชุด postingDate + batchNo) */
export type SmtTransferRow = {
  budgetSource: string;
  postingDate: string; // พ.ศ. YYYYMMDD
  batchNo: string;
  refDocNo: string | null;
  /** ปี พ.ศ. 2 หลัก + กองทุน/กองทุนย่อย/รายการ 2 หลักต่อชั้น เช่น "69010101" */
  mouGrpCode: string;
  /** บัญชีที่ SMT แนะนำ (บางแถวเป็น " ") */
  mophId: string | null;
  mophDesc: string | null;
  fundDescr: string | null;
  efundDesc: string | null;
  /** ยอดโอนสุทธิ = amount − wait − debt */
  total: number;
  pmntStts: string; // P = โอนแล้ว, W = รอโอน
};

export type FundMapEntry = { account_code: string | null; ignore: boolean };
/** แถว ar_transfer เดิมของ smt_key (edited = updated_by ไม่ NULL) */
export type ExistingTransfer = { amount: string | number; account_code: string; edited: boolean; cancelled: boolean };

export type TransferInsert = {
  smt_key: string; transfer_date: string; ref_doc_no: string | null; fund_key: string; fund_name: string; account_code: string; amount: number;
};
export type NewFund = { fund_key: string; fund_name: string; smt_account_name: string | null };
export type UnmappedFund = { fund_key: string; fund_name: string; n: number; total: number };
export type ImportCounts = {
  /** เพิ่มใหม่ */ new: number;
  /** ยอด/บัญชีเปลี่ยนตาม SMT หรือ mapping (แถวที่การเงินยังไม่แก้) */ updated: number;
  unchanged: number;
  /** การเงินแก้หรือยกเลิกแล้ว ไม่ทับ */ kept: number;
  /** รายการของกองทุนที่ยังไม่จับคู่บัญชี */ unmapped: number;
  /** รายการของกองทุนที่ตั้งว่าไม่ใช้ */ ignored: number;
  /** รอโอน (pmntStts W) */ pending: number;
  /** อยู่ในงวดที่ปิดแล้ว ไม่เพิ่ม/ไม่แก้ */ closed: number;
};
export type ImportPlan = {
  inserts: TransferInsert[];
  updates: { smt_key: string; account_code: string; amount: number }[];
  newFunds: NewFund[];
  unmapped: UnmappedFund[];
  counts: ImportCounts;
};

export const ACCOUNT_RE = /^\d{10}\.(\d{3}|\d{5})$/;
const cents = (n: number | string) => Math.round(Number(n) * 100);
const trim = (s: string | null | undefined) => s?.trim() ?? "";

/** "25691113" -> "2026-11-13" */
export const smtIso = (be: string) => `${+be.slice(0, 4) - 543}-${be.slice(4, 6)}-${be.slice(6, 8)}`;

/** กองทุนของแถว: ไม่รวมปีใน mouGrpCode ให้คีย์เดิมข้ามปีงบ ; mophId อยู่ในคีย์เพราะ SMT แยกบัญชีในกองทุนย่อยเดียวกัน (P&P BASIC มีทั้ง .217/.223/.243) */
export const fundKey = (r: Pick<SmtTransferRow, "budgetSource" | "mophId" | "mouGrpCode">) =>
  `${trim(r.budgetSource)}|${trim(r.mophId)}|${/^\d{8}$/.test(r.mouGrpCode) ? r.mouGrpCode.slice(2) : trim(r.mouGrpCode)}`;

/** คีย์ธรรมชาติของแถวโอน (ข้อมูลจริงปีงบ 2569–2570 ไม่ซ้ำ) */
export const smtKey = (r: SmtTransferRow) =>
  [trim(r.budgetSource), r.postingDate, trim(r.batchNo), trim(r.refDocNo), trim(r.mouGrpCode), trim(r.mophId)].join("|");

/** ปีงบ พ.ศ. ของงบ = 2 หลักแรกของ mouGrpCode ("69010101" -> 2569) ; null = ไม่ใช่ 8 หลัก */
export const budgetYear = (mouGrpCode: string | null | undefined) => (/^\d{8}$/.test(trim(mouGrpCode)) ? 2500 + +trim(mouGrpCode).slice(0, 2) : null);
/** ปีงบของแถวที่นำเข้าแล้ว จาก smt_key (mouGrpCode คือช่องรองสุดท้าย ; ช่องท้ายเป็น mophId ไม่มี "|") */
export const keyBudgetYear = (smtKey: string | null) => (smtKey ? budgetYear(smtKey.split("|").at(-2)) : null);
/** ปีงบ พ.ศ. ของวันโอน "25691009" -> 2570 */
const transferFy = (be: string) => +be.slice(0, 4) + (+be.slice(4, 6) >= 10 ? 1 : 0);

/**
 * รายการโอนของงบปีงบก่อนวันโอน (เช่น OP REFER/P&P fee schedule งวดปีก่อน) ไม่นับในรายได้เหมาจ่ายของปีที่โอน
 * การเงินให้ลงบัญชีนี้แทนบัญชีของกองทุน ; จัดสรรพลางก่อนต้นปีงบ (8 ต.ค.) ใช้ mouGrpCode ของปีงบใหม่ จึงไม่ย้าย
 */
export const PRIOR_YEAR_ACCOUNT = { code: "3102010102.201", name: "กำไร/ขาดทุนสะสมจากข้อผิดพลาดเงินกองทุน UC ปีก่อน" };

export const fundName = (r: Pick<SmtTransferRow, "efundDesc" | "fundDescr">) => trim(r.efundDesc) || trim(r.fundDescr);

/**
 * แผนนำเข้า: ข้ามรอโอน ยอด 0 และกองทุนที่ยังไม่จับคู่/ไม่ใช้ (กองทุนที่ไม่เคยเห็นได้แถว mapping ว่างใน newFunds)
 * งบปีก่อนวันโอนลง PRIOR_YEAR_ACCOUNT ; แถวเดิมที่การเงินแก้หรือยกเลิกไม่แตะ ; closedThrough = เดือนล่าสุดที่ปิดงวด YYYY-MM (null = ไม่มี)
 */
export function planImport(rows: SmtTransferRow[], map: Map<string, FundMapEntry>, existing: Map<string, ExistingTransfer>, closedThrough: string | null): ImportPlan {
  const counts: ImportCounts = { new: 0, updated: 0, unchanged: 0, kept: 0, unmapped: 0, ignored: 0, pending: 0, closed: 0 };
  const plan: ImportPlan = { inserts: [], updates: [], newFunds: [], unmapped: [], counts };
  const unmapped = new Map<string, UnmappedFund>();
  for (const r of rows) {
    if (r.pmntStts !== "P") {
      counts.pending++;
      continue;
    }
    if (!cents(r.total)) continue;
    const fk = fundKey(r);
    const m = map.get(fk);
    if (!m) {
      plan.newFunds.push({ fund_key: fk, fund_name: fundName(r), smt_account_name: trim(r.mophDesc) || null });
      map.set(fk, { account_code: null, ignore: false }); // กองทุนเดียวกันแถวถัดไปไม่เพิ่มซ้ำ
    }
    const mapped = m?.account_code ?? null;
    if (m?.ignore) {
      counts.ignored++;
      continue;
    }
    if (!mapped) {
      counts.unmapped++;
      const u = unmapped.get(fk) ?? { fund_key: fk, fund_name: fundName(r), n: 0, total: 0 };
      u.n++;
      u.total = (cents(u.total) + cents(r.total)) / 100;
      unmapped.set(fk, u);
      continue;
    }
    const by = budgetYear(r.mouGrpCode);
    const account = by !== null && by < transferFy(r.postingDate) ? PRIOR_YEAR_ACCOUNT.code : mapped;
    const key = smtKey(r);
    const date = smtIso(r.postingDate);
    const amount = cents(r.total) / 100;
    const old = existing.get(key);
    if (old?.edited || old?.cancelled) counts.kept++;
    else if (old && cents(old.amount) === cents(amount) && old.account_code === account) counts.unchanged++;
    else if (closedThrough && date.slice(0, 7) <= closedThrough) counts.closed++;
    else if (old) {
      plan.updates.push({ smt_key: key, account_code: account, amount });
      counts.updated++;
    } else {
      plan.inserts.push({ smt_key: key, transfer_date: date, ref_doc_no: trim(r.refDocNo) || null, fund_key: fk, fund_name: fundName(r), account_code: account, amount });
      counts.new++;
    }
  }
  plan.unmapped = [...unmapped.values()].sort((a, b) => a.fund_key.localeCompare(b.fund_key));
  return plan;
}

/** บัญชีที่แสดงก่อน (รายได้เหมาจ่ายที่รอบตัดหนี้สิ้นเดือนใช้) */
export const PRIMARY_ACCOUNTS = ["4301020105.214", "4301020105.217"];

export type SummaryRow = { account_code: string; months: Record<string, number>; total: number };

/** ยอดรับต่อบัญชีต่อเดือน (YYYY-MM ของ transfer_date) ไม่นับแถวที่ยกเลิก ; .214/.217 ขึ้นก่อนเสมอแม้ยังไม่มียอด */
export function summarize(rows: { account_code: string; transfer_date: string; amount: string | number; cancelled: boolean }[]): SummaryRow[] {
  const acc = new Map<string, Map<string, number>>(PRIMARY_ACCOUNTS.map((c) => [c, new Map()]));
  for (const r of rows) {
    if (r.cancelled) continue;
    const m = acc.get(r.account_code) ?? new Map<string, number>();
    const month = r.transfer_date.slice(0, 7);
    m.set(month, (m.get(month) ?? 0) + cents(r.amount));
    acc.set(r.account_code, m);
  }
  const rank = (c: string) => (PRIMARY_ACCOUNTS.includes(c) ? PRIMARY_ACCOUNTS.indexOf(c) : PRIMARY_ACCOUNTS.length);
  return [...acc]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([account_code, m]) => ({
      account_code,
      months: Object.fromEntries([...m].map(([k, c]) => [k, c / 100])),
      total: [...m.values()].reduce((s, c) => s + c, 0) / 100,
    }));
}

/* ---------- ตรวจ body ของการเพิ่มเอง/แก้/ยกเลิก ---------- */

export const MAX_NOTE = 500;
export type TransferInput = { transfer_date: string; account_code: string; amount: number; note: string | null };
type Err = { error: string };

const validDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** วันที่ (from..today) บัญชี ยอด (≠ 0 ไม่เกิน 2 ทศนิยม ติดลบได้ เช่น ถูกหักคืน) และหมายเหตุ */
export function parseTransferInput(b: unknown, from: string, today: string): TransferInput | Err {
  const x = (b ?? {}) as Record<string, unknown>;
  if (!validDate(x.transfer_date) || x.transfer_date < from || x.transfer_date > today) return { error: "วันที่โอนต้องอยู่ระหว่างวันเริ่มสมุดลูกหนี้ถึงวันนี้" };
  const account = typeof x.account_code === "string" ? x.account_code.trim() : "";
  if (!ACCOUNT_RE.test(account)) return { error: "รหัสบัญชีต้องเป็นรูปแบบ 4301020105.214" };
  const amount = Number(x.amount);
  if (typeof x.amount !== "number" || !Number.isFinite(amount) || !cents(amount) || Math.abs(amount) >= 1e12 || Math.abs(amount * 100 - cents(amount)) > 1e-6)
    return { error: "จำนวนเงินต้องไม่เป็น 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง" };
  if (x.note != null && typeof x.note !== "string") return { error: "หมายเหตุต้องเป็นข้อความ" };
  const note = (x.note as string | null | undefined)?.trim() || null;
  if (note && note.length > MAX_NOTE) return { error: `หมายเหตุยาวได้ไม่เกิน ${MAX_NOTE} ตัวอักษร` };
  return { transfer_date: x.transfer_date, account_code: account, amount, note };
}

export type TransferPatch = ({ action: "edit" } & TransferInput) | { action: "cancel"; reason: string };

/** { id, action: "edit", ...TransferInput } หรือ { id, action: "cancel", reason } */
export function parseTransferPatch(b: unknown, from: string, today: string): ({ id: string } & TransferPatch) | Err {
  const x = (b ?? {}) as Record<string, unknown>;
  const id = typeof x.id === "string" || typeof x.id === "number" ? String(x.id) : "";
  if (!/^\d{1,18}$/.test(id)) return { error: "id ไม่ถูกต้อง" };
  if (x.action === "cancel") {
    const reason = typeof x.reason === "string" ? x.reason.trim() : "";
    if (!reason || reason.length > MAX_NOTE) return { error: `กรอกเหตุผลที่ยกเลิก ไม่เกิน ${MAX_NOTE} ตัวอักษร` };
    return { id, action: "cancel", reason };
  }
  if (x.action !== "edit") return { error: "action ต้องเป็น edit หรือ cancel" };
  const input = parseTransferInput(x, from, today);
  return "error" in input ? input : { id, action: "edit", ...input };
}

export const STATUS_LABEL: Record<"active" | "cancelled", string> = { active: "ใช้งาน", cancelled: "ยกเลิก" };
export const SOURCE_LABEL: Record<"smt" | "manual", string> = { smt: "SMT", manual: "เพิ่มเอง" };
