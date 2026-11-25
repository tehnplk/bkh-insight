// คอลัมน์ "กองทุนย่อย" ของ /opd/admissions และ /ipd/admissions: แถวไหนเข้าเกณฑ์กองทุนย่อยใด (กติกาเดียวกับ /admin/ar-funds)
// แล้วเทียบกับ REP ล่าสุดของแถว ; logic pure อยู่ใน admin/ar-funds/rules.ts (classifyVisits, repPay)
import { hisQuery, insightQuery } from "@/lib/db";
import { formatBaht } from "@/lib/number-format";
import { fundOf, inList, type Lookups } from "./fund";
import { CHUNK, ITEMS_SQL, TOTALS_SQL, byChunks, itemNames, loadFundRules, withAdpIcodes, type ItemScope } from "@/app/api/admin/ar-funds/sql";
import {
  REP_PAY_LABEL, classifyVisits, repPay, ruleReady, ruleSide,
  type Diag, type FundRule, type ItemRow, type SubFund, type SubFundSide, type VisitTotal,
} from "@/app/api/admin/ar-funds/rules";

// fund_amounts ของ REP ล่าสุด (tran_id มากสุด ไม่กรอง scheme เหมือน latestRepSql) ใช้ rep_row_seq_no_idx / rep_row_an_idx ~7 ms ต่อ 1,000 key
const REP_FUNDS_SQL: Record<SubFundSide, string> = {
  OP: `SELECT DISTINCT ON (r.seq_no) r.seq_no AS k, r.fund_amounts FROM rep_row r
WHERE r.patient_type = 'OP' AND r.seq_no = ANY($1::text[]) ORDER BY r.seq_no, r.tran_id::bigint DESC`,
  IP: `SELECT DISTINCT ON (r.an) r.an AS k, r.fund_amounts FROM rep_row r
WHERE r.patient_type = 'IP' AND r.an = ANY($1::text[]) ORDER BY r.an, r.tran_id::bigint DESC`,
};
// วินิจฉัย: OP ovstdiag (index vn / vstdate), IP iptdiag (ix_an) pdx = diagtype 1
const DIAG_SQL = {
  OP: (n: number) => `SELECT vn, icd10, diagtype FROM ovstdiag WHERE ${inList("vn", n)}`,
  OP_RANGE: "SELECT vn, icd10, diagtype FROM ovstdiag WHERE vstdate BETWEEN ? AND ?",
  IP: (n: number) => `SELECT an AS vn, icd10, diagtype FROM iptdiag WHERE ${inList("an", n)}`,
};

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/**
 * กองทุนย่อยต่อ key (OP = VN, IP = AN) จากกติกาที่ตั้งเงื่อนไขแล้ว (ruleReady) และใช้กับฝั่งนี้ (ruleSide) ; ไม่เข้าเกณฑ์ = ไม่มีใน map
 * range: ช่วงวันรับบริการของ OP ทุก key ต้องอยู่ในช่วงนี้ เมื่อ key เกิน CHUNK อ่าน opitemrece ตามวันครั้งเดียวแทนหลายชุด
 * IP อ่านตาม AN เสมอ (ห้ามสแกน opitemrece ตามวันของผู้ป่วยใน) ; names = เติมชื่อรายการ (ใช้แสดงผล ตัวกรองไม่ต้องใช้) ; codes = เฉพาะกติกาเหล่านี้
 */
