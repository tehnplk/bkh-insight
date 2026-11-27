// ตั้งลูกหนี้ตามผังบัญชีลง ar_ledger แบบ pure (ไม่มี import) จึงรันทดสอบด้วย node ได้ตรง (ledger.test.mjs)
// ยอดเก็บเป็นสตางค์ (จำนวนเต็ม) ระหว่างคำนวณ ไม่ให้ทศนิยม float เพี้ยนตอนเทียบส่วนต่าง

/** วันแรกที่ตั้งลูกหนี้ (1 ต.ค. 2568) */
export const LEDGER_START = "2025-10-01";
/** รหัสหน่วยบริการของโรงพยาบาล และจังหวัดที่ตั้ง (แยกบัญชีตามที่ตั้งหน่วยบริการประจำ) */
export const HOSPITAL_HCODE = "11252";
export const HOSPITAL_CHWPART = "65";
/** hospcode.hospital_type_id ของหน่วยบริการสังกัด สธ. (5 รพศ., 7 รพช.) ที่เหลือ เช่น 11 จิตเวช, 12 มหาวิทยาลัย/ค่ายทหาร = นอกสังกัด */
const MOPH_TYPES = new Set(["5", "7"]);
/** ชุดละไม่เกิน 31 วัน (เท่ากับช่วงสูงสุดของ query his) */
export const MAX_BATCH_DAYS = 31;
export const DAILY_OPD_DAYS = 14;
export const DAILY_IPD_DAYS = 120;

export type PatientType = "OP" | "IP";
export type Source = "rcpt_debt" | "ipt";
/** diff ของ source HOSxP = ส่วนต่างตามเพดาน/สัดส่วนของกติกาบัญชี (ค่ารักษาเต็มลงรายได้ ส่วนเกินลูกหนี้ลง diff_under_code) */
export type Kind = "set" | "adjust" | "cancel" | "reverse" | "diff";

/** ที่ตั้งหน่วยบริการประจำเทียบกับหน่วยบริการหลักของกลุ่มสิทธิ ; any = กติกาที่ใช้เมื่อไม่มีกติกาของที่ตั้งนั้น */
export const LOCS = ["any", "main", "province_moph", "province_other", "outside", "unknown"] as const;
export type Loc = (typeof LOCS)[number];
export const LOC_LABEL: Record<Loc, string> = {
  any: "ทุกที่", main: "หน่วยบริการหลัก/ใน CUP", province_moph: "ในจังหวัด สังกัด สธ.", province_other: "ในจังหวัด นอกสังกัด สธ.",
  outside: "ต่างจังหวัด", unknown: "ไม่พบหน่วยบริการประจำ",
};
/** กลุ่มสิทธิ (ar_right) main_hcode = หน่วยบริการหลัก (null = ไม่แยกตามที่ตั้ง) books_ar = false คือไม่ตั้งลูกหนี้ */
export type Right = { code: string; name: string; main_hcode: string | null; books_ar: boolean };
/** บัญชีของกลุ่มสิทธิ × OP/IP × ที่ตั้ง (ar_account_rule) cap = เพดานลูกหนี้ (บาท), debt_pct = ลูกหนี้เป็น % ของค่ารักษา */
export type AccountRule = {
  right_code: string; patient_type: PatientType; loc: Loc; account_code: string; cap: string | number | null; debt_pct: string | number | null;
};
export type AccountRules = { rights: Right[]; pttypes: Map<string, string>; rules: AccountRule[]; cup: Set<string> };
export type Resolved = { account_code: string | null; rule: AccountRule | null; books: boolean };

/** ข้อมูลสิทธิของแถวที่ใช้หาบัญชี (เก็บลงทุกแถวของ ledger เพื่อคำนวณบัญชีใหม่ได้) */
export type Coverage = {
  patient_type: PatientType;
  pttype: string | null;
  hipdata_code: string | null;
  hospmain: string | null;
  hospmain_chwpart: string | null;
  /** hospcode.hospital_type_id ของหน่วยบริการประจำ */
  hospmain_type: string | null;
};

/** แถวที่จะ INSERT ลง ar_ledger (amount เป็นบาท string 2 ตำแหน่ง) */
export type Entry = Coverage & {
  source: Source;
  kind: Kind;
  ref: string;
  vn: string | null;
  an: string | null;
  ref_date: string | null;
  entry_date: string;
  account_code: string | null;
  amount: string;
  note: string | null;
};

/**
 * หนี้ใน ledger + ข้อมูลจากแถว set (ทุกแถวถัดไปคัดลอกจากแถวนี้) ยอดเป็นสตางค์ของ source เดียวกัน:
 * balance = ค่ารักษาเต็ม (ไม่นับ diff), diff = ส่วนต่างตามเพดาน/สัดส่วน, settled = มีแถวตัดหนี้จาก source อื่น (STM/fwf/รับเงิน)
 */
