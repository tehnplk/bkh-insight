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

/** ฝั่งของ mapping: ALL = ทั้งกองทุน ; OP/IP = แถว SMT ฝั่งนั้น (ar_transfer_fund_map.side) */
export type FundSide = "ALL" | "OP" | "IP";
export type FundMapEntry = { account_code: string | null; ignore: boolean };
/** แถว ar_transfer เดิมของ smt_key (edited = updated_by ไม่ NULL, received = ลงรับแล้ว) */
export type ExistingTransfer = { amount: string | number; account_code: string; edited: boolean; cancelled: boolean; received?: boolean };

export type TransferInsert = {
  smt_key: string; transfer_date: string; ref_doc_no: string | null; fund_key: string; fund_name: string; account_code: string; amount: number;
};
export type NewFund = { fund_key: string; side: FundSide; fund_name: string; smt_account_name: string | null };
export type UnmappedFund = { fund_key: string; fund_name: string; n: number; total: number };
export type ImportCounts = {
  /** เพิ่มใหม่ */ new: number;
  /** ยอด/บัญชีเปลี่ยนตาม SMT หรือ mapping (แถวที่การเงินยังไม่แก้) */ updated: number;
  unchanged: number;
  /** การเงินแก้ ยกเลิก หรือลงรับแล้ว ไม่ทับ */ kept: number;
  /** รายการของกองทุนที่ยังไม่จับคู่บัญชี */ unmapped: number;
  /** รายการของกองทุนที่ตั้งว่าไม่ใช้ */ ignored: number;
  /** รอโอน (pmntStts W) */ pending: number;
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

/** ฝั่งของแถว SMT จากเลขงวด REP/STM ต้น refDocNo ("6909_IP_02", "6909_OP_01_อุทธรณ์") ; null = ไม่ระบุ (DDSA..., OP REFER..., งบจัดสรร) */
export const rowSide = (r: Pick<SmtTransferRow, "refDocNo">): "OP" | "IP" | null => (/^\d{4}_(OP|IP)_/.exec(trim(r.refDocNo))?.[1] as "OP" | "IP" | undefined) ?? null;

/**
 * งบปีก่อนย้ายไป PRIOR_YEAR_ACCOUNT เฉพาะ UC ; LGO ลงลูกหนี้ .801/.802 เสมอ เพราะตัดรายตัวด้วย REP
 * และส่วนต่างของหนี้ปีงบก่อนลง 3102010102.102 ตอนตัด (PRIOR_DIFF_ACCOUNT) ไม่ใช่ตอนรับเงิน
 */
const priorYearRule = (source: string | null | undefined) => trim(source) === "UC";

/** คีย์ของ Map mapping ต่อ (fund_key, side) */
export const mapKey = (fundKey: string, side: FundSide) => `${fundKey}#${side}`;

/** mapping ของแถว: ของฝั่ง OP/IP ที่ตั้งแล้ว (มีบัญชีหรือไม่ใช้) ก่อน ไม่งั้นของทั้งกองทุน ; undefined = กองทุนที่ไม่เคยเห็น */
export function findMapping(map: Map<string, FundMapEntry>, fk: string, side: "OP" | "IP" | null): FundMapEntry | undefined {
  const s = side ? map.get(mapKey(fk, side)) : undefined;
  return s && (s.account_code || s.ignore) ? s : map.get(mapKey(fk, "ALL"));
}

/**
 * แผนนำเข้า: ข้ามรอโอน ยอด 0 และกองทุนที่ยังไม่จับคู่/ไม่ใช้ (กองทุนที่ไม่เคยเห็นได้แถว mapping ว่างใน newFunds)
 * map คีย์ด้วย mapKey ; กองทุนที่มีทั้งแถว OP และ IP ได้แถว mapping ว่างของ OP/IP เพิ่ม ให้ admin แยกบัญชีได้ (ว่าง = ใช้ตาม ALL)
 * งบปีก่อนวันโอนลง PRIOR_YEAR_ACCOUNT ; แถวเดิมที่การเงินแก้ ยกเลิก หรือลงรับแล้วไม่แตะ (ใบเสร็จออกตามยอดนั้นแล้ว)
 * แถวใหม่/แถวที่อัปเดตเป็นรอออกใบเสร็จ ยังไม่ลงบัญชี งวดที่ปิดจึงไม่กัน (งวดปิดดูที่วันที่ใบเสร็จตอนลงรับ)
 */
export function planImport(
  rows: SmtTransferRow[], map: Map<string, FundMapEntry>, existing: Map<string, ExistingTransfer>,
  /** ฝั่งของเลขที่ REP (refDocNo ของ LGO ไม่มี _OP_/_IP_) จาก rep_row ; ไม่พบ = ใช้ mapping ALL */
  repSides: Map<string, "OP" | "IP"> = new Map(),
): ImportPlan {
  const counts: ImportCounts = { new: 0, updated: 0, unchanged: 0, kept: 0, unmapped: 0, ignored: 0, pending: 0 };
  const plan: ImportPlan = { inserts: [], updates: [], newFunds: [], unmapped: [], counts };
  const unmapped = new Map<string, UnmappedFund>();
  const sides = new Map<string, { op: boolean; ip: boolean; r: SmtTransferRow }>();
  const sideOf = (r: SmtTransferRow) => rowSide(r) ?? repSides.get(trim(r.refDocNo)) ?? null;
  for (const r of rows) {
    const side = sideOf(r);
    if (side) {
      const s = sides.get(fundKey(r)) ?? { op: false, ip: false, r };
      if (side === "OP") s.op = true;
      else s.ip = true;
      sides.set(fundKey(r), s);
    }
    if (r.pmntStts !== "P") {
      counts.pending++;
      continue;
    }
    if (!cents(r.total)) continue;
    const fk = fundKey(r);
    const m = findMapping(map, fk, side);
    if (!m) {
      plan.newFunds.push({ fund_key: fk, side: "ALL", fund_name: fundName(r), smt_account_name: trim(r.mophDesc) || null });
      map.set(mapKey(fk, "ALL"), { account_code: null, ignore: false }); // กองทุนเดียวกันแถวถัดไปไม่เพิ่มซ้ำ
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
    const account = priorYearRule(r.budgetSource) && by !== null && by < transferFy(r.postingDate) ? PRIOR_YEAR_ACCOUNT.code : mapped;
    const key = smtKey(r);
    const date = smtIso(r.postingDate);
    const amount = cents(r.total) / 100;
    const old = existing.get(key);
    if (old?.edited || old?.cancelled || old?.received) counts.kept++;
    else if (old && cents(old.amount) === cents(amount) && old.account_code === account) counts.unchanged++;
    else if (old) {
      plan.updates.push({ smt_key: key, account_code: account, amount });
      counts.updated++;
    } else {
      plan.inserts.push({ smt_key: key, transfer_date: date, ref_doc_no: trim(r.refDocNo) || null, fund_key: fk, fund_name: fundName(r), account_code: account, amount });
      counts.new++;
    }
  }
  for (const [fk, s] of sides) {
    if (!s.op || !s.ip) continue;
    for (const side of ["OP", "IP"] as const) {
      if (!map.has(mapKey(fk, side))) plan.newFunds.push({ fund_key: fk, side, fund_name: fundName(s.r), smt_account_name: trim(s.r.mophDesc) || null });
    }
  }
  plan.unmapped = [...unmapped.values()].sort((a, b) => a.fund_key.localeCompare(b.fund_key));
  return plan;
}

/* ---------- รายละเอียดกองทุน (modal ในตาราง "กองทุนใน SMT") ---------- */

/** field เพิ่มของแถว SMT ที่แสดงในรายละเอียด (ไม่มีข้อมูลบุคคล) */
export type SmtDetailRow = SmtTransferRow & { fundGroupDescr?: string | null; amount?: number; wait?: number; debt?: number; countRecord?: number };
export type FundLine = {
  date: string; ref_doc_no: string | null; batch_no: string; mou_grp_code: string; budget_year: number | null;
  group: string | null; fund: string; account: string | null; account_name: string | null;
  amount: number; wait: number; debt: number; total: number; status: string; paid: boolean; count: number | null;
  /** งบปีก่อนวันโอน: นำเข้าแล้วลง PRIOR_YEAR_ACCOUNT แทนบัญชีที่จับคู่ */
  prior_year: boolean;
  side: "OP" | "IP" | null;
};
export type FundYear = { budget_year: number | null; n: number; total: number };
export type FundSideTotal = { side: "OP" | "IP" | null; n: number; total: number };
/** sides: ยอดโอนแล้วแยก OP/IP/ไม่ระบุ (ว่าง = ไม่มีแถว OP/IP เลย) */
export type FundDetail = { lines: FundLine[]; n: number; total: number; pending: number; pending_total: number; years: FundYear[]; sides: FundSideTotal[] };

export const PAYMENT_STATUS: Record<string, string> = { P: "โอนแล้ว", W: "รอโอน" };

/** รายการโอนของกองทุน fund_key เรียงวันโอน ; ยอดรวมไม่นับรอโอน (แยกเป็น pending) และแยกตามงบปี */
export function fundDetail(rows: SmtDetailRow[], key: string): FundDetail {
  const lines = rows
    .filter((r) => fundKey(r) === key)
    .map((r): FundLine => {
      const by = budgetYear(r.mouGrpCode);
      return {
        date: smtIso(r.postingDate), ref_doc_no: trim(r.refDocNo) || null, batch_no: trim(r.batchNo), mou_grp_code: trim(r.mouGrpCode), budget_year: by,
        group: trim(r.fundGroupDescr) || null, fund: fundName(r), account: trim(r.mophId) || null, account_name: trim(r.mophDesc) || null,
        amount: r.amount ?? r.total, wait: r.wait ?? 0, debt: r.debt ?? 0, total: r.total,
        status: PAYMENT_STATUS[r.pmntStts] ?? r.pmntStts, paid: r.pmntStts === "P", count: r.countRecord ?? null,
        prior_year: priorYearRule(r.budgetSource) && by !== null && by < transferFy(r.postingDate),
        side: rowSide(r),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.batch_no.localeCompare(b.batch_no));
  const years = new Map<number | null, { n: number; c: number }>();
  let c = 0, pc = 0;
  for (const l of lines) {
    if (!l.paid) {
      pc += cents(l.total);
      continue;
    }
    c += cents(l.total);
    const y = years.get(l.budget_year) ?? { n: 0, c: 0 };
    y.n++;
    y.c += cents(l.total);
    years.set(l.budget_year, y);
  }
  const paid = lines.filter((l) => l.paid);
  const sides = lines.some((l) => l.side)
    ? (["OP", "IP", null] as const)
        .map((side) => {
          const ls = paid.filter((l) => l.side === side);
          return { side, n: ls.length, total: ls.reduce((s, l) => s + cents(l.total), 0) / 100 };
        })
        .filter((s) => s.n > 0)
    : [];
  return {
    lines, n: paid.length, total: c / 100, pending: lines.length - paid.length, pending_total: pc / 100,
    years: [...years].sort(([a], [b]) => (a ?? 0) - (b ?? 0)).map(([budget_year, y]) => ({ budget_year, n: y.n, total: y.c / 100 })),
    sides,
  };
}

/** บัญชีที่แสดงก่อน (รายได้เหมาจ่ายที่รอบตัดหนี้สิ้นเดือนใช้) */
export const PRIMARY_ACCOUNTS = ["4301020105.214", "4301020105.217"];

/** months/total = รับแล้วตามเดือนของวันที่ใบเสร็จ ; pending = รอออกใบเสร็จ (ทุกปีงบ) */
export type SummaryRow = { account_code: string; months: Record<string, number>; total: number; pending: number };

/** ยอดรับต่อบัญชีต่อเดือน (YYYY-MM ของ receipt_date ; null = รอออกใบเสร็จ) แถวที่ส่งมาต้องไม่ยกเลิก ; .214/.217 ขึ้นก่อนเสมอแม้ยังไม่มียอด */
export function summarize(rows: { account_code: string; receipt_date: string | null; amount: string | number }[]): SummaryRow[] {
  const acc = new Map<string, Map<string, number>>(PRIMARY_ACCOUNTS.map((c) => [c, new Map()]));
  for (const r of rows) {
    const m = acc.get(r.account_code) ?? new Map<string, number>();
    const month = r.receipt_date?.slice(0, 7) ?? "pending";
    m.set(month, (m.get(month) ?? 0) + cents(r.amount));
    acc.set(r.account_code, m);
  }
  const rank = (c: string) => (PRIMARY_ACCOUNTS.includes(c) ? PRIMARY_ACCOUNTS.indexOf(c) : PRIMARY_ACCOUNTS.length);
  return [...acc]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([account_code, m]) => {
      const months = [...m].filter(([k]) => k !== "pending");
      return {
        account_code,
        months: Object.fromEntries(months.map(([k, c]) => [k, c / 100])),
        total: months.reduce((s, [, c]) => s + c, 0) / 100,
        pending: (m.get("pending") ?? 0) / 100,
      };
    });
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

/** pending = รอออกใบเสร็จ (ยังไม่ลงบัญชี ไม่นับใน pool เหมาจ่าย), received = รับแล้ว (ลงบัญชีตามวันที่ใบเสร็จ) */
export const STATUS_LABEL: Record<"pending" | "received" | "cancelled", string> = { pending: "รอออกใบเสร็จ", received: "รับแล้ว", cancelled: "ยกเลิก" };

/* ---------- ลงรับเงินโอน (ใบเสร็จ) ---------- */

/** แถวรอออกใบเสร็จ (ไม่ยกเลิก receipt_date NULL) ; batch = batchNo ใน smt_key, manual = null (ลงรับรายแถว) */
export type PendingLine = {
  id: string; source: "smt" | "manual"; transfer_date: string; batch: string | null; ref_doc_no: string | null; fund_name: string | null;
  account_code: string; amount: string | number;
  /** ใบเสร็จของแถวอื่นในชุดเดียวกันที่ลงรับแล้ว (ชุดรับไม่ครบ เช่น SMT เพิ่มรายการหลังลงรับ) */
  batch_receipt_no: string | null;
};
export type PendingBatch = {
  key: string; transfer_date: string; batch: string | null; n: number; amount: number; batch_receipt_no: string | null;
  lines: (Omit<PendingLine, "amount" | "batch_receipt_no"> & { amount: number })[];
};

/** หนึ่งชุดโอน = (วันที่โอน, batchNo) ของ SMT เงินชุดเดียวกันเข้าธนาคารเป็นก้อนเดียว ; manual แยกรายแถว ; เรียงวันที่โอน */
export function pendingBatches(rows: PendingLine[]): PendingBatch[] {
  const out = new Map<string, PendingBatch & { c: number }>();
  for (const { batch_receipt_no, amount, ...r } of rows) {
    const batch = r.source === "smt" ? r.batch : null;
    const key = batch ? `${r.transfer_date}|${batch}` : `id:${r.id}`;
    const b = out.get(key) ?? { key, transfer_date: r.transfer_date, batch, n: 0, amount: 0, c: 0, lines: [], batch_receipt_no: null };
    b.n++;
    b.c += cents(amount);
    b.lines.push({ ...r, amount: Number(amount) });
    b.batch_receipt_no ??= batch_receipt_no;
    out.set(key, b);
  }
  return [...out.values()]
    .map(({ c, ...b }) => ({ ...b, amount: c / 100 }))
    .sort((a, b) => a.transfer_date.localeCompare(b.transfer_date) || a.key.localeCompare(b.key));
}

/** ปีงบ พ.ศ. ของวันที่ ISO "2026-10-02" -> 2570 */
const isoFy = (d: string) => +d.slice(0, 4) + 543 + (+d.slice(5, 7) >= 10 ? 1 : 0);

/**
 * บัญชีตอนลงรับ: แถว SMT ที่การเงินยังไม่แก้ และงบปี (mouGrpCode) ก่อนปีงบของวันที่ใบเสร็จ ย้ายไป PRIOR_YEAR_ACCOUNT
 * เพราะลงบัญชีตามวันที่ใบเสร็จ (เช่น โอน 30 ก.ย. ออกใบเสร็จ ต.ค. = เงินงบปีก่อนที่รับในปีงบใหม่) ; ไม่ย้ายกลับ
 */
export function receiptAccount(r: { smt_key: string | null; account_code: string; edited: boolean }, receiptDate: string): string {
  const by = keyBudgetYear(r.smt_key);
  return !r.edited && priorYearRule(r.smt_key?.split("|")[0]) && by !== null && by < isoFy(receiptDate) ? PRIOR_YEAR_ACCOUNT.code : r.account_code;
}

export const MAX_RECEIPT_NO = 30;
export type ReceiptFields = { receipt_no: string; receipt_date: string };

/** เลขที่ใบเสร็จ (ไม่ว่าง ≤ 30 ตัว) และวันที่ใบเสร็จ (from..today) ; ไม่ก่อนวันที่โอน/งวดปิด route ตรวจกับข้อมูลจริง */
export function parseReceiptFields(b: unknown, from: string, today: string): ReceiptFields | Err {
  const x = (b ?? {}) as Record<string, unknown>;
  const no = typeof x.receipt_no === "string" ? x.receipt_no.trim() : "";
  if (!no || no.length > MAX_RECEIPT_NO) return { error: `กรอกเลขที่ใบเสร็จ ไม่เกิน ${MAX_RECEIPT_NO} ตัวอักษร` };
  if (!validDate(x.receipt_date) || x.receipt_date < from || x.receipt_date > today) return { error: "วันที่ใบเสร็จต้องไม่ก่อนวันที่โอนและไม่เกินวันนี้" };
  return { receipt_no: no, receipt_date: x.receipt_date };
}

export type ReceiptAction =
  | ({ action: "receive"; target: { transfer_date: string; batch: string } | { id: string } } & ReceiptFields)
  | { action: "unreceive"; id: string; reason: string };

/** { action: "receive", (transfer_date + batch) หรือ id, receipt_no, receipt_date } หรือ { action: "unreceive", id, reason } */
export function parseReceiptAction(b: unknown, from: string, today: string): ReceiptAction | Err {
  const x = (b ?? {}) as Record<string, unknown>;
  const id = typeof x.id === "string" || typeof x.id === "number" ? String(x.id) : null;
  if (id !== null && !/^\d{1,18}$/.test(id)) return { error: "id ไม่ถูกต้อง" };
  if (x.action === "unreceive") {
    const reason = typeof x.reason === "string" ? x.reason.trim() : "";
    if (!id) return { error: "id ไม่ถูกต้อง" };
    if (!reason || reason.length > MAX_NOTE) return { error: `กรอกเหตุผลที่ยกเลิกการรับ ไม่เกิน ${MAX_NOTE} ตัวอักษร` };
    return { action: "unreceive", id, reason };
  }
  if (x.action !== "receive") return { error: "action ต้องเป็น receive หรือ unreceive" };
  const fields = parseReceiptFields(x, from, today);
  if ("error" in fields) return fields;
  if (id) return { action: "receive", target: { id }, ...fields };
  const batch = typeof x.batch === "string" ? x.batch.trim() : "";
  if (!validDate(x.transfer_date) || !batch || batch.length > 50) return { error: "ระบุชุดโอน (วันที่โอนและเลขชุด) หรือ id" };
  if (fields.receipt_date < x.transfer_date) return { error: "วันที่ใบเสร็จต้องไม่ก่อนวันที่โอน" };
  return { action: "receive", target: { transfer_date: x.transfer_date, batch }, ...fields };
}
export const SOURCE_LABEL: Record<"smt" | "manual", string> = { smt: "SMT", manual: "เพิ่มเอง" };
