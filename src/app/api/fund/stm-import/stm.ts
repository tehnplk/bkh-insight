// แปลงไฟล์ Statement การโอนเงิน (STM) ของ สปสช. (UC) และกรมบัญชีกลาง (OFC) .xls BIFF8 เป็นแถวสำหรับฐาน insight
// ไม่อ่านคอลัมน์ชื่อ-สกุล และไม่ import ของ server จึงรันทดสอบด้วย node ได้ (stm.test.mjs)
import { read, utils, type WorkSheet } from "xlsx";
import { dateTime, printedAt, text } from "../rep-import/rep";

export { MAX_FILE_BYTES } from "../rep-import/rep";

export type StmSection = "normal" | "appeal" | "d1_normal" | "d1_appeal";

export type StmRow = {
  section: StmSection;
  rep_no: string;
  line_no: number;
  /** UC เท่านั้น (OFC ไม่มี) ตรงกับ rep_row.tran_id */
  tran_id: string | null;
  hn: string | null;
  an: string | null;
  pid: string | null;
  /** OP = HOSxP vn */
  seq_no: string | null;
  admit_at: string | null;
  discharge_at: string | null;
  main_inscl: string | null;
  proj: string | null;
  /** แหล่งข้อมูล FDH / EC2 / NHSO (UC) */
  source: string | null;
  adjrw: number | null;
  claim_total: number | null;
  /** ยอดชดเชยทั้งสิ้น (UC) หรือพึงรับทั้งหมด (OFC) */
  paid_total: number;
  /** ยอดรายกองทุน/หมวด key คงที่ (FUND_KEYS) เฉพาะค่าที่ไม่ใช่ 0 */
  fund_amounts: Record<string, number>;
};

export type StmSummary = {
  section: StmSection;
  rep_no: string;
  period_label: string | null;
  cases: number | null;
  passed: number | null;
  failed: number | null;
  claim_total: number | null;
  amounts: Record<string, number>;
  paid_total: number;
  source: string | null;
};

export type ParsedStm = {
  docNo: string;
  hcode: string;
  scheme: "UCS" | "OFC";
  layout: "uc" | "csmbs";
  patientType: "OP" | "IP";
  /** YYYY-MM-01 (ค.ศ.) */
  periodMonth: string;
  runNo: number;
  printedAt: string | null;
  paidTotal: number;
  deduction: number;
  netTotal: number;
  rows: StmRow[];
  summaries: StmSummary[];
};

/** ไฟล์อ่านได้แต่ไม่ใช่รูปแบบที่รองรับ (เช่น STM สิทธิอื่น) แยกจาก error ที่ไฟล์เสีย */
export class StmUnsupportedError extends Error {}

// key ของ jsonb ยอดรายกองทุน (UC) และรายหมวด (OFC) ใช้ร่วมกันทั้ง stm_row.fund_amounts และ stm_summary.amounts
// _CALC = ยอดที่คำนวณได้ ส่วน IP/DMIS คือยอดที่จ่ายจริง (ยอดรวมใช้ยอดจ่ายจริง)
export const FUND_KEYS = [
  "OP", "IP_CALC", "IP", "HC", "HC_DRUG", "AE", "AE_DRUG", "INST", "DMIS_CALC", "DMIS", "DMIS_DRUG",
  "PALLIATIVE", "DMISHD", "PP", "FS", "OPBKK", "VA", "COVID",
  "ROOM", "DRUG", "CARE", "TRANSPORT", "WAITING", "OTHER",
] as const;
const UC_FUNDS = FUND_KEYS.slice(0, 16); // ตามลำดับคอลัมน์พึงรับ OP..OPBKK
const OFC_FUNDS = ["ROOM", "INST", "DRUG", "CARE", "TRANSPORT", "WAITING", "OTHER"] as const;

/** ตัวเลขที่อาจเป็นข้อความมีจุลภาค ("12,345.00", ".7628", "-50") ว่างหรือ "-" = null */
export function amount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = text(v)?.replace(/,/g, "");
  return s && /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null;
}

