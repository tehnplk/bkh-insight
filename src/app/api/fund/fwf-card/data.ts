import "server-only";
import { auth } from "@/auth";
import { hisQuery, insightQuery, type InsightTx } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import {
  FWF_ACCOUNTS, POOL_START, addMonths, cardPool, defaultValidity, matchType, monthEnd, monthOf, monthsBetween, poolBalance,
  type Card, type CardType, type PlanDebt,
} from "./fwf";

// SQL ฝั่ง his (Q1–Q3, H1, H2) ผ่าน prove-query แล้ว (24 พ.ย. 2569) ห้ามเปลี่ยน logic ถ้าไม่ได้ prove ใหม่ ; IN (...) สร้าง placeholder ตามจำนวนค่า (ห้ามส่ง list ว่าง)
const inList = (n: number) => Array(n).fill("?").join(", ");
// Q1 รายการขายบัตรของเดือน ($1 start, $2 end, ...icode) has_receipt เป็นระดับ visit
const Q1 = (n: number) => `SELECT c.hos_guid, c.vn, c.hn, c.vstdate, c.icode, c.unitprice, c.qty, c.sum_price, c.paidst, o.pttype,
  EXISTS (SELECT 1 FROM rcpt_print r WHERE r.vn = c.vn AND r.status = 'OK') AS has_receipt
FROM (SELECT op.hos_guid, op.vn, op.hn, op.vstdate, op.icode, op.unitprice, op.qty, op.sum_price, op.paidst
      FROM opitemrece op FORCE INDEX (ix_vstdate)
      WHERE op.vstdate BETWEEN ? AND ? AND op.vn IS NOT NULL
        AND op.icode IN (${inList(n)})
        AND op.qty > 0 AND op.sum_price > 0) c
LEFT JOIN ovst o ON o.vn = c.vn
ORDER BY c.vstdate, c.vn, c.hos_guid`;
// Q2a ข้อมูลผู้ป่วยของ HN (patient.pttype ไม่น่าเชื่อถือ หน้าแสดงสิทธิของ visit ล่าสุดแทน)
const Q2A = `SELECT p.hn, CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) AS display_name,
  p.sex, p.birthday, TIMESTAMPDIFF(YEAR, p.birthday, CURDATE()) AS age_y,
  p.nationality, n.name AS nationality_name, p.pttype
FROM patient p LEFT JOIN nationality n ON n.nationality = p.nationality
WHERE p.hn = ?`;
// Q2b visit ล่าสุด 5 ครั้ง
const Q2B = `SELECT o.vn, o.vstdate, o.pttype, t.name AS pttype_name
FROM ovst o LEFT JOIN pttype t ON t.pttype = o.pttype
WHERE o.hn = ?
ORDER BY o.vstdate DESC, o.vn DESC
LIMIT 5`;
// Q2c รายการขายบัตรของ HN ($1 hn, ...icode)
const Q2C = (n: number) => `SELECT op.hos_guid, op.vn, op.vstdate, op.icode, op.unitprice, op.qty, op.sum_price, op.paidst
FROM (SELECT o.vn FROM ovst o WHERE o.hn = ?) v
JOIN opitemrece op FORCE INDEX (ix_vn) ON op.vn = v.vn
WHERE op.icode IN (${inList(n)}) AND op.qty > 0 AND op.sum_price > 0`;
// Q3 ชื่อของ HN ไม่เกิน 500 ต่อครั้ง
const Q3 = (n: number) => `SELECT p.hn, CONCAT(COALESCE(p.pname, ''), COALESCE(p.fname, ''), ' ', COALESCE(p.lname, '')) AS display_name
FROM patient p WHERE p.hn IN (${inList(n)})`;
// H1 ผู้ป่วยใน: HN และวัน admit ตาม AN (ix_an_hn) ; H2 ผู้ป่วยนอก: HN วันรับบริการ และสิทธิของ visit ตาม VN (ix_vn_unique)
// ar_ledger ไม่มี HN/วันรับบริการ จึงอ่านตาม vn/an ของหนี้ ไม่เกิน 500 ค่าต่อครั้ง
const H1 = (n: number) => `SELECT i.an, i.hn, i.regdate FROM ipt i WHERE i.an IN (${inList(n)})`;
const H2 = (n: number) => `SELECT o.vn, o.hn, o.vstdate, o.pttype FROM ovst o WHERE o.vn IN (${inList(n)})`;
const NAME_CHUNK = 500;
const CHUNK = 500;

