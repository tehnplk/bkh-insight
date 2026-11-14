// แฟ้ม FDH ของแต่ละหมวด (ลำดับใน left tab) และชนิดผลของ API แบบ pure ไม่มี import
// ใช้ทั้งฝั่งหน้า (left tab) และ API (whitelist) ส่วน SQL ของแต่ละแฟ้มอยู่ที่ checks.ts (ฝั่ง server) ซึ่งบังคับ type ให้ครบทุกแฟ้มในนี้

export const FDH_TYPES = ["op", "ip"] as const;
export type FdhType = (typeof FDH_TYPES)[number];

export const TYPE_LABEL: Record<FdhType, string> = { op: "OP/PP", ip: "IP" };
/** OP/PP เลือกตามวันที่รับบริการ (vstdate) ส่วน IP เลือกตามวันที่จำหน่าย (dchdate) */
export const DATE_LABEL: Record<FdhType, string> = { op: "วันที่รับบริการ", ip: "วันที่จำหน่าย" };

export const FILE_ORDER = {
  op: ["INS", "PAT", "OPD", "ORF", "ODX", "OOP", "CHT", "CHA", "AER", "ADP", "DRU", "LABFU", "PHDB"],
  ip: ["INS", "PAT", "IPD", "IRF", "IDX", "IOP", "CHT", "CHA", "AER", "ADP", "LVD", "DRU", "LABFU", "PHDB"],
} as const;
export type OpFile = (typeof FILE_ORDER.op)[number];
export type IpFile = (typeof FILE_ORDER.ip)[number];

/** จำนวนรหัส C ที่มีกฎตรวจ (ทุกหมวดรวมกันไม่ซ้ำ ไม่นับกฎ STP) ต้องตรงกับ checks.ts (ตรวจใน fdh.test.mjs) */
export const RULE_CODE_COUNT = 20;

/** ระดับของกฎ: รหัส C ทุกตัวเป็น error ; warn = อาจถูกตีกลับ ; info = ยังไม่ยืนยันว่ากองทุนตรวจ */
export type Level = "error" | "warn" | "info";

/**
 * กฎเฉพาะกองทุน STP (บุคคลที่มีปัญหาสถานะและสิทธิ) ตามรหัสตีกลับ (R) ของกองทุน ไม่ใช่รหัส C ของ สปสช.
 * ไม่มีใน rep_error_code จึงเก็บคำอธิบาย/วิธีแก้ไว้ที่นี่ ; ตรวจเฉพาะ visit/admission สิทธิ STP
 */
