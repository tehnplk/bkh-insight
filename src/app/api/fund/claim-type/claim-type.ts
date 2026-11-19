// แยกประเภทการเรียกเก็บของ visit ผู้ป่วยนอก (/fund/claim-type) แบบ pure
// import เฉพาะ type จึงใช้ได้ทั้ง route, หน้า (client) และ claim-type.test.mjs
import type { GridPage } from "@/lib/grid-query";
import type { ClaimInfo, ClaimStatusKey } from "@/app/api/fdh/claim-batch/claim";

/** ช่วงวันรับบริการยาวสุด: ไม่อ่าน opitemrece (JOIN ด้วย PK ทุกตัว) วัดแล้ว 90 วันราว 45,000 visit his ~4 วินาที insight ~1 วินาที */
export const MAX_DAYS = 90;
/** กองทุนบัตรทอง (pttype.hipdata_code) */
const UC_FUNDS = ["UCS", "WEL", "DIS"];

export type Destination = "FDH" | "e-Claim" | "อื่นๆ";
/** tracked = แสดงสถานะเคลม (กองทุนใน CLAIM_FUNDS ของ claim-batch/claim.ts ซึ่ง test ตรวจว่าตรงกัน) */
export type CategoryDef = { key: string; label: string; dest: Destination; tracked: boolean; note?: string };

// ลำดับ = ลำดับการ์ด ; key ตัวพิมพ์ใหญ่ = รหัสกองทุน (hipdata_code) กองทุนที่ไม่อยู่ในรายการรวมเป็น "other"
export const CATEGORIES = [
  { key: "ucs_cup", label: "UCS ใน CUP", dest: "FDH", tracked: true },
  { key: "ucs_prov", label: "UCS ในจังหวัด", dest: "FDH", tracked: true, note: "รวม VA (ยังไม่แยก)" },
  { key: "ucs_ae", label: "UCS ต่างจังหวัด AE", dest: "FDH", tracked: true },
  { key: "ucs_walkin", label: "UCS ต่างจังหวัด Walk-in", dest: "FDH", tracked: true },
  { key: "ucs_unknown", label: "UCS ไม่พบหน่วยบริการหลัก", dest: "FDH", tracked: true, note: "HCODE หลักว่างหรือไม่รู้จัก" },
  { key: "STP", label: "STP ผู้มีปัญหาทางสิทธิ", dest: "FDH", tracked: false },
  { key: "OFC", label: "OFC ข้าราชการ", dest: "e-Claim", tracked: true },
  { key: "LGO", label: "LGO อปท.", dest: "e-Claim", tracked: true },
  { key: "BKK", label: "BKK กทม.", dest: "e-Claim", tracked: true },
  { key: "BMT", label: "BMT ขสมก.", dest: "e-Claim", tracked: true },
  { key: "SSS", label: "SSS ประกันสังคม", dest: "อื่นๆ", tracked: false },
  { key: "SRT", label: "SRT การรถไฟ", dest: "อื่นๆ", tracked: false },
  { key: "INS", label: "พ.ร.บ.รถ", dest: "อื่นๆ", tracked: false },
  { key: "CSH", label: "ชำระเงิน", dest: "อื่นๆ", tracked: false },
  { key: "other", label: "สิทธิอื่น", dest: "อื่นๆ", tracked: false },
] as const satisfies readonly CategoryDef[];
export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export const CATEGORY_KEYS: readonly CategoryKey[] = CATEGORIES.map((c) => c.key);
const FUND_CATEGORY = new Set<string>(CATEGORIES.filter((c) => c.key === c.key.toUpperCase()).map((c) => c.key));

/** CUP จริง = ค่าเริ่มต้น (อำเภอเดียวกัน) ∪ include − exclude และรวมโรงพยาบาลเองเสมอ */
export function effectiveCup(defaults: string[], overrides: { hcode: string; mode: "include" | "exclude" }[], own: string): Set<string> {
  const cup = new Set(defaults);
  for (const o of overrides) {
    if (o.mode === "include") cup.add(o.hcode);
    else cup.delete(o.hcode);
  }
  return cup.add(own);
}

