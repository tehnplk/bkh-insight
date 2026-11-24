import "server-only";
import { hisQuery, insightQuery, insightTransaction, type InsightTx } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import {
  LEDGER_START, accountFor, addDays, chunkRange, dailyWindows, monthRange, planCancels, planIpd, planOpd,
  type AccountMap, type AccountRules, type Entry, type HisCancel, type HisDebt, type HisIpd, type RefState, type Source, type SyncCase,
} from "./ledger";

// SQL ฝั่ง his ผ่าน prove-query แล้ว (A/B/C) ห้ามเปลี่ยน logic ถ้าไม่ได้ prove ใหม่
// A ตั้งหนี้ OPD: key = debt_id (1 vn มีหลาย debt_id ได้) แถว ABORT ถูกตั้ง amount = 0 จึงกรองออก ส่วนการลดยอดใช้ B
// where ของ A/B/C เป็นค่าคงที่ในโค้ดเท่านั้น (BY_RANGE รายวัน/backfill, BY_CASE ดึงใหม่รายราย) ห้ามรับจากผู้ใช้
const OPD_DEBT_SQL = (where: string) => `SELECT d.debt_id, d.vn, d.debt_date, d.debt_date_time, d.pttype,
       t.hipdata_code, t.pttype_eclaim_id,
       IFNULL(d.amount, 0) AS amount, d.status,
       COALESCE(NULLIF(vp.hospmain, ''), NULLIF(o.hospmain, '')) AS hospmain,
       hc.chwpart AS hospmain_chwpart
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
const IPD_SQL = (where: string) => `SELECT i.an, i.dchdate, i.pttype, t.hipdata_code, t.pttype_eclaim_id,
       s.uc_money, i.finance_lock
FROM ipt i
JOIN an_stat s ON s.an = i.an
LEFT JOIN pttype t ON t.pttype = i.pttype
WHERE ${where}
  AND i.finance_lock = 'Y'
ORDER BY i.dchdate, i.an`;
const BY_RANGE = { opd: "d.debt_date BETWEEN ? AND ?", cancel: "c.cancel_datetime >= ? AND c.cancel_datetime < ?", ipd: "i.dchdate BETWEEN ? AND ?" };
// รายราย (params [vn|an, LEDGER_START]) ไม่ตั้งหนี้ก่อนวันเริ่มสมุด ; cancel สแกน rcpt_debt_cancel ทั้งตาราง (InnoDB เล็ก) เหมือนรายวัน
const BY_CASE = { opd: "d.vn = ? AND d.debt_date >= ?", cancel: "r.vn = ?", ipd: "i.an = ? AND i.dchdate >= ?" };

const COLS = "source, kind, ref, vn, an, patient_type, ref_date, entry_date, pttype, hipdata_code, hospmain, hospmain_chwpart, account_code, amount, note";
// ON CONFLICT: set/cancel ซ้ำ (unique ar_ledger_once_uq) ไม่ลงซ้ำแม้หลุดการเทียบยอด
const INSERT_SQL = `INSERT INTO ar_ledger (${COLS}, sync_id)
SELECT ${COLS}, $2 FROM jsonb_to_recordset($1::jsonb) AS x(source text, kind text, ref text, vn varchar, an varchar, patient_type text,
  ref_date date, entry_date date, pttype text, hipdata_code text, hospmain text, hospmain_chwpart text, account_code text, amount numeric, note text)
ON CONFLICT (source, ref, kind) WHERE kind IN ('set', 'cancel') DO NOTHING
RETURNING source, kind`;
// แถว set ของ ref + ยอดคงเหลือทั้ง ref ; $3/$4 = ช่วง ref_date (IPD หา AN ที่หายไปจากผล) OPD ส่ง null
const STATES_SQL = `SELECT s.source, s.ref, s.vn, s.an, s.patient_type, s.ref_date, s.pttype, s.hipdata_code, s.hospmain, s.hospmain_chwpart,
  s.account_code, b.balance, b.cancelled
FROM ar_ledger s
CROSS JOIN LATERAL (SELECT SUM(x.amount) AS balance, bool_or(x.kind = 'cancel') AS cancelled
  FROM ar_ledger x WHERE x.source = s.source AND x.ref = s.ref) b
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