/** hisQuery ทีละไม่เกิน 500 ค่า (ไม่ยิงเมื่อ list ว่าง) */
async function byChunks<T>(values: string[], sql: (n: number) => string): Promise<T[]> {
  const list = [...new Set(values)];
  const out: T[] = [];
  for (let i = 0; i < list.length; i += CHUNK) {
    const part = list.slice(i, i + CHUNK);
    out.push(...(await hisQuery<T>(sql(part.length), part)));
  }
  return out;
}

export type HisSale = { hos_guid: string; vn: string | null; hn: string | null; vstdate: string; icode: string; unitprice: string; qty: string | number; sum_price: string; paidst: string | null; pttype?: string | null; has_receipt?: number };
export type HisPatient = { hn: string; display_name: string; sex: string | null; birthday: string | null; age_y: number | null; nationality: string | null; nationality_name: string | null; pttype: string | null };
export type HisVisit = { vn: string; vstdate: string; pttype: string | null; pttype_name: string | null };

/** session ที่ login (รวม super user) ; ไม่มี = null */
export async function sessionUser() {
  const s = await auth();
  return s ? { name: s.user.name ?? "ไม่ทราบชื่อ", userId: s.user.userId ?? null, admin: s.user.role === "admin" } : null;
}
export const fail = (error: string, status = 400) => Response.json({ error }, { status });

/* ---------- ชนิดบัตร ---------- */

export const TYPES_SQL = `SELECT id::text AS id, icode, unit_price, label, months, pool_amount, active, note, updated_by,
  to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at
FROM fwf_card_type ORDER BY icode, unit_price DESC`;
export type CardTypeRow = CardType & { note: string | null; updated_by: string | null; updated_at: string };
export const loadTypes = () => insightQuery<CardTypeRow>(TYPES_SQL);
const icodesOf = (types: CardType[]) => [...new Set(types.filter((t) => t.active).map((t) => t.icode))];

/* ---------- บัตร ---------- */

/** บัตร + ชนิด + ยอดใช้ (settle + diff ที่อ้างบัตร) + ยอดโอน ; where เป็นค่าคงที่ในโค้ดเท่านั้น */
const cardsSql = (where: string) => `SELECT c.id::text AS id, c.hn, c.card_type_id::text AS card_type_id, t.label AS type_label, t.icode, t.unit_price,
  c.qty, c.sale_date::text AS sale_date, c.valid_from::text AS valid_from, c.valid_to::text AS valid_to, c.pool_amount, c.source, c.hos_guid, c.vn,
  c.paidst, c.has_receipt, c.hosxp_missing, c.status, c.void_reason, c.created_by, c.updated_by,
  COALESCE(u.usage, 0) AS usage, COALESCE(r.released, 0) AS released
FROM fwf_card c
JOIN fwf_card_type t ON t.id = c.card_type_id
LEFT JOIN (SELECT fwf_card_id, -SUM(amount) AS usage FROM ar_ledger WHERE fwf_card_id IS NOT NULL GROUP BY fwf_card_id) u ON u.fwf_card_id = c.id
LEFT JOIN (SELECT card_id, SUM(amount) AS released FROM fwf_card_release GROUP BY card_id) r ON r.card_id = c.id
${where}
ORDER BY c.sale_date, c.id`;
export const CARDS_SQL = {
  month: cardsSql("WHERE c.sale_date BETWEEN $1 AND $2"),
  hn: cardsSql("WHERE c.hn = $1"),
  id: cardsSql("WHERE c.id = $1"),
  all: cardsSql(""),
} as const;
export type CardRow = Card & {
  card_type_id: string; type_label: string; icode: string; unit_price: string; qty: number; source: "hosxp" | "manual"; hos_guid: string | null; vn: string | null;
  paidst: string | null; has_receipt: boolean | null; hosxp_missing: boolean; void_reason: string | null; created_by: string; updated_by: string | null;
  usage: string; released: string;
};

/* ---------- ดึงรายการขายจาก HOSxP ---------- */