export type RefState = Omit<Entry, "kind" | "entry_date" | "amount" | "note"> & {
  balance: number; diff: number; cancelled: boolean; settled: boolean;
  /** มีแถวจาก source อื่น (ตัดหนี้ หรือปรับปรุงด้วยมือ manual adjust) ; กลับรายการ visit ที่ admit ไม่แตะหนี้เหล่านี้ */
  touched?: boolean;
};

/** ผลจาก query A (rcpt_debt) */
export type HisDebt = {
  debt_id: string | number;
  vn: string;
  debt_date: string;
  /** ovst.vstdate (null เมื่อไม่มีแถว ovst ซึ่งพบน้อย ใช้ debt_date แทน) */
  vstdate: string | null;
  pttype: string | null;
  hipdata_code: string | null;
  amount: string | number | null;
  hospmain: string | null;
  hospmain_chwpart: string | null;
  hospmain_type: string | number | null;
  /** ovst.an: visit ที่ admit แล้ว ไม่ตั้งหนี้ OPD (ADMIT_NOTE) */
  an?: string | null;
};
/** ผลจาก query B (rcpt_debt_cancel) */
export type HisCancel = { debt_id: string | number; cancel_datetime: string };
/** ผลจาก query C (ipt ที่ finance_lock = 'Y') pttype = an_stat.pttype */
export type HisIpd = {
  an: string; dchdate: string; pttype: string | null; hipdata_code: string | null; uc_money: string | number | null;
  hospmain: string | null; hospmain_chwpart: string | null; hospmain_type: string | number | null;
};

/**
 * UC OP ใน CUP (.201) แบบโปรแกรม Claim: ยอด HC + INST ของ visit (กองทุนย่อยที่ account_op = .216) แยกเป็นหนี้ ref "<debt_id>:CR" บัญชี .216
 * source/vn/ref_date เดียวกับหนี้หลัก แล้วลด .201 เท่ากัน ยอดรวมต่อ visit จึงเท่ายอด HOSxP ; CR ตัดด้วย STM ส่วน .201 ตัดด้วยเหมาจ่าย
 */
export const CR_SPLIT = { from: "1102050101.201", to: "1102050101.216" } as const;
/**
 * UC IP (.202): ค่าพาหนะส่งต่อ (กองทุนย่อยใน codes = รายการรหัสเบิก S18xx) แยกเป็นหนี้ ref "<an>:CR" บัญชี .217 แบบเดียวกับ OP
 * ผู้ใช้เลือก 27 พ.ย. 2569 ตามที่ สปสช. จ่ายจริง (STM AE) ; INST มี account_ip .217 แต่ไม่แยก (เลนส์/อุปกรณ์และรถพยาบาลระดับสูงคงอยู่ .202)
 */
export const IP_CR_SPLIT = { from: "1102050101.202", to: "1102050101.217", codes: ["CARREF"] } as const;
export const crRef = (ref: string) => `${ref}:CR`;
export const isCrRef = (ref: string) => ref.endsWith(":CR");
const CR_NOTE = "แยก HC/INST ไปบัญชี CR";
const IP_CR_NOTE = "แยกค่าพาหนะส่งต่อไปบัญชี CR";
const crSplitOf = (pt: PatientType) => (pt === "OP" ? CR_SPLIT : IP_CR_SPLIT);
const crNote = (pt: PatientType) => (pt === "OP" ? CR_NOTE : IP_CR_NOTE);

/**
 * แบ่งยอด CR (สตางค์ต่อ vn) ให้หนี้ของ vn เรียงตาม debt_id ไม่เกินยอดของแต่ละหนี้ (cap) -> สตางค์ต่อ ref ; หนี้ที่ไม่ได้ = ไม่มีใน map
 * planOpd และ planRecompute ใช้ลำดับเดียวกัน หนี้หลายใบของ vn เดียวจึงไม่สลับยอดกันไปมา
 */
export function allocateCr(debts: { ref: string; vn: string | null; cap: number }[], cr: Map<string, number>): Map<string, number> {
  const left = new Map(cr);
  const out = new Map<string, number>();
  for (const d of [...debts].sort((a, b) => Number(a.ref) - Number(b.ref) || a.ref.localeCompare(b.ref))) {
    const vn = d.vn ?? "";
    const n = Math.min(left.get(vn) ?? 0, d.cap);
    if (n <= 0) continue;
    left.set(vn, (left.get(vn) ?? 0) - n);
    out.set(d.ref, n);
  }
  return out;
}