const int = (v: unknown) => {
  const n = amount(v);
  return n === null ? null : Math.trunc(n);
};
const cents = (n: number) => Math.round(n * 100);
const baht = (c: number) => c / 100;
const fmt = (c: number) => (c / 100).toFixed(2);
const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const digits = (v: unknown) => /^\d+$/.test(norm(v));

/** วันที่ในไฟล์ OFC มีช่องว่างแปลกๆ ("17/11 /2025 13:52:00") ตัดช่องว่างรอบ "/" ก่อนอ่าน */
export const stmDateTime = (v: unknown) => dateTime(norm(v).replace(/\s*\/\s*/g, "/"));

const toAoa = (ws: WorkSheet) => utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });

function checkKeys(sheet: string, row: unknown[], keys: [number, string][]) {
  const bad = keys.find(([c, h]) => norm(row[c]) !== h);
  if (bad) throw new Error(`รูปแบบชีต ${sheet} ไม่ตรงกับที่รองรับ (คอลัมน์ ${bad[0] + 1} ต้องเป็น "${bad[1]}")`);
}

function funds(v: unknown[], cols: number[], keys: readonly string[]) {
  const out: Record<string, number> = {};
  cols.forEach((c, i) => {
    const n = amount(v[c]);
    if (n) out[keys[i]] = n;
  });
  return out;
}

const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

/** แถว "ข้อมูลปกติ" / "ข้อมูลอุทธรณ์" (มี "(ผู้พิการ D1)" ต่อท้ายในชีต D1) -> section */
function sectionOf(label: string, sheet: string): StmSection | null {
  if (!label.startsWith("ข้อมูล")) return null;
  const s = label.includes("อุทธรณ์") ? "appeal" : "normal";
  return sheet.includes("D1") ? `d1_${s}` : s;
}

/** "เลขที่เอกสาร 11252_OPUCS256812_01" จากแถวบนของชีต */
function docNoOf(aoa: unknown[][]): string | null {
  for (const r of aoa.slice(0, 12)) {
    const m = /^เลขที่เอกสาร\s+(\S+)/.exec(norm(r?.[0]));
    if (m) return m[1];
  }
  return null;
}
const printedOf = (aoa: unknown[][]) => aoa.slice(0, 3).map((r) => printedAt(r?.[0])).find(Boolean) ?? null;

type Totals = Map<StmSection, number>; // cents
const add = (t: Totals, s: StmSection, c: number) => t.set(s, (t.get(s) ?? 0) + c);

// ---------- UC (OPUCS / IPUCS) ----------

const UC_DETAIL_HEAD: [number, string][] = [
  [0, "REP"], [1, "ลำดับที่"], [2, "TRAN_ID"], [3, "HN"], [4, "AN"], [5, "PID"], [7, "วันเข้ารักษา"], [8, "วันจำหน่าย"],
  [9, "MAININSCL"], [10, "PROJCODE"], [11, "เรียกเก็บ"], [12, "กองทุน IP"], [21, "พึงรับ"], [37, "ยอดชดเชยทั้งสิ้น"],
  [38, "VA"], [39, "COVID"], [40, "แหล่งข้อมูล"], [41, "SEQ NO"],
];
const UC_DETAIL_HEAD2: [number, string][] = [
  [13, "AdjRW"], [21, "OP"], [22, "IP"], [24, "HC"], [26, "AE"], [28, "INST"], [29, "DMIS"], [32, "Palliative care"],
  [33, "DMISHD"], [34, "PP"], [35, "FS"], [36, "OPBKK"],
];
const UC_SUMMARY_HEAD: [number, string][] = [
  [0, "งวด"], [1, "HCODE"], [2, "REP NO."], [4, "ทั้งหมดที่ผ่าน"], [5, "เรียกเก็บ"], [7, "พึงรับ"], [23, "พึงรับทั้งหมด"],
  [24, "COVID"], [25, "แหล่งข้อมูล"],
];
const UC_SUMMARY_HEAD2: [number, string][] = [[7, "OP"], [8, "IP"], [10, "HC"], [12, "AE"], [14, "INST"], [15, "DMIS"], [22, "OPBKK"]];

