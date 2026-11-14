// แยกกองทุนย่อยตามกติกาใน ar_fund_rule (+ กิจกรรมย่อย ar_fund_activity) แล้วเทียบกับยอด REP แบบ pure (ไม่มี import) ทดสอบด้วย node ได้ตรง (rules.test.mjs)
// ยอดเก็บเป็นสตางค์ระหว่างคำนวณ ไม่ให้ทศนิยม float เพี้ยน

export type MatchMode = "items" | "rights" | "icd";
export type IcdScope = "any" | "pdx";

export type FundActivity = {
  id: string;
  rule_code: string;
  name: string;
  items_mode: "any" | "all";
  incomes: string[];
  icodes: string[];
  icd10: string[];
  icd_scope: IcdScope;
  active: boolean;
};

export type FundRule = {
  code: string;
  name: string;
  match_mode: MatchMode;
  hipdata_codes: string[];
  /** กรองรหัสสิทธิ (ว่าง = ทุกสิทธิในกองทุนหลัก) */
  pttypes: string[];
  incomes: string[];
  icodes: string[];
  icd10: string[];
  icd_scope: IcdScope;
  required_icodes: string[];
  rep_keys: string[];
  account_op: string | null;
  account_ip: string | null;
  updated_by: string | null;
  updated_at: string;
  activities: FundActivity[];
};

/** รายการ paidst = '02' รวมต่อ (vn, icode) ; fund = กองทุนของ pttype ของรายการ */
export type ItemRow = { vn: string; icode: string; income: string | null; pttype: string | null; fund: string; amount: string | number };
/** ยอดรายการ paidst 02 ทั้ง visit ต่อสิทธิ (ใช้กับ match_mode rights/icd) */
export type VisitTotal = { vn: string; pttype: string | null; fund: string; amount: string | number };
/** สิทธิของ visit จาก HOSxP (ovst) ใช้บอกเหตุผลของราย REP จ่ายแต่ไม่เข้าเกณฑ์ ; ไม่มีใน map = ไม่พบ visit */
export type VisitInfo = { pttype: string | null; fund: string };
export type Diag = { icd10: string; pdx: boolean };
export type RepRow = { vn: string; key: string; amount: string | number };
export type CheckCase = { vn: string; his: number; rep: number; reason?: string };
export type ItemStat = { icode: string; vns: number; paid: number };
export type RuleCheck = {
  code: string;
  /** false = ยังไม่มีเงื่อนไข ฝั่ง HOSxP จึงไม่นับ */
  ready: boolean;
  his: { vns: number; amount: number };
  rep: { vns: number; amount: number };
  both: number;
  /** เข้าเกณฑ์ใน HOSxP แต่ REP ไม่จ่ายกองทุนนี้ */
  hisOnly: { vns: number; amount: number; cases: CheckCase[] };
  /** REP จ่ายกองทุนนี้แต่ visit ไม่เข้าเกณฑ์ พร้อมเหตุผล */
  repOnly: { vns: number; amount: number; cases: CheckCase[] };
  /** visit ที่เข้าเกณฑ์แต่ขาดรายการจำเป็น */
  missingRequired: { vns: number; cases: { vn: string; missing: string[] }[] };
  /** อัตราได้รับเงินรายรายการ (เฉพาะ match_mode items) */
  itemStats: ItemStat[];
  /** visit ที่ผ่านแต่ละกิจกรรม (ชื่อกิจกรรม -> จำนวน visit) */
  activityVns: Record<string, number>;
};

export const CASE_LIMIT = 200;
export const REASON = {
  noVisit: "ไม่พบ visit ใน HOSxP",
  rights: "สิทธิไม่อยู่ในเงื่อนไข",
  noItems: "ไม่มีรายการที่ตั้งค่า",
  icd: "รหัสโรคไม่ตรง",
  activity: "ไม่ผ่านกิจกรรมใด",
  noAmount: "ไม่มียอดลูกหนี้สิทธิ",
} as const;

/** เดือน YYYY-MM ตั้งแต่ 2024-10 (REP เดือนแรก) ถึงเดือนของ today -> วันแรก วันสุดท้าย และวันแรกของเดือนถัดไป ; ผิดคืน null */
export function monthBounds(month: string, today: string): { start: string; end: string; next: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < "2024-10" || month > today.slice(0, 7)) return null;
  const [y, m] = month.split("-").map(Number);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: `${month}-01`, end: iso(new Date(Date.UTC(y, m, 0))), next: iso(new Date(Date.UTC(y, m, 1))) };
}
const cents = (v: string | number) => Math.round(Number(v) * 100);
const activeActs = (r: Pick<FundRule, "activities">) => r.activities.filter((a) => a.active);
/** กติกามีเงื่อนไขพอจะนับฝั่ง HOSxP ได้ */
export const ruleReady = (r: Pick<FundRule, "match_mode" | "incomes" | "icodes" | "icd10" | "activities">) =>
  r.match_mode === "rights" || (r.match_mode === "icd" ? r.icd10.length > 0 : r.incomes.length > 0 || r.icodes.length > 0 || activeActs(r).length > 0);

