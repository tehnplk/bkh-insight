// สถานะรับยาต่อ visit ของหน้าปิดสิทธิ (แสดงอย่างเดียว ไม่กันการปิดสิทธิ) pure ไม่มี import ทดสอบด้วย dispense.test.mjs

export type DispenseStatus = "dispensed" | "er" | "self" | "pending" | "none";

// ER/PCU/แพทย์แผนไทยจ่ายยาเองที่แผนก ไม่บันทึกที่หน้าจอจ่ายยาของห้องยา ;
// PCU บางวันมีเจ้าหน้าที่ห้องยาไปช่วย บันทึกจ่ายยาจริงจึงชนะเสมอ
export const SELF_DISPENSE_DEPS = ["011", "030", "034", "029"];
const ER_DEP = "011";

export const DISPENSE_LABEL: Record<DispenseStatus, string> = {
  dispensed: "จ่ายยาแล้ว",
  er: "ER จ่ายเอง",
  self: "แผนกจ่ายเอง",
  pending: "ยังไม่จ่าย",
  none: "ไม่มียา",
};

/** has_drug/dispensed จาก SQL เป็น 0/1 ; main_dep = ovst.main_dep (อาจมีช่องว่าง) */
export function dispenseStatus(r: { has_drug: unknown; dispensed: unknown; main_dep: string | null }): DispenseStatus {
  if (!Number(r.has_drug)) return "none";
  if (Number(r.dispensed)) return "dispensed";
  const dep = (r.main_dep ?? "").trim();
  if (dep === ER_DEP) return "er";
  return SELF_DISPENSE_DEPS.includes(dep) ? "self" : "pending";
}