/** ชีตรายละเอียด: หนึ่งแถวต่อ TRAN_ID แถว "รวม" (คอลัมน์ 37) ต่อส่วน หยุดที่ "ความหมายแต่ละคอลัมน์" */
function ucDetail(ws: WorkSheet, sheet: string, rows: StmRow[], totals: Totals) {
  const aoa = toAoa(ws);
  let section: StmSection | null = null;
  let head = false;
  for (let r = 0; r < aoa.length; r++) {
    const v = aoa[r] ?? [];
    const c0 = norm(v[0]);
    if (c0 === "ความหมายแต่ละคอลัมน์") break;
    const s = sectionOf(c0, sheet);
    if (s) {
      section = s;
      head = false;
      continue;
    }
    if (c0 === "REP" && norm(v[2]) === "TRAN_ID") {
      checkKeys(sheet, v, UC_DETAIL_HEAD);
      checkKeys(sheet, aoa[r + 1] ?? [], UC_DETAIL_HEAD2);
      head = true;
      continue;
    }
    if (!section || !head) continue;
    if (norm(v[36]) === "รวม") {
      add(totals, section, cents(amount(v[37]) ?? 0));
      continue;
    }
    if (!digits(v[0]) || !digits(v[2])) continue;
    const paid = amount(v[37]);
    if (paid === null) throw new Error(`ชีต ${sheet} แถว ${r + 1} ไม่มียอดชดเชยทั้งสิ้น`);
    const fund = funds(v, range(21, 16), UC_FUNDS);
    const va = amount(v[38]);
    const covid = amount(v[39]);
    if (va) fund.VA = va;
    if (covid) fund.COVID = covid;
    rows.push({
      section,
      rep_no: norm(v[0]),
      line_no: int(v[1]) ?? 0,
      tran_id: norm(v[2]),
      hn: text(v[3]),
      an: text(v[4]),
      pid: text(v[5]),
      seq_no: text(v[41]),
      admit_at: stmDateTime(v[7]),
      discharge_at: stmDateTime(v[8]),
      main_inscl: text(v[9]),
      proj: text(v[10]),
      source: text(v[40]),
      adjrw: amount(v[13]),
      claim_total: amount(v[11]),
      paid_total: paid,
      fund_amounts: fund,
    });
  }
}

/** ชีตรายงานสรุป: หนึ่งแถวต่อ REP แถว "รวม" (คอลัมน์ 23) ต่อส่วน */
function ucSummary(ws: WorkSheet, sheet: string, out: StmSummary[], totals: Totals) {
  const aoa = toAoa(ws);
  let section: StmSection | null = null;
  let head = false;
  for (let r = 0; r < aoa.length; r++) {
    const v = aoa[r] ?? [];
    const s = sectionOf(norm(v[0]), sheet);
    if (s) {
      section = s;
      head = false;
      continue;
    }
    if (norm(v[0]) === "งวด") {
      checkKeys(sheet, v, UC_SUMMARY_HEAD);
      checkKeys(sheet, aoa[r + 1] ?? [], UC_SUMMARY_HEAD2);
      head = true;
      continue;
    }
    if (!section || !head) continue;
    if (norm(v[22]) === "รวม") {
      add(totals, section, cents(amount(v[23]) ?? 0));
      continue;
    }
    if (!digits(v[2])) continue;
    const paid = amount(v[23]);
    if (paid === null) throw new Error(`ชีต ${sheet} แถว ${r + 1} ไม่มียอดพึงรับทั้งหมด`);
    const amounts = funds(v, range(7, 16), UC_FUNDS);
    const covid = amount(v[24]);
    if (covid) amounts.COVID = covid;
    out.push({
      section,
      rep_no: norm(v[2]),
      period_label: text(v[0]),
      cases: null,
      passed: int(v[4]),
      failed: null,
      claim_total: amount(v[5]),
      amounts,
      paid_total: paid,
      source: text(v[25]),
    });
  }
}