/** ข้อความรายการรหัสจากผู้ใช้ (คั่นด้วยช่องว่าง , หรือขึ้นบรรทัด) -> รายการไม่ซ้ำ ตัวพิมพ์ใหญ่ ; รหัสผิดรูปแบบคืน invalid */
export function parseCodeList(raw: unknown, re: RegExp): string[] | { invalid: string } {
  if (raw == null || raw === "") return [];
  if (typeof raw !== "string" && !Array.isArray(raw)) return { invalid: String(raw) };
  const list = (Array.isArray(raw) ? raw.map(String) : raw.split(/[\s,]+/)).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const bad = list.find((s) => !re.test(s));
  return bad ? { invalid: bad } : [...new Set(list)];
}
/** รหัสเดี่ยว A00 หรือ A00.1 หรือช่วง A00-B99 / C50.1-C50.9 */
export const ICD_PATTERN = /^[A-Z]\d{0,2}(\.?\d{0,2}[A-Z0-9]?)?(-[A-Z]\d{0,2}(\.?\d{0,2}[A-Z0-9]?)?)?$/;

/** icd ตรงกับรายการรหัส: รหัสเดี่ยว = ขึ้นต้นด้วย ; ช่วง = เทียบตามความยาวของรหัสที่ใส่ (C00-C96 นับ C000–C969) จุดไม่มีผล */
export function icdMatch(icd: string, patterns: string[]): boolean {
  const code = icd.replace(/\./g, "").toUpperCase();
  return patterns.some((p) => {
    const [a, b] = p.replace(/\./g, "").toUpperCase().split("-");
    if (!b) return code.startsWith(a);
    const n = Math.max(a.length, b.length);
    const c = code.slice(0, n);
    return c >= a.padEnd(n, "0").slice(0, n) && c <= b.padEnd(n, "9").slice(0, n);
  });
}
const dxPass = (diags: Diag[] | undefined, patterns: string[], scope: IcdScope) =>
  !patterns.length || (diags ?? []).some((d) => (scope === "any" || d.pdx) && icdMatch(d.icd10, patterns));

/**
 * เทียบทุกกติกา
 * - items: รายการที่ตรงหมวดรายรับ/icode (หรือผ่านกิจกรรมย่อยใดกิจกรรมหนึ่ง) ; rights/icd: ทุก visit ใน totals ที่สิทธิ (และรหัสโรค) ตรง
 * - visits: สิทธิของ visit ที่ REP จ่าย (เหตุผลของราย REP จ่ายแต่ไม่เข้าเกณฑ์)
 */