const UPSERT_SQL = `INSERT INTO fwf_card (hn, card_type_id, qty, sale_date, valid_from, valid_to, pool_amount, source, hos_guid, vn, paidst, has_receipt, created_by)
SELECT x.hn, x.card_type_id, x.qty, x.sale_date, x.valid_from, x.valid_to, x.pool_amount, 'hosxp', x.hos_guid, x.vn, x.paidst, x.has_receipt, $2
FROM jsonb_to_recordset($1::jsonb) AS x(hn text, card_type_id bigint, qty int, sale_date date, valid_from date, valid_to date, pool_amount numeric,
  hos_guid text, vn text, paidst text, has_receipt boolean)
ON CONFLICT (hos_guid) DO UPDATE SET paidst = EXCLUDED.paidst, has_receipt = EXCLUDED.has_receipt, hosxp_missing = false
WHERE fwf_card.paidst IS DISTINCT FROM EXCLUDED.paidst OR fwf_card.has_receipt IS DISTINCT FROM EXCLUDED.has_receipt OR fwf_card.hosxp_missing
RETURNING (xmax = 0) AS inserted`;
// ไม่ทับวันที่ สถานะ หรือการยกเลิกของการเงิน ; แถวที่หายจาก HOSxP แค่ติดธงให้การเงินตรวจ
const MISSING_SQL = `UPDATE fwf_card SET hosxp_missing = true
WHERE source = 'hosxp' AND sale_date BETWEEN $1 AND $2 AND NOT (hos_guid = ANY($3::text[])) AND NOT hosxp_missing`;
const MISSING_ALL_SQL = "UPDATE fwf_card SET hosxp_missing = true WHERE source = 'hosxp' AND sale_date BETWEEN $1 AND $2 AND NOT hosxp_missing";
const SYNC_LOG_SQL = `INSERT INTO fwf_sync_month (month, counts, synced_by) VALUES ($1, $2, $3)
ON CONFLICT (month) DO UPDATE SET counts = EXCLUDED.counts, synced_by = EXCLUDED.synced_by, synced_at = now()`;
export type SyncCounts = { rows: number; matched: number; added: number; updated: number; missing: number; skipped: number };

/** ดึงรายการขายบัตรของเดือน YYYY-MM (หนึ่งเดือนปฏิทินพอดี) upsert ตาม hos_guid ; กดซ้ำได้ */
export async function syncMonth(month: string, by: string, types?: CardType[]): Promise<SyncCounts> {
  const list = types ?? (await loadTypes());
  const icodes = icodesOf(list);
  const [from, to] = [`${month}-01`, monthEnd(month)];
  const counts: SyncCounts = { rows: 0, matched: 0, added: 0, updated: 0, missing: 0, skipped: 0 };
  const sales = icodes.length ? await hisQuery<HisSale>(Q1(icodes.length), [from, to, ...icodes]) : [];
  // หนึ่ง VN มีได้หลายบัตร จึงนับตาม hos_guid
  const unique = [...new Map(sales.map((s) => [s.hos_guid, s])).values()];
  counts.rows = unique.length;
  const cards = [];
  for (const s of unique) {
    const type = matchType(list, s.icode, s.unitprice);
    if (!type) continue;
    if (!s.hn) {
      counts.skipped++;
      continue;
    }
    const qty = Math.max(1, Math.round(Number(s.qty)));
    cards.push({
      hn: s.hn, card_type_id: type.id, qty, sale_date: s.vstdate, ...defaultValidity(s.vstdate, type.months), pool_amount: cardPool(type, qty),
      hos_guid: s.hos_guid, vn: s.vn, paidst: s.paidst, has_receipt: Boolean(Number(s.has_receipt)),
    });
  }
  counts.matched = cards.length;
  if (cards.length) {
    const rows = await insightQuery<{ inserted: boolean }>(UPSERT_SQL, [JSON.stringify(cards), by]);
    counts.added = rows.filter((r) => r.inserted).length;
    counts.updated = rows.length - counts.added;
  }
  // ไม่มีชนิดบัตรที่ใช้อยู่ = ไม่ได้อ่าน HOSxP จึงไม่ติดธง ; list ว่างใช้ SQL ที่ไม่มี ANY
  if (icodes.length) {
    if (unique.length) await insightQuery(MISSING_SQL, [from, to, unique.map((s) => s.hos_guid)]);
    else await insightQuery(MISSING_ALL_SQL, [from, to]);
  }
  counts.missing = (await insightQuery<{ n: number }>(
    "SELECT count(*)::int AS n FROM fwf_card WHERE source = 'hosxp' AND sale_date BETWEEN $1 AND $2 AND hosxp_missing", [from, to],
  ))[0].n;
  await insightQuery(SYNC_LOG_SQL, [from, JSON.stringify(counts), by]);
  return counts;
}