/** ชีตรายงานพึงรับ: ต่อส่วนมีแถวประเภท (จ่ายชดเชย, ยอดหัก...) และแถว "รวม" = จ่ายชดเชย − หัก */
function ucReceivable(ws: WorkSheet, sheet: string, paid: Totals, deducted: Totals, net: Totals) {
  const aoa = toAoa(ws);
  let section: StmSection | null = null;
  let payCol = -1;
  let dedCols: number[] = [];
  for (const v of aoa.map((x) => x ?? [])) {
    const c0 = norm(v[0]);
    const s = sectionOf(c0, sheet);
    if (s) {
      section = s;
      payCol = -1;
      continue;
    }
    if (!section) continue;
    if (c0 === "ประเภท") {
      const h = v.map(norm);
      payCol = h.indexOf("จ่ายชดเชย");
      dedCols = h.flatMap((x, i) => (x.startsWith("ยอดหัก") ? [i] : []));
      if (payCol < 0) throw new Error(`รูปแบบชีต ${sheet} ไม่ตรงกับที่รองรับ (ไม่พบคอลัมน์ "จ่ายชดเชย")`);
      continue;
    }
    if (payCol < 0) continue;
    const sum = v.findIndex((x) => norm(x) === "รวม");
    if (sum >= 0) {
      add(net, section, cents(amount(v[sum + 1]) ?? 0));
      payCol = -1; // หลังแถวรวมไม่มีข้อมูลของส่วนนี้อีก
      continue;
    }
    if (!c0) continue;
    add(paid, section, cents(amount(v[payCol]) ?? 0));
    for (const c of dedCols) add(deducted, section, cents(amount(v[c]) ?? 0));
  }
}

function parseUc(sheets: [string, WorkSheet][]): Omit<ParsedStm, "docNo" | "hcode" | "scheme" | "layout" | "patientType" | "periodMonth" | "runNo" | "printedAt"> {
  const rows: StmRow[] = [];
  const summaries: StmSummary[] = [];
  const t = { detail: new Map(), detailSum: new Map(), summary: new Map(), summarySum: new Map(), paid: new Map(), deducted: new Map(), net: new Map() } satisfies Record<string, Totals>;
  for (const [name, ws] of sheets) {
    if (name.startsWith("รายละเอียด")) ucDetail(ws, name, rows, t.detailSum);
    else if (name.startsWith("รายงานสรุป")) ucSummary(ws, name, summaries, t.summarySum);
    else if (name.startsWith("รายงานพึงรับ")) ucReceivable(ws, name, t.paid, t.deducted, t.net);
  }
  for (const r of rows) add(t.detail, r.section, cents(r.paid_total));
  for (const s of summaries) add(t.summary, s.section, cents(s.paid_total));

  // ยอดเดียวกันต้องตรงกันทุกที่ ไม่ตรง = อ่านไฟล์ผิดหรือรูปแบบเปลี่ยน จึงไม่นำเข้า
  const sections = new Set(Object.values(t).flatMap((m) => [...m.keys()]));
  for (const s of sections) {
    const g = (m: Totals) => m.get(s) ?? 0;
    const paid = g(t.paid);
    const net = g(t.net);
    if (g(t.detail) !== g(t.detailSum) || g(t.detail) !== g(t.summary) || g(t.summary) !== g(t.summarySum) || g(t.detail) !== paid || paid - g(t.deducted) !== net) {
      throw new Error(
        `ยอดรวมไม่ตรงกัน (${s}): รายละเอียด ${fmt(g(t.detail))}, แถวรวมรายละเอียด ${fmt(g(t.detailSum))}, สรุป ${fmt(g(t.summary))}, ` +
          `แถวรวมสรุป ${fmt(g(t.summarySum))}, รายงานพึงรับ ${fmt(paid)} หัก ${fmt(g(t.deducted))} สุทธิ ${fmt(net)}`,
      );
    }
  }
  const total = (m: Totals) => baht([...m.values()].reduce((a, b) => a + b, 0));
  return { rows, summaries, paidTotal: total(t.paid), deduction: total(t.deducted), netTotal: total(t.net) };
}

// ---------- OFC / CSMBS (OP{yyyymm} / IP{yyyymm}) ----------