export function checkRules(
  rules: FundRule[],
  items: ItemRow[],
  diags: Map<string, Diag[]>,
  rep: RepRow[],
  totals: VisitTotal[] = [],
  visits: Map<string, VisitInfo> = new Map(),
): RuleCheck[] {
  const itemsByVn = new Map<string, ItemRow[]>();
  for (const it of items) itemsByVn.set(it.vn, [...(itemsByVn.get(it.vn) ?? []), it]);

  return rules.map((rule) => {
    const ready = ruleReady(rule);
    const funds = new Set(rule.hipdata_codes);
    const pts = new Set(rule.pttypes);
    const rightsOk = (fund: string, pttype: string | null) => funds.has(fund) && (!pts.size || pts.has(pttype ?? ""));
    const keys = new Set(rule.rep_keys);
    const acts = activeActs(rule);
    const ruleDx = (vn: string) => dxPass(diags.get(vn), rule.icd10, rule.icd_scope);
    const activityVns: Record<string, number> = {};
    /** สตางค์ต่อ vn และ icode ที่ทำให้เข้าเกณฑ์ (ใช้ทำอัตราได้รับรายรายการ) */
    const his = new Map<string, number>();
    const hisItems = new Map<string, Set<string>>();

    if (ready && rule.match_mode === "items") {
      for (const [vn, list] of itemsByVn) {
        const own = list.filter((it) => rightsOk(it.fund, it.pttype));
        if (!own.length || !ruleDx(vn)) continue;
        let picked: ItemRow[];
        if (acts.length) {
          const chosen = new Map<string, ItemRow>();
          for (const a of acts) {
            const inc = new Set(a.incomes);
            const ics = new Set(a.icodes);
            const hits = own.filter((it) => inc.has(it.income ?? "") || ics.has(it.icode));
            const pass =
              hits.length > 0 &&
              (a.items_mode === "any" || (a.icodes.every((c) => hits.some((h) => h.icode === c)) && a.incomes.every((c) => hits.some((h) => h.income === c)))) &&
              dxPass(diags.get(vn), a.icd10, a.icd_scope);
            if (!pass) continue;
            activityVns[a.name] = (activityVns[a.name] ?? 0) + 1;
            for (const h of hits) chosen.set(h.icode, h);
          }
          picked = [...chosen.values()];
        } else {
          const inc = new Set(rule.incomes);
          const ics = new Set(rule.icodes);
          picked = own.filter((it) => inc.has(it.income ?? "") || ics.has(it.icode));
        }
        if (!picked.length) continue;
        his.set(vn, picked.reduce((s, it) => s + cents(it.amount), 0));
        hisItems.set(vn, new Set(picked.map((it) => it.icode)));
      }
    } else if (ready) {
      for (const t of totals)
        if (rightsOk(t.fund, t.pttype) && cents(t.amount) > 0 && ruleDx(t.vn))
          his.set(t.vn, (his.get(t.vn) ?? 0) + cents(t.amount));
    }

    const paid = new Map<string, number>();
    for (const r of rep) if (keys.has(r.key)) paid.set(r.vn, (paid.get(r.vn) ?? 0) + cents(r.amount));

    const reasonOf = (vn: string): string => {
      const v = visits.get(vn);
      if (!v) return REASON.noVisit;
      if (!rightsOk(v.fund, v.pttype)) return REASON.rights;
      if (rule.match_mode !== "items") return rule.match_mode === "icd" || rule.icd10.length ? REASON.icd : REASON.noAmount;
      const own = (itemsByVn.get(vn) ?? []).filter((it) => rightsOk(it.fund, it.pttype));
      const inc = new Set([...rule.incomes, ...acts.flatMap((a) => a.incomes)]);
      const ics = new Set([...rule.icodes, ...acts.flatMap((a) => a.icodes)]);
      if (!own.some((it) => inc.has(it.income ?? "") || ics.has(it.icode))) return REASON.noItems;
      if (!ruleDx(vn)) return REASON.icd;
      return acts.length ? REASON.activity : REASON.noItems;
    };
    const side = (from: Map<string, number>, other: Map<string, number>, withReason: boolean) => {
      const cases: CheckCase[] = [...from].filter(([vn]) => !other.has(vn)).map(([vn]) => ({
        vn, his: (his.get(vn) ?? 0) / 100, rep: (paid.get(vn) ?? 0) / 100, ...(withReason && ready ? { reason: reasonOf(vn) } : {}),
      }));
      const amount = cases.reduce((s, c) => s + Math.round((c.his + c.rep) * 100), 0) / 100;
      cases.sort((a, b) => b.his + b.rep - (a.his + a.rep) || a.vn.localeCompare(b.vn));
      return { vns: cases.length, amount, cases: cases.slice(0, CASE_LIMIT) };
    };
    const total = (m: Map<string, number>) => ({ vns: m.size, amount: [...m.values()].reduce((s, c) => s + c, 0) / 100 });

    const req = rule.required_icodes;
    const missing = req.length
      ? [...his.keys()].map((vn) => ({ vn, missing: req.filter((c) => !(itemsByVn.get(vn) ?? []).some((it) => it.icode === c)) })).filter((x) => x.missing.length)
      : [];
    const stats = new Map<string, ItemStat>();
    for (const [vn, set] of hisItems)
      for (const icode of set) {
        const s = stats.get(icode) ?? { icode, vns: 0, paid: 0 };
        s.vns++;
        if (paid.has(vn)) s.paid++;
        stats.set(icode, s);
      }

    return {
      code: rule.code,
      ready,
      his: total(his),
      rep: total(paid),
      both: [...his.keys()].filter((vn) => paid.has(vn)).length,
      hisOnly: side(his, paid, false),
      repOnly: side(paid, his, true),
      missingRequired: { vns: missing.length, cases: missing.slice(0, CASE_LIMIT) },
      itemStats: [...stats.values()].sort((a, b) => b.vns - a.vns || a.icode.localeCompare(b.icode)),
      activityVns,
    };
  });
}