export const toCents = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
export const fromCents = (c: number) => (c / 100).toFixed(2);
const blank = (v: string | number | null | undefined) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const day = (v: string) => String(v).slice(0, 10);

/** ที่ตั้งหน่วยบริการประจำ: ตรง main_hcode (หรืออยู่ใน CUP เมื่อหน่วยหลักคือโรงพยาบาล) = main ; ไม่มี hospmain/ไม่พบใน hospcode = unknown */
export function locationOf(c: Coverage, main: string | null, cup: Set<string>): Loc {
  if (!main) return "any";
  if (!c.hospmain) return "unknown";
  if (c.hospmain === main || (main === HOSPITAL_HCODE && cup.has(c.hospmain))) return "main";
  if (!c.hospmain_chwpart) return "unknown";
  if (c.hospmain_chwpart !== HOSPITAL_CHWPART) return "outside";
  return MOPH_TYPES.has(String(c.hospmain_type)) ? "province_moph" : "province_other";
}

/** บัญชีของหนี้: pttype -> กลุ่มสิทธิ -> กติกาของ (OP/IP, ที่ตั้ง) แล้ว (OP/IP, any) ; ไม่มีกลุ่มสิทธิหรือกติกา = null (ไม่ระบุบัญชี ห้ามเดา) */
export function resolve(c: Coverage, r: AccountRules): Resolved {
  const code = c.pttype ? r.pttypes.get(c.pttype) : undefined;
  const right = code ? r.rights.find((x) => x.code === code) : undefined;
  if (!right) return { account_code: null, rule: null, books: true };
  if (!right.books_ar) return { account_code: null, rule: null, books: false };
  const loc = locationOf(c, right.main_hcode, r.cup);
  const of = (l: Loc) => r.rules.find((x) => x.right_code === right.code && x.patient_type === c.patient_type && x.loc === l);
  const rule = of(loc) ?? of("any") ?? null;
  return { account_code: rule?.account_code ?? null, rule, books: true };
}

/** ส่วนต่าง (สตางค์ ≤ 0) ที่ทำให้ลูกหนี้เหลือตามเพดานหรือสัดส่วนของกติกา จากค่ารักษาเต็ม full */
export function capDiff(full: number, rule: AccountRule | null): number {
  if (rule?.cap != null) return Math.min(full, toCents(rule.cap)) - full;
  if (rule?.debt_pct != null) return Math.round((full * Number(rule.debt_pct)) / 100) - full;
  return 0;
}
const capNote = (rule: AccountRule | null) =>
  rule?.cap != null ? `ลูกหนี้ไม่เกิน ${Number(rule.cap)} บาท`
  : rule?.debt_pct != null ? `ลูกหนี้ ${Number(rule.debt_pct)}% ของค่ารักษา`
  : "ยกเลิกส่วนต่างตามเพดาน/สัดส่วน";
const NO_AR = "สิทธินี้ไม่ตั้งลูกหนี้";
/**
 * visit ที่ admit แล้ว (ovst.an) ไม่ตั้งหนี้ OPD ทุกบัญชี รวมรายที่ยังค้างรายการฝั่ง OPD เพราะโปรแกรม Claim/GL ตั้งหนี้ที่ผู้ป่วยในตอนจำหน่าย
 * หนี้ที่ตั้งไปแล้วกลับรายการลงวันตั้งหนี้ ยกเว้นที่มีแถวจาก source อื่น (touched: ตัดแล้ว/ปรับปรุงด้วยมือ) ไม่แตะ
 */
export const ADMIT_NOTE = "admit แล้ว ตั้งหนี้ที่ผู้ป่วยใน";

type RefInfo = Omit<RefState, "balance" | "diff" | "cancelled" | "settled">;
const follow = (s: RefInfo, kind: Kind, entry_date: string, cents: number, note: string | null): Entry => ({
  source: s.source, ref: s.ref, vn: s.vn, an: s.an, ref_date: s.ref_date, patient_type: s.patient_type, pttype: s.pttype,
  hipdata_code: s.hipdata_code, hospmain: s.hospmain, hospmain_chwpart: s.hospmain_chwpart, hospmain_type: s.hospmain_type,
  account_code: s.account_code, kind, entry_date, amount: fromCents(cents), note,
});
const changed = (from: number, to: number) => `ยอดใน HOSxP เปลี่ยน ${fromCents(from)} → ${fromCents(to)}`;
/** แถว set ของหนี้ CR ที่คัดลอกข้อมูลจากหนี้หลัก */
const crSet = (s: RefInfo, date: string, cents: number): Entry =>
  follow({ ...s, ref: crRef(s.ref), account_code: crSplitOf(s.patient_type).to }, "set", date, cents, crNote(s.patient_type));
