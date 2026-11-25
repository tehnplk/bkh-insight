import "server-only";
import { hisQuery, insightQuery, insightTransaction, type InsightTx } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { inList, loadLookups } from "@/app/api/fund/_lib/fund";
import { loadSubfunds } from "@/app/api/fund/_lib/subfund";
import { byChunks, loadFundRules } from "@/app/api/admin/ar-funds/sql";
import {
  CR_SPLIT, LEDGER_START, addDays, chunkRange, crRef, dailyWindows, isCrRef, monthRange, planCancels, planIpd, planOpd, planRecompute, resolve, toCents,
  type AccountRule, type AccountRules, type Entry, type HisCancel, type HisDebt, type HisIpd, type RecomputeState, type Recomputed, type RefState,
  type Right, type Source, type SyncCase,
} from "./ledger";

// SQL ฝั่ง his ผ่าน prove-query แล้ว (A/B/C) ห้ามเปลี่ยน logic ถ้าไม่ได้ prove ใหม่
// A ตั้งหนี้ OPD: key = debt_id (1 vn มีหลาย debt_id ได้) แถว ABORT ถูกตั้ง amount = 0 จึงกรองออก ส่วนการลดยอดใช้ B
// where ของ A/B/C เป็นค่าคงที่ในโค้ดเท่านั้น (BY_RANGE รายวัน/backfill, BY_CASE ดึงใหม่รายราย) ห้ามรับจากผู้ใช้
const OPD_DEBT_SQL = (where: string) => `SELECT d.debt_id, d.vn, d.debt_date, d.debt_date_time, d.pttype,
       t.hipdata_code, t.pttype_eclaim_id,
       IFNULL(d.amount, 0) AS amount, d.status,
       COALESCE(NULLIF(vp.hospmain, ''), NULLIF(o.hospmain, '')) AS hospmain,
       hc.chwpart AS hospmain_chwpart,
       hc.hospital_type_id AS hospmain_type,
       o.vstdate
FROM rcpt_debt d
LEFT JOIN pttype t ON t.pttype = d.pttype
LEFT JOIN visit_pttype vp ON vp.vn = d.vn AND vp.pttype = d.pttype
LEFT JOIN ovst o ON o.vn = d.vn
LEFT JOIN hospcode hc ON hc.hospcode = COALESCE(NULLIF(vp.hospmain, ''), NULLIF(o.hospmain, ''))
WHERE ${where}
  AND LENGTH(d.vn) = 12
  AND (d.status IS NULL OR d.status <> 'ABORT')
ORDER BY d.debt_date, d.debt_id`;
// B ยกเลิกหนี้: cancel_amount เป็น NULL ทุกแถว จึงลดเท่ายอดที่ ledger ตั้งไว้ (ไม่มี index บน cancel_datetime ตารางเล็กรับได้)
const OPD_CANCEL_SQL = (where: string) => `SELECT c.debt_id, c.cancel_datetime, r.debt_date, r.pttype, c.amount AS cancel_amount
FROM rcpt_debt_cancel c
JOIN rcpt_debt r ON r.debt_id = c.debt_id
WHERE ${where}
  AND LENGTH(r.vn) = 12
ORDER BY c.cancel_datetime, c.debt_id`;
// C IPD ที่ปิดสิทธิแล้ว: ช่วงยาวกว่า 120 วันจะ full scan ipt (เราดึงชุดละ ≤31 วัน)
//   สิทธิ = an_stat.pttype (สิทธิที่คิดเงิน) ; hospmain จาก ipt_pttype ของสิทธินั้น (ไม่มีใช้แถวแรกของ AN)
const IPD_SQL = (where: string) => `SELECT i.an, i.dchdate,
       s.pttype AS pttype,
       ta.hipdata_code, ta.pttype_eclaim_id,
       s.uc_money, i.finance_lock,
       ip.hospmain, hc.chwpart AS hospmain_chwpart, hc.hospital_type_id AS hospmain_type
FROM ipt i
JOIN an_stat s ON s.an = i.an
LEFT JOIN pttype ta ON ta.pttype = s.pttype
LEFT JOIN ipt_pttype ip ON ip.ipt_pttype_id = (
  SELECT p2.ipt_pttype_id FROM ipt_pttype p2 WHERE p2.an = i.an
  ORDER BY (p2.pttype = s.pttype) DESC, p2.ipt_pttype_id LIMIT 1)
LEFT JOIN hospcode hc ON hc.hospcode = NULLIF(ip.hospmain, '')
WHERE ${where}
  AND i.finance_lock = 'Y'
ORDER BY i.dchdate, i.an`;
const BY_RANGE = { opd: "d.debt_date BETWEEN ? AND ?", cancel: "c.cancel_datetime >= ? AND c.cancel_datetime < ?", ipd: "i.dchdate BETWEEN ? AND ?" };
// รายราย (params [vn|an, LEDGER_START]) ไม่ตั้งหนี้ก่อนวันเริ่มสมุด ; cancel สแกน rcpt_debt_cancel ทั้งตาราง (InnoDB เล็ก) เหมือนรายวัน
const BY_CASE = { opd: "d.vn = ? AND d.debt_date >= ?", cancel: "r.vn = ?", ipd: "i.an = ? AND i.dchdate >= ?" };

