// สัญญา API ของหน้าแรก (ภาพรวมโรงพยาบาล) ใช้ร่วมกันระหว่าง route กับหน้า UI

/** ค่าของช่วงที่เลือก (cur) และช่วงยาวเท่ากันก่อนหน้า (prev) */
export type Compare = { cur: number; prev: number };

export type CountRow = { code: string; name: string; visits: number; patients: number };

/** ป้ายกลุ่มอายุของ pyramid ตามลำดับ age_group 0..8 */
export const AGE_GROUPS = ["0–4", "5–14", "15–24", "25–34", "35–44", "45–54", "55–64", "65–74", "75+"] as const;

/** GET /api/home/overview?start&end (ช่วงไม่เกิน 31 วัน) */
export type HomeOverviewResponse = {
  start: string;
  end: string;
  /** ช่วงยาวเท่ากันที่อยู่ก่อน start ทันที */
  prevStart: string;
  prevEnd: string;
  kpi: { patients: Compare; visits: Compare; admissions: Compare; er: Compare };
  /** ทุกวันในช่วง เติม 0 วันที่ไม่มีข้อมูล */
  daily: { date: string; visits: number; patients: number }[];
  /** visit ต่อชั่วโมง index 0..23 */
  hourly: number[];
  /** 15 แผนกแรกตาม visit (patients นับไม่ซ้ำคนในแผนก) */
  departments: CountRow[];
  /** แผนกที่เหลือรวมกัน: นับได้แค่ visit (คนเดียวมาหลายแผนก รวมจำนวนคนข้ามแผนกไม่ได้) */
  otherDepartments: { count: number; visits: number } | null;
  /** กองทุน (pttype.hipdata_code ของ ovst.pttype) เรียงตาม visit */
  funds: CountRow[];
  /** ผู้ป่วยไม่ซ้ำคนตามกลุ่มอายุ (index ตาม AGE_GROUPS) เพศอื่นหรือไม่ระบุนับใน unknownSex */
  pyramid: { male: number[]; female: number[]; unknownSex: number };
  /** ผู้ป่วยในที่ยังไม่จำหน่าย ณ ตอนนี้ (ไม่ขึ้นกับช่วงวันที่) */
  wards: { code: string; name: string; beds: number; admitted: number; homeCare: boolean }[];
};