/** วันตั้งหนี้ OPD = วันรับบริการ ไม่ก่อน LEDGER_START */
const setDateOf = (svc: string) => (svc < LEDGER_START ? LEDGER_START : svc);

/** ตั้งหนี้ใหม่ + ส่วนต่างตามเพดาน/สัดส่วนวันเดียวกัน ; สิทธิที่ไม่ตั้งลูกหนี้ = ไม่มีแถว */
function setEntries(e: Omit<RefInfo, "account_code"> & { entry_date: string }, cents: number, rules: AccountRules): Entry[] {
  const res = resolve(e, rules);
  if (!res.books) return [];
  const s = { ...e, account_code: res.account_code };
  const d = capDiff(cents, res.rule);
  const set = follow(s, "set", e.entry_date, cents, null);
  return d ? [set, follow(s, "diff", e.entry_date, d, capNote(res.rule))] : [set];
}

/** หนี้ที่ตั้งแล้ว ยอด HOSxP = target: ปรับปรุงค่ารักษาเต็มให้เท่า target แล้วปรับ diff ตามกติกา ; หนี้ที่ตัดแล้ว (settled) ไม่แตะ diff */
function followEntries(s: RefState, target: number, rules: AccountRules, today: string, note: string): Entry[] {
  const res = resolve(s, rules);
  const full = res.books ? target : 0;
  const out: Entry[] = [];
  if (full !== s.balance) out.push(follow(s, "adjust", today, full - s.balance, res.books ? note : NO_AR));
  const want = s.settled ? s.diff : capDiff(full, res.rule);
  if (want !== s.diff) out.push(follow(s, "diff", today, want - s.diff, capNote(want ? res.rule : null)));
  return out;
}

/** ยกเลิก/กลับรายการทั้งหนี้: ค่ารักษาเต็ม และ diff ตามเพดาน/สัดส่วน */
function closeEntries(s: RefState, kind: "cancel" | "reverse", date: string, note: string): Entry[] {
  const out: Entry[] = [];
  if (s.balance !== 0) out.push(follow(s, kind, date, -s.balance, note));
  if (s.diff !== 0) out.push(follow(s, "diff", date, -s.diff, capNote(null)));
  return out;
}

/** ตั้งหนี้ใหม่ยอด target โดยแยก split ไปหนี้ CR ; ar_ledger ห้ามยอด 0: CR เต็มยอดหนี้ = ตั้งเต็มแล้วปรับลดวันเดียวกัน (หนี้หลักต้องมีแถว set ไว้ให้ sync ถัดไปหาเจอ) */
function setWithCr(info: Omit<RefInfo, "account_code"> & { entry_date: string }, target: number, split: number, rules: AccountRules): Entry[] {
  const main = target - split;
  const out = setEntries(info, main || target, rules);
  if (split) {
    const s0 = { ...info, account_code: crSplitOf(info.patient_type).from };
    if (!main) out.push(follow(s0, "adjust", info.entry_date, -target, crNote(info.patient_type)));
    out.push(crSet(s0, info.entry_date, split));
  }
  return out;
}

/**
 * หนี้ที่ตั้งแล้ว (s หลัก, cs CR) ยอด HOSxP = target: ให้ CR = split แล้วปรับหนี้หลักให้รวมเท่า target
 * ยังไม่เคยแยก = แยกลงวันตั้งหนี้ (setDate) ; ตัดแล้ว (หลักหรือ CR) ไม่ย้ายยอดระหว่างสอง ref อีก ยอดที่เปลี่ยนลงหนี้หลัก ; note(ยอดเดิมรวม) = หมายเหตุของแถวปรับหนี้หลัก
 */
function followWithCr(
  s: RefState, cs: RefState | undefined, target: number, split: number, rules: AccountRules, today: string, setDate: string, note: (total: number) => string,
): Entry[] {
  const out: Entry[] = [];
  const have = cs?.balance ?? 0;
  const c = cs && (s.settled || cs.settled) ? have : split;
  let main = s;
  if (!cs && c) {
    out.push(follow(s, "adjust", setDate, -c, crNote(s.patient_type)), crSet(s, setDate, c));
    main = { ...s, balance: s.balance - c };
  } else if (cs && c !== have) out.push(follow(cs, "adjust", today, c - have, crNote(s.patient_type)));
  out.push(...followEntries(main, target - c, rules, today, note(s.balance + have)));
  return out;
}

/** ข้อมูลสิทธิของหนี้ OPD จาก HOSxP */
export const opdCoverage = (d: HisDebt): Coverage => ({
  patient_type: "OP", pttype: blank(d.pttype), hipdata_code: blank(d.hipdata_code), hospmain: blank(d.hospmain),
  hospmain_chwpart: blank(d.hospmain_chwpart), hospmain_type: blank(d.hospmain_type),
});

