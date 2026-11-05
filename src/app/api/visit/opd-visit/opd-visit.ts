// ใช้ร่วมกันระหว่าง route กับหน้า /visit/opd-visit (ไม่มี server-only)
export type OpdVisit = {
  vn: string;
  /** วันที่รับบริการ YYYY-MM-DD (ค.ศ.) */
  vstdate: string;
  hn: string;
  name: string;
  /** ชาย / หญิง (patient.sex 1 / 2) ค่าอื่นเป็น null */
  sex: string | null;
  /** อายุเต็มปี ณ วันที่รับบริการ */
  age: number | null;
  /** รหัสสิทธิ (pttype.pttype) */
  pttypeCode: string | null;
  /** ชื่อสิทธิ */
  pttype: string | null;
  /** เลข authen จาก สปสช. (ขึ้นต้น PP) */
  authen: string | null;
  /** เลขปิดสิทธิ (endpoint ขึ้นต้น EP) */
  closeCode: string | null;
  /** ค่าใช้จ่ายรวมของ visit (vn_stat.income, บาท) */
  income: number | null;
  /** ทุกการวินิจฉัย (ovstdiag ที่เป็นรหัส ICD-10) เรียงหลักก่อน */
  diagnoses: Diagnosis[];
};

export type Diagnosis = {
  /** รหัส ICD-10 ตามที่ HOSxP เก็บ (ไม่มีจุด เช่น E119) */
  code: string;
  /** ชื่อโรค (icd101.name) */
  name: string;
  /** ovstdiag.diagtype: 1 หลัก, 2 ร่วม, 3 แทรกซ้อน, 4 อื่นๆ, 5 สาเหตุภายนอก */
  type: string;
};

export const DIAG_TYPE_LABEL: Record<string, string> = {
  "1": "หลัก",
  "2": "ร่วม",
  "3": "แทรกซ้อน",
  "4": "อื่นๆ",
  "5": "สาเหตุภายนอก",
};

/**
 * กลุ่มสิทธิ = pttype.hipdata_code ตรงๆ (UCS, OFC, SSS, …) ค่าของ ?group= คือรหัสนั้นเอง
 * สิทธิที่ hipdata_code เป็น NULL หรือว่างใช้ค่า NO_HIPDATA ("none" ตัวพิมพ์เล็ก จึงไม่ชนกับรหัสจริงที่เป็นตัวพิมพ์ใหญ่)
 */
export const NO_HIPDATA = "none";
/** รูปแบบของ ?group= ก่อนส่งเป็น bind parameter: รหัส hipdata (ตัวพิมพ์ใหญ่/ตัวเลข ไม่เกิน 5 ตัว) หรือ NO_HIPDATA */
export const isHipdataGroup = (s: string) => s === NO_HIPDATA || /^[A-Z0-9]{1,5}$/.test(s);
/** กลุ่มของสิทธิจาก hipdata_code ตามกติกาเดียวกับตัวกรอง ?group= ของ route */
export const hipdataGroupOf = (hipdata: string | null) => hipdata?.trim() || NO_HIPDATA;
/** "UCS สิทธิหลักประกันสุขภาพแห่งชาติ" (ชื่อจาก pttype_coverage_group) ไม่มีชื่อใช้รหัสอย่างเดียว */
export const hipdataLabel = (group: string, name: string | null) =>
  group === NO_HIPDATA ? "ไม่ระบุ" : name?.trim() ? `${group} ${name.trim()}` : group;

/** กลุ่มสิทธิ (ตัวเลือกของ filter) */
export type HipdataOption = { value: string; label: string };
/** ตัวเลือกของ filter สิทธิ (pttype ที่ isuse = 'Y') group = hipdataGroupOf(hipdata_code) */
export type PttypeOption = { code: string; name: string; group: string };
/** รูปแบบ pttype.pttype (char(2) ตัวเลขหรือตัวอักษร) ใช้ validate ?pttype= ก่อนส่งเป็น bind parameter */
export const isPttypeCode = (s: string) => /^[0-9A-Za-z]{1,2}$/.test(s);

/** ผลรวมของทุกแถวที่ตรง filter (ไม่ใช่แค่หน้าปัจจุบัน) ส่งมากับ { rows, total } */
export type OpdVisitSummary = { income: number };

/** สถานะปิดสิทธิ เป็นทั้ง allowlist ของ ?closed= และตัวเลือกของ filter (ไม่ส่ง = ทั้งหมด) */
export const CLOSE_STATUSES = [
  { value: "no", label: "ยังไม่ปิดสิทธิ" },
  { value: "yes", label: "ปิดสิทธิแล้ว" },
] as const;
export type CloseStatus = (typeof CLOSE_STATUSES)[number]["value"];
export const isCloseStatus = (s: string): s is CloseStatus => CLOSE_STATUSES.some((c) => c.value === s);

/** ช่วงวันที่ยาวสุดที่ค้นได้ (นับรวมวันแรกและวันสุดท้าย) พอสำหรับรายงานทั้งเดือน และจำกัดภาระของ HIS production */
export const MAX_SPAN_DAYS = 31;

/** วันนี้ตามเวลาไทย รูปแบบ YYYY-MM-DD */
export const todayTh = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());

/** YYYY-MM-DD ที่เป็นวันจริง (ปฏิเสธ 2026-02-30) */
export const isIsoDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

/** บวก/ลบวันของ YYYY-MM-DD แบบ UTC (ไม่เลื่อนตาม timezone ของเครื่อง) */
export const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);

/** จำนวนวันในช่วง นับรวมทั้งสองฝั่ง */
export const spanDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