const COLS = "source, kind, ref, vn, an, patient_type, ref_date, entry_date, pttype, hipdata_code, hospmain, hospmain_chwpart, hospmain_type, account_code, amount, note";
// ON CONFLICT: set/cancel ซ้ำ (unique ar_ledger_once_uq) ไม่ลงซ้ำแม้หลุดการเทียบยอด
const INSERT_SQL = `INSERT INTO ar_ledger (${COLS}, sync_id)
SELECT ${COLS}, $2 FROM jsonb_to_recordset($1::jsonb) AS x(source text, kind text, ref text, vn varchar, an varchar, patient_type text,
  ref_date date, entry_date date, pttype text, hipdata_code text, hospmain text, hospmain_chwpart text, hospmain_type text, account_code text, amount numeric, note text)
ON CONFLICT (source, ref, kind) WHERE kind IN ('set', 'cancel') DO NOTHING
RETURNING source, kind`;
// ยอดของหนี้ (x = ทุกแถวของ (patient_type, ref) เดียวกับแถว set s): balance = ค่ารักษาเต็มของ source HOSxP (ไม่นับ diff),
//   diff = ส่วนต่างตามเพดาน/สัดส่วน (diff ของ source HOSxP), settled = ตัดหนี้แล้วด้วย source อื่น (stm/fwf/capitation/manual)
const REF_AGG = `SUM(x.amount) FILTER (WHERE x.source = s.source AND x.kind <> 'diff') AS balance,
  COALESCE(SUM(x.amount) FILTER (WHERE x.source = s.source AND x.kind = 'diff'), 0) AS diff,
  bool_or(x.kind = 'cancel') AS cancelled,
  COALESCE(bool_or(x.source <> s.source AND x.kind IN ('settle', 'diff')), false) AS settled`;
const SET_COLS = "s.source, s.ref, s.vn, s.an, s.patient_type, s.ref_date, s.pttype, s.hipdata_code, s.hospmain, s.hospmain_chwpart, s.hospmain_type, s.account_code";
// แถว set ของ ref + ยอดของหนี้ ; $3/$4 = ช่วง ref_date (IPD หา AN ที่หายไปจากผล) OPD ส่ง null
const STATES_SQL = `SELECT ${SET_COLS}, b.balance, b.diff, b.cancelled, b.settled
FROM ar_ledger s
CROSS JOIN LATERAL (SELECT ${REF_AGG} FROM ar_ledger x WHERE x.patient_type = s.patient_type AND x.ref = s.ref) b
WHERE s.source = $1 AND s.kind = 'set' AND (s.ref = ANY($2::text[]) OR s.ref_date BETWEEN $3::date AND $4::date)`;
// ชุดเขียนลง ledger ทีละชุด: ถือ lock นี้ตลอด transaction ให้การกดพร้อมกันเรียงคิว ไม่ตั้งหรือปรับซ้ำ
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('ar_ledger'))";
const CHUNK = 2000;
/** คอลัมน์ของ SyncLog เวลาเป็น "YYYY-MM-DD HH24:MI" เวลาไทย (session timezone) */
export const LOG_COLS = `id, mode, range_start, range_end, counts, requested_by, to_char(started_at, 'YYYY-MM-DD HH24:MI') AS started_at,
  to_char(finished_at, 'YYYY-MM-DD HH24:MI') AS finished_at, error`;

