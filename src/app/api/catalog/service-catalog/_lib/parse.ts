// อ่านไฟล์อ้างอิงของ Service catalog แบบ pure (ไม่มี import ค่า ทดสอบด้วย node ได้ตรง: parse.test.mjs)
// รับแถวจาก xlsx sheet_to_json({ header: 1, raw: true }) ; errors ไม่ว่าง = ไม่ควรบันทึกไฟล์นี้

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const text = (v: unknown) => {
  const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
};
/** หัวคอลัมน์เทียบแบบไม่สนช่องว่างและตัวพิมพ์ */
const key = (v: unknown) => String(v ?? "").replace(/\s+/g, "").toUpperCase();

/** "dd/mm/yyyy" ปี ค.ศ. -> ISO ; ว่าง = null ; ผิดรูปแบบหรือไม่มีวันจริง = undefined */
export function parseDmy(v: unknown): string | null | undefined {
  const s = text(v);
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return undefined;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : undefined;
}

/** ตัวเลขเงิน (มีจุลภาคได้) ; ว่าง = null ; ไม่ใช่ตัวเลข = undefined */
function parseMoney(v: unknown): number | null | undefined {
  const s = text(v);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

// ---------- UC Service catalog (export จากระบบ สปสช.) ----------

/** หัวคอลัมน์ของไฟล์ตามลำดับ (ตรวจรูปแบบไฟล์ก่อนนำเข้า) */
export const UC_HEADERS = [
  "หมวด", "รหัสของ รพ.", "รหัสมาตรฐาน/working code", "ชื่อ", "ราคา", "หน่วยนับ", "วันที่เริ่มต้น", "วันที่สิ้นสุด", "วันที่อัพเดทล่าสุด",
  "รหัสมาตรฐานอยู่ใน Fee Schedule List [1]", "รหัสมาตรฐานไม่อยู่ใน Fee Schedule List [2]", "ไม่อยู่ในรหัสมาตรฐาน [3]",
] as const;

export type UcRow = {
  line_no: number;
  chrgitem_group: string | null;
  group_name: string | null;
  hosp_code: string | null;
  code: string | null;
  name: string;
  /** null = ไม่มีอัตรา (ไฟล์ใส่ 0) */
  price: number | null;
  unit: string | null;
  start_date: string | null;
  end_date: string | null;
  updated_date: string | null;
  fs_status: 1 | 2 | 3 | null;
};

export type ParseResult<T> = { rows: T[]; errors: string[] };

export function parseUcCatalog(sheet: unknown[][]): ParseResult<UcRow> {
  const header = (sheet[0] ?? []).map(key);
  const col = UC_HEADERS.map((h) => header.indexOf(key(h)));
  const missing = UC_HEADERS.filter((_, i) => col[i] < 0);
  if (missing.length) return { rows: [], errors: [`ไม่ใช่ไฟล์ Service catalog ของ สปสช.: ไม่พบคอลัมน์ ${missing.join(", ")}`] };

  const errors: string[] = [];
  const err = (line: number, msg: string) => errors.length < 20 && errors.push(`แถว ${line}: ${msg}`);
  const rows: UcRow[] = [];
  for (let i = 1; i < sheet.length; i++) {
    const r = sheet[i] ?? [];
    if (r.every((v) => text(v) === null)) continue;
    const line = i + 1;
    const get = (n: number) => r[col[n]];
    const name = text(get(3));
    if (!name) {
      err(line, "ไม่มีชื่อรายการ");
      continue;
    }
    // "8 ตรวจวินิจฉัยและรักษาทางรังสีวิทยา" = หมวดค่ารักษา (CHRGITEM) 1–19 ไม่ใช่ ADP TYPE
    const group = /^(\d{1,2})\s*(.*)$/.exec(text(get(0)) ?? "");
    const price = parseMoney(get(4));
    if (price === undefined) err(line, `ราคาไม่ใช่ตัวเลข (${text(get(4))})`);
    const dates = [6, 7, 8].map((n) => {
      const d = parseDmy(get(n));
      if (d === undefined) err(line, `${UC_HEADERS[n]} ไม่ใช่วันที่ dd/mm/yyyy (${text(get(n))})`);
      return d ?? null;
    });
    const fs = ([9, 10, 11] as const).findIndex((n) => text(get(n)) !== null);
    rows.push({
      line_no: line,
      chrgitem_group: group ? group[1] : null,
      group_name: group ? group[2] || null : text(get(0)),
      hosp_code: text(get(1)),
      code: text(get(2)),
      name,
      price: price ? price : null,
      unit: text(get(5)),
      start_date: dates[0],
      end_date: dates[1],
      updated_date: dates[2],
      fs_status: fs < 0 ? null : ((fs + 1) as 1 | 2 | 3),
    });
  }
  if (!rows.length && !errors.length) errors.push("ไม่มีรายการในไฟล์");
  return { rows, errors };
}

// ---------- อัตรากรมบัญชีกลาง (POST mbdb.cgd.go.th/mwa-api/mwa/getMedSearch) ----------

/** หนึ่งรายการใน results ของ getMedSearch (ตรวจจาก response จริง 14 พ.ย. 2569) */
export type CgdMed = { medSeqno?: unknown; medId?: unknown; medName?: unknown; remark?: unknown; unitName?: unknown; price?: unknown };
export type OfcRow = { line_no: number; med_seqno: string | null; code: string; name: string | null; remark: string | null; unit: string | null; price: number | null };

/** results ทุกหน้าต่อกันตามลำดับ ; รหัสว่าง = error (ต้นทางผิดรูป ไม่บันทึก) */
export function parseOfc(results: CgdMed[]): ParseResult<OfcRow> {
  const errors: string[] = [];
  const rows: OfcRow[] = [];
  results.forEach((m, i) => {
    const code = text(m.medId);
    const price = m.price == null ? null : parseMoney(m.price);
    if (!code) return errors.length < 20 && errors.push(`ลำดับ ${i + 1}: ไม่มีรหัส`);
    if (price === undefined) return errors.length < 20 && errors.push(`ลำดับ ${i + 1} (${code}): ราคาไม่ใช่ตัวเลข`);
    rows.push({ line_no: i + 1, med_seqno: text(m.medSeqno), code, name: text(m.medName), remark: text(m.remark), unit: text(m.unitName), price });
  });
  if (!rows.length && !errors.length) errors.push("ไม่มีรายการจากกรมบัญชีกลาง");
  return { rows, errors };
}

// ---------- รายการเคลม STP (ไฟล์หมวดรายการเบิกจ่าย 19 หมวด ชีตละกลุ่มบริการ) ----------

export type ClaimItemRow = {
  sheet: string;
  line_no: number;
  seq: string | null;
  code: string | null;
  name: string;
  qty: string | null;
  rate: number | null;
  chrgitem_group: string | null;
  adp_type: string | null;
  use_status: string | null;
  tmt_id: string | null;
  opd: boolean | null;
  ipd: boolean | null;
  note: string | null;
};

const CODE_HEADERS = new Set(["CODE", "CODE/TMT_ID", "TMT_ID/CODE", "TMT_ID"]);
const yesNo = (v: unknown) => {
  const s = key(v);
  return s === "YES" ? true : s === "NO" ? false : null;
};

/**
 * หนึ่งชีต: หาแถวหัวที่มีคอลัมน์ CODE (หรือ TMT_ID) และ RATE ซึ่งเลื่อนได้ แถวหัวข้อย่อยที่ไม่มีชื่อรายการข้ามไป
 * ชีตที่ไม่มีแถวหัว (เช่น หน้าสรุปหมวด) คืน null
 */
export function parseClaimSheet(sheetName: string, sheet: unknown[][]): ClaimItemRow[] | null {
  const h = sheet.findIndex((r) => (r ?? []).some((v) => CODE_HEADERS.has(key(v))) && (r ?? []).some((v) => key(v).startsWith("RATE")));
  if (h < 0) return null;
  const head = sheet[h].map(key);
  const at = (pred: (k: string) => boolean) => head.findIndex(pred);
  const c = {
    seq: at((k) => k === "ลำดับ"),
    code: at((k) => CODE_HEADERS.has(k)),
    name: at((k) => k === "รายการ" || k === "ชื่อสามัญทางยา"),
    strength: at((k) => k === "ความแรงของยา"),
    form: at((k) => k === "รูปแบบของยา"),
    amount: at((k) => k === "ปริมาณ"),
    amountUnit: at((k) => k === "หน่วยนับ"),
    qty: at((k) => k === "QTY"),
    rate: at((k) => k.startsWith("RATE")),
    group: at((k) => k === "หมวด"),
    adp: at((k) => k.startsWith("ADP") || k.startsWith("แฟ้ม")),
    type: at((k) => k === "ประเภท"),
    use: at((k) => k === "หมวดการใช้ยา"),
    note: at((k) => k === "หมายเหตุ"),
    record: at((k) => k.startsWith("การบันทึกข้อมูล")),
  };
  if (c.name < 0) return null;
  const tmtSheet = head[c.code].includes("TMT");
  const rows: ClaimItemRow[] = [];
  for (let i = h + 1; i < sheet.length; i++) {
    const r = sheet[i] ?? [];
    const get = (n: number) => (n < 0 ? null : text(r[n]));
    const name0 = get(c.name);
    const rawCode = get(c.code);
    const rawRate = get(c.rate);
    // แถวหัวข้อย่อย/หมายเหตุอยู่คอลัมน์แรก ไม่มีชื่อรายการ ; แถวรายการต้องมีรหัส ราคา หรือ QTY อย่างใดอย่างหนึ่ง
    if (!name0 || !(rawCode || rawRate || get(c.qty))) continue;
    const name = [name0, get(c.strength), get(c.form), [get(c.amount), get(c.amountUnit)].filter(Boolean).join(" ")].filter(Boolean).join(" ");
    const code = rawCode && rawCode !== "-" ? rawCode : null;
    const rate = parseMoney(rawRate);
    const adp = get(c.adp)?.replace(/^แฟ้ม\s*/, "") ?? null;
    const use = c.use < 0 ? [] : [get(c.use), get(c.use + 1)].map((v) => /\d/.exec(v ?? "")?.[0]).filter(Boolean);
    const note = [rate === undefined ? `RATE: ${rawRate}` : null, get(c.record), get(c.note)].filter(Boolean).join(" ; ");
    rows.push({
      sheet: sheetName,
      line_no: i + 1,
      seq: get(c.seq),
      code,
      name,
      qty: get(c.qty),
      rate: rate ?? null,
      chrgitem_group: get(c.group),
      adp_type: adp,
      use_status: use.length ? use.join(",") : null,
      tmt_id: tmtSheet && code && adp === "DRU" && /^\d+$/.test(code) ? code : null,
      opd: c.type < 0 ? null : yesNo(r[c.type]),
      ipd: c.type < 0 ? null : yesNo(r[c.type + 1]),
      note: note || null,
    });
  }
  return rows;
}

/** ทั้งไฟล์: ต้องเป็นเอกสารของกองทุนบุคคลที่มีปัญหาสถานะและสิทธิ และมีอย่างน้อยหนึ่งชีตที่อ่านรายการได้ */
export function parseStpWorkbook(sheets: { name: string; rows: unknown[][] }[]): ParseResult<ClaimItemRow> & { sheets: { name: string; rows: number }[] } {
  const isStp = sheets.some((s) => s.rows.slice(0, 6).some((r) => (r ?? []).some((v) => String(v ?? "").includes("ปัญหาสถานะและสิทธิ"))));
  if (!isStp) return { rows: [], sheets: [], errors: ["ไม่ใช่ไฟล์หมวดรายการเบิกจ่ายของกองทุนบุคคลที่มีปัญหาสถานะและสิทธิ"] };
  const out: ClaimItemRow[] = [];
  const counts: { name: string; rows: number }[] = [];
  for (const s of sheets) {
    const rows = parseClaimSheet(s.name.trim(), s.rows);
    if (!rows) continue;
    out.push(...rows);
    counts.push({ name: s.name.trim(), rows: rows.length });
  }
  return { rows: out, sheets: counts, errors: out.length ? [] : ["ไม่พบชีตที่มีหัวตาราง CODE และ RATE"] };
}
