import "server-only";
import { hisQuery, insightQuery, insightTransaction, type InsightTx } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import {
  accountFor, addDays, chunkRange, dailyWindows, monthRange, planCancels, planIpd, planOpd,
  type AccountMap, type AccountRules, type Entry, type HisCancel, type HisDebt, type HisIpd, type RefState, type Source,
} from "./ledger";
import { debtKey, planSettle, type DebtState, type SettleEntry, type StmLine } from "./settle";

// SQL ฝั่ง his ผ่าน prove-query แล้ว (A/B/C) ห้ามเปลี่ยน logic ถ้าไม่ได้ prove ใหม่
// A ตั้งหนี้ OPD: key = debt_id (1 vn มีหลาย debt_id ได้) แถว ABORT ถูกตั้ง amount = 0 จึงกรองออก ส่วนการลดยอดใช้ B
const OPD_DEBT_SQL = `SELECT d.debt_id, d.vn, d.debt_date, d.debt_date_time, d.pttype,
       t.hipdata_code, t.pttype_eclaim_id,
       IFNULL(d.amount, 0) AS amount, d.status,
       COALESCE(NULLIF(vp.hospmain, ''), NULLIF(o.hospmain, '')) AS hospmain,
       hc.chwpart AS hospmain_chwpart
FROM rcpt_debt d
LEFT JOIN pttype t ON t.pttype = d.pttype
LEFT JOIN visit_pttype vp ON vp.vn = d.vn AND vp.pttype = d.pttype
LEFT JOIN ovst o ON o.vn = d.vn
LEFT JOIN hospcode hc ON hc.hospcode = COALESCE(NULLIF(vp.hospmain, ''), NULLIF(o.hospmain, ''))
WHERE d.debt_date BETWEEN ? AND ?
  AND LENGTH(d.vn) = 12
  AND (d.status IS NULL OR d.status <> 'ABORT')
ORDER BY d.debt_date, d.debt_id`;
// B ยกเลิกหนี้: cancel_amount เป็น NULL ทุกแถว จึงลดเท่ายอดที่ ledger ตั้งไว้ (ไม่มี index บน cancel_datetime ตารางเล็กรับได้)
const OPD_CANCEL_SQL = `SELECT c.debt_id, c.cancel_datetime, r.debt_date, r.pttype, c.amount AS cancel_amount
FROM rcpt_debt_cancel c
JOIN rcpt_debt r ON r.debt_id = c.debt_id
WHERE c.cancel_datetime >= ? AND c.cancel_datetime < ?
  AND LENGTH(r.vn) = 12
ORDER BY c.cancel_datetime, c.debt_id`;
// C IPD ที่ปิดสิทธิแล้ว: ช่วงยาวกว่า 120 วันจะ full scan ipt (เราดึงชุดละ ≤31 วัน)
const IPD_SQL = `SELECT i.an, i.dchdate, i.pttype, t.hipdata_code, t.pttype_eclaim_id,
       s.uc_money, i.finance_lock
FROM ipt i
JOIN an_stat s ON s.an = i.an
LEFT JOIN pttype t ON t.pttype = i.pttype
WHERE i.dchdate BETWEEN ? AND ?
  AND i.finance_lock = 'Y'
ORDER BY i.dchdate, i.an`;

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
// ตัดหนี้ด้วย STM: แถว STM ที่จ่าย ≠ 0 และยังไม่เคยลง ledger ; vn/an จาก stm_row หรือ rep_row (tran_id) สำหรับไฟล์ UC ยุคแรกที่ไม่มี seq_no
const STM_LINES_SQL = `SELECT r.id::text AS id, f.patient_type, COALESCE(NULLIF(r.seq_no, ''), rr.seq_no) AS vn, COALESCE(NULLIF(r.an, ''), rr.an) AS an,
  r.paid_total, f.transfer_date::text AS transfer_date
FROM stm_row r JOIN stm_file f ON f.id = r.stm_file_id
LEFT JOIN rep_row rr ON rr.tran_id = r.tran_id
WHERE r.paid_total <> 0 AND NOT EXISTS (SELECT 1 FROM ar_ledger l WHERE l.stm_row_id = r.id)
ORDER BY f.transfer_date, r.id`;
// หนี้ของบัญชีที่ตัดด้วย STM ได้ ยอดคงเหลือรวม HOSxP + stm + manual ของหนี้เดียวกัน (patient_type, ref)
const SETTLE_DEBTS_SQL = `SELECT s.source, s.ref, s.vn, s.an, s.patient_type, s.ref_date::text AS ref_date, s.pttype, s.hipdata_code, s.hospmain, s.hospmain_chwpart,
  s.account_code, b.balance
FROM ar_ledger s
JOIN ar_account a ON a.code = s.account_code AND a.settles_by_stm
CROSS JOIN LATERAL (SELECT SUM(x.amount) AS balance FROM ar_ledger x
  WHERE x.patient_type = s.patient_type AND x.ref = s.ref AND x.source IN (s.source, 'stm', 'manual')) b
WHERE s.kind = 'set' AND s.source IN ('rcpt_debt', 'ipt')
  AND ((s.patient_type = 'OP' AND s.vn = ANY($1::text[])) OR (s.patient_type = 'IP' AND s.an = ANY($2::text[])))`;
