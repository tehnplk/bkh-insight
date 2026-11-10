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

/** จำนวนรหัส C ที่มีกฎตรวจ (ทุกหมวดรวมกันไม่ซ้ำ) ต้องตรงกับ checks.ts (ตรวจใน fdh.test.mjs) */
export const RULE_CODE_COUNT = 20;

export const parseType = (v: string | null): FdhType | null => (FDH_TYPES as readonly string[]).includes(v ?? "") ? (v as FdhType) : null;
export const isFile = (type: FdhType, v: string | null): v is string => (FILE_ORDER[type] as readonly string[]).includes(v ?? "");

/** รหัส C ใน DB เป็นเลขล้วน ('116') แสดงเป็น C116 */
export const cLabel = (code: string) => `C${code}`;

/** /api/fdh/c-check/summary: cases = null คือแฟ้มนี้ยังไม่มีกฎตรวจ */
export type SummaryFile = { file: string; rows: number; cases: number | null };
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