export const STP_RULES: Record<string, { detail: string; fix: string; level?: Level }> = {
  "STP-R175": { detail: "หน่วยบริการหลักหรือหน่วยบริการรอง (HOSPMAIN/HOSPSUB) ว่าง", fix: "ตั้งหน่วยบริการหลัก/รอง (hospmain/hospsub) ที่สิทธิของ visit" },
  "STP-AUTH": {
    detail: "ไม่มี Authen Code (2 ตัวอักษร + 10 หลัก เช่น PP…) ในช่อง PERMITNO ของแฟ้ม INS ยังไม่ยืนยันว่ากองทุน STP ตรวจช่องนี้",
    fix: "ขอ Authen Code ของ visit ก่อนส่ง",
    level: "info",
  },
  "STP-R112": {
    detail: "OP ทั่วไปเบิกกองทุนไม่ได้ เบิกได้เฉพาะ OPAE นอกจังหวัด ส่งต่อ และรายการ on-top เช่น PP, ARV, TB, Methadone, ไต (visit นี้ไม่มีประเภทอุบัติเหตุ/ฉุกเฉินที่สิทธิ)",
    fix: "อุบัติเหตุ/ฉุกเฉิน: ระบุประเภทอุบัติเหตุ/ฉุกเฉินที่สิทธิของ visit ; ไม่ประสงค์เบิก: ส่ง UUC = 2",
    level: "warn",
  },
  "STP-R111": { detail: "มีการรับหรือส่งต่อ แต่ไม่มีรหัสโรงพยาบาลรับ/ส่งต่อ (REFMAINI/REFMAINO)", fix: "บันทึกรหัสหน่วยบริการในข้อมูลรับ/ส่งต่อของ visit" },
  "STP-R113": { detail: "รหัสโรงพยาบาลรับ/ส่งต่อไม่ใช่ตัวเลข 5 หลัก", fix: "แก้รหัสหน่วยบริการในข้อมูลรับ/ส่งต่อเป็นรหัส 5 หลัก" },
  "STP-R108": { detail: "จำนวน ราคาต่อหน่วย หรือราคารวมของรายการว่างหรือไม่มากกว่า 0", fix: "แก้จำนวน/ราคาของรายการให้มากกว่า 0 หรือลบรายการที่ไม่เบิก" },
  "STP-R188": { detail: "รหัสรายการ ADP ซ้ำในเคสเดียว (วันเดียวกัน ประเภทเดียวกัน) ไม่นับรหัสรวม 55999/57999", fix: "รวมเป็นรายการเดียวแล้วใส่จำนวนรวม หรือลบรายการที่ซ้ำ" },
  "STP-R292": { detail: "ค่าพาหนะ S1801 จำนวน (QTY) ไม่อยู่ในช่วง 1–2", fix: "แก้จำนวน S1801 ให้เป็น 1 หรือ 2" },
  "STP-R180": { detail: "เบิกค่าระยะทาง S1802 (กม.) โดยไม่มีค่าพาหนะ S1801 ในเคสเดียวกัน", fix: "เพิ่ม S1801 คู่กับ S1802 หรือลบ S1802" },
  "STP-R194": { detail: "ค่าพาหนะ S1801 มากกว่า 1 รายการในเคสเดียว", fix: "รวม S1801 เป็นรายการเดียว" },
  "STP-R186": { detail: "ค่ารักษารวม (CHT.TOTAL) ไม่เท่ากับผลรวมค่ารักษาแยกหมวด (CHA)", fix: "ตรวจรายการค่ารักษาของเคส แล้วคำนวณยอดรวมใหม่ให้ตรงกัน" },
  "STP-R191": { detail: "ไม่มีโรคหลัก (DXTYPE 1)", fix: "ลงรหัสโรคหลักของเคส" },
  "STP-R136": { detail: "H54 (ความบกพร่องทางการเห็น รวมตาบอด) เป็นโรคหลักไม่ได้", fix: "ใช้โรคที่เป็นสาเหตุเป็นโรคหลัก แล้วย้าย H54 เป็นโรคร่วม" },
  "STP-R116": { detail: "มีรหัสบาดเจ็บ (S, T) แต่ไม่มีสาเหตุภายนอก (DXTYPE 5)", fix: "ลงรหัสสาเหตุภายนอก V01–Y98 เป็น DXTYPE 5" },
};

export const codeLevel = (code: string): Level => STP_RULES[code]?.level ?? "error";

export const parseType = (v: string | null): FdhType | null => (FDH_TYPES as readonly string[]).includes(v ?? "") ? (v as FdhType) : null;
export const isFile = (type: FdhType, v: string | null): v is string => (FILE_ORDER[type] as readonly string[]).includes(v ?? "");

/** รหัส C ใน DB เป็นเลขล้วน ('116') แสดงเป็น C116 ส่วนกฎ STP แสดงตามรหัส (STP-R175) */
export const cLabel = (code: string) => (/^\d+$/.test(code) ? `C${code}` : code);
/** เรียงรหัส C ตามเลขก่อน แล้วจึงกฎ STP */
export const compareCode = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** /api/fdh/c-check/summary: cases = null คือแฟ้มนี้ยังไม่มีกฎตรวจ, level = ระดับสูงสุดที่พบ (ไม่มีเคส = ไม่มี) */
export type SummaryFile = { file: string; rows: number; cases: number | null; level?: Level };
export type SummaryResponse = { type: FdhType; files: SummaryFile[] };

export type CodeSummary = { c_code: string; detail: string | null; fix: string | null; n: number };
export type CaseRow = { c_code: string; hn: string; an: string; seq: string; found: string | null };
/** /api/fdh/c-check/validate: total = จำนวนเคสทั้งหมด, truncated = cases ถูกตัดที่ CASE_LIMIT */
export type ValidateResponse = {
  type: FdhType;
  file: string;
  rows: number;
  ruleCodes: string[];
  summary: CodeSummary[];
  cases: CaseRow[];
  total: number;
  truncated: boolean;
};