const SETTLE_COLS = `${COLS}, stm_row_id`;
const SETTLE_INSERT_SQL = `INSERT INTO ar_ledger (${SETTLE_COLS}, sync_id)
SELECT ${SETTLE_COLS}, $2 FROM jsonb_to_recordset($1::jsonb) AS x(source text, kind text, ref text, vn varchar, an varchar, patient_type text,
  ref_date date, entry_date date, pttype text, hipdata_code text, hospmain text, hospmain_chwpart text, account_code text, amount numeric, note text, stm_row_id bigint)
ON CONFLICT (stm_row_id, ref, kind) WHERE stm_row_id IS NOT NULL DO NOTHING
RETURNING kind`;
const CHUNK = 2000;
/** คอลัมน์ของ SyncLog เวลาเป็น "YYYY-MM-DD HH24:MI" เวลาไทย (session timezone) */
export const LOG_COLS = `id, mode, range_start, range_end, counts, requested_by, to_char(started_at, 'YYYY-MM-DD HH24:MI') AS started_at,
  to_char(finished_at, 'YYYY-MM-DD HH24:MI') AS finished_at, error`;

export type SyncCounts = Record<string, number>;
export type SyncLog = {
  id: string;
  mode: "daily" | "backfill";
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

async function insert(tx: InsightTx, entries: Entry[], syncId: string, counts: SyncCounts) {
  for (let i = 0; i < entries.length; i += CHUNK) {
    const rows = await tx<{ source: Source; kind: string }>(INSERT_SQL, [JSON.stringify(entries.slice(i, i + CHUNK)), syncId]);
    for (const r of rows) bump(counts, `${r.source === "rcpt_debt" ? "opd" : "ipd"}_${r.kind}`);
  }
}

const bump = (c: SyncCounts, k: string, n = 1) => (c[k] = (c[k] ?? 0) + n);
const locked = <T>(fn: (tx: InsightTx) => Promise<T>) => insightTransaction(async (tx) => (await tx(LOCK_SQL), fn(tx)));

async function syncOpd(w: { from: string; to: string }, rules: AccountRules, today: string, syncId: string, counts: SyncCounts) {
  const debts = await hisQuery<HisDebt>(OPD_DEBT_SQL, [w.from, w.to]);
  bump(counts, "opd_rows", debts.length);
  await locked(async (tx) => {
    const states = await loadStates(tx, "rcpt_debt", debts.map((d) => String(d.debt_id)));
    await insert(tx, planOpd(debts, states, rules, today), syncId, counts);
  });
}

async function syncCancels(w: { from: string; to: string }, syncId: string, counts: SyncCounts) {
  for (const c of chunkRange(w.from, w.to)) {
    const cancels = await hisQuery<HisCancel>(OPD_CANCEL_SQL, [c.from, addDays(c.to, 1)]);
    bump(counts, "cancel_rows", cancels.length);
    if (!cancels.length) continue;
    await locked(async (tx) => {
      const { entries, skipped } = planCancels(cancels, await loadStates(tx, "rcpt_debt", cancels.map((x) => String(x.debt_id))));
      bump(counts, "cancel_skipped", skipped);
      await insert(tx, entries, syncId, counts);
    });
  }
}

async function syncIpd(w: { from: string; to: string }, mode: SyncLog["mode"], rules: AccountRules, today: string, syncId: string, counts: SyncCounts) {
  for (const c of chunkRange(w.from, w.to)) {
    const rows = await hisQuery<HisIpd>(IPD_SQL, [c.from, c.to]);
    bump(counts, "ipd_rows", rows.length);
    await locked(async (tx) => {
      const states = await loadStates(tx, "ipt", rows.map((r) => r.an), c);
      await insert(tx, planIpd(rows, states, rules, c, mode, today), syncId, counts);
    });
  }
}

async function syncSettle(syncId: string, counts: SyncCounts) {
  await locked(async (tx) => {
    const lines = await tx<StmLine>(STM_LINES_SQL);
    bump(counts, "stm_rows", lines.length);
    if (!lines.length) return;
    const vns = [...new Set(lines.filter((l) => l.patient_type === "OP" && l.vn).map((l) => l.vn!))];
    const ans = [...new Set(lines.filter((l) => l.patient_type === "IP" && l.an).map((l) => l.an!))];
    const debts = new Map<string, DebtState[]>();
    for (const r of await tx<Omit<DebtState, "balance" | "cancelled"> & { balance: string }>(SETTLE_DEBTS_SQL, [vns, ans])) {
      const key = debtKey(r.patient_type, (r.patient_type === "OP" ? r.vn : r.an) ?? "");
      debts.set(key, [...(debts.get(key) ?? []), { ...r, balance: Math.round(Number(r.balance) * 100), cancelled: false }]);
    }
    const { entries, unmatched } = planSettle(lines, debts);
    bump(counts, "stm_unmatched", unmatched);
    for (let i = 0; i < entries.length; i += CHUNK) {
      const rows = await tx<{ kind: SettleEntry["kind"] }>(SETTLE_INSERT_SQL, [JSON.stringify(entries.slice(i, i + CHUNK)), syncId]);
      for (const r of rows) bump(counts, `stm_${r.kind}`);
    }
  });
}

/**
 * ดึงยอดลง ledger หนึ่งครั้ง (หนึ่งแถวใน ar_sync_log) เขียนทีละชุด ≤31 วันใน transaction ของตัวเอง กดซ้ำได้ไม่ตั้งซ้ำ
 * - daily: OPD ย้อน 14 วัน, ยกเลิกหนี้ตั้งแต่ sync รายวันที่สำเร็จล่าสุด −1 วัน, IPD ย้อน 120 วัน (วันตั้งหนี้ = วันนี้)
 * - backfill: หนึ่งเดือน (YYYY-MM) IPD ใช้ dchdate เป็นวันตั้งหนี้
 * error กลางทาง: ชุดที่ commit แล้วคงอยู่ (กดใหม่ได้เพราะ idempotent) และบันทึก error ลง log
 * daily รันอัตโนมัติทุก 01:00 ผ่าน scripts/ar-sync-daily.mjs (systemd timer ใน deploy/)
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
    // ตัดหนี้หลังตั้งหนี้ครบ (STM ทุกงวดที่ยังไม่ตัด ไม่ขึ้นกับช่วงวันที่ของรอบนี้)
    await syncSettle(id, counts);
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
