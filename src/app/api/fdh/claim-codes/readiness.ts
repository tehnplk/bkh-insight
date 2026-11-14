// ตรวจความพร้อมรหัสเบิก (INST / PP) ของรายการใน HOSxP แบบ pure ทดสอบด้วย node ได้ตรง (readiness.test.mjs)
// รายการอ้างอิง: INST = ประกาศ สปสช. (ตาราง claim_code) ; PP = nhso_adp_code ประเภท 4 ของ HOSxP

export type ClaimKind = "INST" | "PP";
export const KIND_SCOPE: Record<ClaimKind, { income: string; adpType: number; label: string }> = {
  INST: { income: "02", adpType: 2, label: "อุปกรณ์และอวัยวะเทียม (INST)" },
  PP: { income: "21", adpType: 4, label: "ส่งเสริมป้องกัน (PP fee schedule)" },
};

export type RefCode = { code: string; name: string | null; rate: number | null };
/** รายการ active ใน HOSxP ที่อยู่ในหมวดรายรับของกองทุน หรือใส่รหัสของกองทุนไว้ ; adp_* = ข้อมูลรหัสจาก nhso_adp_code */
export type HisItem = { icode: string; name: string; income: string | null; adp: string | null; unitprice: number | null; adp_type: number | null; adp_name: string | null };
export type Usage = { n: number; qty: number; amount: number };
export type Problem = "empty" | "placeholder" | "cancelled" | "not_in_list" | "other_type" | "unknown";
export type ItemRow = HisItem & { problem: Problem | null; usage: Usage };

export const PROBLEM_TEXT: Record<Problem, { label: string; fix: string }> = {
  empty: { label: "ยังไม่ได้ใส่รหัส สปสช.", fix: "ใส่รหัสตามรายการที่เบิกได้ในรายการค่าบริการของ HOSxP" },
  placeholder: { label: "ใช้รหัสชั่วคราว (XXX)", fix: "เปลี่ยนเป็นรหัสจริงตามรายการที่เบิกได้" },
  cancelled: { label: "รหัสถูกยกเลิกแล้ว", fix: "เปลี่ยนเป็นรหัสที่ใช้ได้ปัจจุบัน" },
  not_in_list: { label: "รหัสไม่อยู่ในรายการที่เบิกได้", fix: "ตรวจกับรายการที่เบิกได้ แล้วแก้รหัส" },
  other_type: { label: "รหัสเป็นของหมวดอื่น", fix: "ถ้าเป็นรายการที่เบิกกองทุนนี้ให้แก้รหัส ถ้าไม่ใช่ให้แก้หมวดรายรับ" },
  unknown: { label: "ไม่พบรหัสนี้ในรายการของ สปสช.", fix: "ตรวจรหัสที่พิมพ์ แล้วแก้ให้ตรงรายการที่เบิกได้" },
};

const NO_USE: Usage = { n: 0, qty: 0, amount: 0 };
const PLACEHOLDER = /^X+\d*$/i;

/** ปัญหาของรายการหนึ่ง (null = ตั้งถูกแล้ว) ลำดับ: ว่าง > ชั่วคราว > อยู่ในรายการที่เบิกได้ > ยกเลิก > หมวดอื่น/ไม่อยู่ในประกาศ > ไม่รู้จัก */
export function problemOf(kind: ClaimKind, item: HisItem, refs: Set<string>): Problem | null {
  const adp = item.adp?.trim();
  if (!adp) return "empty";
  if (PLACEHOLDER.test(adp)) return "placeholder";
  if (refs.has(adp)) return null;
  if (item.adp_name?.includes("ยกเลิก")) return "cancelled";
  if (item.adp_type != null) return item.adp_type === KIND_SCOPE[kind].adpType ? "not_in_list" : "other_type";
  return "unknown";
}

/** แยกรายการที่ตั้งถูก / ต้องแก้ (เรียงตามการใช้งานมากก่อน) และรหัสที่เบิกได้แต่ยังไม่มีรายการใดใน HOSxP */
export function assess(kind: ClaimKind, refs: RefCode[], items: HisItem[], usage: Map<string, Usage>) {
  const refSet = new Set(refs.map((r) => r.code));
  const rows: ItemRow[] = items.map((i) => ({ ...i, problem: problemOf(kind, i, refSet), usage: usage.get(i.icode) ?? NO_USE }));
  const byUse = (a: ItemRow, b: ItemRow) => b.usage.n - a.usage.n || a.icode.localeCompare(b.icode);
  const ok = rows.filter((r) => !r.problem).sort((a, b) => (a.adp ?? "").localeCompare(b.adp ?? "") || a.icode.localeCompare(b.icode));
  const mapped = new Set(ok.map((r) => r.adp!.trim()));
  return {
    ok,
    fix: rows.filter((r) => r.problem).sort(byUse),
    missing: refs.filter((r) => !mapped.has(r.code)),
    mappedCodes: mapped.size,
  };
}