/**
 * OPD (rcpt_debt) หนึ่ง debt_id = หนึ่ง ref: ยังไม่มี = ตั้งลงวันรับบริการ (vstdate, ไม่มีใช้ debt_date) ทั้ง ref_date และ entry_date
 * แต่ entry_date ไม่ก่อน LEDGER_START (สมุดไม่มียอดยกมาก่อนวันนั้น ref_date คงวันรับบริการจริง) ; แถวถัดไปคัดลอก ref_date จากแถว set
 * มีแล้วยอดต่าง = ปรับปรุงส่วนต่างลงวันที่ sync (today) ยกเลิกแล้วไม่ปรับอีก ยอด 0 ที่ยังไม่เคยตั้งไม่ต้องตั้ง
 * ค่ารักษาเต็มลงแถว set/adjust ส่วนที่เกินเพดาน/สัดส่วนของกติกาลงแถว diff (source เดียวกัน)
 * cr = ยอด HC + INST (สตางค์) ต่อ vn: หนี้ที่ลง .201 แยกส่วนนี้เป็น ref "<debt_id>:CR" (states ต้องโหลดทั้งสอง ref) ยอด HOSxP = หลัก + CR
 *   แยกครั้งแรกของหนี้ที่ตั้งแล้วลงวันตั้งหนี้ (เดือนจึงแยกเหมือน Claim) ; หนี้ที่ตัดแล้วและยังไม่เคยแยกไม่แยก ; ไม่ใช่ .201 แล้ว = CR กลับเป็น 0
 * d.an (admit แล้ว) = ไม่ตั้ง ที่ตั้งแล้วกลับรายการทั้งหนี้หลักและ CR ตาม ADMIT_NOTE ; counts.opd_admit_skipped = หนี้ที่ข้ามเพราะ touched
 */
export function planOpd(
  debts: HisDebt[], states: Map<string, RefState>, rules: AccountRules, today: string, cr: Map<string, number> = new Map(),
  counts?: Record<string, number>,
): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  const uniq = debts.filter((d) => !seen.has(String(d.debt_id)) && !!seen.add(String(d.debt_id)));
  for (const d of uniq.filter((x) => x.an)) {
    const ref = String(d.debt_id);
    for (const x of [states.get(ref), states.get(crRef(ref))]) {
      if (!x || x.cancelled) continue;
      if (!x.touched) out.push(...closeEntries(x, "reverse", setDateOf(x.ref_date ?? today), ADMIT_NOTE));
      else if (counts) counts.opd_admit_skipped = (counts.opd_admit_skipped ?? 0) + 1;
    }
  }
  const share = allocateCr(
    uniq.filter((d) => !d.an).flatMap((d) => {
      const ref = String(d.debt_id);
      const s = states.get(ref);
      const ok = s
        ? !s.cancelled && (!s.settled || states.has(crRef(ref))) && resolve(s, rules).account_code === CR_SPLIT.from
        : resolve(opdCoverage(d), rules).account_code === CR_SPLIT.from;
      return ok ? [{ ref, vn: d.vn, cap: toCents(d.amount) }] : [];
    }),
    cr,
  );
  for (const d of uniq) {
    if (d.an) continue;
    const ref = String(d.debt_id);
    const target = toCents(d.amount);
    const split = share.get(ref) ?? 0;
    const s = states.get(ref);
    if (!s) {
      if (target === 0) continue;
      const svc = day(d.vstdate ?? d.debt_date);
      // .201 ไม่มีเพดาน diff การแยก CR จึงไม่เปลี่ยน diff
      out.push(...setWithCr({ ...opdCoverage(d), source: "rcpt_debt", ref, vn: d.vn, an: null, ref_date: svc, entry_date: setDateOf(svc) }, target, split, rules));
    } else if (!s.cancelled) {
      out.push(...followWithCr(s, states.get(crRef(ref)), target, split, rules, today, setDateOf(s.ref_date ?? today),
        (total) => (total !== target ? changed(total, target) : CR_NOTE)));
    }
  }
  return out;
}

/** ยกเลิกหนี้ (และหนี้ CR ของ debt_id): ลดเท่ายอดที่ ledger ตั้งไว้ (และ diff) ลงวันที่ cancel_datetime (ref_date ตามแถว set) ไม่เคยตั้ง (ก่อน 1 ต.ค. 2568) = ข้าม debt_id ซ้ำนับครั้งแรก */
export function planCancels(cancels: HisCancel[], states: Map<string, RefState>): { entries: Entry[]; skipped: number } {
  const entries: Entry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const c of cancels) {
    const ref = String(c.debt_id);
    if (seen.has(ref)) continue;
    seen.add(ref);
    const s = states.get(ref);
    if (!s || s.cancelled) {
      if (!s) skipped++;
      continue;
    }
    for (const x of [s, states.get(crRef(ref))]) {
      if (!x || x.cancelled) continue;
      x.cancelled = true; // กันชุดเดียวกันยกเลิกซ้ำ
      entries.push(...closeEntries(x, "cancel", day(c.cancel_datetime), "ยกเลิกหนี้ใน HOSxP"));
    }
  }
  return { entries, skipped };
}

