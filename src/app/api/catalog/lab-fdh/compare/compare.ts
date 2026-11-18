// เทียบ Lab Catalog จาก FDH (lab_catalog_fdh) กับรายการ Lab ของ HOSxP แบบ pure (ไม่มี import ทดสอบด้วย node ได้ตรง: compare.test.mjs)
// หนึ่งแถวผลลัพธ์ = หนึ่งปัญหาของหนึ่งรหัส (Lab Code = icode) ; catalog มีหลายสิทธิ์ต่อรหัส จึงรวมทุกสิทธิ์ต่อรหัสก่อนเทียบ

/** แถวจาก SQL ของ HOSxP (nondrugitems ทุกแถว + lab_items ที่ active) ; tmlt_n null = ไม่ผูก lab_items, 0 = ผูกแต่ไม่มี TMLT */
export type HisLab = {
  icode: string;
  name: string;
  istatus: string | null;
  income: string | null;
  price: number | null;
  nhso_adp_code: string | null;
  lab_items_codes: string | null;
  /** TMLT ของ lab_items คั่นด้วยจุลภาค (GROUP_CONCAT DISTINCT) */
  tmlt_codes: string | null;
  tmlt_n: number | null;
  /** รหัสกรมบัญชีกลางตาม lab_items_tmlt (มีเมื่อ TMLT ค่าเดียว) */
  sks_code: string | null;
  /** ราคาสิทธิกลุ่ม 1 (ข้าราชการ) OPD */
  price_ofc: number | null;
};
/** แถวของ lab_catalog_fdh (วันที่ "YYYY-MM-DD HH:MM[:SS]") */
export type CatRow = {
  lab_code: string;
  benefit_plan: string;
  cgd_code: string | null;
  name: string;
  price: number | null;
  tmlt_code: string | null;
  start_at: string | null;
  end_at: string | null;
};

// เรียงตามระดับ: error = เสี่ยงเคลมไม่ผ่าน, warn = ควรแก้, info = ข้อมูลไม่ครบหรือรายการค้าง
export const PROBLEMS = {
  not_in_catalog: { level: "error", label: "ไม่มีใน Lab Catalog", fix: "ขึ้นทะเบียน Lab Code นี้ใน Lab Catalog ของ FDH ก่อนส่งเคลม รายการ Lab ที่ไม่อยู่ใน catalog อาจถูกปฏิเสธ" },
  no_tmlt: { level: "error", label: "HOSxP ไม่มี TMLT", fix: "ใส่ TMLT Code ในรายการแล็บ (lab_items) ที่ผูกกับ icode นี้ ให้ตรงกับ Lab Catalog" },
  tmlt_mismatch: { level: "error", label: "TMLT ไม่ตรง", fix: "แก้ TMLT Code ของ lab_items ที่ผูกกับ icode นี้ให้เหลือค่าเดียวที่ตรงกับ Lab Catalog" },
  not_in_hosxp: { level: "warn", label: "ไม่มีใน HOSxP", fix: "ตรวจ Lab Code ใน Lab Catalog ของ FDH ว่าตรงกับ icode ของรายการใน HOSxP" },
  cgd_mismatch: { level: "warn", label: "รหัสกรมบัญชีกลางไม่ตรง", fix: "แก้รหัส ADP (nhso_adp_code) ของรายการใน HOSxP ให้ตรงรหัสกรมบัญชีกลางใน Lab Catalog" },
  over_price: { level: "warn", label: "ราคาข้าราชการเกินราคากลาง", fix: "ลดราคาเรียกเก็บกลุ่มข้าราชการ (ราคาตามสิทธิกลุ่ม 1) ให้ไม่เกินราคากลาง ส่วนเกินเบิกไม่ได้" },
  plan_gap: { level: "warn", label: "ไม่ครบทุกสิทธิประโยชน์", fix: "ขึ้นทะเบียน Lab Code นี้ในสิทธิประโยชน์ที่ขาดใน FDH" },
  inactive: { level: "info", label: "ยกเลิกใน HOSxP แล้ว", fix: "ถ้าไม่ใช้รายการนี้แล้ว ให้ยกเลิกใน Lab Catalog ของ FDH" },
  catalog_incomplete: { level: "info", label: "Lab Catalog ข้อมูลไม่ครบ", fix: "เติมข้อมูลที่ขาดใน Lab Catalog ของ FDH" },
} as const;
export type Problem = keyof typeof PROBLEMS;
export type Level = (typeof PROBLEMS)[Problem]["level"];

export type CompareRow = {
  key: string;
  code: string;
  /** ชื่อใน HOSxP (ไม่มีใช้ชื่อใน catalog) */
  name: string;
  /** สิทธิประโยชน์ที่มีรหัสนี้ใน catalog (มีผลวันนี้) */
  plans: string | null;
  problem: Problem;
  level: Level;
  detail: string;
  tmlt_his: string | null;
  tmlt_cat: string | null;
  cgd_his: string | null;
  cgd_cat: string | null;
  /** ราคากลางสูงสุดของรหัส (บาท) ; null = ไม่มีราคา */
  cat_price: number | null;
  /** ราคาข้าราชการ OPD ของ HOSxP (ไม่มีใช้ราคาขาย) */
  ofc_price: number | null;
};

