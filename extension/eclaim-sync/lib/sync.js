// ขั้นตอนดึง REP/STM จาก e-Claim ที่ใช้ร่วมกันระหว่าง extension (sw.js), หน้า /fund/rep-import และ scripts/eclaim-sync.mjs
// pure ไม่แตะ chrome/DOM: งานจริง (fetch ในแท็บ e-Claim, อัปโหลดเข้าแอป) ส่งเข้ามาเป็น io ของแต่ละที่
// test: node --test extension/eclaim-sync/lib/

const pad = (n) => String(n).padStart(2, "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const ECLAIM_ORIGIN = "https://eclaim.nhso.go.th";
export const DELAY_MS = 300; // เว้นระหว่าง request ไป e-Claim
export const CHUNK = 4 * 1024 * 1024; // ส่งไฟล์ข้ามแท็บทีละ 4 MB (base64 ~5.3 MB ต่อข้อความ ต่ำกว่าเพดาน 64 MiB ของ runtime messaging)
export const MAX_BYTES = 30 * 1024 * 1024; // เท่า MAX_FILE_BYTES ของ route นำเข้า
export const REP_SCHEMES = ["ucs", "ofc", "lgo", "bkk", "bmt"];
export const EXPIRED = "e-Claim หมดอายุ: login ThaiD ในแท็บ e-Claim ใหม่แล้วลองอีกครั้ง";
export const APP_EXPIRED = "BKH Insight หมดอายุ: login ใหม่แล้วลองอีกครั้ง";
export const CANCELLED = "ยกเลิกแล้ว";
export const STM_UNSUPPORTED = "ข้าม STM BKK/SSS/LGO: ยังไม่รองรับ";
export const OFC_NO_ZONE = "ไม่รู้ zone/จังหวัด: อ่านจากหน้า Statement OFC ของ e-Claim ไม่ได้ (เปิดหน้านั้นในแท็บ e-Claim ได้หรือไม่ หรือใส่ --zone= --province= เมื่อรันคำสั่ง)";
export const STM_PATH = "/api/fund/stm-import";
export const HSUB_PATH = "/api/fund/stm-import/hsub";
export const HSUB_NO_STM = "ยังไม่มี STM UC ผู้ป่วยนอกงวดเดียวกันในระบบ: นำเข้า STM งวดนั้นก่อน";
export const HSUB_STM_FAILED = "ไม่มี STM คู่: นำเข้า STM งวดเดียวกันไม่สำเร็จ";
export const OFC_DATE_NOTE = "STM OFC/BMT ใช้ \"ออกรายงานวันที่\" ในไฟล์เป็นวันที่ออก STM เพราะรายการบน e-Claim ไม่มีวันที่ออก (รอยืนยันกับไฟล์จริง)";

/** หยุดทั้งรอบพร้อมข้อความ (หมดอายุ, ไม่มีแท็บ, ยกเลิก) ; Error อื่นนับเป็นไม่สำเร็จรายการเดียว */
export class Stop extends Error {}

/** "YYYY-MM" ของวันนี้ตามเวลาไทย */
export function thaiMonthNow(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" }).format(now).slice(0, 7);
}

/** ปีงบประมาณปัจจุบัน: 1 ต.ค. ถึงเดือนนี้ */
export function fiscalRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  return { from: `${m >= 10 ? y : y - 1}-10`, to: ym };
}

/** ปีงบ (ค.ศ.) ของเดือน: ต.ค. ขึ้นปีงบใหม่ */
export const fiscalYear = (ym) => Number(ym.slice(0, 4)) + (Number(ym.slice(5, 7)) >= 10 ? 1 : 0);

/** เดือนในช่วง (รวมปลาย) เป็น [{ y, m }] ค.ศ. */
export function months(from, to) {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push({ y, m });
    if (++m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

const YM = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** ช่วงเดือน from/to (YYYY-MM ค.ศ.) ผิดคืนข้อความ ไม่ผิดคืน null */
export function rangeError(from, to, nowYm = thaiMonthNow()) {
  if (!YM.test(from) || !YM.test(to)) return "เดือนต้องเป็น YYYY-MM (ค.ศ.) เช่น 2026-10";
  if (from > to) return "เดือนเริ่มต้องไม่หลังเดือนสุดท้าย";
  if (to > nowYm) return "เดือนสุดท้ายต้องไม่เกินเดือนนี้";
  return null;
}

/** argv ของ npm run eclaim:sync -> options ; ค่าผิดคืน { error } */
export function parseArgs(argv, env = {}, nowYm = thaiMonthNow()) {
  const flags = Object.fromEntries(argv.map((a) => {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, undefined];
  }));
  const unknown = Object.keys(flags).filter((k) => !["from", "to", "dry-run", "hcode", "app", "cdp", "zone", "province"].includes(k));
  if (unknown.length) return { error: `ไม่รู้จัก ${unknown.join(" ")} (ใช้ได้: --from=YYYY-MM --to=YYYY-MM --dry-run --hcode= --app= --cdp= --zone= --province=)` };
  const fy = fiscalRange(nowYm);
  const from = flags.from ?? fy.from;
  const to = flags.to ?? fy.to;
  const bad = rangeError(from, to, nowYm);
  if (bad) return { error: `--from/--to: ${bad}` };
  const str = (v) => (typeof v === "string" && v ? v : undefined);
  return {
    from,
    to,
    dryRun: flags["dry-run"] === true,
    hcode: str(flags.hcode) ?? str(env.ECLAIM_SYNC_HCODE),
    app: (str(flags.app) ?? str(env.ECLAIM_SYNC_APP_URL) ?? "http://localhost:3000").replace(/\/+$/, ""),
    cdp: str(flags.cdp) ?? str(env.ECLAIM_SYNC_CDP),
    zone: str(flags.zone) ?? str(env.ECLAIM_SYNC_ZONE),
    province: str(flags.province) ?? str(env.ECLAIM_SYNC_PROVINCE),
  };
}

/** "06/11/2569" (พ.ศ.) -> "2026-11-06" ; ไม่ใช่วันจริงคืน null */
export function beToIso(s) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s ?? "");
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3]) - 543];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null;
}