/**
 * IPD ที่ปิดสิทธิแล้ว (finance_lock = 'Y') ในช่วง from..to ของ dchdate
 * - ยังไม่มี: ตั้งเมื่อ uc_money > 0 ลงวันจำหน่าย (dchdate) ทุกโหมด ให้หนี้อยู่ในเดือนที่เกิด ไม่ใช่เดือนที่ปิดสิทธิ
 * - มีแล้วยอดต่าง (รวมปิดสิทธิอีกครั้งหลังกลับรายการ): ปรับปรุงส่วนต่างลงวันที่ sync
 * - เคยตั้งแต่ไม่อยู่ในผลแล้ว (finance_lock กลับเป็น N) และ dchdate อยู่ในช่วงที่ดึง: กลับรายการเต็มยอดคงเหลือ (และ diff) ทั้งหนี้หลักและ CR
 * cr = ค่าพาหนะส่งต่อ (สตางค์) ต่อ AN: หนี้ที่ลง .202 แยกส่วนนี้ (ไม่เกินยอด) เป็น ref "<an>:CR" บัญชี .217 (states ต้องโหลดทั้งสอง ref) ยอด HOSxP = หลัก + CR
 *   แยกครั้งแรกของหนี้ที่ตั้งแล้วลงวันจำหน่าย ; หนี้ที่มีแถวจาก source อื่นแล้ว (touched: ตัด/ปรับด้วยมือ) และยังไม่เคยแยกไม่แยก ; ไม่ใช่ .202 แล้ว = CR กลับเป็น 0
 */
export function planIpd(
  rows: HisIpd[], states: Map<string, RefState>, rules: AccountRules,
  window: { from: string; to: string }, today: string, cr: Map<string, number> = new Map(),
): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.an)) continue;
    seen.add(r.an);
    const target = toCents(r.uc_money);
    const s = states.get(r.an);
    const cs = states.get(crRef(r.an));
    const splitOf = (c: Coverage, ok: boolean) => (ok && resolve(c, rules).account_code === IP_CR_SPLIT.from ? Math.min(cr.get(r.an) ?? 0, Math.max(target, 0)) : 0);
    if (!s) {
      if (target <= 0) continue;
      const info = {
        patient_type: "IP" as const, pttype: blank(r.pttype), hipdata_code: blank(r.hipdata_code), hospmain: blank(r.hospmain),
        hospmain_chwpart: blank(r.hospmain_chwpart), hospmain_type: blank(r.hospmain_type),
        source: "ipt" as const, ref: r.an, vn: null, an: r.an, ref_date: day(r.dchdate), entry_date: day(r.dchdate),
      };
      out.push(...setWithCr(info, target, splitOf(info, true), rules));
    } else {
      out.push(...followWithCr(s, cs, target, splitOf(s, !!cs || !s.touched), rules, today, s.ref_date ?? today,
        (total) => (total === 0 ? "ปิดสิทธิอีกครั้ง" : total !== target ? changed(total, target) : IP_CR_NOTE)));
    }
  }
  for (const [an, s] of states) {
    if (isCrRef(an) || seen.has(an) || !s.ref_date || s.ref_date < window.from || s.ref_date > window.to) continue;
    for (const x of [s, states.get(crRef(an))]) if (x) out.push(...closeEntries(x, "reverse", today, "ยกเลิกปิดสิทธิ (finance_lock ไม่ใช่ Y)"));
  }
  return out;
}

/** หนี้ใน ledger สำหรับคำนวณบัญชีใหม่: RefState + วันลงบัญชีของแถว set */
export type RecomputeState = RefState & { set_date: string };
/** ผลคำนวณบัญชีใหม่ต่อหนี้: บัญชีใหม่ + แถวที่ต้องลงเพิ่ม (diff ที่ขาด, แยก CR หรือกลับรายการสิทธิที่ไม่ตั้งลูกหนี้) ลงวันเดียวกับแถว set */
export type Recomputed = { state: RecomputeState; to: string | null; entries: Entry[]; noRule: boolean; settledSkip: boolean };

