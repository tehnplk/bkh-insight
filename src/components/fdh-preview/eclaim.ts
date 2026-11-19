// แปลง 16 แฟ้มรูปแบบ FDH (ข้อมูลที่ modal โหลดไว้) เป็นไฟล์นำเข้า e-Claim (pure ไม่มี import ค่า ; test ที่ eclaim.test.mjs)
// รูปแบบตามไฟล์ส่งออก e-Claim ของ HOSxP ที่นำเข้าได้จริง (ลำดับคอลัมน์จากหัว DBF ที่มากับไฟล์): {FILE}.txt ครบ 16 แฟ้มทุกโฟลเดอร์ (ไม่มีแถว = ไฟล์ 0 ไบต์),
// คั่นด้วย | ไม่มีหัวคอลัมน์ ทุกบรรทัดจบ CRLF, UTF-8 ไม่มี BOM, วันที่ YYYYMMDD ; ไม่มี PHDB และ LABFU ; CHA.CHRGITEM ตามตารางหน้า 40 ของประกาศ e-Claim 2564
// หรือ {FILE}.dbf (dBase III ตามหัว DBF ของ HOSxP ใน ECLAIM_DBF เขียนด้วย dbf.ts) จากแถวและค่าชุดเดียวกัน
import type { FileRow } from "@/app/api/fdh/files/txt";
import type { DbfField } from "./dbf";

type File = { file: string; columns: string[]; rows: FileRow[] };
/** data = ข้อความ (.txt) หรือไบต์ (.dbf) */
export type EclaimFolder = { name: string; files: { name: string; data: string | Uint8Array }[]; bytes: number };
/** เขียนไฟล์ DBF หนึ่งแฟ้ม (writeDbf ของ dbf.ts) */
export type DbfWriter = (fields: DbfField[], records: string[][]) => Uint8Array;

/** e-Claim นำเข้าได้ไม่เกิน 10 MB ต่อครั้ง (หนึ่งสิทธิต่อครั้ง = หนึ่งโฟลเดอร์) */
export const ECLAIM_MAX_BYTES = 10 * 1024 * 1024;

/**
 * คอลัมน์ของแต่ละแฟ้มตามลำดับ: `ชื่อ` ใช้ค่าคอลัมน์ชื่อเดียวกันของแฟ้ม FDH, `ชื่อ=ที่มา` ใช้ค่าคอลัมน์อื่น (ec_* = คอลัมน์ช่วยใน SQL ที่ไม่อยู่ในแฟ้ม FDH),
 * `=` ว่าง = ไม่มีแหล่งข้อมูลหรือไฟล์ TXT ของ HOSxP ส่งว่าง ; ต่อท้าย `:2` = ทศนิยม 2 ตำแหน่ง, `:n` = ตัวเลขไม่เติมทศนิยม (1, 100, 0) แบบไฟล์ของ HOSxP
 */