const RECENT_MINUTES = 5;
/**
 * เดือนที่ยังไม่เคยดึง (ตั้งแต่เดือนของ POOL_START) ทีละเดือนตามลำดับ + เดือนนี้และเดือนก่อนทุกครั้ง
 * (ยกเว้นดึงไปไม่ถึง 5 นาที เว้นแต่ force) คืนเดือนที่ดึง
 */
type AutoSyncResult = { months: string[]; counts: Record<string, SyncCounts> };
// เปิดหน้าพร้อมกันหลายคน (และ dev StrictMode ยิง effect ซ้ำ) ใช้รอบที่กำลังดึงอยู่ร่วมกัน ไม่ยิง HOSxP ซ้ำ
// shortcut: กันซ้ำได้เฉพาะใน process เดียว, ใช้ pg_advisory_lock ถ้ารันหลาย instance
let running: Promise<AutoSyncResult> | null = null;
export function autoSync(by: string, force: boolean): Promise<AutoSyncResult> {
  running ??= runAutoSync(by, force).finally(() => (running = null));
  return running;
}
async function runAutoSync(by: string, force: boolean): Promise<AutoSyncResult> {
  const today = todayIso();
  const done = await insightQuery<{ month: string; recent: boolean }>(
    `SELECT to_char(month, 'YYYY-MM') AS month, synced_at > now() - make_interval(mins => $1) AS recent FROM fwf_sync_month`, [RECENT_MINUTES],
  );
  const state = new Map(done.map((d) => [d.month, d.recent]));
  const live = new Set([monthOf(today), monthOf(addMonths(`${monthOf(today)}-01`, -1))]);
  const months = monthsBetween(POOL_START, today).filter((m) => !state.has(m) || (live.has(m) && (force || !state.get(m))));
  const types = await loadTypes();
  const counts: Record<string, SyncCounts> = {};
  for (const m of months) counts[m] = await syncMonth(m, by, types);
  return { months, counts };
}

/* ---------- ข้อมูลจาก HOSxP ---------- */

/** ชื่อของ HN (ไม่พบ = ไม่อยู่ใน Map หน้าแสดง "–") */
export async function loadNames(hns: string[]): Promise<Map<string, string>> {
  const list = [...new Set(hns.filter(Boolean))];
  const out = new Map<string, string>();
  for (let i = 0; i < list.length; i += NAME_CHUNK) {
    const part = list.slice(i, i + NAME_CHUNK);
    for (const r of await hisQuery<{ hn: string; display_name: string }>(Q3(part.length), part)) out.set(r.hn, r.display_name.trim());
  }
  return out;
}

export async function lookupHn(hn: string, types: CardType[]) {
  const icodes = icodesOf(types);
  const [[patient], visits, sales] = await Promise.all([
    hisQuery<HisPatient>(Q2A, [hn]),
    hisQuery<HisVisit>(Q2B, [hn]),
    icodes.length ? hisQuery<HisSale>(Q2C(icodes.length), [hn, ...icodes]) : Promise.resolve([] as HisSale[]),
  ]);
  return { patient: patient ?? null, visits, sales };
}

/**
 * HN และวันรับบริการของหนี้ .501/.502 จาก HOSxP: OP = visit ตาม VN (H2, his_pttype ใช้ตรวจว่าสิทธิยังเป็น 99), IP = วัน admit ตาม AN (H1)
 * ไม่พบใน HOSxP = ต้องตรวจ
 */
export async function attachPatients(debts: Omit<PlanDebt, "hn" | "service_date">[]): Promise<PlanDebt[]> {
  const [visits, admits] = await Promise.all([
    byChunks<{ vn: string; hn: string | null; vstdate: string; pttype: string | null }>(debts.flatMap((d) => (d.patient_type === "OP" && d.vn ? [d.vn] : [])), H2),
    byChunks<{ an: string; hn: string | null; regdate: string }>(debts.flatMap((d) => (d.patient_type === "IP" && d.an ? [d.an] : [])), H1),
  ]);
  const vn = new Map(visits.map((v) => [v.vn, v]));
  const an = new Map(admits.map((a) => [a.an, a]));
  return debts.map((d) => {
    if (d.patient_type === "IP") {
      const a = d.an ? an.get(d.an) : undefined;
      return a?.hn ? { ...d, hn: a.hn, service_date: a.regdate } : { ...d, hn: null, service_date: null, missing_reason: "ไม่พบ AN นี้ใน HOSxP" };
    }
    const v = d.vn ? vn.get(d.vn) : undefined;
    return v?.hn ? { ...d, hn: v.hn, service_date: v.vstdate, his_pttype: v.pttype } : { ...d, hn: null, service_date: null, missing_reason: "ไม่พบ VN นี้ใน HOSxP" };
  });
}

