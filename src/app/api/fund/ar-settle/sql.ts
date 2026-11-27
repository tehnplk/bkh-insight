import "server-only";
import type { InsightTx } from "@/lib/db";
import type { PatientType } from "../ar-sync/ledger";
import { REP_ACCOUNTS, repDebts, repGate, type DebtRow, type RepGate, type RepTransferAgg, type MissingRow, type SettleBatch, type SettleSummary, type StmLine } from "./settle";

// SQL ฝั่ง insight ของการตัดลูกหนี้ผ่าน prove-query แล้ว (20 พ.ย. 2569) ห้ามเปลี่ยน logic ถ้าไม่ได้ prove ใหม่

// S7 ข้อมูลไฟล์ ($1 = stm_file_id)
export const FILE_SQL = `SELECT id::text AS id, scheme, patient_type, doc_no, period_month::text AS period_month, run_no,
  transfer_date::text AS transfer_date, net_total
FROM stm_file WHERE id = $1`;
// S2 บรรทัด STM ของไฟล์ ($1 = stm_file_id): vn/an จาก stm_row หรือ rep_row ของ scheme เดียวกัน (tran_id ชนข้าม scheme ได้, OFC ไม่มี tran_id)
//   cr_paid = ค่าพาหนะส่งต่อที่ STM UC IP จ่าย (กองทุน AE) ให้หนี้ CR .217 ก่อน
export const LINES_SQL = `SELECT r.id::text AS id, f.patient_type, r.rep_no, r.tran_id, r.hn,
  COALESCE(NULLIF(r.seq_no, ''), rr.seq_no) AS vn, COALESCE(NULLIF(r.an, ''), rr.an) AS an,
  r.paid_total, EXISTS (SELECT 1 FROM ar_ledger l WHERE l.stm_row_id = r.id) AS done,
  CASE WHEN f.scheme = 'UCS' AND f.patient_type = 'IP' THEN (r.fund_amounts->>'AE')::numeric END AS cr_paid
FROM stm_row r JOIN stm_file f ON f.id = r.stm_file_id
LEFT JOIN rep_row rr ON rr.tran_id = r.tran_id AND rr.scheme = f.scheme
WHERE r.stm_file_id = $1
ORDER BY r.id`;
// S3 หนี้ของ VN/AN ($1 = vns, $2 = ans) ยอดคงเหลือรวม HOSxP + stm + manual + fwf + capitation ของหนี้เดียวกัน ; settles_by_stm ให้ route กรองบัญชีที่ตัดได้
const DEBTS_SQL = `SELECT s.source, s.ref, s.vn, s.an, s.patient_type, s.ref_date::text AS ref_date, s.pttype, s.hipdata_code, s.hospmain, s.hospmain_chwpart,
  s.account_code, COALESCE(a.settles_by_stm, false) AS settles_by_stm, b.balance
FROM ar_ledger s
LEFT JOIN ar_account a ON a.code = s.account_code
CROSS JOIN LATERAL (SELECT SUM(x.amount) AS balance FROM ar_ledger x
  WHERE x.patient_type = s.patient_type AND x.ref = s.ref AND x.source IN (s.source, 'stm', 'manual', 'fwf', 'capitation')) b
WHERE s.kind = 'set' AND s.source IN ('rcpt_debt', 'ipt')
  AND ((s.patient_type = 'OP' AND s.vn = ANY($1::text[])) OR (s.patient_type = 'IP' AND s.an = ANY($2::text[])))`;
