// แปลงไฟล์ REP ของ e-Claim สปสช. (.xls BIFF8) เป็นแถวสำหรับฐาน insight
// ไม่อ่านคอลัมน์ชื่อ-สกุล (index 6) และไม่ import ของ server จึงรันทดสอบด้วย node ได้ตรง (rep.test.mjs)
import { read, utils, type WorkSheet } from "xlsx";

export const FILE_RE = /^eclaim_(\d+)_(.+)_(\d{8})_(\d+)\.xls$/;
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

export type RepFileInfo = { hcode: string; type: string; fileDate: string };

export type RepRow = {
  tran_id: string;
  rep_no: string;
  sheet: string;
  patient_type: string | null;
  hn: string | null;
  an: string | null;
  pid: string | null;
  seq_no: string | null;
  admit_at: string | null;
  discharge_at: string | null;
  net_nhso: number | null;
  net_affiliation: number | null;
  claim_total: number | null;
  central_reimburse: number | null;
  self_pay: number | null;
  paid: number | null;
  error_codes: string[];
  main_fund: string[];
  sub_fund: string[];
  main_inscl: string | null;
  sub_inscl: string | null;
  hmain: string | null;
  proj: string | null;
  drg: string | null;
  rw: number | null;
  adjrw: number | null;
  /** ชดเชยรายกองทุน คอลัมน์ 54 ถึงก่อน VA (ไม่รวมกลุ่ม Deny) key = หัวตาราง 3 ชั้นต่อกัน เก็บเฉพาะค่าตัวเลขที่ไม่ใช่ 0 */
  fund_amounts: Record<string, number>;
  /** กลุ่ม Deny เฉพาะช่องที่มีค่า (เช่น "C") ไม่มีเลย = null */
  deny: Record<string, string> | null;
  remark: string | null;
  pay_mode: string | null;
};

export type RepSummary = {
  rep_no: string;
  sheet: string;
  period: string | null;
  total_cases: number | null;
  passed: number | null;
  failed: number | null;
  amounts: Record<string, number>;
  paid_affiliation: number | null;
  paid_total: number | null;
};

export type ParsedRep = { printedAt: string | null; rows: RepRow[]; summaries: RepSummary[] };

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO ค.ศ. ถ้าเป็นวันจริง ไม่งั้น null */
function isoDate(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** ชื่อไฟล์ eclaim_{hcode}_{type}_{yyyymmdd พ.ศ.}_{n}.xls -> hcode, type, วันที่ไฟล์ ISO ค.ศ. */
export function parseFileName(name: string): RepFileInfo | null {
  const m = FILE_RE.exec(name);
  if (!m) return null;
  const be = m[3];
  const fileDate = isoDate(Number(be.slice(0, 4)) - 543, Number(be.slice(4, 6)), Number(be.slice(6, 8)));
  return fileDate ? { hcode: m[1], type: m[2], fileDate } : null;
}

/** ข้อความ: ว่างหรือ "-" = null */
export function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "-" ? null : s;
}

/** ตัวเลข: number ตามเดิม, ข้อความที่เป็นตัวเลขล้วน (RW, จำนวนราย) แปลงเป็น number, อื่นๆ ("-", ว่าง) = null */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = text(v);
  return s !== null && /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

const int = (v: unknown) => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};

/** "a,b, c" -> ["a","b","c"], ว่างหรือ "-" -> [] */
export const list = (v: unknown) => (text(v) ?? "").split(",").map((s) => s.trim()).filter((s) => s && s !== "-");

/** "dd/mm/yyyy HH:MM:SS" (ค.ศ.) -> "yyyy-mm-dd HH:MM:SS", อื่นๆ = null */
export function dateTime(v: unknown): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(text(v) ?? "");
  if (!m) return null;
  const d = isoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  return d && `${d} ${m[4]}:${m[5]}:${m[6]}`;
}

/** "ออกรายงานวันที่ 06/11/2569 เวลา 14:31" (พ.ศ.) -> "2026-11-06 14:31:00" */
export function printedAt(v: unknown): string | null {
  const m = /(\d{2})\/(\d{2})\/(\d{4})\D+(\d{2}):(\d{2})/.exec(text(v) ?? "");
  if (!m) return null;
  const d = isoDate(Number(m[3]) - 543, Number(m[2]), Number(m[1]));
  return d && `${d} ${m[4]}:${m[5]}:00`;
}

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * หัวตารางหลายชั้น (แถว r0..r1) ต่อกันเป็น label ต่อคอลัมน์ ช่องที่ merge ใช้ค่าของช่องแรก ชั้นที่ซ้ำกับชั้นบนตัดทิ้ง
 * คืน top (ชั้นบนสุด) ไว้หาคอลัมน์ และ label ไว้เป็น key ของ jsonb
 */