export const ECLAIM_COLUMNS: Record<string, string> = {
  INS: "HN INSCL SUBTYPE CID DATEIN=ec_datein DATEEXP=ec_dateexp HOSPMAIN=ec_hospmain HOSPSUB=ec_hospsub GOVCODE=ec_govcode GOVNAME=ec_govname PERMITNO DOCNO=ec_docno OWNRPID=ec_ownrpid OWNNAME=ec_ownname AN SEQ SUBINSCL RELINSCL= HTYPE",
  PAT: "HCODE HN CHANGWAT AMPHUR DOB SEX MARRIAGE OCCUPA NATION PERSON_ID NAMEPAT TITLE FNAME LNAME IDTYPE",
  OPD: "HN CLINIC=ec_clinic DATEOPD TIMEOPD SEQ UUC",
  ORF: "HN DATEOPD CLINIC=ec_clinic REFER REFERTYPE SEQ",
  ODX: "HN DATEDX CLINIC=ec_clinic DIAG DXTYPE DRDX=ec_drdx PERSON_ID SEQ",
  OOP: "HN DATEOPD CLINIC=ec_clinic OPER DROPID PERSON_ID SEQ",
  IPD: "HN AN DATEADM TIMEADM DATEDSC TIMEDSC DISCHS DISCHT WARDDSC DEPT ADM_W UUC SVCTYPE",
  IRF: "AN REFER REFERTYPE",
  IDX: "AN DIAG DXTYPE DRDX",
  IOP: "AN OPER OPTYPE DROPID DATEIN TIMEIN DATEOUT TIMEOUT",
  CHT: "HN AN DATE TOTAL:2 PAID:2 PTTYPE=ec_pttype PERSON_ID SEQ",
  CHA: "HN AN DATE CHRGITEM AMOUNT:2 PERSON_ID SEQ",
  AER: "HN AN DATEOPD AUTHAE AEDATE AETIME AETYPE REFER_NO REFMAINI IREFTYPE REFMAINO OREFTYPE UCAE EMTYPE SEQ AESTATUS DALERT TALERT",
  ADP: "HN AN DATEOPD TYPE CODE QTY:n RATE:n SEQ CAGCODE DOSE CA_TYPE SERIALNO TOTCOPAY:n USE_STATUS TOTAL:2 QTYDAY TMLTCODE=ec_tmlt STATUS1 BI CLINIC=ec_clinic ITEMSRC= PROVIDER= GRAVIDA GA_WEEK DCIP/E_SCR=DCIP/E_screen LMP SP_ITEM",
  LVD: "SEQLVD AN DATEOUT TIMEOUT DATEIN TIMEIN QTYDAY",
  DRU: "HCODE HN AN CLINIC=ec_clinic PERSON_ID DATE_SERV DID DIDNAME=ec_didname AMOUNT:n DRUGPRIC=DRUGPRICE:2 DRUGCOST:2 DIDSTD=ec_didstd UNIT UNIT_PACK=ec_unitpack SEQ DRUGTYPE= DRUGREMARK PA_NO TOTCOPAY:n USE_STATUS TOTAL=",
};

const spec = (file: string) =>
  ECLAIM_COLUMNS[file].split(" ").map((c) => {
    const [, name, src, fmt] = c.match(/^([^=:]+)(?:=([^:]*))?(?::(2|n))?$/)!;
    return { name, src: src ?? name, fmt };
  });

/**
 * หัว DBF ของไฟล์ส่งออก e-Claim ของ HOSxP ที่นำเข้าได้จริง (ชื่อ:ชนิด:ความยาว[:ทศนิยม]) ; ค่าแต่ละช่องมาจากคอลัมน์ชื่อเดียวกันใน ECLAIM_COLUMNS
 * ต่างจาก TEXT: INS มี HCODE (แฟ้ม FDH มีคอลัมน์ HCODE) ; DRU.TOTAL ไม่มีแหล่งข้อมูลจึงเป็น 0.00 แบบไฟล์ของ HOSxP
 */
