// เทียบรายการค่าบริการ HOSxP (nondrugitems istatus='Y') กับ Service catalog UC และอัตรากรมบัญชีกลาง (OFC) แบบ pure
// ทดสอบด้วย node ได้ตรง (compare.test.mjs) ; หนึ่งแถวผลลัพธ์ = หนึ่งปัญหาของหนึ่งรายการ (รายการเดียวมีหลายปัญหาได้)

/** แถวจาก SQL ของ HOSxP (ราคาเป็น number หรือ null) ; g1 = ข้าราชการ, g2 = UC ตาม pttype_items_price */
export type HisItem = {
  icode: string;
  name: string;
  unit: string | null;
  price: number | null;
  ipd_price: number | null;
  income: string | null;
  nhso_adp_type_id: number | null;
  nhso_adp_code: string | null;
  g1_opd: number | null;
  g1_ipd: number | null;
  g2_opd: number | null;
  g2_ipd: number | null;
};
/** แถว UC ทุกช่วงราคา (price null = ไม่มีอัตรา) วันที่ ISO */
export type UcRef = { code: string; name: string; price: number | null; start_date: string | null; end_date: string | null; fs_status: number | null; chrgitem_group: string | null };
export type OfcRef = { code: string; name: string | null; price: number | null };
/** หมวดค่ารักษา -> ADP TYPE ที่ใช้ได้ (null = ไม่มีในแฟ้ม ADP ไม่ตรวจ) */
export type GroupAdp = Map<string, number[] | null>;

export const PROBLEMS = {
  no_code: { label: "ไม่มีรหัส ADP", fix: "ใส่รหัส ADP (nhso_adp_code) ตาม Service catalog UC หรืออัตรากรมบัญชีกลาง ในรายการค่าบริการของ HOSxP" },
  unknown_code: { label: "รหัสไม่อยู่ใน UC และ OFC", fix: "ตรวจรหัสที่พิมพ์ ถ้ารหัสถูกยกเลิกให้เปลี่ยนเป็นรหัสที่ใช้ได้ปัจจุบัน" },
  not_fee_schedule: { label: "UC: ไม่อยู่ใน Fee Schedule", fix: "สปสช. ไม่จ่ายตามอัตรา ตรวจว่ามีรหัสใน Fee Schedule ที่ตรงกับบริการนี้หรือไม่" },
  not_standard: { label: "UC: ไม่อยู่ในรหัสมาตรฐาน", fix: "เปลี่ยนเป็นรหัสมาตรฐานที่ตรงกับบริการนี้" },
  over_ofc: { label: "ราคาข้าราชการเกินอัตรา OFC", fix: "ลดราคาเรียกเก็บกลุ่มข้าราชการ (ราคาตามสิทธิกลุ่ม 1) ให้ไม่เกินอัตรากรมบัญชีกลาง ส่วนเกินเบิกไม่ได้" },
  under_uc: { label: "ราคา UC ต่ำกว่าอัตรา สปสช.", fix: "ปรับราคาเรียกเก็บกลุ่ม UC (ราคาตามสิทธิกลุ่ม 2) ให้เท่าอัตรา สปสช. เพื่อไม่เสียรายได้" },
  adp_type: { label: "ประเภท ADP ไม่ตรงหมวดของ UC", fix: "แก้ประเภท ADP (nhso_adp_type_id) ของรายการให้ตรงหมวดค่ารักษาของรหัสใน UC" },
  shared_code: { label: "รหัสเดียวผูกหลายรายการ", fix: "ตรวจว่าทุกรายการเป็นบริการเดียวกัน ถ้าไม่ใช่ให้แก้รหัสของรายการที่ผิด" },
} as const;
export type Problem = keyof typeof PROBLEMS;