/** mapping จาก insight + รายการ hcode ใน CUP จาก HOSxP (hospcode_cup ~20 แถว) */
export async function loadRules(): Promise<AccountRules> {
  const [maps, cup] = await Promise.all([
    insightQuery<AccountMap>("SELECT hipdata_code, pttype, patient_type, account_code FROM ar_account_map"),
    hisQuery<{ hospcode: string }>("SELECT hospcode FROM hospcode_cup"),
  ]);
  return { maps, cup: new Set(cup.map((c) => c.hospcode)) };
}

async function loadStates(tx: InsightTx, source: Source, refs: string[], window?: { from: string; to: string }) {
  const rows = await tx<Omit<RefState, "balance"> & { balance: string }>(STATES_SQL, [source, refs, window?.from ?? null, window?.to ?? null]);
  return new Map(rows.map((r) => [r.ref, { ...r, balance: Math.round(Number(r.balance) * 100) }]));
}

/** คืนจำนวนแถวที่ลงจริง (ไม่นับที่ชน ON CONFLICT) */
async function insert(tx: InsightTx, entries: Entry[], syncId: string, counts: SyncCounts) {
  let n = 0;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const rows = await tx<{ source: Source; kind: string }>(INSERT_SQL, [JSON.stringify(entries.slice(i, i + CHUNK)), syncId]);
    for (const r of rows) bump(counts, `${r.source === "rcpt_debt" ? "opd" : "ipd"}_${r.kind}`);
    n += rows.length;
  }
  return n;
}

const bump = (c: SyncCounts, k: string, n = 1) => (c[k] = (c[k] ?? 0) + n);
/** ถือ advisory lock ของ ar_ledger ตลอด transaction (ar-sync และตัดลูกหนี้ /fund/ar-settle) */
export const locked = <T>(fn: (tx: InsightTx) => Promise<T>) => insightTransaction(async (tx) => (await tx(LOCK_SQL), fn(tx)));