// S4 หนี้ใน REP ที่ STM ไฟล์นี้จ่าย (stm_summary.rep_no) REP ผ่านแล้ว แต่ไม่มีบรรทัดในไฟล์ และยังคงเหลือ ($1 = stm_file_id) แยก OP/IP ให้ใช้ index vn/an
const missingSql = (pt: PatientType) => {
  const [line, rep, src] = pt === "OP" ? ["COALESCE(NULLIF(r.seq_no, ''), rr.seq_no)", "rr.seq_no", "s.source = 'rcpt_debt' AND s.patient_type = 'OP' AND s.vn"]
    : ["COALESCE(NULLIF(r.an, ''), rr.an)", "rr.an", "s.source = 'ipt' AND s.patient_type = 'IP' AND s.an"];
  return `WITH f AS (SELECT scheme FROM stm_file WHERE id = $1),
lines AS MATERIALIZED (
  SELECT DISTINCT ${line} AS k
  FROM stm_row r LEFT JOIN rep_row rr ON rr.tran_id = r.tran_id AND rr.scheme = (SELECT scheme FROM f)
  WHERE r.stm_file_id = $1)
SELECT rr.tran_id, rr.rep_no, rr.hn, ${rep} AS ${pt === "OP" ? "vn" : "an"}, s.ref, s.account_code, b.balance
FROM rep_row rr
JOIN ar_ledger s ON s.kind = 'set' AND ${src} = ${rep}
JOIN ar_account a ON a.code = s.account_code AND a.settles_by_stm
CROSS JOIN LATERAL (SELECT SUM(x.amount) AS balance FROM ar_ledger x
  WHERE x.patient_type = s.patient_type AND x.ref = s.ref AND x.source IN (s.source, 'stm', 'manual', 'fwf', 'capitation')) b
WHERE rr.scheme = (SELECT scheme FROM f)
  AND rr.rep_no IN (SELECT rep_no FROM stm_summary WHERE stm_file_id = $1)
  AND rr.patient_type = '${pt}' AND cardinality(rr.error_codes) = 0
  AND NOT EXISTS (SELECT 1 FROM lines l WHERE l.k = ${rep})
  AND b.balance > 0
ORDER BY rr.rep_no, rr.tran_id`;
};
// identifier ทั้งหมดในโค้ดเป็นค่าคงที่ตาม patient_type (ไม่ได้รับจากผู้ใช้)
export const MISSING_SQL = { OP: missingSql("OP"), IP: missingSql("IP") } as const;
export const OPEN_FROM_SQL = "SELECT ar_open_from()::text AS open_from";
export const BATCHES_SQL = `SELECT id::text AS id, receipt_date::text AS receipt_date, receipt_no, settled_by,
  to_char(settled_at, 'YYYY-MM-DD HH24:MI') AS settled_at, counts
FROM ar_settle_batch WHERE stm_file_id = $1 ORDER BY id DESC`;
// S6 ชุดตัดหนี้ ($1 file, $2 receipt_date, $3 receipt_no, $4 ชื่อผู้ตัด, $5 users.id หรือ null)
export const BATCH_INSERT_SQL = `INSERT INTO ar_settle_batch (stm_file_id, receipt_date, receipt_no, settled_by, settled_user_id)
VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`;
export const BATCH_COUNTS_SQL = "UPDATE ar_settle_batch SET counts = $2 WHERE id = $1";
// S5 ลงแถว settle/diff ($1 = entries jsonb, $2 = settle_batch_id) unique (stm_row_id, ref, kind) กันลงซ้ำ ; trigger เลื่อนวันก่อน RETURNING
const COLS = "source, kind, ref, vn, an, patient_type, ref_date, entry_date, pttype, hipdata_code, hospmain, hospmain_chwpart, account_code, amount, note, stm_row_id";
export const SETTLE_INSERT_SQL = `INSERT INTO ar_ledger (${COLS}, settle_batch_id)
SELECT ${COLS}, $2 FROM jsonb_to_recordset($1::jsonb) AS x(source text, kind text, ref text, vn varchar, an varchar, patient_type text,
  ref_date date, entry_date date, pttype text, hipdata_code text, hospmain text, hospmain_chwpart text, account_code text, amount numeric, note text, stm_row_id bigint)
ON CONFLICT (stm_row_id, ref, kind) WHERE stm_row_id IS NOT NULL DO NOTHING
RETURNING kind, amount, orig_entry_date IS NOT NULL AS shifted`;

type Query = InsightTx;
export type FileInfo = SettleSummary["file"];