export type CompareRow = {
  key: string;
  icode: string;
  name: string;
  unit: string | null;
  adp_code: string | null;
  adp_type: number | null;
  problem: Problem;
  detail: string;
  /** อัตรา UC ที่มีผลวันนี้ (ต่ำสุดเมื่อรหัสมีหลายรายการ) ; null = ไม่มีอัตรา/ไม่อยู่ใน UC */
  uc_rate: number | null;
  /** อัตรา OFC (สูงสุดเมื่อรหัสซ้ำ) */
  ofc_rate: number | null;
  /** ราคาเรียกเก็บ ข้าราชการ/UC (OPD, IPD) */
  ofc_opd: number | null;
  ofc_ipd: number | null;
  uc_opd: number | null;
  uc_ipd: number | null;
};

/** รหัสเทียบแบบ UPPER + TRIM ; OFC เทียบแบบตัดเลข 0 นำหน้าด้วย */
export const normCode = (c: string | null | undefined) => (c ?? "").trim().toUpperCase();
const ofcKey = (c: string) => normCode(c).replace(/^0+(?=.)/, "");
/** รหัสชั่วคราวที่ใส่แทนรหัสจริง (XXXXXX) นับเป็นไม่มีรหัส และไม่นับเป็นรหัสที่ใช้ร่วมกัน */
const PLACEHOLDER = /^X+\d*$/;

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** แถว UC ที่มีผลวันนี้ของรหัสหนึ่ง: start ≤ วันนี้ และ (end ว่าง หรือ ≥ วันนี้) เลือก start ล่าสุด (เก็บทุกแถวที่ start เดียวกัน) */
export function effectiveUc(rows: UcRef[], today: string): UcRef[] {
  const live = rows.filter((r) => (!r.start_date || r.start_date <= today) && (!r.end_date || r.end_date >= today));
  const latest = live.reduce<string>((m, r) => ((r.start_date ?? "") > m ? (r.start_date ?? "") : m), "");
  return live.filter((r) => (r.start_date ?? "") === latest);
}