// ชนิด REP ที่ /api/fund/rep-import อ่านได้ (rep.ts): UC IP/OP/OP_APPEAL_*/ORF และสิทธิอื่น IP/OP × CS/LGO/BKK/BMT รวม _APPEAL
const REP_OK = /^(IP|OP|OP_APPEAL\w*|ORF|(IP|OP)(CS|LGO|BKK|BMT)(_APPEAL\w*)?)$/;
const REP_FILE = /^eclaim_\d+_[A-Za-z0-9_]+?_\d{8}_\d+\.ecd$/;

/** eclaim_{hcode}_{TYPE}_{yyyymmdd พ.ศ.}_{n}.ecd -> TYPE */
export const repTypeOf = (fn) => /^eclaim_\d+_(.+)_\d{8}_\d+\.ecd$/.exec(fn)?.[1] ?? null;

/** เหตุที่ข้าม หรือ null ถ้านำเข้าได้ */
export function repSkip(type) {
  if (!type) return "ชื่อไฟล์ไม่ตรงรูปแบบ";
  return REP_OK.test(type) ? null : `ยังไม่รองรับ ${type}`;
}

/** ชื่อไฟล์ที่นำเข้า = ชื่อบน e-Claim เปลี่ยน .ecd เป็น .xls (ตรง FILE_RE ของ rep.ts) */
export const xlsName = (fn) => fn.replace(/\.ecd$/, ".xls");

export const UC_DOC = /^\d+_(OP|IP)UCS\d{6}_\d+$/;
export const OFC_DOC = /^\d+_(OP|IP)\d{6}_\d+$/;

/** เลขที่ STM UC ผู้ป่วยนอก -> งวดของรายงาน Hsub: "11252_OPUCS256910_01" -> "6910_OP_01" (= period_month + run_no ของ stm_file) ; อื่นๆ null */
export function hsubPeriod(doc) {
  const m = /^\d+_OPUCS\d\d(\d{2})(\d{2})_(\d+)$/.exec(doc ?? "");
  return m ? `${m[1]}${m[2]}_OP_${m[3].padStart(2, "0")}` : null;
}

/**
 * อาร์กิวเมนต์ของทุกการเรียก name(...) ใน HTML (เช่น onclick="downloadBill('a','b')") เป็น string[] ต่อครั้ง
 * ถอด entity ก่อน และข้ามการประกาศ function name(...)
 */
export function callArgs(src, name) {
  const s = src
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const ws = (c) => c !== undefined && /\s/.test(c);
  const out = [];
  const re = new RegExp(`(?<!function\\s+)\\b${name}\\s*\\(`, "g");
  while (re.exec(s)) {
    let i = re.lastIndex;
    const args = [];
    while (i < s.length) {
      while (ws(s[i])) i++;
      if (s[i] === ")") break;
      let v = "";
      const q = s[i];
      if (q === "'" || q === '"') {
        for (i++; i < s.length && s[i] !== q; i++) v += s[i] === "\\" ? s[++i] : s[i];
        i++;
      } else {
        while (i < s.length && s[i] !== "," && s[i] !== ")") v += s[i++];
        v = v.trim();
      }
      args.push(v);
      while (ws(s[i])) i++;
      if (s[i] !== ",") break;
      i++;
    }
    out.push(args);
  }
  return out;
}

/** หน้ารายการ REP (ValidationMainAction) -> [{ fn, repNo, date }] ไม่คืนข้อมูลอื่นของแถว (เช่น ชื่อผู้ดาวน์โหลด) */
export function parseRepList(html) {
  const out = [];
  const seen = new Set();
  for (const tr of html.split(/<tr[\s>]/i).slice(1)) {
    const fn = /eclaim_\d+_[A-Za-z0-9_]+?_\d{8}_\d+\.ecd/.exec(tr)?.[0];
    if (!fn || seen.has(fn)) continue;
    seen.add(fn);
    const text = tr.split(fn).join(" ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ");
    out.push({ fn, repNo: /(?<![\d_])\d{9,12}(?![\d_])/.exec(text)?.[0] ?? null, date: /\d{2}\/\d{2}\/\d{4}/.exec(text)?.[0] ?? null });
  }
  return out;
}