export type SyncCounts = Record<string, number>;
export type SyncLog = {
  id: string;
  mode: "daily" | "backfill" | "case";
  range_start: string;
  range_end: string;
  counts: SyncCounts;
  requested_by: string | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

/** กลุ่มสิทธิ, pttype -> กลุ่มสิทธิ และกติกาบัญชีจาก insight + รายการ hcode ใน CUP จาก HOSxP (hospcode_cup ~20 แถว) */
export async function loadRules(): Promise<AccountRules> {
  const [rights, pttypes, rules, cup] = await Promise.all([
    insightQuery<Right>("SELECT code, name, main_hcode, books_ar FROM ar_right"),
    insightQuery<{ pttype: string; right_code: string }>("SELECT pttype, right_code FROM ar_right_pttype"),
    insightQuery<AccountRule>("SELECT right_code, patient_type, loc, account_code, cap, debt_pct FROM ar_account_rule"),
    hisQuery<{ hospcode: string }>("SELECT hospcode FROM hospcode_cup"),
  ]);
  return { rights, pttypes: new Map(pttypes.map((p) => [p.pttype, p.right_code])), rules, cup: new Set(cup.map((c) => c.hospcode)) };
}

type RawState<T> = Omit<T, "balance" | "diff"> & { balance: string; diff: string };
const toState = <T,>(r: RawState<T>) => ({ ...r, balance: toCents(r.balance), diff: toCents(r.diff) }) as T;

async function loadStates(tx: InsightTx, source: Source, refs: string[], window?: { from: string; to: string }) {
  // OPD โหลดหนี้ CR ของ debt_id มาด้วย (planOpd/planCancels ใช้ทั้งสอง ref)
  const all = source === "rcpt_debt" ? refs.flatMap((r) => [r, crRef(r)]) : refs;
  const rows = await tx<RawState<RefState>>(STATES_SQL, [source, all, window?.from ?? null, window?.to ?? null]);
  return new Map(rows.map((r) => [r.ref, toState<RefState>(r)]));
}

/** คืนจำนวนแถวที่ลงจริง (ไม่นับที่ชน ON CONFLICT) */
async function insert(tx: InsightTx, entries: Entry[], syncId: string | null, counts: SyncCounts) {
  let n = 0;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const rows = await tx<{ source: Source; kind: string }>(INSERT_SQL, [JSON.stringify(entries.slice(i, i + CHUNK)), syncId]);
    for (const r of rows) bump(counts, `${r.source === "rcpt_debt" ? "opd" : "ipd"}_${r.kind}`);
    n += rows.length;
  }
  return n;
}

const bump = (c: SyncCounts, k: string, n = 1) => (c[k] = (c[k] ?? 0) + n);

// ovst PK (vn) เฉพาะ visit ที่มี HC/INST
const ADMITTED_SQL = (n: number) => `SELECT vn FROM ovst WHERE ${inList("vn", n)} AND an IS NOT NULL`;

/**
 * ยอด HC + INST (สตางค์) ต่อ vn ของผู้ป่วยนอก = กองทุนย่อยที่ account_op เป็นบัญชี CR (กติกาเดียวกับ /admin/ar-funds ผ่าน loadSubfunds)
 * อ่านทีละเดือนของวันรับบริการ (ช่วง min..max ของเดือน): เกิน 1,000 VN อ่าน opitemrece ตามวัน (ix_vstdate) ไม่งั้นตาม VN (ix_vn)
 * visit ที่ admit แล้ว (ovst.an) ไม่แยก เหมือนโปรแกรม Claim ; อ่าน his ก่อนถือ lock ; error = ทั้งรอบล้ม (ไม่ลงยอดผิดว่า CR เป็น 0)
 */