/**
 * คำนวณบัญชีของหนี้ที่มีอยู่ตามกติกาปัจจุบัน (ใช้กับทุกแถวของหนี้ รวม stm/manual/fwf) กดซ้ำได้: ครั้งถัดไปไม่มีอะไรเปลี่ยน
 * ไม่มีกติกา = คงบัญชีเดิม (noRule) ; หนี้ที่ตัดแล้วไม่ลง diff/ไม่แยก CR เพิ่ม (นับใน settledSkip) แค่ย้ายบัญชี
 * cr = ยอด HC + INST ต่อ vn (เหมือน planOpd): หนี้ .201 แยกเป็นหนี้ CR / ปรับ CR ให้เท่ายอดนี้ ; หนี้ CR คงบัญชี (.216/.217) ตามหนี้หลัก
 * ipCr = ค่าพาหนะส่งต่อต่อ AN (เหมือน planIpd): หนี้ .202 แยกเป็นหนี้ CR .217 ; touched และยังไม่เคยแยก = ไม่แยก (นับใน settledSkip)
 * admitted = vn ที่ admit แล้ว: กลับรายการหนี้ OPD (และ CR) ลงวันตั้งหนี้ตาม ADMIT_NOTE ; touched นับใน settledSkip
 */
export function planRecompute(
  states: RecomputeState[], rules: AccountRules, cr: Map<string, number> = new Map(), admitted: Set<string> = new Set(), ipCr: Map<string, number> = new Map(),
): Recomputed[] {
  const byRef = new Map(states.map((s) => [s.ref, s]));
  const crEntries = new Map<string, Entry[]>();
  const resOf = new Map(states.filter((s) => !isCrRef(s.ref)).map((s) => [s.ref, resolve(s, rules)]));
  const isAdmit = (s: RecomputeState) => s.patient_type === "OP" && admitted.has(s.vn ?? "");
  const share = allocateCr(
    states.flatMap((s) => {
      const cs = byRef.get(crRef(s.ref));
      const ok = s.patient_type === "OP" && !isAdmit(s) && !s.cancelled && (!s.settled || cs) && resOf.get(s.ref)?.account_code === CR_SPLIT.from;
      return ok ? [{ ref: s.ref, vn: s.vn, cap: s.balance + (cs?.balance ?? 0) }] : [];
    }),
    cr,
  );
  // IP หนึ่ง AN หนึ่งหนี้ ไม่ต้องแบ่ง
  for (const s of states) {
    const cs = byRef.get(crRef(s.ref));
    const n = s.patient_type === "IP" && !isCrRef(s.ref) && !s.cancelled && (cs || !s.touched) && resOf.get(s.ref)?.account_code === IP_CR_SPLIT.from
      ? Math.min(ipCr.get(s.ref) ?? 0, Math.max(s.balance + (cs?.balance ?? 0), 0)) : 0;
    if (n > 0) share.set(s.ref, n);
  }
  const pendingCr = (s: RecomputeState) => (s.patient_type === "OP" ? cr.get(s.vn ?? "") : ipCr.get(s.ref)) ?? 0;
  const blocked = (s: RecomputeState) => (s.patient_type === "OP" ? s.settled : !!s.touched);
  const plan = states.filter((s) => !isCrRef(s.ref)).map((s): Recomputed => {
    const res = resOf.get(s.ref)!;
    const noRule = res.books && !res.account_code;
    const to = res.account_code ?? s.account_code;
    const t = { ...s, account_code: to };
    const cs = byRef.get(crRef(s.ref));
    const entries: Entry[] = [];
    const crOut: Entry[] = [];
    let settledSkip = false;
    if (isAdmit(s)) {
      for (const [x, sink] of [[t, entries], [cs, crOut]] as const) {
        if (!x || x.cancelled) continue;
        if (x.touched) settledSkip = true;
        else sink.push(...closeEntries(x, "reverse", s.set_date, ADMIT_NOTE));
      }
    } else if (!res.books) {
      if (!s.settled) entries.push(...closeEntries(t, "reverse", s.set_date, NO_AR));
      if (cs && !cs.settled) crOut.push(...closeEntries(cs, "reverse", s.set_date, NO_AR));
    } else {
      const have = cs?.balance ?? 0;
      let c = s.cancelled ? have : (share.get(s.ref) ?? 0);
      if (c !== have && (s.settled || cs?.settled)) {
        settledSkip = true;
        c = have;
      }
      // ตัดแล้ว (IP: มีแถวจาก source อื่น) และยังไม่เคยแยก (ไม่อยู่ใน share) แต่มียอด CR
      if (blocked(s) && !cs && !s.cancelled && res.account_code === crSplitOf(s.patient_type).from && pendingCr(s) > 0) settledSkip = true;
      if (c !== have) {
        entries.push(follow(t, "adjust", s.set_date, have - c, crNote(s.patient_type)));
        crOut.push(cs ? follow(cs, "adjust", s.set_date, c - have, crNote(s.patient_type)) : crSet(t, s.set_date, c));
      }
      const want = capDiff(s.balance + have - c, res.rule);
      if (want !== s.diff) {
        if (s.settled) settledSkip = true;
        else entries.push(follow(t, "diff", s.set_date, want - s.diff, capNote(want ? res.rule : null)));
      }
    }
    if (cs) crEntries.set(cs.ref, crOut);
    else entries.push(...crOut);
    return { state: s, to, entries, noRule, settledSkip };
  });
  // หนี้ CR คงบัญชี (.216/.217) ; แถวที่ต้องลงคำนวณในรอบของหนี้หลักข้างบน
  const crs = states.filter((s) => isCrRef(s.ref)).map((s): Recomputed => ({ state: s, to: s.account_code, entries: crEntries.get(s.ref) ?? [], noRule: false, settledSkip: false }));
  return [...plan, ...crs];
}

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(utc(d) + n * DAY_MS);
const maxDate = (a: string, b: string) => (a > b ? a : b);