/* ---------- pool และแผนตัดหนี้ ---------- */

// หนี้ .501/.502 ที่คงเหลือ > 0 ตั้งหนี้ถึง $2 ; คงเหลือ = HOSxP + stm + manual + fwf ของหนี้เดียวกัน
const DEBTS_SQL = `SELECT s.source, s.ref, s.vn, s.an, s.patient_type, s.ref_date::text AS ref_date, s.pttype, s.hipdata_code, s.hospmain, s.hospmain_chwpart,
  s.account_code, b.balance
FROM ar_ledger s
CROSS JOIN LATERAL (SELECT SUM(x.amount) AS balance FROM ar_ledger x
  WHERE x.patient_type = s.patient_type AND x.ref = s.ref AND x.source IN (s.source, 'stm', 'manual', 'fwf')) b
WHERE s.kind = 'set' AND s.source IN ('rcpt_debt', 'ipt') AND s.account_code = ANY($1::text[]) AND s.ref_date <= $2 AND b.balance > 0
ORDER BY s.ref_date, s.ref`;
// ยอดที่ตัดด้วย pool แล้ว (fwf_batch_id ไม่ว่าง = source fwf ตาม constraint) และยอดที่โอนไปเงินบำรุง
const POOL_USED_SQL = `SELECT
  (SELECT COALESCE(-SUM(amount) FILTER (WHERE kind = 'settle'), 0) FROM ar_ledger WHERE fwf_batch_id IS NOT NULL) AS settled,
  (SELECT COALESCE(-SUM(amount) FILTER (WHERE kind = 'diff'), 0) FROM ar_ledger WHERE fwf_batch_id IS NOT NULL) AS lost,
  (SELECT COALESCE(SUM(amount), 0) FROM fwf_card_release) AS released`;
const POOL_CARDS_SQL = `SELECT id::text AS id, hn, sale_date::text AS sale_date, valid_from::text AS valid_from, valid_to::text AS valid_to, status, pool_amount
FROM fwf_card`;

type Query = InsightTx;
export const loadDebts = (q: Query, end: string) =>
  q<Omit<PlanDebt, "hn" | "service_date">>(DEBTS_SQL, [[FWF_ACCOUNTS.OP, FWF_ACCOUNTS.IP], end]);

/** บัตรทั้งหมด + ยอดเงินรับล่วงหน้า ณ date */
export async function loadPool(q: Query, date: string) {
  const [cards, [used]] = await Promise.all([q<Card>(POOL_CARDS_SQL), q<{ settled: string; lost: string; released: string }>(POOL_USED_SQL)]);
  return { cards, lost: Number(used.lost), ...poolBalance(cards, used.settled, used.released, date) };
}

export const BATCH_INSERT_SQL = `INSERT INTO fwf_settle_batch (month, created_by, created_user_id) VALUES ($1, $2, $3) RETURNING id::text AS id`;
export const BATCH_COUNTS_SQL = "UPDATE fwf_settle_batch SET counts = $2 WHERE id = $1";
const COLS = "source, kind, ref, vn, an, patient_type, ref_date, entry_date, pttype, hipdata_code, hospmain, hospmain_chwpart, account_code, amount, note, fwf_card_id";
// trigger ar_ledger_period_guard เลื่อนวันที่ตกงวดปิดก่อน RETURNING
export const ENTRY_INSERT_SQL = `INSERT INTO ar_ledger (${COLS}, fwf_batch_id)
SELECT ${COLS}, $2 FROM jsonb_to_recordset($1::jsonb) AS x(source text, kind text, ref text, vn varchar, an varchar, patient_type text,
  ref_date date, entry_date date, pttype text, hipdata_code text, hospmain text, hospmain_chwpart text, account_code text, amount numeric, note text, fwf_card_id bigint)
ON CONFLICT (fwf_batch_id, patient_type, ref, kind) WHERE fwf_batch_id IS NOT NULL DO NOTHING
RETURNING kind, amount, orig_entry_date IS NOT NULL AS shifted`;
export const BATCHES_SQL = `SELECT id::text AS id, to_char(month, 'YYYY-MM') AS month, counts, created_by, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
FROM fwf_settle_batch ORDER BY id DESC LIMIT 24`;
export type FwfBatch = { id: string; month: string; counts: Record<string, number>; created_by: string; created_at: string };