/** บรรทัด STM + หนี้ของทุก VN/AN ในไฟล์ (ใช้ทั้งตัวอย่างและตอนตัด) */
export async function loadFile(q: Query, id: string): Promise<{ file: FileInfo; lines: StmLine[]; debts: DebtRow[] } | null> {
  const [file] = await q<FileInfo>(FILE_SQL, [id]);
  if (!file) return null;
  const lines = await q<StmLine>(LINES_SQL, [id]);
  const ids = (k: "vn" | "an") => [...new Set(lines.map((l) => l[k]).filter((v): v is string => !!v))];
  const [vns, ans] = file.patient_type === "OP" ? [ids("vn"), []] : [[], ids("an")];
  const debts = vns.length || ans.length ? await q<DebtRow>(DEBTS_SQL, [vns, ans]) : [];
  return { file, lines, debts };
}

export const loadMissing = (q: Query, file: FileInfo) => q<MissingRow>(MISSING_SQL[file.patient_type], [file.id]);
export const loadBatches = (q: Query, id: string) => q<SettleBatch>(BATCHES_SQL, [id]);
export const loadOpenFrom = async (q: Query) => (await q<{ open_from: string | null }>(OPEN_FROM_SQL))[0]?.open_from ?? null;

// ---------- ตัดด้วย REP (scheme ใน REP_ACCOUNTS เช่น LGO ที่ไม่มี STM) ; $1 = rep_no, $2 = scheme ที่รองรับ ----------
// หนึ่ง REP มี patient_type เดียว ; ยอดจ่ายต่อราย = ชดเชยสุทธิ net_nhso + net_affiliation (ผลรวมต่อ REP = ยอดโอน SMT ของ REP นั้น)
const REP_FILE_SQL = `SELECT r.rep_no AS id, r.scheme, max(r.patient_type) AS patient_type, r.rep_no AS doc_no, NULL::text AS period_month, 0 AS run_no,
  max(f.printed_at)::date::text AS transfer_date, SUM(COALESCE(r.net_nhso, 0) + COALESCE(r.net_affiliation, 0)) AS net_total
FROM rep_row r JOIN rep_file f ON f.id = r.rep_file_id
WHERE r.rep_no = $1 AND r.scheme = ANY($2::text[])
GROUP BY r.rep_no, r.scheme ORDER BY r.scheme LIMIT 1`;
// บรรทัดของ REP: id = tran_id (ar_ledger.rep_tran_id) ; REP อุทธรณ์ที่ upsert tran_id เดิมมาอยู่ REP ใหม่ยังนับว่า done
const REP_LINES_SQL = `SELECT r.tran_id AS id, r.patient_type, r.rep_no, r.tran_id, r.hn, NULLIF(r.seq_no, '') AS vn, NULLIF(r.an, '') AS an,
  COALESCE(r.net_nhso, 0) + COALESCE(r.net_affiliation, 0) AS paid_total,
  EXISTS (SELECT 1 FROM ar_ledger l WHERE l.rep_tran_id = r.tran_id) AS done
FROM rep_row r WHERE r.rep_no = $1 AND r.scheme = ANY($2::text[])
ORDER BY r.tran_id`;
export const REP_BATCHES_SQL = `SELECT id::text AS id, receipt_date::text AS receipt_date, receipt_no, settled_by,
  to_char(settled_at, 'YYYY-MM-DD HH24:MI') AS settled_at, counts
FROM ar_settle_batch WHERE rep_no = $1 AND rep_scheme = $2 ORDER BY id DESC`;
// ($1 rep_no, $2 scheme, $3 receipt_date, $4 receipt_no, $5 ชื่อผู้ตัด, $6 users.id หรือ null)
export const REP_BATCH_INSERT_SQL = `INSERT INTO ar_settle_batch (rep_no, rep_scheme, receipt_date, receipt_no, settled_by, settled_user_id)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id`;
const REP_COLS = "source, kind, ref, vn, an, patient_type, ref_date, entry_date, pttype, hipdata_code, hospmain, hospmain_chwpart, account_code, amount, note, rep_tran_id";
export const REP_SETTLE_INSERT_SQL = `INSERT INTO ar_ledger (${REP_COLS}, settle_batch_id)
SELECT ${REP_COLS}, $2 FROM jsonb_to_recordset($1::jsonb) AS x(source text, kind text, ref text, vn varchar, an varchar, patient_type text,
  ref_date date, entry_date date, pttype text, hipdata_code text, hospmain text, hospmain_chwpart text, account_code text, amount numeric, note text, rep_tran_id varchar)
ON CONFLICT (rep_tran_id, ref, kind) WHERE rep_tran_id IS NOT NULL DO NOTHING
RETURNING kind, amount, orig_entry_date IS NOT NULL AS shifted`;