export const ECLAIM_DBF: Record<string, string> = {
  INS: "HN:C:15 INSCL:C:3 SUBTYPE:C:2 CID:C:16 HCODE:C:9 DATEIN:D:8 DATEEXP:D:8 HOSPMAIN:C:9 HOSPSUB:C:9 GOVCODE:C:6 GOVNAME:C:250 PERMITNO:C:30 DOCNO:C:30 OWNRPID:C:13 OWNNAME:C:250 AN:C:15 SEQ:C:15 SUBINSCL:C:2 RELINSCL:C:2 HTYPE:C:1",
  PAT: "HCODE:C:9 HN:C:15 CHANGWAT:C:2 AMPHUR:C:2 DOB:D:8 SEX:C:1 MARRIAGE:C:1 OCCUPA:C:3 NATION:C:3 PERSON_ID:C:13 NAMEPAT:C:36 TITLE:C:30 FNAME:C:40 LNAME:C:40 IDTYPE:C:1",
  OPD: "HN:C:15 CLINIC:C:5 DATEOPD:D:8 TIMEOPD:C:4 SEQ:C:15 UUC:C:1",
  ORF: "HN:C:15 DATEOPD:D:8 CLINIC:C:5 REFER:C:9 REFERTYPE:C:1 SEQ:C:15",
  ODX: "HN:C:15 DATEDX:D:8 CLINIC:C:5 DIAG:C:7 DXTYPE:C:1 DRDX:C:15 PERSON_ID:C:13 SEQ:C:15",
  OOP: "HN:C:15 DATEOPD:D:8 CLINIC:C:5 OPER:C:7 DROPID:C:6 PERSON_ID:C:13 SEQ:C:15",
  IPD: "HN:C:15 AN:C:15 DATEADM:D:8 TIMEADM:C:4 DATEDSC:D:8 TIMEDSC:C:4 DISCHS:C:1 DISCHT:C:1 WARDDSC:C:4 DEPT:C:2 ADM_W:N:7:3 UUC:C:1 SVCTYPE:C:1",
  IRF: "AN:C:15 REFER:C:9 REFERTYPE:C:1",
  IDX: "AN:C:15 DIAG:C:7 DXTYPE:C:1 DRDX:C:6",
  IOP: "AN:C:15 OPER:C:9 OPTYPE:C:1 DROPID:C:6 DATEIN:D:8 TIMEIN:C:4 DATEOUT:D:8 TIMEOUT:C:4",
  CHT: "HN:C:15 AN:C:15 DATE:D:8 TOTAL:N:12:2 PAID:N:12:2 PTTYPE:C:2 PERSON_ID:C:13 SEQ:C:15",
  CHA: "HN:C:15 AN:C:15 DATE:D:8 CHRGITEM:C:2 AMOUNT:N:12:2 PERSON_ID:C:13 SEQ:C:15",
  AER: "HN:C:15 AN:C:15 DATEOPD:D:8 AUTHAE:C:12 AEDATE:D:8 AETIME:C:4 AETYPE:C:1 REFER_NO:C:20 REFMAINI:C:9 IREFTYPE:C:4 REFMAINO:C:9 OREFTYPE:C:4 UCAE:C:1 EMTYPE:C:1 SEQ:C:15 AESTATUS:C:1 DALERT:D:8 TALERT:C:4",
  ADP: "HN:C:15 AN:C:15 DATEOPD:D:8 TYPE:C:2 CODE:C:20 QTY:N:4 RATE:N:12:2 SEQ:C:15 CAGCODE:C:10 DOSE:C:10 CA_TYPE:C:1 SERIALNO:C:24 TOTCOPAY:N:12:2 USE_STATUS:C:1 TOTAL:N:12:2 QTYDAY:N:3 TMLTCODE:C:20 STATUS1:C:1 BI:N:3 CLINIC:C:5 ITEMSRC:N:3 PROVIDER:C:15 GRAVIDA:C:2 GA_WEEK:C:2 DCIP/E_SCR:C:2 LMP:D:8 SP_ITEM:C:2",
  LVD: "SEQLVD:C:3 AN:C:15 DATEOUT:D:8 TIMEOUT:C:4 DATEIN:D:8 TIMEIN:C:4 QTYDAY:C:3",
  DRU: "HCODE:C:9 HN:C:15 AN:C:15 CLINIC:C:5 PERSON_ID:C:13 DATE_SERV:D:8 DID:C:30 DIDNAME:C:250 AMOUNT:C:12 DRUGPRIC:C:14 DRUGCOST:C:14 DIDSTD:C:24 UNIT:C:20 UNIT_PACK:C:20 SEQ:C:15 DRUGTYPE:C:2 DRUGREMARK:C:2 PA_NO:C:9 TOTCOPAY:N:12:2 USE_STATUS:C:1 TOTAL:N:12:2",
};

export const dbfFields = (file: string): DbfField[] =>
  ECLAIM_DBF[file].split(" ").map((d) => {
    const [name, type, length, decimals = "0"] = d.split(":");
    return { name, type: type as DbfField["type"], length: Number(length), decimals: Number(decimals) };
  });

/** CHRGITEM ของ FDH (หมวดค่ารักษา 01–19) → ตัวอักษรหมวดของ e-Claim (1–9, A–J ; seed ใน chrgitem_group) ; หมวดที่ไม่รู้จัก = J (ยังไม่ได้จัดหมวด) */
export function chrgGroup(v: FileRow[string]) {
  const n = Number(v);
  return n >= 1 && n <= 9 ? String(n) : n >= 10 && n <= 19 ? "ABCDEFGHIJ"[n - 10] : "J";
}

