// รายงานลูกหนี้สำหรับพิมพ์ (/fund/ar-report) ; pure ไม่มี import เพื่อให้ test รัน .ts ตรงได้

export type ReportKind = "daily" | "balance";
export type PatientType = "OP" | "IP";
/** ช่วงวันของรายงานประจำวันยาวได้ไม่เกิน (ไม่อ่าน HOSxP อ่านแค่ ar_ledger) */
export const MAX_DAYS = 366;

/** หัวรายงาน (ต่อด้วยประเภทผู้ป่วย) และหัวคอลัมน์ของแต่ละรายงาน (หน้าจอ/พิมพ์และ Excel ใช้ชุดเดียวกัน) ; money เรียงตาม ReportRow.money (= คอลัมน์เงินของ SQL) */
export const REPORTS: Record<ReportKind, { title: string; code: string; count: string; money: { key: string; header: string }[] }> = {
  daily: {
    title: "สรุปลูกหนี้",
    code: "รหัสบัญชี",
    count: "จำนวนลูกหนี้ (ราย)",
    money: [
      { key: "gross", header: "ค่าใช้จ่ายจริง (บาท)" },
      { key: "booked", header: "เงินตั้งลูกหนี้ (บาท)" },
    ],
  },
  balance: {
    title: "สรุปยอดลูกหนี้คงเหลือ",
    code: "เลขผังบัญชี",
    count: "จำนวน (ราย)",
    money: [{ key: "bal", header: "ยอดคงเหลือ (บาท)" }],
  },
};

export type ReportRow = { account_code: string | null; account_name: string; n: number; money: number[] };
export type ReportTotal = { n: number; money: number[] };

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * แถวจาก SQL (pg คืน numeric/bigint เป็น string) -> ReportRow ; ยอดรวมเงิน = ผลรวมแถว
 * แต่จำนวนรวมใช้ total_n ของ query เพราะ VN เดียวอยู่ได้หลายบัญชี (.201 กับ .216) ผลรวมแถวจึงนับซ้ำ
 */
export function toReport(raw: Record<string, unknown>[], kind: ReportKind): { rows: ReportRow[]; total: ReportTotal } {
  const keys = REPORTS[kind].money.map((m) => m.key);
  const rows = raw.map((r) => ({
    account_code: (r.account_code as string | null) ?? null,
    account_name: (r.account_name as string | null) ?? "ยังไม่กำหนดบัญชี",
    n: Number(r.n),
    money: keys.map((k) => Number(r[k])),
  }));
  return {
    rows,
    total: { n: Number(raw[0]?.total_n ?? 0), money: keys.map((_, i) => round2(rows.reduce((s, r) => s + r.money[i], 0))) },
  };
}

// บัญชีที่แสดงแม้ยอดเป็นศูนย์: บัญชีกลุ่ม 1102050101/1102050102 ที่ชื่อเป็นของฝั่งนี้ ไม่ระบุฝั่ง หรือเคยมีหนี้ฝั่งนี้ ; แถว NULL = ยังไม่กำหนดบัญชี ; pt = placeholder ของ patient_type (ไม่ใช่ค่าจากผู้ใช้)
const shown = (pt: "$2" | "$3") => `WHERE x.account_code IS NOT NULL OR a.code IS NULL
   OR (a.code ~ '^11020501(01|02)[.]'
       AND ((a.name ~ '(^|[^A-Za-z])OPD?([^A-Za-z]|$)' AND ${pt}::text = 'OP')
         OR (a.name ~ '(^|[^A-Za-z])IPD?([^A-Za-z]|$)' AND ${pt}::text = 'IP')
         OR (a.name !~ '(^|[^A-Za-z])(OP|IP)D?([^A-Za-z]|$)')
         OR a.code IN (SELECT account_code FROM ev)))
ORDER BY a.code NULLS LAST`;