async function loadCr(visits: { vn: string | null; date: string | null }[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const months = new Map<string, { vns: Set<string>; start: string; end: string }>();
  for (const v of visits) {
    if (!v.vn || !v.date) continue;
    const d = v.date.slice(0, 10);
    const m = months.get(d.slice(0, 7)) ?? { vns: new Set<string>(), start: d, end: d };
    m.vns.add(v.vn);
    if (d < m.start) m.start = d;
    if (d > m.end) m.end = d;
    months.set(d.slice(0, 7), m);
  }
  if (!months.size) return out;
  const codes = (await loadFundRules()).filter((r) => r.account_op === CR_SPLIT.to).map((r) => r.code);
  if (!codes.length) return out;
  const lk = await loadLookups();
  for (const m of months.values())
    for (const [vn, funds] of await loadSubfunds("OP", [...m.vns], lk, { range: { start: m.start, end: m.end }, codes }))
      out.set(vn, funds.reduce((sum, f) => sum + toCents(f.amount), 0));
  for (const r of await byChunks<{ vn: string }>([...out.keys()], ADMITTED_SQL)) out.delete(r.vn);
  return out;
}
const debtVisits = (debts: HisDebt[]) => debts.map((d) => ({ vn: d.vn, date: d.vstdate ?? d.debt_date }));
/** ถือ advisory lock ของ ar_ledger ตลอด transaction (ar-sync และตัดลูกหนี้ /fund/ar-settle) */
export const locked = <T>(fn: (tx: InsightTx) => Promise<T>) => insightTransaction(async (tx) => (await tx(LOCK_SQL), fn(tx)));

async function syncOpd(w: { from: string; to: string }, rules: AccountRules, today: string, syncId: string, counts: SyncCounts) {
  const debts = await hisQuery<HisDebt>(OPD_DEBT_SQL(BY_RANGE.opd), [w.from, w.to]);
  bump(counts, "opd_rows", debts.length);
  const cr = await loadCr(debtVisits(debts));
  await locked(async (tx) => {
    const states = await loadStates(tx, "rcpt_debt", debts.map((d) => String(d.debt_id)));
    await insert(tx, planOpd(debts, states, rules, today, cr), syncId, counts);
  });
}

async function syncCancels(w: { from: string; to: string }, syncId: string, counts: SyncCounts) {
  for (const c of chunkRange(w.from, w.to)) {
    const cancels = await hisQuery<HisCancel>(OPD_CANCEL_SQL(BY_RANGE.cancel), [c.from, addDays(c.to, 1)]);
    bump(counts, "cancel_rows", cancels.length);
    if (!cancels.length) continue;
    await locked(async (tx) => {
      const { entries, skipped } = planCancels(cancels, await loadStates(tx, "rcpt_debt", cancels.map((x) => String(x.debt_id))));
      bump(counts, "cancel_skipped", skipped);
      await insert(tx, entries, syncId, counts);
    });
  }
}

async function syncIpd(w: { from: string; to: string }, rules: AccountRules, today: string, syncId: string, counts: SyncCounts) {
  for (const c of chunkRange(w.from, w.to)) {
    const rows = await hisQuery<HisIpd>(IPD_SQL(BY_RANGE.ipd), [c.from, c.to]);
    bump(counts, "ipd_rows", rows.length);
    await locked(async (tx) => {
      const states = await loadStates(tx, "ipt", rows.map((r) => r.an), c);
      await insert(tx, planIpd(rows, states, rules, c, today), syncId, counts);
    });
  }
}

/**
 * ดึงยอดลง ledger หนึ่งครั้ง (หนึ่งแถวใน ar_sync_log) เขียนทีละชุด ≤31 วันใน transaction ของตัวเอง กดซ้ำได้ไม่ตั้งซ้ำ
 * - daily: OPD ย้อน 14 วันของ debt_date, ยกเลิกหนี้ตั้งแต่ sync รายวันที่สำเร็จล่าสุด −1 วัน, IPD ย้อน 120 วันของ dchdate
 * - backfill: หนึ่งเดือน (YYYY-MM)
 * วันตั้งหนี้ทุกโหมด: OPD = วันรับบริการ (ไม่ก่อน LEDGER_START), IPD = วันจำหน่าย ; ปรับปรุง/กลับรายการลงวันที่ sync
 * error กลางทาง: ชุดที่ commit แล้วคงอยู่ (กดใหม่ได้เพราะ idempotent) และบันทึก error ลง log
 * daily รันอัตโนมัติทุก 01:00 ผ่าน scripts/ar-sync-daily.mjs (systemd timer ใน deploy/)
 * ไม่ตัดหนี้ด้วย STM (ผู้ใช้เลือก 20 พ.ย. 2569 ให้ตัดเองที่ /fund/ar-settle) แถว stm ที่ตัดอัตโนมัติไปแล้วคงไว้
 */
export async function runSync(
  input: { mode: "daily" } | { mode: "backfill"; month: string },
  requestedBy: string | null,
): Promise<SyncLog> {
  const today = todayIso();
  let windows;
  if (input.mode === "daily") {
    const [last] = await insightQuery<{ day: string | null }>(
      "SELECT max(started_at)::date AS day FROM ar_sync_log WHERE mode = 'daily' AND finished_at IS NOT NULL AND error IS NULL",
    );
    windows = dailyWindows(today, last?.day ?? null);
  } else {
    const m = monthRange(input.month, today);
    if (!m) throw new RangeError("month ต้องเป็น YYYY-MM ตั้งแต่ 2025-10 ถึงเดือนปัจจุบัน");
    windows = { opd: m, cancel: m, ipd: m };
  }
  const start = [windows.opd.from, windows.cancel.from, windows.ipd.from].sort()[0];
  const [{ id }] = await insightQuery<{ id: string }>(
    "INSERT INTO ar_sync_log (mode, range_start, range_end, requested_by) VALUES ($1, $2, $3, $4) RETURNING id",
    [input.mode, start, windows.opd.to, requestedBy],
  );
  const counts: SyncCounts = {};
  let error: string | null = null;
  try {
    const rules = await loadRules();
    // ตั้งก่อนยกเลิก ให้หนี้ที่ตั้งและยกเลิกในรอบเดียวกันลดได้ทันที
    await syncOpd(windows.opd, rules, today, id, counts);
    await syncCancels(windows.cancel, id, counts);
    await syncIpd(windows.ipd, rules, today, id, counts);
  } catch (e) {
    console.error("ar-sync", id, (e as Error).message);
    error = (e as Error).message.slice(0, 500);
  }
  const [log] = await insightQuery<SyncLog>(
    `UPDATE ar_sync_log SET counts = $2, finished_at = now(), error = $3 WHERE id = $1
RETURNING ${LOG_COLS}`,
    [id, JSON.stringify(counts), error],
  );
  return log;
}

// หนี้ทั้งหมดของ VN/AN ใน ledger ($1 = source จากโค้ด, $2 = vn หรือ an): settled = มีแถวรับชำระ/ส่วนต่างแล้ว (STM, เงินรับล่วงหน้า fwf, เหมาจ่าย capitation, รับเงิน manual ; รวมรับบางส่วน)
//   booked = ยอดของ source HOSxP (เท่าคอลัมน์ "ลงสมุดแล้ว"), balance = คงเหลือทางบัญชีทุก source
//   diff ของ source HOSxP (เพดาน/สัดส่วนของกติกาบัญชี) ไม่ใช่การตัดหนี้ และไม่นับใน booked
const CASE_SQL = `SELECT COALESCE(bool_or(x.kind = 'settle' OR (x.kind = 'diff' AND x.source <> s.source)), false) AS settled,
  count(DISTINCT s.ref)::int AS debts,
  COALESCE(SUM(x.amount) FILTER (WHERE x.source = s.source AND x.kind <> 'diff'), 0) AS booked,
  COALESCE(SUM(x.amount), 0) AS balance
FROM ar_ledger s
JOIN ar_ledger x ON x.patient_type = s.patient_type AND x.ref = s.ref
WHERE s.kind = 'set' AND s.source = $1 AND (s.vn = $2 OR s.an = $2)`;
type CaseState = { settled: boolean; debts: number; booked: string; balance: string };

/** ตัดหนี้แล้ว (STM/fwf/รับเงิน) ดึงใหม่ไม่ได้ (route ตอบ 409) */
export class CaseSettledError extends Error {}
/** ผลของ POST /api/fund/ar-sync/case (บาท) */
export type CaseSyncResult = { sync_id: string; counts: SyncCounts; entries: number; booked: number; balance: number };

/**
 * ดึงใหม่รายราย: อ่าน HOSxP ของ VN/AN เดียว แล้วลงส่วนต่างด้วย plan* เดียวกับรายวัน ใน transaction เดียวที่ถือ lock เดียวกัน กดซ้ำไม่ลงซ้ำ
 * ไม่พบทั้งใน HOSxP และ ledger = null ; ไม่ตัดหนี้ด้วย STM (ตัดเองที่ /fund/ar-settle)
 */
export async function runCaseSync(c: SyncCase, requestedBy: string | null): Promise<CaseSyncResult | null> {
  const today = todayIso();
  const opd = "vn" in c;
  const id = opd ? c.vn : c.an;
  const source: Source = opd ? "rcpt_debt" : "ipt";
  const rules = await loadRules();
  // อ่าน his ก่อนถือ lock เหมือนรายวัน
  const [debts, cancels, ipd] = await Promise.all([
    opd ? hisQuery<HisDebt>(OPD_DEBT_SQL(BY_CASE.opd), [id, LEDGER_START]) : [],
    opd ? hisQuery<HisCancel>(OPD_CANCEL_SQL(BY_CASE.cancel), [id]) : [],
    opd ? [] : hisQuery<HisIpd>(IPD_SQL(BY_CASE.ipd), [id, LEDGER_START]),
  ]);
  const cr = await loadCr(debtVisits(debts));
  return locked(async (tx) => {
    const [before] = await tx<CaseState>(CASE_SQL, [source, id]);
    if (before.settled) throw new CaseSettledError("รายนี้ตัดหนี้แล้ว (STM, เงินรับล่วงหน้า, เหมาจ่าย หรือรับเงิน) ดึงใหม่ไม่ได้ ถ้ายอดต้องแก้ให้ขอปรับปรุงลูกหนี้");
    if (!before.debts && !debts.length && !cancels.length && !ipd.length) return null;
    const [{ id: syncId }] = await tx<{ id: string }>(
      "INSERT INTO ar_sync_log (mode, range_start, range_end, requested_by, case_ref) VALUES ('case', $1, $1, $2, $3) RETURNING id",
      [today, requestedBy, `${opd ? "OP" : "IP"}:${id}`],
    );
    const counts: SyncCounts = { [`${opd ? "opd" : "ipd"}_rows`]: debts.length + ipd.length };
    let entries = 0;
    if (opd) {
      if (cancels.length) counts.cancel_rows = cancels.length;
      entries += await insert(tx, planOpd(debts, await loadStates(tx, source, debts.map((d) => String(d.debt_id))), rules, today, cr), syncId, counts);
      // โหลด states ใหม่ ให้หนี้ที่เพิ่งตั้งในรอบนี้ยกเลิกได้ทันที (ลำดับเดียวกับรายวัน)
      const { entries: cancelEntries } = planCancels(cancels, await loadStates(tx, source, cancels.map((x) => String(x.debt_id))));
      entries += await insert(tx, cancelEntries, syncId, counts);
    } else {
      // states จาก [an] ตรงๆ: AN ที่ finance_lock ไม่ใช่ Y แล้ว (his ไม่คืนแถว) จึงกลับรายการได้
      const states = await loadStates(tx, source, [id]);
      entries += await insert(tx, planIpd(ipd, states, rules, { from: LEDGER_START, to: today }, today), syncId, counts);
    }
    const [after] = await tx<CaseState>(CASE_SQL, [source, id]);
    await tx("UPDATE ar_sync_log SET counts = $2, finished_at = now() WHERE id = $1", [syncId, JSON.stringify(counts)]);
    return { sync_id: syncId, counts, entries, booked: Number(after.booked), balance: Number(after.balance) };
  });
}

// ทุกหนี้ใน ledger (แถว set ของ source HOSxP) พร้อมยอดของหนี้
const RECOMPUTE_SQL = `SELECT ${SET_COLS}, s.entry_date AS set_date, ${REF_AGG}
FROM ar_ledger s JOIN ar_ledger x ON x.patient_type = s.patient_type AND x.ref = s.ref
WHERE s.kind = 'set' AND s.source IN ('rcpt_debt', 'ipt')
GROUP BY s.id`;
// ที่ตั้งหน่วยบริการประจำของ OPD (hospcode PK) ค่าใน IN มาจาก ledger ส่งเป็น bind parameter
const HOSPCODE_SQL = (n: number) => `SELECT hospcode, chwpart, hospital_type_id FROM hospcode WHERE hospcode IN (${Array(n).fill("?").join(", ")})`;
const HIS_CHUNK = 500;
// ข้อมูลสิทธิในทุกแถวของหนี้ (คัดลอกจากแถว set) ให้ตรงกับที่คำนวณ
const COVERAGE_UPDATE_SQL = `UPDATE ar_ledger l SET pttype = x.pttype, hipdata_code = x.hipdata_code, hospmain = x.hospmain,
  hospmain_chwpart = x.hospmain_chwpart, hospmain_type = x.hospmain_type
FROM jsonb_to_recordset($1::jsonb) AS x(patient_type text, ref text, pttype text, hipdata_code text, hospmain text, hospmain_chwpart text, hospmain_type text)
WHERE l.patient_type = x.patient_type AND l.ref = x.ref
  AND (l.pttype, l.hipdata_code, l.hospmain, l.hospmain_chwpart, l.hospmain_type) IS DISTINCT FROM (x.pttype, x.hipdata_code, x.hospmain, x.hospmain_chwpart, x.hospmain_type)`;
const ACCOUNT_UPDATE_SQL = `UPDATE ar_ledger l SET account_code = x.account_code
FROM jsonb_to_recordset($1::jsonb) AS x(patient_type text, ref text, account_code text)
WHERE l.patient_type = x.patient_type AND l.ref = x.ref AND l.account_code IS DISTINCT FROM x.account_code
RETURNING l.id`;

/** ผลคำนวณบัญชีใหม่ (บาท) month = เดือนของวันตั้งหนี้ YYYY-MM */
export type RecomputeResult = {
  applied: boolean;
  /** ทุกคู่บัญชีเดิม -> ใหม่ (รวมที่ไม่เปลี่ยน) amount = ค่ารักษาเต็มคงค้าง (ไม่นับ diff) */
  moves: { month: string; from: string | null; to: string | null; refs: number; amount: number }[];
  /** diff ที่ลงเพิ่มต่อบัญชีใหม่ (ลบ = ลดลูกหนี้ตามเพดาน/สัดส่วน) */
  diffs: { month: string; account: string | null; n: number; amount: number }[];
  /** หนี้ของสิทธิที่ไม่ตั้งลูกหนี้ ที่กลับรายการ (amount = ยอดที่กลับ) */
  reversed: { refs: number; amount: number };
  /** ไม่มีกติกา คงบัญชีเดิม */
  no_rule: { refs: number; amount: number };
  /** หนี้ที่ตัดแล้ว ไม่ลง diff/ไม่แยก CR เพิ่ม */
  settled_skipped: number;
  /** หนี้ .201 ที่แยก/ปรับยอด HC + INST ไปหนี้ CR (.216) amount = ยอดที่ย้ายเข้า CR (ลบ = ย้ายกลับ) */
  cr_split: { refs: number; amount: number };
  /** หนี้ที่ข้อมูลสิทธิ (สิทธิ IPD, ที่ตั้งหน่วยบริการประจำ) เปลี่ยนตาม HOSxP */
  coverage_updated: number;
  /** แถวที่ย้ายบัญชี และแถวที่ลงใหม่ (apply เท่านั้น) */
  rows_moved: number;
  rows_inserted: number;
};

const coverageKey = (s: RecomputeState) => [s.pttype, s.hipdata_code, s.hospmain, s.hospmain_chwpart, s.hospmain_type].join("|");
const str = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const round = (n: number) => Math.round(n * 100) / 100;

/** ข้อมูลสิทธิจาก HOSxP: OPD = ที่ตั้งของหน่วยบริการประจำ (hospcode) ; IPD = สิทธิ an_stat + hospmain ของ ipt_pttype (query C) */
async function hisCoverage(states: RecomputeState[]) {
  const hospmains = [...new Set(states.flatMap((s) => (s.patient_type === "OP" && s.hospmain ? [s.hospmain] : [])))];
  const ans = states.flatMap((s) => (s.patient_type === "IP" ? [s.ref] : []));
  const hosp = new Map<string, { chwpart: string | null; type: string | null }>();
  for (let i = 0; i < hospmains.length; i += HIS_CHUNK) {
    const part = hospmains.slice(i, i + HIS_CHUNK);
    for (const h of await hisQuery<{ hospcode: string; chwpart: string | null; hospital_type_id: string | number | null }>(HOSPCODE_SQL(part.length), part))
      hosp.set(h.hospcode, { chwpart: str(h.chwpart), type: str(h.hospital_type_id) });
  }
  const ipd = new Map<string, HisIpd>();
  for (let i = 0; i < ans.length; i += HIS_CHUNK) {
    const part = ans.slice(i, i + HIS_CHUNK);
    for (const r of await hisQuery<HisIpd>(IPD_SQL(`i.an IN (${Array(part.length).fill("?").join(", ")})`), part)) ipd.set(r.an, r);
  }
  return (s: RecomputeState): RecomputeState => {
    if (s.patient_type === "OP") {
      const h = s.hospmain ? hosp.get(s.hospmain) : undefined;
      return { ...s, hospmain_chwpart: h?.chwpart ?? null, hospmain_type: h?.type ?? null };
    }
    const r = ipd.get(s.ref); // finance_lock ไม่ใช่ Y แล้ว = คงข้อมูลเดิม
    return r
      ? { ...s, pttype: str(r.pttype), hipdata_code: str(r.hipdata_code), hospmain: str(r.hospmain), hospmain_chwpart: str(r.hospmain_chwpart), hospmain_type: str(r.hospmain_type) }
      : s;
  };
}

/** สรุปแผนเป็นยอดต่อเดือน/บัญชี */
function summarize(plan: Recomputed[], apply: boolean, coverageUpdated: number): RecomputeResult {
  const out: RecomputeResult = {
    applied: apply, moves: [], diffs: [], reversed: { refs: 0, amount: 0 }, no_rule: { refs: 0, amount: 0 },
    settled_skipped: 0, cr_split: { refs: 0, amount: 0 }, coverage_updated: coverageUpdated, rows_moved: 0, rows_inserted: 0,
  };
  const moves = new Map<string, RecomputeResult["moves"][number]>();
  const diffs = new Map<string, RecomputeResult["diffs"][number]>();
  for (const p of plan) {
    const month = p.state.set_date.slice(0, 7);
    const baht = p.state.balance / 100;
    const mk = `${month}|${p.state.account_code}|${p.to}`;
    const m = moves.get(mk) ?? { month, from: p.state.account_code, to: p.to, refs: 0, amount: 0 };
    moves.set(mk, { ...m, refs: m.refs + 1, amount: m.amount + baht });
    if (p.noRule) out.no_rule = { refs: out.no_rule.refs + 1, amount: out.no_rule.amount + baht };
    if (p.settledSkip) out.settled_skipped++;
    const crs = p.entries.filter((e) => isCrRef(e.ref) && (e.kind === "set" || e.kind === "adjust"));
    if (crs.length) out.cr_split = { refs: out.cr_split.refs + 1, amount: out.cr_split.amount + crs.reduce((sum, e) => sum + Number(e.amount), 0) };
    if (p.entries.some((e) => e.kind === "reverse")) out.reversed = { refs: out.reversed.refs + 1, amount: out.reversed.amount + baht };
    for (const e of p.entries.filter((x) => x.kind === "diff")) {
      const dk = `${month}|${e.account_code}`;
      const d = diffs.get(dk) ?? { month, account: e.account_code, n: 0, amount: 0 };
      diffs.set(dk, { ...d, n: d.n + 1, amount: d.amount + Number(e.amount) });
    }
  }
  out.moves = [...moves.values()].map((m) => ({ ...m, amount: round(m.amount) }));
  out.diffs = [...diffs.values()].map((d) => ({ ...d, amount: round(d.amount) }));
  out.reversed.amount = round(out.reversed.amount);
  out.no_rule.amount = round(out.no_rule.amount);
  out.cr_split.amount = round(out.cr_split.amount);
  return out;
}

/**
 * คำนวณบัญชีของทุกหนี้ใน ledger ใหม่ตามกติกาปัจจุบัน (ar_right/ar_account_rule) ; apply = false คือดูผลอย่างเดียว ไม่เขียน
 * apply: เติมข้อมูลสิทธิจาก HOSxP, ย้ายบัญชีทุกแถวของหนี้ (รวม stm/manual/fwf), ลง diff ตามเพดาน/สัดส่วนที่ขาด, แยก HC + INST ของ .201 เป็นหนี้ CR
 * และกลับรายการหนี้ของสิทธิที่ไม่ตั้งลูกหนี้ ลงวันเดียวกับแถว set ใน transaction เดียวที่ถือ lock ของ ar_ledger กดซ้ำได้
 * งวดที่ปิดแล้ว: trigger ar_ledger_period_guard ห้าม UPDATE แถวในงวดปิด ทั้งชุดจึง ROLLBACK
 */
export async function recomputeLedger(apply: boolean): Promise<RecomputeResult> {
  const rules = await loadRules();
  // อ่าน his ก่อนถือ lock (เหมือน sync) จากหนี้ที่มีตอนนี้ ; หนี้ที่ตั้งระหว่างนี้ไม่มีใน map จึงคงข้อมูลเดิม (OPD = ไม่พบที่ตั้ง)
  const current = (await insightQuery<RawState<RecomputeState>>(RECOMPUTE_SQL)).map((r) => toState<RecomputeState>(r));
  const fresh = await hisCoverage(current);
  // ยอด HC + INST ของหนี้ OPD ที่ลง .201 ตามกติกาปัจจุบัน (ตามเดือนของวันรับบริการ = ref_date)
  const cr = await loadCr(current.map(fresh).filter((s) => s.patient_type === "OP" && !isCrRef(s.ref) && !s.cancelled && resolve(s, rules).account_code === CR_SPLIT.from)
    .map((s) => ({ vn: s.vn, date: s.ref_date })));
  return locked(async (tx) => {
    const before = (await tx<RawState<RecomputeState>>(RECOMPUTE_SQL)).map((r) => toState<RecomputeState>(r));
    const states = before.map(fresh);
    const changedCoverage = states.filter((s, i) => coverageKey(s) !== coverageKey(before[i]));
    const plan = planRecompute(states, rules, cr);
    const out = summarize(plan, apply, changedCoverage.length);
    if (!apply) return out;
    if (changedCoverage.length)
      await tx(COVERAGE_UPDATE_SQL, [JSON.stringify(changedCoverage.map(({ patient_type, ref, pttype, hipdata_code, hospmain, hospmain_chwpart, hospmain_type }) =>
        ({ patient_type, ref, pttype, hipdata_code, hospmain, hospmain_chwpart, hospmain_type })))]);
    const moved = plan.filter((p) => p.to !== p.state.account_code).map((p) => ({ patient_type: p.state.patient_type, ref: p.state.ref, account_code: p.to }));
    if (moved.length) out.rows_moved = (await tx(ACCOUNT_UPDATE_SQL, [JSON.stringify(moved)])).length;
    out.rows_inserted = await insert(tx, plan.flatMap((p) => p.entries), null, {});
    return out;
  });
}