/**
 * แถว CHA หนึ่งหมวดแยกเป็นยอดเบิกได้ (x1 = paidst 02 จาก claim_amount) และเบิกไม่ได้ (x2 = ที่เหลือ) ตัดยอด 0 ;
 * ยาของผู้ป่วยนอก (ไม่มี AN) หมวด 3 → 4 (ยาที่นำไปใช้ต่อที่บ้าน) แบบไฟล์ของ HOSxP
 */
export function splitCha(r: FileRow): FileRow[] {
  const { claim_amount, ...row } = r;
  const total = Number(r.AMOUNT ?? 0);
  const claim = claim_amount == null ? total : Number(claim_amount);
  const c = chrgGroup(r.CHRGITEM);
  const g = c === "3" && !r.AN ? "4" : c;
  return [
    { ...row, CHRGITEM: `${g}1`, AMOUNT: claim.toFixed(2) },
    { ...row, CHRGITEM: `${g}2`, AMOUNT: (Math.round((total - claim) * 100) / 100).toFixed(2) },
  ].filter((x) => Number(x.AMOUNT) !== 0);
}

/** รวมแถวที่ค่าอื่น (ยกเว้น ignore ซึ่งใช้ของแถวแรก) เหมือนกันทุกช่อง โดยบวกคอลัมน์ sum (ทศนิยม 2 ตำแหน่ง) ; ลำดับตามแถวแรกของแต่ละกลุ่ม */
export function sumRows(rows: FileRow[], sum: string[], ignore: string[] = []): FileRow[] {
  const out = new Map<string, FileRow>();
  for (const r of rows) {
    const key = JSON.stringify(Object.entries(r).filter(([k]) => !sum.includes(k) && !ignore.includes(k)));
    const prev = out.get(key);
    out.set(key, prev ? { ...prev, ...Object.fromEntries(sum.map((k) => [k, (Number(prev[k] ?? 0) + Number(r[k] ?? 0)).toFixed(2)])) } : r);
  }
  return [...out.values()];
}

/** แถว CHA ของ e-Claim: splitCha แล้วรวมแถวที่ซ้ำกันหลังเปลี่ยนหมวด (ยา OP หมวด 3 กับ 4 ของ visit/วันเดียวกัน) */
export const chaRows = (rows: FileRow[]) => sumRows(rows.flatMap(splitCha), ["AMOUNT"]);

/**
 * แถว ADP ของ e-Claim แบบไฟล์ของ HOSxP: รายการเดียวกันราคาเดียวกันใน visit เดียวกันรวมเป็นแถวเดียว (บวก QTY/TOTAL/TOTCOPAY) ;
 * สิทธิ OFC ใช้ CODE = billcode (ec_billcode รหัสกรมบัญชีกลาง ไม่มี = ว่าง) ; อุปกรณ์ (TYPE 11) ของผู้ป่วยนอก USE_STATUS 2 (ใช้ที่บ้าน)
 */
export const adpRows = (rows: FileRow[], inscl: (r: FileRow) => string = () => "") =>
  sumRows(
    rows.map((r) => ({ ...r, CODE: inscl(r) === "OFC" ? (r.ec_billcode ?? "") : r.CODE, USE_STATUS: !r.AN && String(r.TYPE) === "11" ? "2" : r.USE_STATUS })),
    ["QTY", "TOTAL", "TOTCOPAY"],
    ["PROVIDER", "CLINIC", "ec_clinic"], // ไม่อยู่ในไฟล์ (PROVIDER) หรือต่างกันตามแผนกที่สั่ง: ใช้ของแถวแรก
  );

/** NAMEPAT ของ e-Claim = "ชื่อ  นามสกุล , คำนำหน้า" (เว้นสองช่องหลังชื่อ) แบบไฟล์ของ HOSxP ไม่ใช่ค่า NAMEPAT ของ FDH */
export const namePat = (r: FileRow) => `${r.FNAME ?? ""}  ${r.LNAME ?? ""} , ${r.TITLE ?? ""}`;

