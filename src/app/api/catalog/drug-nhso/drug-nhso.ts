// อ่านไฟล์ Drug Catalogue ที่ สปสช. อนุมัติแล้ว (APPROVED_<hcode>_<yyyymmdd>.xls จาก drug.nhso.go.th) แบบ pure
// รับแถวจาก xlsx (header แถวแรก ค่าเป็น string) ไม่มี import ค่า จึงใช้ทดสอบด้วย node ได้ (drug-nhso.test.mjs)

/** หัวคอลัมน์ของไฟล์ตามลำดับ (21 ฟิลด์ data dictionary สะกดตามไฟล์จริง เช่น DFSCODE + ผลอนุมัติ 4 คอลัมน์) */
export const DRUG_NHSO_HEADERS = [
  "HOSPDRUGCODE", "PRODUCTCAT", "TMTID", "SPECPREP", "GENERICNAME", "TRADENAME", "DFSCODE", "DOSAGEFORM", "STRENGTH",
  "CONTENT", "UNITPRICE", "DISTRIBUTOR", "MANUFACTURER", "ISED", "NDC24", "PACKSIZE", "PACKPRICE", "UPDATEFLAG",
  "DATECHANGE", "DATEUPDATE", "DATEEFFECTIVE", "ISED_APPROVED", "NDC24_APPROVED", "DATE_APPROVED", "ISED_STATUS",
] as const;

export const MAX_CATALOG_BYTES = 10 * 1024 * 1024;

/** หนึ่งแถวที่จะบันทึก (ชื่อคอลัมน์ตามตาราง drug_catalog_nhso) วันที่เป็น ISO ค.ศ. */
export type DrugNhsoRow = {
  line_no: number;
  hosp_drug_code: string;
  product_cat: string | null;
  tmt_id: string | null;
  spec_prep: string | null;
  generic_name: string | null;
  trade_name: string | null;
  dfs_code: string | null;
  dosage_form: string | null;
  strength: string | null;
  content: string | null;
  unit_price: number | null;
  distributor: string | null;
  manufacturer: string | null;
  ised: string | null;
  ndc24: string | null;
  pack_size: string | null;
  pack_price: number | null;
  update_flag: string | null;
  date_change: string | null;
  date_update: string | null;
  date_effective: string | null;
  ised_approved: string | null;
  ndc24_approved: string | null;
  date_approved: string | null;
  ised_status: string | null;
};

const text = (v: unknown) => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/** "dd/mm/yyyy" (ปี ค.ศ. ตามไฟล์ สปสช.) หรือ "dd/mm/yyyy hh:mm" -> "yyyy-mm-dd" ; ว่าง = null ; ผิดรูปแบบ = undefined */
export function parseDmy(v: unknown): string | null | undefined {
  const s = text(v);
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s);
  if (!m) return undefined;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  // 9999-12-31 คือ "ไม่มีวันสิ้นสุด" ตามคู่มือ ยอมรับ ; วันที่ไม่มีจริง (31/02) = ผิด
  const t = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : undefined;
}