/** ข้อความของแต่ละช่อง <td>/<th> ในแถว */
export function cellsOf(tr) {
  return [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1].replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim());
}

/**
 * รายการ STM UC (statementUCSViewAction) -> [{ doc, personType, hcode, hname, province, issued, argc }]
 * issued = "วันที่ออก Statement" (dd/mm/yyyy พ.ศ.) จากคอลัมน์ที่หัวตารางมีคำว่า "วันที่ออก" ; ไม่พบ issued = null และ head = ข้อความหัวตาราง (ไว้ดูว่าหน้าเปลี่ยนอย่างไร)
 * shortcut: ลำดับอาร์กิวเมนต์ downloadBill เดาจากลำดับ param ของ URL ดาวน์โหลด ถ้า "ตรวจรายการ" ฟ้อง "รูปแบบปุ่มดาวน์โหลด" ให้แก้ลำดับที่นี่
 */
export function parseUcStmList(html) {
  const out = [];
  let idx = -1;
  let head = null;
  // หน้าจริง: หัวตารางเป็น <thead><th>.. ไม่มี <tr> และแถวข้อมูลมี <td> ที่ comment ไว้ (ทำให้นับช่องเลื่อน)
  for (const tr of html.replace(/<!--[\s\S]*?-->/g, "").split(/<(?:tr|thead)[\s>]/i).slice(1)) {
    const row = cellsOf(tr);
    const calls = callArgs(tr, "downloadBill");
    if (!calls.length) {
      const h = row.findIndex((c) => /วันที่ออก|ออก\s*Statement/i.test(c));
      if (h >= 0) idx = h;
      if (row.length > 1) head ??= row;
      continue;
    }
    // ไม่พบหัวคอลัมน์: ใช้ช่องที่เป็นวันที่ พ.ศ. ล้วนถ้ามีช่องเดียว
    const dates = row.filter((c) => /^\d{2}\/\d{2}\/25\d\d$/.test(c));
    const issued = (idx >= 0 ? /\d{2}\/\d{2}\/\d{4}/.exec(row[idx] ?? "")?.[0] : null) ?? (dates.length === 1 ? dates[0] : null);
    for (const a of calls) {
      out.push({ doc: a[0], personType: a[1], hcode: a[2], hname: a[3], province: a[4], issued, argc: a.length, ...(!issued && { head: head?.join(" | ") ?? "" }) });
    }
  }
  return out;
}

/**
 * รายการ STM OFC (StatementReportWebActionList) -> [{ hcode, maininscl, personType, gyear, gmonth, revision, doc, argc }]
 * shortcut: ลำดับอาร์กิวเมนต์ getReportNCHReportRepOFC เดาจากลำดับ field ของ POST ดาวน์โหลด ผิดแล้ว "ตรวจรายการ" จะฟ้อง
 * หน้า STM BMT (bmt/BmtViewAction) ใช้ getReportNCHReportRep ลำดับเดียวกัน (พบจริง: '11252','BMT','1','2027','10','21','11252_OP202610_21' gyear = ปีงบ)
 */
export function parseOfcStmList(html, fn = "getReportNCHReportRepOFC") {
  const seen = new Set();
  return callArgs(html, fn)
    .map((a) => ({ hcode: a[0], maininscl: a[1], personType: a[2], gyear: a[3], gmonth: a[4], revision: a[5], doc: a[6], argc: a.length }))
    .filter((r) => !seen.has(r.doc) && seen.add(r.doc));
}

/**
 * รายการรายงานพึงจ่าย รพ.สต. (statement_hsub/viewPage.do, TYPE_STMT 2 = พึงจ่าย) -> [{ period, gyear, issued, argc }]
 * แถว: ลำดับ | ปีงบ | STMT_PERIOD | วันที่ออก Statement | ปุ่ม downloadReportExcel('6910_OP_01', '2027')
 * ไม่พบ "พบข้อมูลทั้งหมด N รายการ" หรือจำนวนไม่ตรง (เช่น แบ่งหน้า) = throw ไม่ให้ตกหล่นเงียบ
 */
export function parseHsubList(html) {
  const out = [];
  for (const tr of html.replace(/<!--[\s\S]*?-->/g, "").split(/<tr[\s>]/i).slice(1)) {
    const calls = callArgs(tr, "downloadReportExcel");
    if (!calls.length) continue;
    const dates = cellsOf(tr).filter((c) => /^\d{2}\/\d{2}\/25\d\d$/.test(c));
    for (const a of calls) out.push({ period: a[0], gyear: a[1], issued: dates.length === 1 ? dates[0] : null, argc: a.length });
  }
  const total = /พบข้อมูลทั้งหมด\s*([\d,]+)\s*รายการ/.exec(html)?.[1];
  if (total == null) {
    // แนบข้อความต้นหน้า (หน้ารายการไม่มีข้อมูลผู้ป่วย) ไว้ดูว่า e-Claim ตอบอะไร
    const got = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(`หน้ารายการ Hsub ไม่ตรงที่คาด (ไม่พบจำนวนรายการ)${got ? `: ${got}` : ""}`);
  }
  if (Number(total.replace(/,/g, "")) !== out.length) throw new Error(`รายการ Hsub อ่านได้ ${out.length} จาก ${total} (หน้าเปลี่ยนหรือแบ่งหน้า แจ้งผู้ดูแลแก้ parseHsubList)`);
  return out;
}