export function headerLabels(aoa: unknown[][], merges: WorkSheet["!merges"], r0: number, r1: number) {
  const grid = aoa.slice(r0, r1 + 1).map((row) => [...(row ?? [])].map(norm));
  for (const m of merges ?? []) {
    if (m.e.r < r0 || m.s.r > r1) continue;
    const v = norm(aoa[m.s.r]?.[m.s.c]);
    for (let r = Math.max(m.s.r, r0); r <= Math.min(m.e.r, r1); r++) {
      for (let c = m.s.c; c <= m.e.c; c++) grid[r - r0][c] = v;
    }
  }
  const width = Math.max(...grid.map((r) => r.length));
  const top: string[] = [];
  const label: string[] = [];
  for (let c = 0; c < width; c++) {
    const parts = grid.map((r) => r[c] ?? "").filter((s, i, a) => s && s !== a[i - 1]);
    top.push(grid[0][c] ?? "");
    label.push(parts.join(" / "));
  }
  return { top, label };
}

// คอลัมน์ 0-53 ของ Detail และ Detail(ST) อยู่ตำแหน่งเดียวกัน ตรวจหัวตารางก่อนอ่าน ถ้าไม่ตรง = รูปแบบไฟล์เปลี่ยน
const DETAIL_KEYS: [number, string][] = [
  [0, "REP No."], [2, "TRAN_ID"], [3, "HN"], [4, "AN"], [5, "PID"], [7, "ประเภทผู้ป่วย"], [8, "วันเข้ารักษา"],
  [10, "ชดเชยสุทธิ"], [13, "Error Code"], [36, "RW"], [47, "AdjRW_NHSO (7)"], [49, "จ่ายชดเชย (9 = 4x5x8)"], [54, "ค่าใช้จ่ายสูง (HC)"],
];
const SUMMARY_KEYS: [number, string][] = [[0, "งวด"], [2, "REP NO."], [3, "ข้อมูลปกติ"], [20, "จ่ายชดเชยต้นสังกัด"], [21, "จ่ายชดเชยทั้งสิ้น"]];

function checkKeys(sheet: string, top: string[], keys: [number, string][]) {
  const bad = keys.find(([c, h]) => top[c] !== h);
  if (bad) throw new Error(`รูปแบบชีต ${sheet} ไม่ตรงกับที่รองรับ (คอลัมน์ ${bad[0] + 1} ต้องเป็น "${bad[1]}")`);
}

const toAoa = (ws: WorkSheet) => utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });

function parseDetail(ws: WorkSheet, sheet: string): RepRow[] {
  const aoa = toAoa(ws);
  const { top, label } = headerLabels(aoa, ws["!merges"], 5, 7);
  checkKeys(sheet, top, DETAIL_KEYS);
  const col = (h: string) => top.indexOf(h);
  const va = col("VA");
  const remark = col("Remark");
  const denyStart = col("Deny");
  const seq = col("SEQ NO");
  if (va < 0 || remark < 0 || denyStart < 0) throw new Error(`รูปแบบชีต ${sheet} ไม่ตรงกับที่รองรับ (ไม่พบคอลัมน์ VA, Remark หรือ Deny)`);
  // Detail(ST) ไม่มี SEQ NO และรูปแบบการจ่าย
  if (sheet === "Detail" && seq < 0) throw new Error(`รูปแบบชีต ${sheet} ไม่ตรงกับที่รองรับ (ไม่พบคอลัมน์ SEQ NO)`);
  const pay = col("รูปแบบการจ่าย");
  const fundCols: number[] = [];
  const denyCols: number[] = [];
  for (let c = 54; c < va; c++) (top[c] === "Deny" ? denyCols : fundCols).push(c);
  // label ซ้ำ = ยอดของคอลัมน์หนึ่งทับอีกคอลัมน์ใน jsonb
  if (new Set(fundCols.map((c) => label[c])).size !== fundCols.length) throw new Error(`ชีต ${sheet} มีหัวคอลัมน์กองทุนซ้ำกัน`);

  const rows: RepRow[] = [];
  for (let r = 8; r < aoa.length; r++) {
    const v = aoa[r];
    const tranId = text(v?.[2]);
    // แถวข้อมูลคือ TRAN_ID เป็นตัวเลขล้วน ท้ายชีตเป็นหมายเหตุ
    if (!tranId || !/^\d+$/.test(tranId)) continue;
    const fund: Record<string, number> = {};
    for (const c of fundCols) {
      const n = typeof v[c] === "number" ? (v[c] as number) : null;
      if (n) fund[label[c]] = n;
    }
    const deny: Record<string, string> = {};
    for (const c of denyCols) {
      const s = text(v[c]);
      if (s) deny[label[c]] = s;
    }
    rows.push({
      tran_id: tranId,
      rep_no: text(v[0]) ?? "",
      sheet,
      patient_type: text(v[7]),
      hn: text(v[3]),
      an: text(v[4]),
      pid: text(v[5]),
      seq_no: seq < 0 ? null : text(v[seq]),
      admit_at: dateTime(v[8]),
      discharge_at: dateTime(v[9]),
      net_nhso: num(v[10]),
      net_affiliation: num(v[11]),
      claim_total: num(v[40]),
      central_reimburse: num(v[41]),
      self_pay: num(v[42]),
      paid: num(v[49]),
      error_codes: list(v[13]),
      main_fund: list(v[14]),
      sub_fund: list(v[15]),
      main_inscl: text(v[21]),
      sub_inscl: text(v[22]),
      hmain: text(v[25]),
      proj: text(v[33]),
      drg: text(v[35]),
      rw: num(v[36]),
      adjrw: num(v[47]),
      fund_amounts: fund,
      deny: Object.keys(deny).length ? deny : null,
      remark: text(v[remark]),
      pay_mode: pay < 0 ? null : text(v[pay]),
    });
  }
  if (rows.some((r) => !r.rep_no)) throw new Error(`ชีต ${sheet} มีแถวที่ไม่มี REP No.`);
  return rows;
}

function parseSummary(ws: WorkSheet, sheet: string): RepSummary[] {
  const aoa = toAoa(ws);
  const { top, label } = headerLabels(aoa, ws["!merges"], 1, 4);
  checkKeys(sheet, top, SUMMARY_KEYS);
  const out: RepSummary[] = [];
  for (let r = 5; r < aoa.length; r++) {
    const v = aoa[r];
    const repNo = text(v?.[2]);
    if (!repNo || !/^\d+$/.test(repNo)) continue;
    const amounts: Record<string, number> = {};
    for (let c = 6; c < v.length; c++) {
      const n = num(v[c]);
      if (c !== 20 && c !== 21 && n !== null) amounts[label[c]] = n;
    }
    out.push({
      rep_no: repNo,
      sheet,
      period: text(v[0]),
      total_cases: int(v[3]),
      passed: int(v[4]),
      failed: int(v[5]),
      amounts,
      paid_affiliation: num(v[20]),
      paid_total: num(v[21]),
    });
  }
  return out;
}

const SHEETS = ["Detail", "Summary", "Detail(ST)", "Summary(ST)"];

/** อ่านไฟล์ REP แบบ IP/OP/OP_APPEAL_* (ORF รูปแบบต่างกัน ผู้เรียกต้องกันไว้ก่อน) แถวซ้ำ TRAN_ID เดียวกันในไฟล์เก็บแถวหลังสุด */
export function parseRep(buf: Uint8Array): ParsedRep {
  let wb;
  try {
    wb = read(buf, { type: "buffer", sheets: SHEETS });
  } catch {
    throw new Error("อ่านไฟล์ไม่ได้ ไม่ใช่ไฟล์ Excel ของ e-Claim");
  }
  if (!wb.Sheets.Detail || !wb.Sheets.Summary) throw new Error("ไม่พบชีต Detail หรือ Summary");
  const rows = new Map<string, RepRow>();
  const summaries: RepSummary[] = [];
  for (const [detail, summary] of [["Detail", "Summary"], ["Detail(ST)", "Summary(ST)"]]) {
    if (wb.Sheets[detail]) for (const row of parseDetail(wb.Sheets[detail], detail)) rows.set(row.tran_id, row);
    if (wb.Sheets[summary]) summaries.push(...parseSummary(wb.Sheets[summary], summary));
  }
  return { printedAt: printedAt(wb.Sheets.Detail.A1?.v), rows: [...rows.values()], summaries };
}