/** ค่าหนึ่งช่อง: ตัวเลขตาม fmt ; วันที่ YYYY-MM-DD → YYYYMMDD ; | CR LF เป็นช่องว่าง ตัด " (เหมือน toTxt) */
function cell(v: FileRow[string], fmt?: string) {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (fmt && Number.isFinite(n)) return fmt === "2" ? n.toFixed(2) : String(n);
  return String(v).replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1$2$3").replace(/[|\r\n]/g, " ").replace(/"/g, "");
}

/** ข้อความของแฟ้มหนึ่งแฟ้ม (ไม่มีแถว = "") */
export const eclaimText = (file: string, rows: FileRow[]) => {
  const cols = spec(file);
  return rows.map((r) => `${cols.map((c) => (c.src ? cell(r[c.src], c.fmt) : "")).join("|")}\r\n`).join("");
};

/** ค่าของแต่ละช่องตามลำดับหัว DBF (ที่มาและรูปแบบเดียวกับ TEXT ; ช่องที่ไม่อยู่ใน ECLAIM_COLUMNS เช่น INS.HCODE ใช้คอลัมน์ชื่อเดียวกันของแฟ้ม FDH) */
export const eclaimRecords = (file: string, rows: FileRow[]) => {
  const cols = new Map(spec(file).map((c) => [c.name, c]));
  const fields = dbfFields(file).map((f) => cols.get(f.name) ?? { name: f.name, src: f.name, fmt: undefined });
  return rows.map((r) => fields.map((c) => (c.src ? cell(r[c.src], c.fmt) : "")));
};

/** แถว OOP ของบริการแพทย์แผนไทย: hm = [{ SEQ, OPER, DROPID }] จาก ecHealthMedSql (sql.ts) ตามลำดับ visit ของแฟ้ม OPD ; PERSON_ID จากแฟ้ม PAT ตาม HN */
export function healthMedOop(opd: FileRow[], pat: FileRow[], hm: FileRow[]): FileRow[] {
  const pid = new Map(pat.map((r) => [r.HN, r.PERSON_ID]));
  const ops = new Map<FileRow[string], FileRow[]>();
  for (const h of hm) (ops.get(h.SEQ) ?? ops.set(h.SEQ, []).get(h.SEQ)!).push(h);
  const seen = new Set<FileRow[string]>();
  return opd
    .filter((r) => ops.has(r.SEQ) && !seen.has(r.SEQ) && seen.add(r.SEQ))
    .flatMap((r) => ops.get(r.SEQ)!.map((h) => ({ HN: r.HN, DATEOPD: r.DATEOPD, ec_clinic: r.ec_clinic, OPER: h.OPER, DROPID: h.DROPID, PERSON_ID: pid.get(r.HN) ?? "", SEQ: r.SEQ })));
}

/**
 * แถว OOP ของ e-Claim แบบไฟล์ของ HOSxP: ตัดแถวไม่มีรหัส, ec_skip และ 0009 ; ทันตกรรมซ้ำตาม ec_n ; DROPID = ec_dropid (แพทย์ของ visit) ไม่มีใช้ DROPID
 * ตัด 6 ตัวตามความยาวช่องใน DBF ของ HOSxP (ไฟล์ TXT ของ HOSxP ก็ตัด)
 * shortcut: 0009 (ultrasound therapy) — HOSxP ไม่ส่ง และ e-Claim ตอบ "ไม่พบรหัส OPER" ; ถ้ามีรายการรหัส OPER ของ e-Claim ให้ตรวจกับรายการนั้นแทน
 */
export const oopRows = (rows: FileRow[]) =>
  rows
    .filter((r) => r.OPER && r.OPER !== "0009" && !Number(r.ec_skip))
    .flatMap((r) => Array<FileRow>(Math.max(1, Number(r.ec_n ?? 1) || 1)).fill({ ...r, DROPID: String(r.ec_dropid ?? r.DROPID ?? "").slice(0, 6) }));

