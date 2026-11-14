// ตั้งลูกหนี้ตามผังบัญชีลง ar_ledger แบบ pure (ไม่มี import) จึงรันทดสอบด้วย node ได้ตรง (ledger.test.mjs)
// ยอดเก็บเป็นสตางค์ (จำนวนเต็ม) ระหว่างคำนวณ ไม่ให้ทศนิยม float เพี้ยนตอนเทียบส่วนต่าง

/** วันแรกที่ตั้งลูกหนี้ (1 ต.ค. 2568) */
export const LEDGER_START = "2025-10-01";
/** รหัสหน่วยบริการของโรงพยาบาล และจังหวัดที่ตั้ง (UCS OP ใน CUP / ในจังหวัด / ต่างจังหวัด) */
export const HOSPITAL_HCODE = "11252";
export const HOSPITAL_CHWPART = "65";
/** หน่วยบริการประจำนอกสังกัด สธ. ในจังหวัด (UCS OP ลง .201 นอกสังกัด สธ.): รพ.มหาวิทยาลัยนเรศวร, รพ.ค่ายสมเด็จพระนเรศวร, รพ.จิตเวชพิษณุโลก */
export const NON_MOPH_HCODES = new Set(["14972", "11517", "41429"]);
/** บัญชี UCS OP ตามหน่วยบริการประจำ */
export const UC_OP_ACCOUNTS = { cup: "1102050101.201", province: "1102050101.203", other: "1102050101.204", nonMoph: "1102050102.201" } as const;
/** ชุดละไม่เกิน 31 วัน (เท่ากับช่วงสูงสุดของ query his) */
export const MAX_BATCH_DAYS = 31;
export const DAILY_OPD_DAYS = 14;
export const DAILY_IPD_DAYS = 120;

export type PatientType = "OP" | "IP";
export type Source = "rcpt_debt" | "ipt";
export type Kind = "set" | "adjust" | "cancel" | "reverse";

export type AccountMap = { hipdata_code: string | null; pttype: string | null; patient_type: PatientType; account_code: string };
export type AccountRules = { maps: AccountMap[]; cup: Set<string> };

/** ข้อมูลสิทธิของแถวที่ใช้หาบัญชี (เก็บลงทุกแถวของ ledger เพื่อคำนวณบัญชีใหม่ได้) */
export type Coverage = {
  patient_type: PatientType;
  pttype: string | null;
  hipdata_code: string | null;
  hospmain: string | null;
  hospmain_chwpart: string | null;
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

/** ยอดคงเหลือของ ref ใน ledger + ข้อมูลจากแถว set (ทุกแถวถัดไปคัดลอกจากแถวนี้) */
export type RefState = Omit<Entry, "kind" | "entry_date" | "amount" | "note"> & { balance: number; cancelled: boolean };

/** ผลจาก query A (rcpt_debt) */
export type HisDebt = {
  debt_id: string | number;
  vn: string;
  debt_date: string;
  pttype: string | null;
  hipdata_code: string | null;
  amount: string | number | null;
  hospmain: string | null;
  hospmain_chwpart: string | null;
};
/** ผลจาก query B (rcpt_debt_cancel) */
export type HisCancel = { debt_id: string | number; cancel_datetime: string };
/** ผลจาก query C (ipt ที่ finance_lock = 'Y') */
export type HisIpd = { an: string; dchdate: string; pttype: string | null; hipdata_code: string | null; uc_money: string | number | null };

export const toCents = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
export const fromCents = (c: number) => (c / 100).toFixed(2);
const blank = (v: string | null | undefined) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const day = (v: string) => String(v).slice(0, 10);

/**
 * บัญชีของสิทธิ: override ราย pttype > UCS OP ตามหน่วยบริการประจำ > ตามกองทุน > null (ไม่ระบุบัญชี ห้ามเดา)
 * UCS OP: hospmain = รพ. หรืออยู่ใน CUP = .201, นอกสังกัด สธ. = 1102050102.201, จังหวัดเดียวกัน = .203, จังหวัดอื่น = .204, ไม่มี hospmain/จังหวัด = null
 */
export function accountFor(c: Coverage, rules: AccountRules): string | null {
  const byPttype = c.pttype && rules.maps.find((m) => m.pttype === c.pttype && m.patient_type === c.patient_type);
  if (byPttype) return byPttype.account_code;
  if (c.hipdata_code === "UCS" && c.patient_type === "OP") {
    if (!c.hospmain) return null;
    if (c.hospmain === HOSPITAL_HCODE || rules.cup.has(c.hospmain)) return UC_OP_ACCOUNTS.cup;
    if (NON_MOPH_HCODES.has(c.hospmain)) return UC_OP_ACCOUNTS.nonMoph;
    if (!c.hospmain_chwpart) return null;
    return c.hospmain_chwpart === HOSPITAL_CHWPART ? UC_OP_ACCOUNTS.province : UC_OP_ACCOUNTS.other;
  }
  return rules.maps.find((m) => m.hipdata_code === c.hipdata_code && m.pttype == null && m.patient_type === c.patient_type)?.account_code ?? null;
}

const follow = (s: RefState, kind: Kind, entry_date: string, cents: number, note: string): Entry => ({
  source: s.source, ref: s.ref, vn: s.vn, an: s.an, ref_date: s.ref_date, patient_type: s.patient_type, pttype: s.pttype,
  hipdata_code: s.hipdata_code, hospmain: s.hospmain, hospmain_chwpart: s.hospmain_chwpart, account_code: s.account_code,
  kind, entry_date, amount: fromCents(cents), note,
});
const changed = (from: number, to: number) => `ยอดใน HOSxP เปลี่ยน ${fromCents(from)} → ${fromCents(to)}`;

/**
 * OPD (rcpt_debt) หนึ่ง debt_id = หนึ่ง ref: ยังไม่มี = ตั้งตาม debt_date, มีแล้วยอดต่าง = ปรับปรุงส่วนต่างลงวันที่ sync (today)
 * ยกเลิกแล้วไม่ปรับอีก ยอด 0 ที่ยังไม่เคยตั้งไม่ต้องตั้ง
 */
export function planOpd(debts: HisDebt[], states: Map<string, RefState>, rules: AccountRules, today: string): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  for (const d of debts) {
    const ref = String(d.debt_id);
    if (seen.has(ref)) continue;
    seen.add(ref);
    const target = toCents(d.amount);
    const s = states.get(ref);
    if (!s) {
      if (target === 0) continue;
      const cov: Coverage = {
        patient_type: "OP", pttype: blank(d.pttype), hipdata_code: blank(d.hipdata_code),
        hospmain: blank(d.hospmain), hospmain_chwpart: blank(d.hospmain_chwpart),
      };
      out.push({
        ...cov, source: "rcpt_debt", kind: "set", ref, vn: d.vn, an: null, ref_date: day(d.debt_date), entry_date: day(d.debt_date),
        account_code: accountFor(cov, rules), amount: fromCents(target), note: null,
      });
    } else if (!s.cancelled && target !== s.balance) {
      out.push(follow(s, "adjust", today, target - s.balance, changed(s.balance, target)));
    }
  }
  return out;
}