export const normCode = (c: string | null | undefined) => (c ?? "").trim().toUpperCase();
/** TMLT ที่ไฟล์ใช้แทนรายการที่ไม่มีรหัสเฉพาะ (Second trimester quad maternal screen panel ราคา 0) */
export const TMLT_PLACEHOLDER = "390013";
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uniq = (xs: (string | null)[]) => [...new Set(xs.map(normCode).filter(Boolean))].sort();
const list = (xs: string[]) => (xs.length ? xs.join(", ") : null);

/** แถวที่มีผลวันนี้: เริ่ม ≤ วันนี้ และ (ไม่มีวันสิ้นสุด หรือสิ้นสุด ≥ วันนี้) ; ปี 9999 = ไม่สิ้นสุด */
export const isLive = (r: CatRow, today: string) => (!r.start_at || r.start_at.slice(0, 10) <= today) && (!r.end_at || r.end_at.slice(0, 10) >= today);
/** รายการ Lab ที่ใช้งานใน HOSxP: active และ (หมวดรายได้ 07 หรือผูก lab_items) */
export const isLabItem = (h: HisLab) => h.istatus === "Y" && (h.income === "07" || h.tmlt_n != null);

export function compareLab(his: HisLab[], cat: CatRow[], today: string): CompareRow[] {
  const allPlans = uniq(cat.map((r) => r.benefit_plan));
  const catAll = new Map<string, CatRow[]>();
  for (const r of cat) catAll.set(normCode(r.lab_code), [...(catAll.get(normCode(r.lab_code)) ?? []), r]);
  const hisBy = new Map(his.map((h) => [normCode(h.icode), h]));
  const codes = [...new Set([...catAll.keys(), ...his.filter(isLabItem).map((h) => normCode(h.icode))])].sort();

  const out: CompareRow[] = [];
  for (const code of codes) {
    const h = hisBy.get(code);
    const all = catAll.get(code) ?? [];
    const live = all.filter((r) => isLive(r, today));
    const plans = uniq(live.map((r) => r.benefit_plan));
    const tmltCat = uniq(live.map((r) => r.tmlt_code));
    const cgdCat = uniq(live.map((r) => r.cgd_code));
    const prices = live.map((r) => r.price).filter((p): p is number => p != null && p > 0);
    // รหัสเดียวมีหลายรหัสกรมบัญชีกลาง (คนละราคา) ใช้สูงสุด = เกินทุกราคา
    const catPrice = prices.length ? Math.max(...prices) : null;
    const tmltHis = uniq((h?.tmlt_codes ?? "").split(","));
    const cgdHis = normCode(h?.nhso_adp_code) || null;
    const ofcPrice = h ? (h.price_ofc ?? h.price) : null;
    const add = (problem: Problem, detail = "") =>
      out.push({
        key: `${code}:${problem}`, code, name: h?.name || all[0]?.name || "", plans: list(plans), problem, level: PROBLEMS[problem].level, detail,
        tmlt_his: list(tmltHis), tmlt_cat: list(tmltCat), cgd_his: cgdHis, cgd_cat: list(cgdCat), cat_price: catPrice, ofc_price: ofcPrice,
      });

    if (!live.length) {
      // แถวหมดอายุของรหัสที่ HOSxP ไม่ได้ใช้เป็น Lab แล้ว ไม่ต้องแจ้ง
      if (h && isLabItem(h)) add("not_in_catalog", all.length ? "catalog มีรหัสนี้แต่ไม่มีแถวที่มีผลวันนี้" : h.tmlt_n == null ? "ไม่ผูก lab_items" : "");
      continue;
    }
    if (!h) {
      add("not_in_hosxp");
      continue;
    }
    if (h.istatus !== "Y") {
      add("inactive");
      continue;
    }

    const missingPlans = allPlans.filter((p) => !plans.includes(p));
    if (missingPlans.length) add("plan_gap", `ไม่มีใน ${missingPlans.join(", ")}`);

    if (tmltCat.length) {
      if (!tmltHis.length) add("no_tmlt", h.tmlt_n == null ? "icode นี้ไม่ผูก lab_items" : `lab_items ${h.lab_items_codes ?? ""} ไม่มี TMLT`.trim());
      else if (tmltHis.length > 1) add("tmlt_mismatch", `HOSxP มี ${tmltHis.length} TMLT ใน lab_items ของ icode เดียว`);
      else if (!tmltCat.includes(tmltHis[0])) add("tmlt_mismatch");
    }

    if (cgdCat.length && (!cgdHis || !cgdCat.includes(cgdHis))) {
      const sks = normCode(h.sks_code);
      add("cgd_mismatch", [cgdHis ? "" : "HOSxP ไม่มีรหัส ADP", sks && sks !== cgdHis ? `TMLT ของ HOSxP ระบุรหัส ${sks}` : ""].filter(Boolean).join(" ; "));
    }

    if (catPrice != null && ofcPrice != null && ofcPrice > catPrice) add("over_price", `${money(ofcPrice)} เกินราคากลาง ${money(catPrice)}`);

    const gaps = [
      cgdCat.length ? "" : "ไม่มีรหัสกรมบัญชีกลาง",
      catPrice == null ? "ไม่มีราคากลาง" : "",
      !tmltCat.length ? "ไม่มี TMLT" : tmltCat.includes(TMLT_PLACEHOLDER) ? `TMLT ${TMLT_PLACEHOLDER}` : "",
    ].filter(Boolean);
    if (gaps.length) add("catalog_incomplete", gaps.join(", "));
  }
  return out;
}