const OFC_DETAIL_HEAD: [number, string][] = [
  [0, "REP"], [1, "ลำดับที่"], [2, "HN"], [3, "AN"], [4, "PID"], [6, "วันเข้ารักษา"], [7, "วันจำหน่าย"], [8, "PROJCODE"],
  [9, "AdjRW"], [10, "เรียกเก็บ"], [11, "พรบ."], [12, "พึงรับ"], [19, "พึงรับทั้งหมด"], [20, "SEQ NO"],
];
const OFC_HEAD2 = (from: number): [number, string][] =>
  ["ค่าห้อง", "ค่าอวัยวะฯ", "ค่ายา", "ค่ารักษา", "ค่ารถ", "กรณีพักรอจำหน่าย", "ค่าบริการอื่นๆ"].map((h, i) => [from + i, h]);
const OFC_SUMMARY_HEAD: [number, string][] = [[0, "งวด"], [1, "HCODE"], [2, "REP NO"], [3, "ข้อมูลปกติ"], [6, "เรียกเก็บ"], [7, "พรบ."], [8, "พึงรับ"], [15, "จ่ายชดเชยทั้งสิ้น"]];

function parseOfc(detailWs: WorkSheet, summaryWs: WorkSheet) {
  const rows: StmRow[] = [];
  const aoa = toAoa(detailWs);
  let rep: string | null = null;
  let head = false;
  for (let r = 0; r < aoa.length; r++) {
    const v = aoa[r] ?? [];
    const block = /^REP NO\s*:\s*(\d+)$/.exec(norm(v[0]));
    if (block) {
      rep = block[1];
      head = false;
      continue;
    }
    if (norm(v[0]) === "REP" && norm(v[1]) === "ลำดับที่") {
      checkKeys("พึงรับ", v, OFC_DETAIL_HEAD);
      checkKeys("พึงรับ", aoa[r + 1] ?? [], OFC_HEAD2(12));
      head = true;
      continue;
    }
    if (!rep || !head || !digits(v[0]) || !digits(v[1])) continue;
    if (norm(v[0]) !== rep) throw new Error(`ชีต พึงรับ แถว ${r + 1} REP ไม่ตรงกับหัวบล็อก REP NO : ${rep}`);
    const paid = amount(v[19]);
    if (paid === null) throw new Error(`ชีต พึงรับ แถว ${r + 1} ไม่มียอดพึงรับทั้งหมด`);
    rows.push({
      section: "normal",
      rep_no: rep,
      line_no: int(v[1]) ?? 0,
      tran_id: null,
      hn: text(v[2]),
      an: text(v[3]),
      pid: text(v[4]),
      seq_no: text(v[20]),
      admit_at: stmDateTime(v[6]),
      discharge_at: stmDateTime(v[7]),
      main_inscl: null,
      proj: text(v[8]),
      source: null,
      adjrw: amount(v[9]),
      claim_total: amount(v[10]),
      paid_total: paid,
      fund_amounts: funds(v, range(12, 7), OFC_FUNDS),
    });
  }

  const sa = toAoa(summaryWs);
  checkKeys("สรุป(พึงรับ)", sa[0] ?? [], OFC_SUMMARY_HEAD);
  checkKeys("สรุป(พึงรับ)", sa[2] ?? [], [[3, "ทั้งหมด"], [4, "ผ่าน"], [5, "ไม่ผ่าน"], ...OFC_HEAD2(8)]);
  const summaries: StmSummary[] = [];
  for (const v of sa.slice(3).map((x) => x ?? [])) {
    if (!digits(v[2])) continue;
    const paid = amount(v[15]);
    if (paid === null) throw new Error(`ชีต สรุป(พึงรับ) REP ${norm(v[2])} ไม่มียอดจ่ายชดเชยทั้งสิ้น`);
    summaries.push({
      section: "normal",
      rep_no: norm(v[2]),
      period_label: text(v[0]),
      cases: int(v[3]),
      passed: int(v[4]),
      failed: int(v[5]),
      claim_total: amount(v[6]),
      amounts: funds(v, range(8, 7), OFC_FUNDS),
      paid_total: paid,
      source: null,
    });
  }

  // ไม่มีแถวรวม จึงเทียบยอดรายละเอียดกับสรุปราย REP
  const byRep = new Map<string, number>();
  for (const r of rows) byRep.set(r.rep_no, (byRep.get(r.rep_no) ?? 0) + cents(r.paid_total));
  const sumRep = new Map(summaries.map((s) => [s.rep_no, cents(s.paid_total)]));
  for (const rep of new Set([...byRep.keys(), ...sumRep.keys()])) {
    const d = byRep.get(rep) ?? 0;
    const s = sumRep.get(rep) ?? 0;
    if (d !== s) throw new Error(`ยอดรวมไม่ตรงกัน (REP ${rep}): รายละเอียด ${fmt(d)}, สรุป ${fmt(s)}`);
  }
  const paidTotal = baht([...sumRep.values()].reduce((a, b) => a + b, 0));
  return { rows, summaries, paidTotal, deduction: 0, netTotal: paidTotal };
}