// ---------- คำขอไป e-Claim: ผู้เรียกส่งแค่ชนิดกับค่า URL สร้างที่นี่ที่เดียว และตรวจทุกค่าก่อน (extension ไม่ยิง URL ที่หน้าเว็บส่งมา) ----------

// query ที่มีภาษาไทย (hname) เก็บตัวอักษรไว้ให้แท็บ e-Claim encode ตาม charset ของหน้าเอง (ดู ecFetch) escape แค่ตัวที่ตัด query
const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${String(v ?? "").replace(/[%&#+]/g, encodeURIComponent)}`).join("&");

const code = /^[A-Za-z0-9_-]{1,40}$/;
const FIELD = {
  m: /^([1-9]|1[0-2])$/, ye: /^25\d\d$/, scheme: /^(ucs|ofc|lgo|bkk|bmt)$/, hcode: /^\d{5}$/, fn: REP_FILE,
  fy: /^20\d\d$/, mm: /^(0[1-9]|1[0-2])$/, y: /^20\d\d$/,
  doc: code, personType: /^\d{1,2}$/, hname: /^[^\0-\x1f<>]{0,200}$/u, provinceName: /^[^\0-\x1f<>]{0,200}$/u,
  period: /^\d{4}_OP_\d{2}$/,
  zone: code, province: code, maininscl: code, gyear: /^20\d\d$/, gmonth: /^(0?[1-9]|1[0-2])$/, revision: /^\d{1,3}$/,
};

const REQ = {
  repList: [["m", "ye", "scheme", "hcode"], (p) => ["/webComponent/validation/ValidationMainAction.do",
    qs({ mo: p.m, ye: p.ye, repNo: "", maininscl: p.scheme, zp: p.hcode, lev: "H", bc: "null", bc2: "null" })]],
  repFile: [["fn", "hcode", "m", "ye"], (p) => [`/webComponent/invoice/InvoiceReportExcelAction.do?${qs({
    status: "excel", filename: p.fn, zphid: p.hcode, level: "H", month: p.m, year: p.ye })}`, null]],
  ucsList: [["fy", "mm", "hcode"], (p) => [`/webComponent/ucs/statementUCSViewAction.do?${qs({
    PAGE_HEAD: "", year: p.fy, month: p.mm, person_type: "", hcode: p.hcode, period_no: "" })}`, null]],
  ucsFile: [["doc", "personType", "hcode", "hname", "provinceName"], (p) => [`/webComponent/ucs/statementUCSDownloadAction.do?${qs({
    document_no: p.doc, person_type: p.personType, hcode: p.hcode, hname: p.hname, province_name: p.provinceName, datesend_from: "", datesend_to: "" })}`, null]],
  ofcList: [["zone", "province", "hcode", "y", "mm"], (p) => [`/webComponent/nch/StatementReportWebActionList.do?${qs({
    zone: p.zone, province_id: p.province, hcode: p.hcode, maininscl: "OFC", gyear: p.y, gmonth: p.mm, ddlPerson_type: "" })}`, null]],
  ofcFile: [["hcode", "maininscl", "personType", "gyear", "gmonth", "revision", "doc"], (p) => ["/webComponent/nch/RepStatementOFCReportExcelWebAction.do",
    qs({ hcode: p.hcode, maininscl: p.maininscl, person_type: p.personType, gyear: p.gyear, gmonth: p.gmonth, revision: p.revision, documentno: p.doc })]],
  // STM BMT (ขสมก.): รายการต่อเดือนปฏิทิน (ddlYear ค.ศ., ddlMonth ไม่เติม 0 ตามที่ทดสอบกับหน้าจริง) × OP/IP ไม่ต้องใช้ zone/จังหวัด ; ดาวน์โหลด field เดียวกับ ofcFile
  bmtList: [["hcode", "y", "m", "personType"], (p) => [`/webComponent/bmt/BmtViewAction.do?${qs({
    ddlZone: "", ddlProvince: "", ddlLHospital: p.hcode, maininscl: "BMT", ddlStatus: "", ddlYear: p.y, ddlMonth: p.m, ddlPerson_type: p.personType, chkhcode: "N" })}`, null]],
  bmtFile: [["hcode", "maininscl", "personType", "gyear", "gmonth", "revision", "doc"], (p) => ["/webComponent/bmt/StatementReportExcelWebAction.do",
    qs({ hcode: p.hcode, maininscl: p.maininscl, person_type: p.personType, gyear: p.gyear, gmonth: p.gmonth, revision: p.revision, documentno: p.doc })]],
  hsubList: [["fy"], (p) => ["/webComponent/statement_hsub/viewPage.do", qs({ PAGE_HEAD: "", TYPE_STMT: "2", GYEAR: p.fy, STMT_PERIOD: "" })]],
  // field ครบตามฟอร์ม op43-excel-form ของหน้า (ZONE/PROVINCE/HCODE ว่าง, gyear/hcode_report_excel เป็น hidden ค่าคงที่ของหน้า)
  hsubFile: [["fy", "period"], (p) => [`/webComponent/statement_hsub/DownloadExcelPage.do?${qs({
    return_gyear: p.fy, return_stmt_period: p.period, TYPE_STMT: "2", ZONE: "", PROVINCE: "", HCODE: "", VAR_HCODE2: "", gyear_report_excel: "2019", hcode_report_excel: "13814" })}`, null]],
};

export const PARSERS = {
  repList: parseRepList, ucsList: parseUcStmList, ofcList: parseOfcStmList, bmtList: (h) => parseOfcStmList(h, "getReportNCHReportRep"), hsubList: parseHsubList,
};
const FILE_KINDS = ["repFile", "ucsFile", "ofcFile", "bmtFile", "hsubFile"];

/** ชนิดคำขอ + ค่า -> { url, body } (path ของ e-Claim) ; ชนิดหรือค่าผิดคืน { error } */
export function ecRequest(kind, p) {
  const def = Object.hasOwn(REQ, kind) ? REQ[kind] : null;
  if (!def || !p || typeof p !== "object") return { error: "คำขอไม่ถูกต้อง" };
  const clean = {};
  for (const k of def[0]) {
    const v = p[k];
    if ((typeof v !== "string" && typeof v !== "number") || !FIELD[k].test(String(v))) return { error: `ค่าไม่ถูกต้อง: ${k}` };
    clean[k] = String(v);
  }
  const [url, body] = def[1](clean);
  return { url, body };
}

/**
 * ข้อความจากหน้า BKH Insight (ผ่าน content script) -> คำสั่งที่ service worker ทำได้ ; ผิดคืน { error }
 * ping | select | list {kind, p} | download {kind, p} | chunk {tabId, start, end} | release {tabId}
 */
export function checkMessage(m) {
  const bad = { error: "คำขอไม่ถูกต้อง" };
  if (!m || typeof m !== "object") return bad;
  const tab = Number.isSafeInteger(m.tabId) && m.tabId >= 0;
  switch (m.op) {
    case "ping":
    case "select":
      return { op: m.op };
    case "list":
    case "download": {
      const ok = m.op === "list" ? Object.hasOwn(PARSERS, m.kind) : FILE_KINDS.includes(m.kind);
      if (!ok) return bad;
      const req = ecRequest(m.kind, m.p);
      return req.error ? req : { op: m.op, kind: m.kind, req };
    }
    case "chunk": {
      const { start, end } = m;
      const ok = tab && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start && end - start <= CHUNK && end <= MAX_BYTES;
      return ok ? { op: m.op, tabId: m.tabId, start, end } : bad;
    }
    case "release":
      return tab ? { op: m.op, tabId: m.tabId } : bad;
    default:
      return bad;
  }
}

// ---------- ขั้นตอน: plan = อ่านรายการทั้งหมดแล้วสรุป (ไม่ดาวน์โหลด), run = นำเข้าตามรายการของ plan ----------
//
// io (แต่ละที่ทำเอง ผลเป็นรูปเดียวกัน: ข้อมูล หรือ { expired } | { status } (HTTP ของ e-Claim) | { fatal } (หยุดทั้งรอบ) | { error }):
//   list(kind, p) -> { items }        download(kind, p) -> { size, ... } (handle ส่งต่อให้ chunk/release)
//   chunk(handle, start, end) -> { b64 }    release(handle)    select() -> { zone, province } จากหน้า Statement OFC ของ e-Claim
//   done(path, key) -> { values } | { status }   upload(path, name, fields, chunks) -> { status, body }   (ฝั่งแอป ใช้ session ของแอป)

/** ผลจาก io ฝั่ง e-Claim: ผิดพลาด throw (Stop = หยุดทั้งรอบ) */
function ecCheck(r) {
  if (!r) throw new Stop("extension ไม่ตอบ");
  if (r.fatal) throw new Stop(r.fatal);
  if (r.expired) throw new Stop(EXPIRED);
  if (r.status) throw new Error(`e-Claim ตอบ HTTP ${r.status}`);
  if (r.error) throw new Error(r.error);
  return r;
}

async function step(signal, delayMs) {
  if (signal?.aborted) throw new Stop(CANCELLED);
  await sleep(delayMs);
  if (signal?.aborted) throw new Stop(CANCELLED);
}

/** key ของทุกแถวที่นำเข้าแล้ว (key เป็น array = object ของ field เหล่านั้นต่อแถว) */
async function appValues(io, path, key) {
  const r = await io.done(path, key);
  if (r.status === 401) throw new Stop(APP_EXPIRED);
  if (r.status) throw new Stop(`อ่านรายการที่นำเข้าแล้วจาก ${path} ไม่ได้ (HTTP ${r.status})`);
  return r.values;
}

/**
 * @typedef {{ found: number, already: number, pending: number, imported: number, failed: number, skipped: number }} GroupStat
 * @typedef {{ status: string, rows?: number, cases?: number, error?: string }} ImportResult
 * @typedef {{ g: string, name: string, kind: string, p: Record<string, string | number>, path: string, fields: Record<string, string>, repNo?: string | null, date?: string, stmDoc?: string, result?: ImportResult }} Todo
 * @typedef {{ hcode: string | null, stats: Record<string, GroupStat>, skips: { g: string, reason: string, n: number }[], failures: { g: string, what: string, msg: string }[], todo: Todo[] }} Plan
 */

/** ตัวนับต่อกลุ่ม (เช่น "REP UCS") */
const stat = (res, g) => (res.stats[g] ??= { found: 0, already: 0, pending: 0, imported: 0, failed: 0, skipped: 0 });

function skip(res, g, reason) {
  stat(res, g).skipped++;
  const s = res.skips.find((x) => x.g === g && x.reason === reason);
  if (s) s.n++;
  else res.skips.push({ g, reason, n: 1 });
}

function fail(res, g, what, msg) {
  stat(res, g).failed++;
  res.failures.push({ g, what, msg });
}

/**
 * อ่านรายการ REP ทุกสิทธิ, STM UC, Hsub (รายงานพึงจ่าย รพ.สต.), STM OFC และ STM BMT ในช่วง from..to (YYYY-MM ค.ศ.) แล้วแยกว่านำเข้าแล้ว / จะนำเข้า / ข้าม
 * คืน { hcode, stats, skips, failures, todo: [{ g, name, kind, p, path, fields, repNo?, date? }] }
 * Stop = หยุดทั้งรอบ ; ข้อผิดพลาดของรายการเดียวลง failures แล้วทำต่อ
 * @param {{ from: string, to: string, hcode?: string, zone?: string, province?: string }} opt
 * @param {any} io
 * @param {{ signal?: AbortSignal, onProgress?: (p: { done: number, total: number, label: string }) => void, delayMs?: number }} [hooks]
 * @returns {Promise<Plan>}
 */
export async function plan(opt, io, { signal, onProgress = () => {}, delayMs = DELAY_MS } = {}) {
  /** @type {Plan} */
  const res = { hcode: null, stats: {}, skips: [], failures: [], todo: [] };
  const ms = months(opt.from, opt.to);
  const [fyFrom, fyTo] = [fiscalYear(opt.from), fiscalYear(opt.to)];
  const [lo, hi] = [`${opt.from}-01`, `${opt.to}-31`]; // ช่วงวันที่ออก Statement (STM UC, Hsub)
  const total = ms.length * REP_SCHEMES.length + (fyTo - fyFrom + 1) * 13 + ms.length * 3; // REP, STM UC 12 + Hsub 1 ต่อปีงบ, OFC 1 + BMT 2 ต่อเดือน
  let done = 0;
  const list = async (g, label, kind, p) => {
    await step(signal, delayMs);
    onProgress({ done, total, label: `${g} ${label}` });
    try {
      return ecCheck(await io.list(kind, p)).items;
    } catch (e) {
      if (e instanceof Stop) throw e;
      fail(res, g, `รายการ ${label}`, e.message);
      return [];
    } finally {
      done++;
    }
  };

  const repDone = new Set(await appValues(io, "/api/fund/rep-import", "file_name"));
  const stmRows = await appValues(io, STM_PATH, ["id", "doc_no", "has_hsub"]);
  const stmDone = new Set(stmRows.map((r) => r.doc_no));
  const hcode = opt.hcode ?? [...repDone].map((n) => /^eclaim_(\d+)_/.exec(n)?.[1]).find(Boolean);
  if (!hcode || !FIELD.hcode.test(hcode)) throw new Stop("ไม่รู้รหัสหน่วยบริการ: นำเข้าไฟล์ REP ด้วยมือก่อนอย่างน้อย 1 ไฟล์ (หรือใส่ --hcode= เมื่อรันคำสั่ง)");
  res.hcode = hcode;

  // REP: endpoint เดียวทุกสิทธิ รายเดือน (ye เป็น พ.ศ.)
  const seenRep = new Set();
  for (const { y, m } of ms) {
    const ye = y + 543;
    for (const sc of REP_SCHEMES) {
      const g = `REP ${sc.toUpperCase()}`;
      for (const it of await list(g, `${pad(m)}/${ye}`, "repList", { m, ye, scheme: sc, hcode })) {
        if (seenRep.has(it.fn)) continue;
        seenRep.add(it.fn);
        const s = stat(res, g);
        s.found++;
        const why = repSkip(repTypeOf(it.fn));
        if (why) {
          skip(res, g, why);
          continue;
        }
        const name = xlsName(it.fn);
        if (repDone.has(name)) {
          s.already++;
          continue;
        }
        s.pending++;
        res.todo.push({ g, name, kind: "repFile", p: { fn: it.fn, hcode, m, ye }, path: "/api/fund/rep-import", fields: {}, repNo: it.repNo });
      }
    }
  }

  // STM UC: ไม่แน่ใจว่า month ของหน้านี้เป็นเดือนปฏิทินหรือลำดับในปีงบ จึงไล่ทุกเดือนของปีงบที่เกี่ยวข้อง แล้วกรองด้วยวันที่ออก Statement
  // shortcut: 12 request ต่อปีงบ ลดเหลือเฉพาะเดือนในช่วงเมื่อยืนยันความหมายของ month กับหน้าจริงแล้ว
  {
    const g = "STM UCS";
    const seen = new Set();
    for (let fy = fyFrom; fy <= fyTo; fy++) {
      for (let mm = 1; mm <= 12; mm++) {
        for (const it of await list(g, `ปีงบ ${fy + 543} เดือน ${pad(mm)}`, "ucsList", { fy, mm: pad(mm), hcode })) {
          if (seen.has(it.doc)) continue;
          seen.add(it.doc);
          const issued = beToIso(it.issued);
          if (issued && (issued < lo || issued > hi)) continue;
          const s = stat(res, g);
          s.found++;
          if (it.argc < 5 || !UC_DOC.test(it.doc) || !/^[12]$/.test(it.personType)) {
            fail(res, g, it.doc || "?", `รูปแบบปุ่มดาวน์โหลดไม่ตรงที่คาด (${it.argc} ค่า)`);
            continue;
          }
          if (!issued) {
            fail(res, g, it.doc, `ไม่พบวันที่ออก Statement ในรายการ${it.head ? ` (หัวตาราง: ${it.head})` : ""}`);
            continue;
          }
          if (stmDone.has(it.doc)) {
            s.already++;
            continue;
          }
          s.pending++;
          res.todo.push({
            g, name: `STM_${it.doc}.xls`, kind: "ucsFile", path: "/api/fund/stm-import", fields: { transfer_date: issued }, date: issued,
            p: { doc: it.doc, personType: it.personType, hcode: it.hcode, hname: it.hname, provinceName: it.province },
          });
        }
      }
    }
  }

  // Hsub: หนึ่ง request ต่อปีงบ (GYEAR = ปีงบของวันที่ออก) ; จับคู่ STM UC OP ด้วยงวด YYMM_OP_NN ตรงตัว (ไม่เดาจากเดือน)
  // STM คู่ที่จะนำเข้าในรอบนี้อยู่ก่อนใน todo จึงนำเข้า STM ก่อน แล้ว run หา stm_file_id ตอนถึงคิว
  {
    const g = "Hsub รพ.สต.";
    const stmBy = new Map();
    for (const r of stmRows) if (hsubPeriod(r.doc_no)) stmBy.set(hsubPeriod(r.doc_no), r);
    for (const t of res.todo) {
      const k = t.kind === "ucsFile" ? hsubPeriod(String(t.p.doc)) : null;
      if (k && !stmBy.has(k)) stmBy.set(k, { doc_no: String(t.p.doc) });
    }
    const seen = new Set();
    for (let fy = fyFrom; fy <= fyTo; fy++) {
      for (const it of await list(g, `ปีงบ ${fy + 543}`, "hsubList", { fy })) {
        if (seen.has(it.period)) continue;
        seen.add(it.period);
        const issued = beToIso(it.issued);
        if (issued && (issued < lo || issued > hi)) continue;
        const s = stat(res, g);
        s.found++;
        if (it.argc < 2 || !FIELD.period.test(it.period) || !FIELD.fy.test(it.gyear)) {
          fail(res, g, it.period || "?", `รูปแบบปุ่มดาวน์โหลดไม่ตรงที่คาด (${it.argc} ค่า)`);
          continue;
        }
        if (!issued) {
          fail(res, g, it.period, "ไม่พบวันที่ออก Statement ในรายการ");
          continue;
        }
        const stm = stmBy.get(it.period);
        if (!stm) {
          skip(res, g, HSUB_NO_STM);
          continue;
        }
        if (stm.has_hsub) {
          s.already++;
          continue;
        }
        s.pending++;
        res.todo.push({
          g, name: `Hsub_${it.period}.xls`, kind: "hsubFile", p: { fy: it.gyear, period: it.period }, path: HSUB_PATH, date: issued,
          fields: stm.id ? { stm_file_id: String(stm.id) } : {}, stmDoc: stm.doc_no,
        });
      }
    }
  }

  // STM แบบ OFC (OFC, BMT): ปุ่มดาวน์โหลดและไฟล์แบบเดียวกัน ; ไม่ส่ง transfer_date: route ใช้ "ออกรายงานวันที่" ในไฟล์แทน (OFC_DATE_NOTE)
  const csmbsItem = (g, it, seen, kind, name, fields) => {
    if (seen.has(it.doc)) return;
    seen.add(it.doc);
    const s = stat(res, g);
    s.found++;
    if (it.argc < 7 || !OFC_DOC.test(it.doc)) return fail(res, g, it.doc || "?", `รูปแบบปุ่มดาวน์โหลดไม่ตรงที่คาด (${it.argc} ค่า)`);
    if (stmDone.has(it.doc)) return void s.already++;
    s.pending++;
    res.todo.push({
      g, name, kind, path: STM_PATH, fields,
      p: { hcode: it.hcode, maininscl: it.maininscl, personType: it.personType, gyear: it.gyear, gmonth: it.gmonth, revision: it.revision, doc: it.doc },
    });
  };

  // STM OFC: zone/จังหวัดจาก option (--zone/--province) หรือหน้า Statement OFC ที่ io.select อ่านในแท็บ e-Claim
  {
    const g = "STM OFC";
    const sel = opt.zone && opt.province ? {} : ((await io.select()) ?? {});
    const zone = opt.zone ?? sel.zone;
    const province = opt.province ?? sel.province;
    if (!zone || !province) {
      skip(res, g, OFC_NO_ZONE);
    } else {
      const seen = new Set();
      for (const { y, m } of ms) {
        for (const it of await list(g, `${pad(m)}/${y + 543}`, "ofcList", { zone, province, hcode, y, mm: pad(m) })) {
          csmbsItem(g, it, seen, "ofcFile", `STM_${it.doc}.xls`, {});
        }
      }
    }
  }

  // STM BMT (ขสมก.): ไฟล์เหมือน OFC ทุกช่อง จึงส่ง scheme ให้ route บันทึกเป็น BMT ; ชื่อไฟล์มี BMT ให้แยกด้วยตาได้
  {
    const g = "STM BMT";
    const seen = new Set();
    for (const { y, m } of ms) {
      for (const personType of ["1", "2"]) {
        for (const it of await list(g, `${personType === "1" ? "OP" : "IP"} ${pad(m)}/${y + 543}`, "bmtList", { hcode, y, m, personType })) {
          csmbsItem(g, it, seen, "bmtFile", `STM_BMT_${it.doc}.xls`, { scheme: "BMT" });
        }
      }
    }
  }
  onProgress({ done: total, total, label: "" });
  return res;
}

/** ดาวน์โหลดไฟล์เดียวในแท็บ e-Claim ย้ายเป็น chunk แล้วอัปโหลดเข้าแอป -> body ของ route นำเข้า */
async function importOne(it, io, signal, delayMs) {
  await step(signal, delayMs);
  const h = ecCheck(await io.download(it.kind, it.p));
  const chunks = [];
  try {
    if (!h.size) throw new Error("ไฟล์ว่าง");
    if (h.size > MAX_BYTES) throw new Error("ไฟล์ใหญ่เกิน 30 MB");
    for (let s = 0; s < h.size; s += CHUNK) chunks.push(ecCheck(await io.chunk(h, s, Math.min(s + CHUNK, h.size))).b64);
  } finally {
    await io.release(h);
  }
  const r = await io.upload(it.path, it.name, it.fields, chunks);
  if (r.status === 401) throw new Stop(APP_EXPIRED);
  return r.body?.status ? r.body : { status: "error", error: r.body?.error ?? `HTTP ${r.status}` };
}

/**
 * นำเข้าทุกไฟล์ใน res.todo ตามลำดับ (แก้ res.stats/skips/failures และใส่ it.result ทีละไฟล์)
 * Stop (หมดอายุ/ยกเลิก) หยุดทั้งรอบ ไฟล์ที่นำเข้าไปแล้วยังอยู่ รอบถัดไปข้ามเอง
 * @param {Plan} res
 * @param {any} io
 * @param {{ signal?: AbortSignal, onItem?: (it: Todo) => void, delayMs?: number }} [hooks]
 */
export async function run(res, io, { signal, onItem = () => {}, delayMs = DELAY_MS } = {}) {
  let stmIds; // doc_no -> stm_file.id อ่านเมื่อ Hsub ตัวแรกที่ STM คู่เพิ่งนำเข้าในรอบนี้ถึงคิว (STM อยู่ก่อนใน todo)
  for (const it of res.todo) {
    if (it.result) continue;
    let out;
    try {
      if (it.kind === "hsubFile" && !it.fields.stm_file_id) {
        stmIds ??= new Map((await appValues(io, STM_PATH, ["id", "doc_no"])).map((r) => [r.doc_no, String(r.id)]));
        const id = stmIds.get(it.stmDoc);
        if (!id) throw new Error(HSUB_STM_FAILED);
        it.fields.stm_file_id = id;
      }
      out = await importOne(it, io, signal, delayMs);
    } catch (e) {
      if (e instanceof Stop) throw e;
      out = { status: "error", error: e.message };
    }
    const s = stat(res, it.g);
    s.pending--;
    if (out.status === "imported") s.imported++;
    else if (out.status === "duplicate") s.already++;
    else if (out.status === "unsupported") skip(res, it.g, out.error ?? "ระบบยังไม่รองรับ");
    else fail(res, it.g, it.name, out.error ?? out.status ?? "ไม่สำเร็จ");
    it.result = out;
    onItem(it);
  }
  return res;
}
