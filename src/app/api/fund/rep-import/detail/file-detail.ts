// รายละเอียดไฟล์ REP หนึ่งไฟล์ (modal ใน /fund/rep-import) helper แบบ pure ไม่มี import จึงรันทดสอบด้วย node ได้ตรง (file-detail.test.mjs)

/** response ของ /api/fund/rep-import/detail */
export type RepFileDetail = {
  file: {
    file_name: string;
    rep_type: string;
    hcode: string | null;
    file_date: string | null;
    printed_at: string | null;
    imported_at: string;
    imported_by: string | null;
    /** จำนวนรายการตอนนำเข้า (rep_file.row_count) */
    row_count: number;
  };
  kpi: {
    /** แถวที่ผูกกับไฟล์นี้ตอนนี้ (แถวที่ TRAN_ID ซ้ำย้ายไปไฟล์ที่นำเข้าทีหลัง) */
    total: number;
    /** vn/an พบใน HOSxP และ uc_money > 0 */
    matched: number;
    unmatched: number;
    error_rows: number;
    claim_total: number;
    compensation: number;
  };
  funds: { main_fund: string[]; sub_fund: string[]; n: number; compensation: number }[];
  errors: { code: string; description: string | null; n: number }[];
};

/** แบ่ง array เป็นชุดละไม่เกิน size (ใช้กับ IN (...) ของ his) */
export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** จำนวน ref ที่ตรงกับลูกหนี้: แถวที่ his คืนมาและ uc_money > 0 (decimal ของ mysql2 มาเป็น string, NULL = ไม่ตรง) */
export const countMatched = (found: { uc_money: string | number | null }[]) =>
  found.filter((r) => r.uc_money != null && Number(r.uc_money) > 0).length;