// ---------- entry ----------

/** อ่านไฟล์ STM ทั้งสองรูปแบบ ตรวจยอดรวมระหว่างชีตก่อนคืนผล (ไม่ตรง = throw) */
export function parseStm(buf: Uint8Array): ParsedStm {
  let wb;
  try {
    wb = read(buf, { type: "buffer" });
  } catch {
    throw new Error("อ่านไฟล์ไม่ได้ ไม่ใช่ไฟล์ Excel");
  }
  // ชื่อชีตของ UC มีช่องว่างหน้า/หลัง
  const sheets = wb.SheetNames.map((n) => [norm(n), wb.Sheets[n]] as [string, WorkSheet]);
  const byName = new Map(sheets);
  const first = toAoa(sheets[0]?.[1] ?? {});
  const docNo = docNoOf(first);

  const uc = byName.has("รายงานพึงรับ") && sheets.some(([n]) => /^รายละเอียด\(ข้อมูลปกติ\) \d+ (OP|IP)$/.test(n));
  const ofc = byName.has("พึงรับ") && byName.has("สรุป(พึงรับ)");
  if (!uc && !ofc) throw new StmUnsupportedError("ไม่ใช่ไฟล์ STM รูปแบบที่รองรับ (UC หรือ OFC)");
  if (!docNo) throw new Error("ไม่พบเลขที่เอกสารในไฟล์");

  // UC ปีเป็น พ.ศ. (OPUCS256812) ส่วน OFC เป็น ค.ศ. (OP202512)
  const m = (uc ? /^(\d+)_(OP|IP)UCS(\d{4})(\d{2})_(\d+)$/ : /^(\d+)_(OP|IP)(\d{4})(\d{2})_(\d+)$/).exec(docNo);
  if (!m) throw new StmUnsupportedError(`ยังไม่รองรับเลขที่เอกสาร ${docNo}`);
  const year = Number(m[3]) - (uc ? 543 : 0);
  const month = Number(m[4]);
  if (month < 1 || month > 12 || year < 2000) throw new Error(`เลขที่เอกสาร ${docNo} มีงวดไม่ถูกต้อง`);

  const body = uc ? parseUc(sheets) : parseOfc(byName.get("พึงรับ")!, byName.get("สรุป(พึงรับ)")!);
  const patientType = m[2] as "OP" | "IP";
  if (!body.rows.length) throw new Error("ไม่พบรายการในไฟล์");

  // unique (section, rep_no, line_no) ในฐาน ตรวจก่อนเพื่อบอกเหตุชัดกว่า error ของฐาน
  const seen = new Set<string>();
  for (const r of body.rows) {
    const k = `${r.section}|${r.rep_no}|${r.line_no}`;
    if (seen.has(k)) throw new Error(`รายการซ้ำในไฟล์ (REP ${r.rep_no} ลำดับที่ ${r.line_no})`);
    seen.add(k);
  }
  const seenRep = new Set<string>();
  for (const s of body.summaries) {
    const k = `${s.section}|${s.rep_no}`;
    if (seenRep.has(k)) throw new Error(`REP ${s.rep_no} ซ้ำในชีตสรุป`);
    seenRep.add(k);
  }

  return {
    docNo,
    hcode: m[1],
    scheme: uc ? "UCS" : "OFC",
    layout: uc ? "uc" : "csmbs",
    patientType,
    periodMonth: `${year}-${String(month).padStart(2, "0")}-01`,
    runNo: Number(m[5]),
    printedAt: printedOf(first),
    ...body,
  };
}
