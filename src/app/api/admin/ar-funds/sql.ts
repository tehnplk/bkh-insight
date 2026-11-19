// SQL ฝั่ง insight ที่ใช้ร่วมกันใน /api/admin/ar-funds/* (ผ่านการพิสูจน์แล้ว ~60 ms/เดือน)
import { hisQuery, insightQuery } from "@/lib/db";
import type { SqlValue } from "@/lib/column-filter-sql";
import { OPI_BY_DATE, inList } from "@/app/api/fund/_lib/fund";
import type { FundActivity, FundRule } from "./rules";
// แถวล่าสุดของแต่ละ VN (tran_id มากสุด) เหมือน /fund/claim-errors เฉพาะ REP UC (visit ที่ส่งใหม่เป็นสิทธิอื่นทีหลังจะหลุดไป)
export const REP_SQL = `SELECT r.seq_no AS vn, k.key, k.value AS amount
FROM rep_row r CROSS JOIN LATERAL jsonb_each_text(r.fund_amounts) k
WHERE r.scheme = 'UCS' AND r.patient_type = 'OP' AND r.seq_no IS NOT NULL AND r.admit_at >= $1::date AND r.admit_at < $2::date AND k.key = ANY($3)
  AND NOT EXISTS (SELECT 1 FROM rep_row n WHERE n.seq_no = r.seq_no AND n.patient_type = 'OP' AND n.tran_id::bigint > r.tran_id::bigint)`;


// รายการ paidst 02 ของกองทุน (ITEMS_SQL) และยอดทั้ง visit (TOTALS_SQL) ใช้ทั้ง /api/admin/ar-funds/check และคอลัมน์กองทุนย่อย (fund/_lib/subfund.ts)
// opitemrece เป็น MyISAM: ตามวันที่ ≤ 1 เดือนด้วย FORCE INDEX (ix_vstdate) ~0.5–1 วินาที ; ตาม key บังคับ ix_vn/ix_an ชุดละ ≤ CHUNK ค่า ~0.1–0.4 วินาที
// กองทุนแปลงเป็น pttype IN (...) ในโค้ด (ห้าม JOIN pttype) ; ตรวจกับฐานจริงแล้ว (EXPLAIN range ix_vstdate / ref ix_vn, ix_an)
/** "range" = ผู้ป่วยนอกตามวันรับบริการ (params เริ่มด้วย start, end) ; vn/an = key IN (n ค่า แรกของ params) */
export type ItemScope = "range" | { col: "vn" | "an"; n: number };
const scopeSql = (s: ItemScope) =>
  s === "range"
    ? { key: "o.vn", from: OPI_BY_DATE, where: "o.vstdate BETWEEN ? AND ? AND o.vn IS NOT NULL" }
    : { key: `o.${s.col}`, from: `opitemrece o FORCE INDEX (ix_${s.col})`, where: inList(`o.${s.col}`, s.n) };
/** key คืนในชื่อ vn เสมอ (ผู้ป่วยในคือ AN) */
export function ITEMS_SQL(s: ItemScope, pt: number, inc: number, ic: number) {
  const { key, from, where } = scopeSql(s);
  return `SELECT ${key} AS vn, o.icode, o.income, o.pttype, SUM(o.sum_price) AS amount
FROM ${from}
WHERE ${where} AND o.paidst = '02' AND ${inList("o.pttype", pt)}
  AND (${[inc && inList("o.income", inc), ic && inList("o.icode", ic)].filter(Boolean).join(" OR ")})
GROUP BY ${key}, o.icode, o.income, o.pttype`;
}
export function TOTALS_SQL(s: ItemScope, pt: number) {
  const { key, from, where } = scopeSql(s);
  return `SELECT ${key} AS vn, o.pttype, SUM(o.sum_price) AS amount
FROM ${from}
WHERE ${where} AND o.paidst = '02' AND ${inList("o.pttype", pt)}
GROUP BY ${key}, o.pttype`;
}

export const CHUNK = 1000;
/** query ทีละชุด (IN ของ values ไม่เกิน CHUNK ค่า เป็น params แรก ตามด้วย tail) */
export async function byChunks<T>(values: string[], sql: (n: number) => string, tail: SqlValue[] = []): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    const batch = values.slice(i, i + CHUNK);
    out.push(...(await hisQuery<T>(sql(batch.length), [...batch, ...tail])));
  }
  return out;
}

const RULE_COLS = `code, name, match_mode, hipdata_codes, pttypes, incomes, icodes, icd10, icd_scope, required_icodes, rep_keys, account_op, account_ip,
  updated_by, to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at`;

/** กติกาทั้งหมดพร้อมกิจกรรมย่อย (เรียงตามรหัส / ลำดับที่เพิ่ม) */
export async function loadFundRules(): Promise<FundRule[]> {
  const [rules, acts] = await Promise.all([
    insightQuery<Omit<FundRule, "activities">>(`SELECT ${RULE_COLS} FROM ar_fund_rule ORDER BY code`),
    insightQuery<FundActivity>("SELECT id, rule_code, name, items_mode, incomes, icodes, icd10, icd_scope, active FROM ar_fund_activity ORDER BY rule_code, id"),
  ]);
  return rules.map((r) => ({ ...r, activities: acts.filter((a) => a.rule_code === r.code) }));
}

/** ชื่อรายการของ icode (ตรวจว่ามีใน HOSxP ด้วย) */
export async function itemNames(icodes: string[]): Promise<{ code: string; name: string }[]> {
  if (!icodes.length) return [];
  return hisQuery<{ code: string; name: string }>(
    `SELECT s.icode AS code, CONCAT_WS(' ', s.name, NULLIF(TRIM(s.strength), '')) AS name FROM s_drugitems s WHERE ${inList("s.icode", icodes.length)}`,
    icodes,
  );
}
