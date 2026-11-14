// SQL ฝั่ง insight ที่ใช้ร่วมกันใน /api/admin/ar-funds/* (ผ่านการพิสูจน์แล้ว ~60 ms/เดือน)
import { hisQuery, insightQuery } from "@/lib/db";
import { inList } from "@/app/api/fund/_lib/fund";
import type { FundActivity, FundRule } from "./rules";
// แถวล่าสุดของแต่ละ VN (tran_id มากสุด) เหมือน /fund/claim-errors
export const REP_SQL = `SELECT r.seq_no AS vn, k.key, k.value AS amount
FROM rep_row r CROSS JOIN LATERAL jsonb_each_text(r.fund_amounts) k
WHERE r.patient_type = 'OP' AND r.seq_no IS NOT NULL AND r.admit_at >= $1::date AND r.admit_at < $2::date AND k.key = ANY($3)
  AND NOT EXISTS (SELECT 1 FROM rep_row n WHERE n.seq_no = r.seq_no AND n.patient_type = 'OP' AND n.tran_id::bigint > r.tran_id::bigint)`;


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