/** ราคา: ตัวเลข (อาจมีจุลภาค) ; ว่าง = null ; ไม่ใช่ตัวเลข = undefined */
function parsePrice(v: unknown): number | null | undefined {
  const s = text(v);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

export type ParseResult = { rows: DrugNhsoRow[]; itemCount: number; errors: string[] };

/**
 * แถวจาก sheet_to_json({ header: 1 }) ทั้งชีต: แถวแรกต้องเป็นหัวคอลัมน์ครบตาม DRUG_NHSO_HEADERS (ตำแหน่งไหนก็ได้ ไม่สนตัวพิมพ์)
 * แถวว่างทั้งแถวข้ามไป ; errors ไม่ว่าง = ไม่ควรบันทึกไฟล์นี้ (แสดงไม่เกิน 20 ข้อ)
 */
export function parseDrugNhso(sheet: unknown[][]): ParseResult {
  const errors: string[] = [];
  const header = (sheet[0] ?? []).map((h) => String(h ?? "").trim().toUpperCase());
  const col = Object.fromEntries(DRUG_NHSO_HEADERS.map((h) => [h, header.indexOf(h)])) as Record<(typeof DRUG_NHSO_HEADERS)[number], number>;
  const missing = DRUG_NHSO_HEADERS.filter((h) => col[h] < 0);
  if (missing.length) return { rows: [], itemCount: 0, errors: [`ไม่ใช่ไฟล์ Drug Catalogue ที่อนุมัติแล้วของ สปสช.: ไม่พบคอลัมน์ ${missing.join(", ")}`] };

  const rows: DrugNhsoRow[] = [];
  const err = (line: number, msg: string) => {
    if (errors.length < 20) errors.push(`แถว ${line}: ${msg}`);
  };
  for (let i = 1; i < sheet.length; i++) {
    const r = sheet[i] ?? [];
    if (r.every((v) => text(v) === null)) continue;
    const line = i + 1; // เลขแถวใน Excel
    const get = (h: (typeof DRUG_NHSO_HEADERS)[number]) => r[col[h]];
    const code = text(get("HOSPDRUGCODE"));
    if (!code) err(line, "ไม่มี HOSPDRUGCODE");
    const dates = {} as Record<"date_change" | "date_update" | "date_effective" | "date_approved", string | null>;
    for (const [key, h] of [["date_change", "DATECHANGE"], ["date_update", "DATEUPDATE"], ["date_effective", "DATEEFFECTIVE"], ["date_approved", "DATE_APPROVED"]] as const) {
      const d = parseDmy(get(h));
      if (d === undefined) err(line, `${h} ไม่ใช่วันที่ dd/mm/yyyy (${text(get(h))})`);
      dates[key] = d ?? null;
    }
    const unit = parsePrice(get("UNITPRICE"));
    if (unit === undefined) err(line, `UNITPRICE ไม่ใช่ตัวเลข (${text(get("UNITPRICE"))})`);
    const pack = parsePrice(get("PACKPRICE"));
    if (pack === undefined) err(line, `PACKPRICE ไม่ใช่ตัวเลข (${text(get("PACKPRICE"))})`);
    if (!code) continue;
    rows.push({
      line_no: line,
      hosp_drug_code: code,
      product_cat: text(get("PRODUCTCAT")),
      tmt_id: text(get("TMTID")),
      spec_prep: text(get("SPECPREP")),
      generic_name: text(get("GENERICNAME")),
      trade_name: text(get("TRADENAME")),
      dfs_code: text(get("DFSCODE")),
      dosage_form: text(get("DOSAGEFORM")),
      strength: text(get("STRENGTH")),
      content: text(get("CONTENT")),
      unit_price: unit ?? null,
      distributor: text(get("DISTRIBUTOR")),
      manufacturer: text(get("MANUFACTURER")),
      ised: text(get("ISED")),
      ndc24: text(get("NDC24")),
      pack_size: text(get("PACKSIZE")),
      pack_price: pack ?? null,
      update_flag: text(get("UPDATEFLAG")),
      ...dates,
      ised_approved: text(get("ISED_APPROVED")),
      ndc24_approved: text(get("NDC24_APPROVED")),
      ised_status: text(get("ISED_STATUS")),
    });
  }
  if (!rows.length && !errors.length) errors.push("ไม่มีรายการยาในไฟล์");
  return { rows, itemCount: new Set(rows.map((r) => r.hosp_drug_code)).size, errors };
}

/** รายการยาปัจจุบัน (แถวล่าสุดของแต่ละรหัส) สำหรับ DataGrid */
export type DrugNhsoItem = {
  hosp_drug_code: string;
  tmt_id: string | null;
  generic_name: string | null;
  trade_name: string | null;
  dosage_form: string | null;
  strength: string | null;
  content: string | null;
  unit_price: string | null;
  ised: string | null;
  ised_approved: string | null;
  product_cat: string | null;
  update_flag: string | null;
  date_effective: string | null;
  date_approved: string | null;
  ised_status: string | null;
  versions: number;
};

/** ไฟล์ล่าสุดที่นำเข้า (แสดงเหนือตาราง) */
export type CatalogFileInfo = { file_name: string; row_count: number; item_count: number; imported_by: string | null; imported_at: string } | null;
export type DrugNhsoImportResult = { status: "imported" | "duplicate" | "error"; file: string; rows?: number; items?: number; errors?: string[] };