async function syncOpd(w: { from: string; to: string }, rules: AccountRules, today: string, syncId: string, counts: SyncCounts) {
  const debts = await hisQuery<HisDebt>(OPD_DEBT_SQL(BY_RANGE.opd), [w.from, w.to]);
  bump(counts, "opd_rows", debts.length);
  await locked(async (tx) => {
    const states = await loadStates(tx, "rcpt_debt", debts.map((d) => String(d.debt_id)));
    await insert(tx, planOpd(debts, states, rules, today), syncId, counts);
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

async function syncIpd(w: { from: string; to: string }, mode: "daily" | "backfill", rules: AccountRules, today: string, syncId: string, counts: SyncCounts) {
  for (const c of chunkRange(w.from, w.to)) {
    const rows = await hisQuery<HisIpd>(IPD_SQL(BY_RANGE.ipd), [c.from, c.to]);
    bump(counts, "ipd_rows", rows.length);
    await locked(async (tx) => {
      const states = await loadStates(tx, "ipt", rows.map((r) => r.an), c);
      await insert(tx, planIpd(rows, states, rules, c, mode, today), syncId, counts);
    });
  }
}

/**
 * ดึงยอดลง ledger หนึ่งครั้ง (หนึ่งแถวใน ar_sync_log) เขียนทีละชุด ≤31 วันใน transaction ของตัวเอง กดซ้ำได้ไม่ตั้งซ้ำ
 * - daily: OPD ย้อน 14 วัน, ยกเลิกหนี้ตั้งแต่ sync รายวันที่สำเร็จล่าสุด −1 วัน, IPD ย้อน 120 วัน (วันตั้งหนี้ = วันนี้)
 * - backfill: หนึ่งเดือน (YYYY-MM) IPD ใช้ dchdate เป็นวันตั้งหนี้
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
    await syncIpd(windows.ipd, input.mode, rules, today, id, counts);
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

// หนี้ทั้งหมดของ VN/AN ใน ledger ($1 = source จากโค้ด, $2 = vn หรือ an): settled = มีแถวรับชำระ/ส่วนต่างแล้ว (STM, เงินรับล่วงหน้า fwf, รับเงิน manual ; รวมรับบางส่วน)
//   booked = ยอดของ source HOSxP (เท่าคอลัมน์ "ลงสมุดแล้ว"), balance = คงเหลือทางบัญชีทุก source
const CASE_SQL = `SELECT COALESCE(bool_or(x.kind IN ('settle', 'diff')), false) AS settled,
  count(DISTINCT s.ref)::int AS debts,
  COALESCE(SUM(x.amount) FILTER (WHERE x.source = s.source), 0) AS booked,
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
  return locked(async (tx) => {
    const [before] = await tx<CaseState>(CASE_SQL, [source, id]);
    if (before.settled) throw new CaseSettledError("รายนี้ตัดหนี้แล้ว (STM, เงินรับล่วงหน้า หรือรับเงิน) ดึงใหม่ไม่ได้ ถ้ายอดต้องแก้ให้ขอปรับปรุงลูกหนี้");
    if (!before.debts && !debts.length && !cancels.length && !ipd.length) return null;
    const [{ id: syncId }] = await tx<{ id: string }>(
      "INSERT INTO ar_sync_log (mode, range_start, range_end, requested_by, case_ref) VALUES ('case', $1, $1, $2, $3) RETURNING id",
      [today, requestedBy, `${opd ? "OP" : "IP"}:${id}`],
    );
    const counts: SyncCounts = { [`${opd ? "opd" : "ipd"}_rows`]: debts.length + ipd.length };
    let entries = 0;
    if (opd) {
      if (cancels.length) counts.cancel_rows = cancels.length;
      entries += await insert(tx, planOpd(debts, await loadStates(tx, source, debts.map((d) => String(d.debt_id))), rules, today), syncId, counts);
      // โหลด states ใหม่ ให้หนี้ที่เพิ่งตั้งในรอบนี้ยกเลิกได้ทันที (ลำดับเดียวกับรายวัน)
      const { entries: cancelEntries } = planCancels(cancels, await loadStates(tx, source, cancels.map((x) => String(x.debt_id))));
      entries += await insert(tx, cancelEntries, syncId, counts);
    } else {
      // states จาก [an] ตรงๆ: AN ที่ finance_lock ไม่ใช่ Y แล้ว (his ไม่คืนแถว) จึงกลับรายการได้ ; "daily" = ตั้งใหม่ลงวันนี้
      const states = await loadStates(tx, source, [id]);
      entries += await insert(tx, planIpd(ipd, states, rules, { from: LEDGER_START, to: today }, "daily", today), syncId, counts);
    }
    const [after] = await tx<CaseState>(CASE_SQL, [source, id]);
    await tx("UPDATE ar_sync_log SET counts = $2, finished_at = now() WHERE id = $1", [syncId, JSON.stringify(counts)]);
    return { sync_id: syncId, counts, entries, booked: Number(after.booked), balance: Number(after.balance) };
  });
}

/** ใส่บัญชีให้แถวที่ account_code ยังเป็น NULL ตาม mapping ปัจจุบัน (หลังแก้ mapping) คืนจำนวนแถวที่ได้บัญชี */
export async function recomputeAccounts(): Promise<number> {
  const rules = await loadRules();
  return locked(async (tx) => {
    const groups = await tx<{ patient_type: "OP" | "IP"; pttype: string | null; hipdata_code: string | null; hospmain: string | null; hospmain_chwpart: string | null }>(
      "SELECT DISTINCT patient_type, pttype, hipdata_code, hospmain, hospmain_chwpart FROM ar_ledger WHERE account_code IS NULL",
    );
    const resolved = groups.map((g) => ({ ...g, account_code: accountFor(g, rules) })).filter((g) => g.account_code);
    if (!resolved.length) return 0;
    const rows = await tx<{ id: string }>(
      `UPDATE ar_ledger l SET account_code = x.account_code
FROM jsonb_to_recordset($1::jsonb) AS x(patient_type text, pttype text, hipdata_code text, hospmain text, hospmain_chwpart text, account_code text)
WHERE l.account_code IS NULL AND l.patient_type = x.patient_type AND l.pttype IS NOT DISTINCT FROM x.pttype
  AND l.hipdata_code IS NOT DISTINCT FROM x.hipdata_code AND l.hospmain IS NOT DISTINCT FROM x.hospmain
  AND l.hospmain_chwpart IS NOT DISTINCT FROM x.hospmain_chwpart
RETURNING l.id`,
      [JSON.stringify(resolved)],
    );
    return rows.length;
  });
}
