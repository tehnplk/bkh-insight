import { THAI_MONTHS_SHORT } from "@/lib/thai-date";

// ป้ายที่ใช้ทั้งตารางไฟล์ งวดที่นำเข้า และ modal รายละเอียด

export const SCHEMES: Record<string, string> = { UCS: "UC", OFC: "OFC" };

/** "2025-12-01" -> "ธ.ค. 2568" */
export function periodLabel(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return `${THAI_MONTHS_SHORT[m - 1]} ${y + 543}`;
}

/** badge งวดที่ของเดือน = เลขท้ายเลขที่เอกสาร (run_no) ตรงกับคอลัมน์ "งวด" ในไฟล์ เช่น 6910_OP_02 */
export const runBadge = "ml-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-accent-text";

export const SECTIONS: Record<string, string> = {
  normal: "ปกติ",
  appeal: "อุทธรณ์",
  d1_normal: "ผู้พิการ D1",
  d1_appeal: "ผู้พิการ D1 อุทธรณ์",
};

// key จาก FUND_KEYS ใน src/app/api/fund/stm-import/stm.ts
export const FUNDS: Record<string, string> = {
  OP: "OP",
  IP: "IP",
  IP_CALC: "IP คำนวณได้",
  HC: "HC",
  HC_DRUG: "HC ยา",
  AE: "AE",
  AE_DRUG: "AE ยา",
  INST: "อวัยวะเทียม/อุปกรณ์",
  DMIS: "DMIS",
  DMIS_CALC: "DMIS คำนวณได้",
  DMIS_DRUG: "DMIS ยา",
  PALLIATIVE: "Palliative care",
  DMISHD: "DMISHD",
  PP: "PP",
  FS: "FS",
  OPBKK: "OPBKK",
  VA: "VA",
  COVID: "COVID",
  ROOM: "ค่าห้อง",
  DRUG: "ค่ายา",
  CARE: "ค่ารักษา",
  TRANSPORT: "ค่ารถ",
  WAITING: "กรณีพักรอจำหน่าย",
  OTHER: "ค่าบริการอื่นๆ",
};

/** ยอดที่คำนวณได้ (ไม่ใช่ยอดจ่าย) ไม่รวมในยอดชดเชย */
export const isCalc = (fund: string) => fund.endsWith("_CALC");
