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
  /** เตียงตามกรอบของโรงพยาบาล (env `HOSPITAL_BEDS`) ตัวหารอัตราครองเตียง ; null = ไม่ได้ตั้ง ใช้ผลรวม ward.bedcount แทน */
  licensedBeds: number | null;
  /** ภาวะทุพโภชนาการ (E40–E46) ของผู้ป่วยในที่จำหน่ายในช่วง */
  malnutrition: Malnutrition;
};

type Num = number | string | null;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** แถว iptdiag ที่ icd10 อยู่ใน E40–E46 ของ AN ที่จำหน่ายในช่วง (HOSxP เก็บรหัสไม่มีจุด เช่น E440) adjrw ของ ipt (DECIMAL มาเป็น string) */
export type MalnutritionDiag = { an: string; icd10: string; diagtype: Num; icd_name: string | null; icd_tname: string | null; adjrw: Num };
/** pdx = AN ที่รหัสนั้นเป็นโรคหลัก (diagtype 1) ; sdx = AN ที่รหัสนั้นเป็นวินิจฉัยอื่น (diagtype 2–5) ; adjrw = ผลรวม AdjRW ต่อ AN ไม่ซ้ำ */
export type MalnutritionCode = { code: string; name: string; pdx: number; sdx: number; adjrw: number };
/** ระดับรวมนับ AN ไม่ซ้ำ: AN ที่มีรหัสใดใน E40–E46 เป็นโรคหลักนับใน pdx ที่เหลือนับใน sdx ; noAdjrw = AN ที่ยังไม่มี AdjRW (ไม่รวมในผลรวม) */
export type Malnutrition = { discharged: number; pdx: number; sdx: number; adjrw: number; noAdjrw: number; codes: MalnutritionCode[] };
/** month = YYYY-MM ; cases = AN ไม่ซ้ำ */
export type MalnutritionMonth = { month: string; cases: number; adjrw: number };
/** GET /api/home/malnutrition-fy?fy=<ปีงบ พ.ศ.> ปีงบที่จบแล้วมีครบ 12 เดือน ปีงบปัจจุบันมีถึงเดือนนี้ */
export type MalnutritionFyResponse = { fy: number; months: MalnutritionMonth[] };

/** AN -> AdjRW (null = ยังไม่มี) */
type AnAdjrw = Map<string, number | null>;
const sumAdjrw = (m: AnAdjrw) => round4([...m.values()].reduce<number>((s, v) => s + (v ?? 0), 0));

export function summarizeMalnutrition(rows: MalnutritionDiag[], discharged: number): Malnutrition {
  const codes = new Map<string, { name: string; pdx: Set<string>; all: AnAdjrw }>();
  const pdx = new Set<string>();
  const all: AnAdjrw = new Map();
  for (const r of rows) {
    let c = codes.get(r.icd10);
    if (!c) {
      // tname ของ icd101 มีช่องว่างซ้อน
      const name = r.icd_tname?.replace(/\s+/g, " ").trim() || r.icd_name?.trim() || r.icd10;
      codes.set(r.icd10, (c = { name, pdx: new Set(), all: new Map() }));
    }
    const adjrw = r.adjrw === null ? null : Number(r.adjrw);
    c.all.set(r.an, adjrw);
    all.set(r.an, adjrw);
    if (String(r.diagtype) === "1") {
      c.pdx.add(r.an);
      pdx.add(r.an);
    }
  }
  return {
    discharged,
    pdx: pdx.size,
    sdx: all.size - pdx.size,
    adjrw: sumAdjrw(all),
    noAdjrw: [...all.values()].filter((v) => v === null).length,
    codes: [...codes]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([code, c]) => ({ code, name: c.name, pdx: c.pdx.size, sdx: c.all.size - c.pdx.size, adjrw: sumAdjrw(c.all) })),
  };
}

/** เดือนของปีงบตั้งแต่ ต.ค. ถึงเดือนของ upTo (YYYY-MM-DD) เดือนที่ไม่มีแถวเป็น 0 */
export function fillMonths(rows: { month: string; cases: Num; adjrw_sum: Num }[], months: string[], upTo: string): MalnutritionMonth[] {
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return months
    .filter((m) => m <= upTo.slice(0, 7))
    .map((month) => {
      const r = byMonth.get(month);
      return { month, cases: Number(r?.cases ?? 0), adjrw: round4(Number(r?.adjrw_sum ?? 0)) };
    });
}