export type CupContext = { cup: ReadonlySet<string>; /** จังหวัดของโรงพยาบาล (hospcode.chwpart) */ chw: string };
export type VisitClass = {
  fund: string;
  /** visit_pttype.hospmain */
  hospmain: string | null;
  /** hospcode.chwpart ของ hospmain (null = ไม่พบใน hospcode) */
  hosp_chw: string | null;
  /** er_pt_type.ucae ของ visit ที่มาทาง ER (A อุบัติเหตุ, E ฉุกเฉิน) เหมือนช่อง UCAE ของแฟ้ม AER */
  ucae: string | null;
};

/** ประเภทการเรียกเก็บของ visit: UC แยกตามหน่วยบริการหลัก (CUP > จังหวัด > ต่างจังหวัด AE/Walk-in) สิทธิอื่นตามกองทุน */
export function categoryOf(v: VisitClass, ctx: CupContext): CategoryKey {
  if (!UC_FUNDS.includes(v.fund)) return FUND_CATEGORY.has(v.fund) ? (v.fund as CategoryKey) : "other";
  const hm = v.hospmain?.trim();
  if (!hm) return "ucs_unknown";
  if (ctx.cup.has(hm)) return "ucs_cup";
  if (!v.hosp_chw) return "ucs_unknown";
  if (v.hosp_chw === ctx.chw) return "ucs_prov";
  return v.ucae === "A" || v.ucae === "E" ? "ucs_ae" : "ucs_walkin";
}

/** กลุ่มสถานะเคลมบนการ์ด (ไม่ประสงค์เบิกและไม่มีสถานะไม่นับ) ; overdue นับใน unsent และแสดงแยก */
export const STATUS_GROUPS = [
  { key: "unsent", label: "ยังไม่ส่ง", statuses: ["unsent", "wait_close", "failed", "overdue"] },
  { key: "sent", label: "ส่งแล้ว", statuses: ["exported", "submitted", "nhso"] },
  { key: "rep_pass", label: "REP ผ่าน", statuses: ["rep_pass"] },
  { key: "rep_bad", label: "ติด C/Deny", statuses: ["rep_c", "rep_deny"] },
  { key: "paid", label: "ได้รับเงิน", statuses: ["paid"] },
] as const satisfies readonly { key: string; label: string; statuses: readonly ClaimStatusKey[] }[];
export type StatusGroup = (typeof STATUS_GROUPS)[number]["key"];

export type ClaimTypeRow = {
  vn: string;
  hn: string;
  patient_name: string;
  vstdate: string;
  pttype: string | null;
  pttype_name: string;
  fund: string;
  hospmain: string | null;
  hosp_name: string | null;
  /** ลูกหนี้สิทธิ (vn_stat.uc_money) */
  amount: number;
  cat: CategoryKey;
  claim?: ClaimInfo;
};

export type CategorySummary = { key: CategoryKey; visits: number; amount: number; overdue: number; counts: Record<StatusGroup, number> };
/** GET /api/fund/claim-type (ไม่ส่ง cat) */
export type ClaimTypeSummary = { cats: CategorySummary[]; cup_size: number; claim_error: boolean };
/** GET /api/fund/claim-type?cat= (DataGrid) */
export type ClaimTypePage = GridPage<ClaimTypeRow>;

const GROUP_OF = new Map<ClaimStatusKey, StatusGroup>(STATUS_GROUPS.flatMap((g) => g.statuses.map((s) => [s, g.key] as const)));

/** ยอดต่อการ์ดตามลำดับ CATEGORIES (การ์ดที่ไม่มี visit ได้ศูนย์) รวมเงินเป็นสตางค์กันเศษ float */
export function summarize(rows: Pick<ClaimTypeRow, "cat" | "amount" | "claim">[]): CategorySummary[] {
  const by = new Map(
    CATEGORY_KEYS.map((key) => [key, { key, visits: 0, satang: 0, overdue: 0, counts: { unsent: 0, sent: 0, rep_pass: 0, rep_bad: 0, paid: 0 } as Record<StatusGroup, number> }]),
  );
  for (const r of rows) {
    const s = by.get(r.cat)!;
    s.visits++;
    s.satang += Math.round(r.amount * 100);
    const g = r.claim && GROUP_OF.get(r.claim.status);
    if (g) s.counts[g]++;
    if (r.claim?.status === "overdue") s.overdue++;
  }
  return [...by.values()].map(({ satang, ...s }) => ({ ...s, amount: satang / 100 }));
}
