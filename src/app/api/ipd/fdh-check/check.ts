// ตรวจ C ใน modal 16 แฟ้ม (/ipd/admissions) แบบ pure: ชนิดข้อมูลและการตรวจแฟ้ม DRU กับ Drug Catalog ที่ สปสช. อนุมัติ
// ไม่มี import ค่า จึงใช้ได้ทั้ง route, หน้า และ check.test.mjs

/** แฟ้มที่มีกฎ: IPD/PAT/INS ใช้กฎ SQL ของหน้าตรวจ C (skill fdh-pre-validate) ส่วน DRU เทียบ Drug Catalog */
export const CHECK_FILES = ["IPD", "PAT", "INS", "DRU"] as const;
export type CheckFile = (typeof CHECK_FILES)[number];
export const isCheckFile = (f: string): f is CheckFile => (CHECK_FILES as readonly string[]).includes(f);

/** รหัส C ของ Drug Catalog ที่ตรวจได้จากข้อมูลที่มี (C564 ED/NED ตรวจไม่ได้ เพราะแฟ้ม DRU ไม่มี ISED) */
export const DRUG_CATALOG_CODES = ["562", "573", "195", "574"] as const;

/** แถวของแฟ้ม DRU สำหรับตรวจ (ลำดับเดียวกับแฟ้ม) icode = HOSPDRUGCODE */
export type DruCheckRow = { icode: string; price: number | string | null; date_serv: string | null };
/** หนึ่งแถวของ drug_catalog_nhso (ประวัติราคาตามวันที่มีผล) */
export type CatalogVersion = {
  code: string;
  unit_price: number | string | null;
  date_effective: string | null;
  date_approved: string | null;
  line_no: number;
  product_cat: string | null;
};

/** ผลต่อรายการ: row = ลำดับแถวในแฟ้ม (DRU) หรือ an/hn/seq (กฎ SQL) */
export type CheckFinding = { row?: number; an?: string | null; hn?: string | null; seq?: string | null; codes: string[]; found?: string };
export type CheckResult = {
  file: string;
  /** รหัสที่ตรวจในแฟ้มนี้ ว่าง = แฟ้มนี้ยังไม่มีกฎ */
  rules: string[];
  findings: CheckFinding[];
  /** คำอธิบายรหัส C จาก rep_error_code */
  info: Record<string, string>;
  note?: string;
  truncated?: boolean;
};

const money = (v: number | string | null) => (v == null || v === "" ? null : Math.round(Number(v) * 100) / 100);
const fmt = (n: number) => n.toFixed(2);

/**
 * ตรวจแต่ละแถวของ DRU กับ Drug Catalog:
 * C562 ไม่พบรหัสใน catalog ; C573 วันที่จ่ายยาก่อนวันที่มีผลแรกสุดของรหัสนั้น ;
 * C195 ราคาเบิกไม่เท่าราคาใน catalog ณ วันที่จ่าย (ฉบับที่ DATEEFFECTIVE ล่าสุดที่ไม่เกินวันที่จ่าย) ; C574 PRODUCTCAT ของฉบับนั้นไม่ใช่ 1–5
 */
export function checkDru(rows: DruCheckRow[], versions: CatalogVersion[]): CheckFinding[] {
  const byCode = new Map<string, CatalogVersion[]>();
  for (const v of versions) {
    let list = byCode.get(v.code);
    if (!list) byCode.set(v.code, (list = []));
    list.push(v);
  }
  // เก่าไปใหม่: วันที่มีผล แล้ววันที่อนุมัติ แล้วแถวในไฟล์ (ตรงกับลำดับที่หน้าตั้งค่ารหัสมาตรฐานใช้เลือกฉบับล่าสุด)
  const key = (v: CatalogVersion) => `${v.date_effective ?? ""}|${v.date_approved ?? ""}|${String(v.line_no).padStart(9, "0")}`;
  for (const list of byCode.values()) list.sort((a, b) => key(a).localeCompare(key(b)));

  const out: CheckFinding[] = [];
  rows.forEach((r, row) => {
    const list = byCode.get(r.icode);
    if (!list?.length) return void out.push({ row, codes: ["562"], found: `icode ${r.icode} ไม่มีใน Drug Catalog` });
    const day = r.date_serv?.slice(0, 10) ?? "";
    const effective = list.filter((v) => v.date_effective && v.date_effective.slice(0, 10) <= day).at(-1);
    if (!effective) return void out.push({ row, codes: ["573"], found: `จ่าย ${day} ก่อน DATEEFFECTIVE ${list[0].date_effective?.slice(0, 10) ?? "–"}` });
    const codes: string[] = [];
    const notes: string[] = [];
    const price = money(r.price);
    const cat = money(effective.unit_price);
    if (price != null && cat != null && price !== cat) {
      codes.push("195");
      notes.push(`ราคาเบิก ${fmt(price)} / catalog ${fmt(cat)}`);
    }
    if (!/^[1-5]$/.test(effective.product_cat ?? "")) {
      codes.push("574");
      notes.push(`PRODUCTCAT ${effective.product_cat ?? "ว่าง"}`);
    }
    if (codes.length) out.push({ row, codes, found: notes.join(" · ") });
  });
  return out;
}
