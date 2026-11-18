// อ่านไฟล์ Lab Catalog ที่ดาวน์โหลดจาก FDH แบบ pure (ไม่มี import ค่า ทดสอบด้วย node ได้ตรง: parse.test.mjs)
// รับแถวจาก xlsx sheet_to_json({ header: 1, raw: true }) ; หัวรายงานอยู่ก่อนแถวหัวตาราง ("หน่วยบริการ : 11252 - ...")

/** หัวตารางของไฟล์ตามลำดับ (ตรวจรูปแบบไฟล์และหาแถวหัวตาราง) */
export const LAB_FDH_HEADERS = [
  "row", "สิทธิประโยชน์", "รหัสกรมบัญชีกลาง", "ชื่อ", "หน่วย", "ราคากลาง", "gyear", "วันที่เริ่มต้น", "วันที่สิ้นสุด",
  "flag", "TMLT Code", "TMLT Name", "Lab Code", "LOINC", "Exception",
] as const;

export const MAX_LAB_FDH_BYTES = 10 * 1024 * 1024;

/** หนึ่งแถวที่จะบันทึก (ชื่อคอลัมน์ตามตาราง lab_catalog_fdh) วันเวลาเป็น ISO ค.ศ. "yyyy-mm-dd hh:mm" */
export type LabFdhRow = {
  line_no: number;
  benefit_plan: string;
  cgd_code: string | null;
  name: string;
  unit: string | null;
  price: number | null;
  gyear: number | null;
  start_at: string | null;
  end_at: string | null;
  flag: string | null;
  tmlt_code: string | null;
  tmlt_name: string | null;
  lab_code: string;
  loinc: string | null;
  exception: string | null;
};

const text = (v: unknown) => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};
/** หัวคอลัมน์เทียบแบบไม่สนช่องว่างและตัวพิมพ์ */
const key = (v: unknown) => String(v ?? "").replace(/\s+/g, "").toUpperCase();

/** "dd-mm-yyyy hh:mm" ปี ค.ศ. -> "yyyy-mm-dd hh:mm" ; ว่าง = null ; ผิดรูปแบบหรือไม่มีวันจริง = undefined (9999-12-31 = ไม่มีวันสิ้นสุด ยอมรับ) */
export function parseDmyTime(v: unknown): string | null | undefined {
  const s = text(v);
  if (!s) return null;
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s);
  if (!m) return undefined;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const [h, mi] = [Number(m[4] ?? 0), Number(m[5] ?? 0)];
  const t = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso || h > 23 || mi > 59) return undefined;
  return `${iso} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/** ราคา (มีจุลภาคได้) ; ว่าง = null ; ไม่ใช่ตัวเลข = undefined */
function parseMoney(v: unknown): number | null | undefined {
  const s = text(v);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

export type LabFdhParseResult = { rows: LabFdhRow[]; itemCount: number; errors: string[] };

/**
 * ทั้งชีต: หาแถวหัวตารางที่มีครบ 15 คอลัมน์ (ไม่จำเป็นต้องเป็นแถวแรก) แล้วตรวจรหัสหน่วยบริการในหัวรายงานให้ตรงกับ hcode
 * แถวว่างทั้งแถวข้ามไป ; errors ไม่ว่าง = ไม่ควรบันทึกไฟล์นี้ (แสดงไม่เกิน 20 ข้อ) ; itemCount = จำนวนคู่ (Lab Code, รหัสกรมบัญชีกลาง) ไม่นับซ้ำข้ามสิทธิ
 */
export function parseLabFdh(sheet: unknown[][], hcode: string): LabFdhParseResult {
  const want = LAB_FDH_HEADERS.map(key);
  const h = sheet.findIndex((r) => want.every((k) => (r ?? []).some((v) => key(v) === k)));
  if (h < 0) return { rows: [], itemCount: 0, errors: [`ไม่ใช่ไฟล์ Lab Catalog ของ FDH: ไม่พบแถวหัวตาราง ${LAB_FDH_HEADERS.join(", ")}`] };
  const unitLine = sheet.slice(0, h).flatMap((r) => r ?? []).map((v) => /หน่วยบริการ\s*:\s*(\d{5})/.exec(String(v ?? ""))).find(Boolean);
  if (!unitLine) return { rows: [], itemCount: 0, errors: ["ไม่พบรหัสหน่วยบริการในหัวรายงาน (หน่วยบริการ : xxxxx)"] };
  if (unitLine[1] !== hcode) return { rows: [], itemCount: 0, errors: [`ไฟล์นี้เป็นของหน่วยบริการ ${unitLine[1]} ไม่ใช่ ${hcode}`] };

  const head = (sheet[h] ?? []).map(key);
  const col = want.map((k) => head.indexOf(k));
  const errors: string[] = [];
  const err = (line: number, msg: string) => errors.length < 20 && errors.push(`แถว ${line}: ${msg}`);
  const rows: LabFdhRow[] = [];
  for (let i = h + 1; i < sheet.length; i++) {
    const r = sheet[i] ?? [];
    if (r.every((v) => text(v) === null)) continue;
    const line = i + 1; // เลขแถวใน Excel
    const get = (n: number) => r[col[n]];
    const plan = text(get(1));
    const name = text(get(3));
    const lab = text(get(12));
    if (!plan) err(line, "ไม่มีสิทธิประโยชน์");
    if (!name) err(line, "ไม่มีชื่อ");
    if (!lab) err(line, "ไม่มี Lab Code");
    const price = parseMoney(get(5));
    if (price === undefined) err(line, `ราคากลางไม่ใช่ตัวเลข (${text(get(5))})`);
    const gy = text(get(6));
    if (gy && !/^\d{4}$/.test(gy)) err(line, `gyear ไม่ใช่ปี 4 หลัก (${gy})`);
    const [start, end] = [7, 8].map((n) => {
      const d = parseDmyTime(get(n));
      if (d === undefined) err(line, `${LAB_FDH_HEADERS[n]} ไม่ใช่วันที่ dd-mm-yyyy hh:mm (${text(get(n))})`);
      return d ?? null;
    });
    if (!plan || !name || !lab) continue;
    rows.push({
      line_no: line,
      benefit_plan: plan,
      cgd_code: text(get(2)),
      name,
      unit: text(get(4)),
      price: price ?? null,
      gyear: gy && /^\d{4}$/.test(gy) ? Number(gy) : null,
      start_at: start,
      end_at: end,
      flag: text(get(9)),
      tmlt_code: text(get(10)),
      tmlt_name: text(get(11)),
      lab_code: lab,
      loinc: text(get(13)),
      exception: text(get(14)),
    });
  }
  if (!rows.length && !errors.length) errors.push("ไม่มีรายการ Lab ในไฟล์");
  return { rows, itemCount: new Set(rows.map((r) => `${r.lab_code}|${r.cgd_code ?? ""}`)).size, errors };
}

/** หนึ่งแถวใน DataGrid (ราคาเป็น string ตาม numeric ของ pg) */
export type LabFdhItem = Omit<LabFdhRow, "price"> & { price: string | null };