/** ยกเลิกหนี้: ลดเท่ายอดที่ ledger ตั้งไว้ ลงวันที่ cancel_datetime ไม่เคยตั้ง (ก่อน 1 ต.ค. 2568) = ข้าม debt_id ซ้ำนับครั้งแรก */
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
    s.cancelled = true; // กันชุดเดียวกันยกเลิกซ้ำ
    if (s.balance !== 0) entries.push(follow(s, "cancel", day(c.cancel_datetime), -s.balance, "ยกเลิกหนี้ใน HOSxP"));
  }
  return { entries, skipped };
}

/**
 * IPD ที่ปิดสิทธิแล้ว (finance_lock = 'Y') ในช่วง from..to ของ dchdate
 * - ยังไม่มี: ตั้งเมื่อ uc_money > 0 วันที่ = dchdate (backfill) หรือวันที่ sync (รายวัน = วันที่เจอครั้งแรก)
 * - มีแล้วยอดต่าง (รวมปิดสิทธิอีกครั้งหลังกลับรายการ): ปรับปรุงส่วนต่างลงวันที่ sync
 * - เคยตั้งแต่ไม่อยู่ในผลแล้ว (finance_lock กลับเป็น N) และ dchdate อยู่ในช่วงที่ดึง: กลับรายการเต็มยอดคงเหลือ
 */
export function planIpd(
  rows: HisIpd[], states: Map<string, RefState>, rules: AccountRules,
  window: { from: string; to: string }, mode: "daily" | "backfill", today: string,
): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.an)) continue;
    seen.add(r.an);
    const target = toCents(r.uc_money);
    const s = states.get(r.an);
    if (!s) {
      if (target <= 0) continue;
      const cov: Coverage = { patient_type: "IP", pttype: blank(r.pttype), hipdata_code: blank(r.hipdata_code), hospmain: null, hospmain_chwpart: null };
      out.push({
        ...cov, source: "ipt", kind: "set", ref: r.an, vn: null, an: r.an, ref_date: day(r.dchdate),
        entry_date: mode === "backfill" ? day(r.dchdate) : today, account_code: accountFor(cov, rules), amount: fromCents(target), note: null,
      });
    } else if (target !== s.balance) {
      out.push(follow(s, "adjust", today, target - s.balance, s.balance === 0 ? "ปิดสิทธิอีกครั้ง" : changed(s.balance, target)));
    }
  }
  for (const [an, s] of states) {
    if (seen.has(an) || s.balance === 0 || !s.ref_date || s.ref_date < window.from || s.ref_date > window.to) continue;
    out.push(follow(s, "reverse", today, -s.balance, "ยกเลิกปิดสิทธิ (finance_lock ไม่ใช่ Y)"));
  }
  return out;
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

/** ประเภทแถวทั้งหมดใน ar_ledger: Kind ของ ar-sync + settle/diff ของการตัดหนี้ด้วย STM */
export type LedgerKind = Kind | "settle" | "diff";
export const KIND_LABEL: Record<LedgerKind, string> = { set: "ตั้งหนี้", adjust: "ปรับปรุง", cancel: "ยกเลิก", reverse: "กลับรายการ", settle: "รับชำระ", diff: "ส่วนต่าง" };

/** เดือนที่เลือกได้ ตั้งแต่ ต.ค. 2568 ถึงเดือนของ today (ใหม่ไปเก่า) */
export function ledgerMonths(today: string): string[] {
  const out: string[] = [];
  for (let m = LEDGER_START.slice(0, 7); m <= today.slice(0, 7); m = nextMonth(m)) out.unshift(m);
  return out;
}