export async function loadSubfunds(
  side: SubFundSide,
  keys: string[],
  lk: Lookups,
  opts: { range?: { start: string; end: string }; names?: boolean; codes?: string[] } = {},
): Promise<Map<string, SubFund[]>> {
  if (!keys.length) return new Map();
  const rules = await withAdpIcodes((await loadFundRules()).filter((r) => ruleReady(r) && ruleSide(r, side) && (!opts.codes || opts.codes.includes(r.code))));
  if (!rules.length) return new Map();
  const ptOf = (rs: FundRule[]) => {
    const funds = new Set(rs.flatMap((r) => r.hipdata_codes));
    return [...lk.pttype].filter(([, p]) => funds.has(p.fund)).map(([c]) => c);
  };
  const acts = (r: FundRule) => r.activities.filter((a) => a.active);
  const itemRules = rules.filter((r) => r.match_mode === "items");
  const totalRules = rules.filter((r) => r.match_mode !== "items");
  const itemPts = ptOf(itemRules);
  const totalPts = ptOf(totalRules);
  const incomes = uniq(itemRules.flatMap((r) => [...r.incomes, ...acts(r).flatMap((a) => a.incomes)]));
  const icodes = uniq(itemRules.flatMap((r) => [...r.icodes, ...r.required_icodes, ...acts(r).flatMap((a) => a.icodes)]));

  const range = side === "OP" && keys.length > CHUNK ? opts.range : undefined;
  const wanted = new Set(keys);
  const col = side === "OP" ? "vn" : "an";
  const run = async <T extends { vn: string }>(sql: (s: ItemScope) => string, tail: string[]) =>
    range
      ? (await hisQuery<T>(sql("range"), [range.start, range.end, ...tail])).filter((r) => wanted.has(r.vn))
      : byChunks<T>(keys, (n) => sql({ col, n }), tail);
  const [rawItems, rawTotals] = await Promise.all([
    itemPts.length && (incomes.length || icodes.length)
      ? run<Omit<ItemRow, "fund">>((s) => ITEMS_SQL(s, itemPts.length, incomes.length, icodes.length), [...itemPts, ...incomes, ...icodes])
      : [],
    totalPts.length ? run<Omit<VisitTotal, "fund">>((s) => TOTALS_SQL(s, totalPts.length), totalPts) : [],
  ]);
  const items: ItemRow[] = rawItems.map((r) => ({ ...r, fund: fundOf(lk, r.pttype) }));
  const totals: VisitTotal[] = rawTotals.map((r) => ({ ...r, fund: fundOf(lk, r.pttype) }));

  // วินิจฉัยเฉพาะเมื่อมีกติกาที่ใช้รหัสโรค และเฉพาะ key ที่มีรายการ/ยอด
  const diags = new Map<string, Diag[]>();
  if (rules.some((r) => r.icd10.length || acts(r).some((a) => a.icd10.length))) {
    const has = uniq([...items.map((i) => i.vn), ...totals.map((t) => t.vn)]);
    type D = { vn: string; icd10: string; diagtype: string | null };
    const rows = !has.length
      ? []
      : range
        ? await hisQuery<D>(DIAG_SQL.OP_RANGE, [range.start, range.end])
        : await byChunks<D>(has, DIAG_SQL[side]);
    const hasSet = new Set(has);
    for (const d of rows)
      if (hasSet.has(d.vn) && d.icd10) diags.set(d.vn, [...(diags.get(d.vn) ?? []), { icd10: d.icd10.toUpperCase(), pdx: d.diagtype?.trim() === "1" }]);
  }

  const funds = classifyVisits(rules, items, diags, totals);
  if (!funds.size) return funds;
  const reps = await insightQuery<{ k: string; fund_amounts: Record<string, unknown> | null }>(REP_FUNDS_SQL[side], [[...funds.keys()]]);
  const amountsOf = new Map(reps.map((r) => [r.k, r.fund_amounts]));
  const repKeys = new Map(rules.map((r) => [r.code, r.rep_keys]));
  const all = [...funds.values()].flat();
  for (const [k, list] of funds) for (const f of list) Object.assign(f, repPay(repKeys.get(f.code) ?? [], amountsOf.get(k)));

  if (opts.names) {
    const names = new Map((await itemNames(uniq(all.flatMap((f) => [...f.items, ...f.missing].map((i) => i.icode))))).map((n) => [n.code, n.name]));
    for (const f of all) for (const i of [...f.items, ...f.missing]) i.name = names.get(i.icode) ?? null;
  }
  return funds;
}

/** ข้อความในไฟล์ Excel เช่น "INST 1,200.00 (REP จ่าย), PP 50.00 (ยังไม่มี REP)" ; undefined (โหลดไม่ได้) = ว่าง */
export const subfundText = (list: SubFund[] | undefined) =>
  (list ?? []).map((f) => `${f.code} ${formatBaht(f.amount)} (${REP_PAY_LABEL[f.rep]})`).join(", ");
