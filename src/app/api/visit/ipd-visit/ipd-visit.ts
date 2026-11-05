// ใช้ร่วมกันระหว่าง route กับหน้า /visit/ipd-visit (ไม่มี server-only)
export type IpdVisit = {
  an: string;
  hn: string;
  name: string;
  /** ชาย / หญิง (patient.sex 1 / 2) ค่าอื่นเป็น null */
  sex: string | null;
  /** อายุเต็มปี ณ วันรับ (an_stat.age_y ไม่มีคำนวณจากวันเกิด) */
  age: number | null;
  pttypeCode: string | null;
  pttype: string | null;
  /** ชื่อตึก (ward.name) */
  ward: string | null;
  /** วันรับ YYYY-MM-DD (ค.ศ.) */
  regdate: string;
  /** วันจำหน่าย YYYY-MM-DD (ค.ศ.) null = ยังนอนอยู่ */
  dchdate: string | null;
  /** วันนอน = วันจำหน่าย (หรือวันนี้ถ้ายังนอนอยู่) ลบวันรับ */
  los: number | null;
  /** แพทย์ผู้รับ (ipt.admdoctor -> doctor.name) */
  doctor: string | null;
  /** รหัส ICD-10 ของการวินิจฉัยหลัก (iptdiag diagtype 1) ยังไม่ลงรหัสเป็น null */
  dxCode: string | null;
  dxName: string | null;
  /** การวินิจฉัยแรกรับ (ipt.prediag ข้อความอิสระ) แสดงแทนเมื่อยังไม่มีรหัส */
  prediag: string | null;
};

/** ผลรวมตาม ward ที่กรอง ไม่ขึ้นกับคำค้นหา: รับใหม่และจำหน่ายนับในช่วงวันที่ ส่วนยังนอนอยู่นับ ณ ตอนนี้ */
export type IpdVisitSummary = {
  admitted: number;
  inHouse: number;
  discharged: number;
  /** วันนอนเฉลี่ยของผู้ที่จำหน่ายในช่วง null = ไม่มีผู้จำหน่าย */
  avgLos: number | null;
};

export type WardOption = { code: string; name: string };
/** รูปแบบ ward.ward (varchar(4)) ใช้ validate ?ward= ก่อนส่งเป็น bind parameter */
export const isWardCode = (s: string) => /^[0-9A-Za-z]{1,4}$/.test(s);