export function compareItems(items: HisItem[], uc: UcRef[], ofc: OfcRef[], groups: GroupAdp, today: string): CompareRow[] {
  const ucBy = new Map<string, UcRef[]>();
  for (const r of uc) if (r.code) ucBy.set(normCode(r.code), [...(ucBy.get(normCode(r.code)) ?? []), r]);
  const ofcBy = new Map<string, OfcRef[]>();
  for (const r of ofc) ofcBy.set(ofcKey(r.code), [...(ofcBy.get(ofcKey(r.code)) ?? []), r]);
  const byCode = new Map<string, HisItem[]>();
  for (const it of items) if (normCode(it.nhso_adp_code)) byCode.set(normCode(it.nhso_adp_code), [...(byCode.get(normCode(it.nhso_adp_code)) ?? []), it]);

  const out: CompareRow[] = [];
  for (const it of items) {
    const code = normCode(it.nhso_adp_code);
    const ofcOpd = it.g1_opd ?? it.price;
    const ofcIpd = it.g1_ipd ?? it.ipd_price ?? it.price;
    const ucOpd = it.g2_opd ?? it.price;
    const ucIpd = it.g2_ipd ?? it.ipd_price ?? it.price;
    // อุปกรณ์ (ADP 2) ไม่อยู่ใน UC/OFC รหัส 4 หลักไปชนกับรหัสหัตถการของ UC โดยบังเอิญ จึงไม่เทียบ (ตรวจที่หน้าความพร้อมรหัสเบิก)
    const inst = it.nhso_adp_type_id === 2;
    const ucAll = code && !inst ? (ucBy.get(code) ?? []) : [];
    const ucNow = effectiveUc(ucAll, today);
    const ofcRows = code && !inst ? (ofcBy.get(ofcKey(code)) ?? []) : [];
    // ตรวจเฉพาะที่แน่ใจ: UC หลายอัตราใช้ต่ำสุด (ต่ำกว่าทุกอัตรา) OFC รหัสซ้ำใช้สูงสุด (เกินทุกอัตรา)
    const ucRates = ucNow.map((r) => r.price).filter((p): p is number => p != null && p > 0);
    const ofcRates = ofcRows.map((r) => r.price).filter((p): p is number => p != null && p > 0);
    const ucRate = ucRates.length ? Math.min(...ucRates) : null;
    const ofcRate = ofcRates.length ? Math.max(...ofcRates) : null;
    const add = (problem: Problem, detail: string) =>
      out.push({
        key: `${it.icode}:${problem}`, icode: it.icode, name: it.name, unit: it.unit, adp_code: code || null, adp_type: it.nhso_adp_type_id,
        problem, detail, uc_rate: ucRate, ofc_rate: ofcRate, ofc_opd: ofcOpd, ofc_ipd: ofcIpd, uc_opd: ucOpd, uc_ipd: ucIpd,
      });

    if (!code || PLACEHOLDER.test(code)) {
      add("no_code", code ? `ใช้รหัสชั่วคราว ${code}` : "");
      continue;
    }
    if (!inst && !ucNow.length && !ofcRows.length) {
      const elsewhere = it.nhso_adp_type_id === 4 ? "ส่งเสริมป้องกัน (ADP 4) ตรวจรหัส PP ที่หน้าความพร้อมรหัสเบิกด้วย" : "";
      add("unknown_code", ucAll.length ? "UC มีรหัสนี้แต่ไม่มีช่วงที่มีผลวันนี้" : elsewhere);
    }
    if (ucNow.length) {
      const fs = Math.min(...ucNow.map((r) => r.fs_status ?? 1));
      if (fs === 2) add("not_fee_schedule", ucRate == null ? "ไม่มีอัตรา" : `อัตรา ${money(ucRate)}`);
      if (fs === 3) add("not_standard", "");
      const group = ucNow[0].chrgitem_group;
      const allowed = group ? groups.get(group) : null;
      if (allowed && (it.nhso_adp_type_id == null || !allowed.includes(it.nhso_adp_type_id)))
        add("adp_type", `หมวด ${group} ของ UC ใช้ ADP ${allowed.join(" หรือ ")} รายการตั้งไว้ ${it.nhso_adp_type_id ?? "ว่าง"}`);
    }
    if (ofcRate != null) {
      const over = [ofcOpd != null && ofcOpd > ofcRate ? `OPD ${money(ofcOpd)}` : "", ofcIpd != null && ofcIpd > ofcRate ? `IPD ${money(ofcIpd)}` : ""].filter(Boolean);
      if (over.length) add("over_ofc", `${over.join(", ")} เกินอัตรา ${money(ofcRate)}`);
    }
    if (ucRate != null) {
      // IPD ตรวจเฉพาะที่ตั้งราคาไว้ > 0 (รายการ OPD อย่างเดียวมักไม่ตั้งราคา IPD)
      const under = [ucOpd != null && ucOpd < ucRate ? `OPD ${money(ucOpd)}` : "", ucIpd != null && ucIpd > 0 && ucIpd < ucRate ? `IPD ${money(ucIpd)}` : ""].filter(Boolean);
      if (under.length) add("under_uc", `${under.join(", ")} ต่ำกว่าอัตรา ${money(ucRate)}${ucRates.length > 1 ? ` (รหัสนี้มี ${ucRates.length} อัตรา ใช้ต่ำสุด)` : ""}`);
    }
    const shared = byCode.get(code)!;
    if (shared.length > 1) {
      // บางรหัสผูกร้อยกว่ารายการ (เช่น เอกซเรย์ทั่วไป) แสดงแค่ 5 icode แรก
      const others = shared.filter((s) => s !== it).map((s) => s.icode);
      add("shared_code", `ใช้ร่วมกับอีก ${others.length} รายการ: ${others.slice(0, 5).join(", ")}${others.length > 5 ? " …" : ""}`);
    }
  }
  return out;
}