/** แบ่ง from..to (รวมทั้งสองวัน) เป็นชุดละไม่เกิน MAX_BATCH_DAYS วัน from > to = ไม่มีชุด */
export function chunkRange(from: string, to: string, days = MAX_BATCH_DAYS): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (let s = from; s <= to; s = addDays(s, days)) {
    const e = addDays(s, days - 1);
    out.push({ from: s, to: e < to ? e : to });
  }
  return out;
}

/** ช่วงของโหมดรายวัน ไม่ย้อนก่อน LEDGER_START ยกเลิกหนี้ = ตั้งแต่ sync รายวันที่สำเร็จล่าสุด −1 วัน (ไม่เคย = LEDGER_START) */
export function dailyWindows(today: string, lastDaily: string | null) {
  return {
    opd: { from: maxDate(addDays(today, 1 - DAILY_OPD_DAYS), LEDGER_START), to: today },
    cancel: { from: lastDaily ? maxDate(addDays(lastDaily, -1), LEDGER_START) : LEDGER_START, to: today },
    ipd: { from: maxDate(addDays(today, 1 - DAILY_IPD_DAYS), LEDGER_START), to: today },
  };
}

/** เดือน YYYY-MM ตั้งแต่ ต.ค. 2568 ถึงเดือนของ today -> ช่วงวันที่ของเดือน (วันสุดท้ายไม่เกินวันนี้) ผิด = null */
export function monthRange(month: string, today: string): { from: string; to: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < LEDGER_START.slice(0, 7) || month > today.slice(0, 7)) return null;
  const last = addDays(`${nextMonth(month)}-01`, -1);
  return { from: `${month}-01`, to: last < today ? last : today };
}

export const nextMonth = (month: string) => {
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** รายที่ดึงใหม่: OPD = VN (ทุก debt_id ของ visit), IPD = AN */
export type SyncCase = { vn: string } | { an: string };

/** body ของ POST /api/fund/ar-sync/case : { vn } (12 หลัก) หรือ { an } (9–12 หลัก) อย่างใดอย่างหนึ่ง */
export function parseCase(body: unknown): SyncCase | { error: string } {
  const b = (body ?? {}) as { vn?: unknown; an?: unknown };
  if ((b.vn == null) === (b.an == null)) return { error: "ต้องระบุ vn หรือ an อย่างใดอย่างหนึ่ง" };
  if (b.vn != null) return typeof b.vn === "string" && /^\d{12}$/.test(b.vn) ? { vn: b.vn } : { error: "VN ต้องเป็นตัวเลข 12 หลัก" };
  return typeof b.an === "string" && /^\d{9,12}$/.test(b.an) ? { an: b.an } : { error: "AN ต้องเป็นตัวเลข 9–12 หลัก" };
}

/** ประเภทแถวทั้งหมดใน ar_ledger: Kind ของ ar-sync + settle/diff ของการตัดหนี้ด้วย STM */
export type LedgerKind = Kind | "settle";
export const KIND_LABEL: Record<LedgerKind, string> = { set: "ตั้งหนี้", adjust: "ปรับปรุง", cancel: "ยกเลิก", reverse: "กลับรายการ", settle: "รับชำระ", diff: "ส่วนต่าง" };

/** เดือนที่เลือกได้ ตั้งแต่ ต.ค. 2568 ถึงเดือนของ today (ใหม่ไปเก่า) */
export function ledgerMonths(today: string): string[] {
  const out: string[] = [];
  for (let m = LEDGER_START.slice(0, 7); m <= today.slice(0, 7); m = nextMonth(m)) out.unshift(m);
  return out;
}