export const REP_SCHEMES = Object.keys(REP_ACCOUNTS);

/**
 * เงินโอน SMT ของ REP เป็นก้อน (RepTransferAgg) ; budgetSource ของ SMT = scheme ของ REP (LGO) อยู่ช่องแรกของ smt_key
 * rep/scheme/accounts เป็น SQL expression ที่กำหนดในโค้ด (bind parameter หรือคอลัมน์ของ query นอก) ไม่ได้มาจากผู้ใช้
 */
export const transferAggSql = (rep: string, scheme: string, accounts: string) => `SELECT count(*)::int AS n,
  count(*) FILTER (WHERE t.receipt_date IS NULL)::int AS pending_n,
  count(*) FILTER (WHERE NOT (t.account_code = ANY(${accounts})))::int AS other_n, SUM(t.amount) AS total,
  (array_agg(t.receipt_no ORDER BY t.receipt_date DESC, t.id DESC) FILTER (WHERE t.receipt_date IS NOT NULL))[1] AS receipt_no,
  max(t.receipt_date)::text AS receipt_date,
  count(DISTINCT (t.receipt_no, t.receipt_date)) FILTER (WHERE t.receipt_date IS NOT NULL)::int AS receipts
FROM ar_transfer t WHERE t.source = 'smt' AND t.cancelled_at IS NULL AND t.ref_doc_no = ${rep} AND split_part(t.smt_key, '|', 1) = ${scheme}`;
const REP_TRANSFER_SQL = transferAggSql("$1", "$2", "$3::text[]");

/** บรรทัด REP + หนี้ของทุก VN/AN ใน REP (หนี้ตัดได้เฉพาะบัญชีของ scheme) + เงื่อนไขเงินโอน ; null = ไม่พบ REP ของ scheme ที่รองรับ */
export async function loadRep(q: Query, repNo: string): Promise<{ file: FileInfo; lines: StmLine[]; debts: DebtRow[]; gate: RepGate } | null> {
  const [file] = await q<FileInfo>(REP_FILE_SQL, [repNo, REP_SCHEMES]);
  if (!file) return null;
  const [lines, [agg]] = await Promise.all([
    q<StmLine>(REP_LINES_SQL, [repNo, [file.scheme]]),
    q<RepTransferAgg>(REP_TRANSFER_SQL, [repNo, file.scheme, REP_ACCOUNTS[file.scheme]]),
  ]);
  const ids = (k: "vn" | "an") => [...new Set(lines.map((l) => l[k]).filter((v): v is string => !!v))];
  const [vns, ans] = file.patient_type === "OP" ? [ids("vn"), []] : [[], ids("an")];
  const debts = vns.length || ans.length ? await q<DebtRow>(DEBTS_SQL, [vns, ans]) : [];
  return { file, lines, debts: repDebts(file.scheme, debts), gate: repGate(file.net_total, agg) };
}

/** ก่อนรัน migration 202611271620_ar_settle_rep.sql (ไม่มีคอลัมน์ rep_tran_id/rep_no) ตอบ 503 แทน 500 */
export function repNotMigrated(e: unknown) {
  if ((e as { code?: string }).code !== "42703") throw e;
  return Response.json({ error: "ยังไม่ได้รัน migration ตัดหนี้ด้วย REP (202611271620_ar_settle_rep.sql)" }, { status: 503 });
}