/** $1 start, $2 end (ref_date = วันรับบริการ/วันจำหน่าย), $3 patient_type ; gross = ค่าใช้จ่ายจริง (ไม่นับ diff), booked = เงินตั้งลูกหนี้ */
export const DAILY_SQL = `WITH d AS (
  SELECT l.account_code, l.amount, l.kind,
         CASE l.patient_type WHEN 'OP' THEN l.vn ELSE l.an END AS k
  FROM ar_ledger l
  WHERE l.source IN ('rcpt_debt', 'ipt') AND l.patient_type = $3::text
    AND l.ref_date BETWEEN $1::date AND $2::date
), x AS (
  SELECT account_code, COUNT(DISTINCT k) AS n,
         COALESCE(SUM(amount) FILTER (WHERE kind <> 'diff'), 0) AS gross,
         SUM(amount) AS booked
  FROM d GROUP BY account_code
), t AS (SELECT COUNT(DISTINCT k) AS total_n FROM d),
 ev AS (SELECT DISTINCT account_code FROM ar_ledger WHERE patient_type = $3::text)
SELECT a.code AS account_code, a.name AS account_name,
       COALESCE(x.n, 0) AS n, COALESCE(x.gross, 0) AS gross, COALESCE(x.booked, 0) AS booked, t.total_n
FROM ar_account a
FULL JOIN x ON x.account_code = a.code
CROSS JOIN t
${shown("$3")}`;

/** $1 สิ้นเดือน (entry_date <= $1 ทุก source), $2 patient_type ; คงเหลือต่อหนี้ (account_code, ref) ที่ไม่เป็นศูนย์ */
export const BALANCE_SQL = `WITH b AS (
  SELECT l.account_code, l.ref,
         MIN(CASE l.patient_type WHEN 'OP' THEN l.vn ELSE l.an END) AS k,
         SUM(l.amount) AS bal
  FROM ar_ledger l
  WHERE l.patient_type = $2::text AND l.entry_date <= $1::date
  GROUP BY l.account_code, l.ref
  HAVING SUM(l.amount) <> 0
), x AS (
  SELECT account_code, COUNT(DISTINCT k) AS n, SUM(bal) AS bal FROM b GROUP BY account_code
), t AS (SELECT COUNT(DISTINCT k) AS total_n FROM b),
 ev AS (SELECT DISTINCT account_code FROM ar_ledger WHERE patient_type = $2::text)
SELECT a.code AS account_code, a.name AS account_name,
       COALESCE(x.n, 0) AS n, COALESCE(x.bal, 0) AS bal, t.total_n
FROM ar_account a
FULL JOIN x ON x.account_code = a.code
CROSS JOIN t
${shown("$2")}`;

/* ---------- ผู้ลงนาม ---------- */

export type Signer = { slot: number; role_label: string; person_name: string | null; position: string | null };

/** ค่าเดียวกับ seed ของ migration 202611252200_ar_report_signer.sql ใช้เมื่อยังไม่ได้รัน migration */
export const DEFAULT_SIGNERS: Signer[] = [
  { slot: 1, role_label: "ผู้รับรองลูกหนี้", person_name: null, position: "หัวหน้าศูนย์จัดเก็บรายได้" },
  { slot: 2, role_label: "ผู้ตรวจสอบบันทึกบัญชี", person_name: null, position: "นักวิชาการการเงินและบัญชี" },
  { slot: 3, role_label: "ผู้อำนวยการ", person_name: null, position: "ผู้อำนวยการโรงพยาบาล" },
];

const MAX_TEXT = 120;
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** body ของ PUT { signers: Signer[] } ครบ 3 ช่อง (slot 1–3 ไม่ซ้ำ) role_label บังคับ ; ช่องว่าง = null */
export function parseSigners(body: unknown): { ok: true; signers: Signer[] } | { ok: false; error: string } {
  const list = (body as { signers?: unknown } | null)?.signers;
  if (!Array.isArray(list) || list.length !== 3) return { ok: false, error: "ต้องส่งผู้ลงนามครบ 3 ช่อง" };
  const signers: Signer[] = [];
  for (const s of list as Record<string, unknown>[]) {
    const slot = Number(s?.slot);
    if (![1, 2, 3].includes(slot) || signers.some((x) => x.slot === slot)) return { ok: false, error: "slot ต้องเป็น 1–3 ไม่ซ้ำกัน" };
    const v = { slot, role_label: text(s.role_label), person_name: text(s.person_name), position: text(s.position) };
    if (!v.role_label) return { ok: false, error: `ช่อง ${slot}: ต้องมีหัวข้อผู้ลงนาม` };
    if ([v.role_label, v.person_name, v.position].some((t) => t && t.length > MAX_TEXT)) return { ok: false, error: `ช่อง ${slot}: ข้อความยาวได้ไม่เกิน ${MAX_TEXT} ตัวอักษร` };
    signers.push(v as Signer);
  }
  return { ok: true, signers: signers.sort((a, b) => a.slot - b.slot) };
}