/** แถวของแต่ละแฟ้มก่อนเขียน e-Claim ให้ตรงไฟล์ของ HOSxP (OPD: visit ละแถว ; DRU: ตัดจำนวน 0, ผู้ป่วยนอก USE_STATUS 2 ใช้ที่บ้าน) */
const PREP: Record<string, (rows: FileRow[], inscl: (r: FileRow) => string) => FileRow[]> = {
  PAT: (rows) => rows.map((r) => ({ ...r, NAMEPAT: namePat(r) })),
  OPD: (rows) => {
    const seen = new Set<FileRow[string]>();
    return rows.filter((r) => !seen.has(r.SEQ) && seen.add(r.SEQ));
  },
  CHA: chaRows,
  ADP: adpRows,
  OOP: oopRows,
  // ec_diag (sql.ts) = รหัส 4 ตัวเมื่อรหัสเต็มไม่อยู่ใน icd10_nhso แบบ HOSxP (Z1281 → Z128) ; ไม่มีใช้ DIAG
  ODX: (rows) => rows.map((r) => (r.ec_diag ? { ...r, DIAG: r.ec_diag } : r)),
  IDX: (rows) => rows.map((r) => (r.ec_diag ? { ...r, DIAG: r.ec_diag } : r)),
  DRU: (rows) => rows.filter((r) => Number(r.AMOUNT) !== 0).map((r) => (r.AN ? r : { ...r, USE_STATUS: "2" })),
};

/**
 * แยกเป็นโฟลเดอร์ละสิทธิ (INSCL ของแฟ้ม INS) เพราะ e-Claim นำเข้าทีละสิทธิ: แถวของแฟ้มอื่นตามสิทธิของ SEQ (OP) / AN (IP) ใน INS ;
 * PAT ไปทุกสิทธิที่ HN นั้นมี ; ไม่พบใน INS = NO-INS ; ทุกโฟลเดอร์มีครบ 16 แฟ้ม ; ส่ง dbf = เขียน {FILE}.dbf แทน {FILE}.txt ;
 * hm = แถวแพทย์แผนไทยของ healthMedOop (ผู้ป่วยนอก)
 */
export function toEclaim(files: File[], dbf?: DbfWriter, hm: FileRow[] = []): EclaimFolder[] {
  const ip = files.some((f) => f.file === "IPD");
  const key = ip ? "AN" : "SEQ";
  const s = (v: FileRow[string]) => (v == null ? "" : String(v));
  const scheme = new Map<string, string>();
  const byHn = new Map<string, Set<string>>();
  for (const r of files.find((f) => f.file === "INS")?.rows ?? []) {
    const inscl = s(r.INSCL) || "NO-INS";
    if (!scheme.has(s(r[key]))) scheme.set(s(r[key]), inscl);
    byHn.set(s(r.HN), (byHn.get(s(r.HN)) ?? new Set()).add(inscl));
  }
  const folders = new Map<string, Map<string, FileRow[]>>();
  const rowsOf = (file: string) => files.find((f) => f.file === file)?.rows ?? [];
  for (const f of files) {
    if (!ECLAIM_COLUMNS[f.file]) continue; // PHDB, LABFU
    const inscl = (r: FileRow) => scheme.get(s(r[key])) ?? "NO-INS";
    const rows = f.file === "OOP" ? [...f.rows, ...healthMedOop(rowsOf("OPD"), rowsOf("PAT"), hm)] : f.rows;
    for (const r of PREP[f.file]?.(rows, inscl) ?? rows) {
      const targets = f.file === "PAT" ? [...(byHn.get(s(r.HN)) ?? ["NO-INS"])] : [inscl(r)];
      for (const inscl of targets) {
        const fs = folders.get(inscl) ?? folders.set(inscl, new Map()).get(inscl)!;
        (fs.get(f.file) ?? fs.set(f.file, []).get(f.file)!).push(r);
      }
    }
  }
  return [...folders].map(([inscl, fs]) => {
    const out = Object.keys(ECLAIM_COLUMNS).map((file) => {
      const rows = fs.get(file) ?? [];
      return dbf ? { name: `${file}.dbf`, data: dbf(dbfFields(file), eclaimRecords(file, rows)) } : { name: `${file}.txt`, data: eclaimText(file, rows) };
    });
    const size = (d: string | Uint8Array) => (typeof d === "string" ? new TextEncoder().encode(d).length : d.length);
    return { name: `${inscl}-${ip ? "IP" : "OP"}`, files: out, bytes: out.reduce((n, f) => n + size(f.data), 0) };
  });
}
