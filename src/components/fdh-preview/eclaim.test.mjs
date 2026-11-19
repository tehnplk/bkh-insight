// รัน: node --test src/components/fdh-preview/eclaim.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { adpRows, chaRows, chrgGroup, eclaimText, splitCha, sumRows, toEclaim } from "./eclaim.ts";

// ลำดับคอลัมน์จากหัว DBF ของไฟล์ส่งออก e-Claim ของ HOSxP ที่นำเข้าได้จริง
const DBF = {
  // INS ไม่มี HCODE: นำเข้า TEXT ใน e-Claim ใหม่แล้วค่าเลื่อนไป 1 ช่อง (ไม่มี DATEOPD หรือ TIMEOPD) แม้หัว DBF ของ HOSxP มี HCODE
  INS: "HN|INSCL|SUBTYPE|CID|DATEIN|DATEEXP|HOSPMAIN|HOSPSUB|GOVCODE|GOVNAME|PERMITNO|DOCNO|OWNRPID|OWNNAME|AN|SEQ|SUBINSCL|RELINSCL|HTYPE",
  PAT: "HCODE|HN|CHANGWAT|AMPHUR|DOB|SEX|MARRIAGE|OCCUPA|NATION|PERSON_ID|NAMEPAT|TITLE|FNAME|LNAME|IDTYPE",
  OPD: "HN|CLINIC|DATEOPD|TIMEOPD|SEQ|UUC",
  ORF: "HN|DATEOPD|CLINIC|REFER|REFERTYPE|SEQ",
  ODX: "HN|DATEDX|CLINIC|DIAG|DXTYPE|DRDX|PERSON_ID|SEQ",
  OOP: "HN|DATEOPD|CLINIC|OPER|DROPID|PERSON_ID|SEQ",
  IPD: "HN|AN|DATEADM|TIMEADM|DATEDSC|TIMEDSC|DISCHS|DISCHT|WARDDSC|DEPT|ADM_W|UUC|SVCTYPE",
  IRF: "AN|REFER|REFERTYPE",
  IDX: "AN|DIAG|DXTYPE|DRDX",
  IOP: "AN|OPER|OPTYPE|DROPID|DATEIN|TIMEIN|DATEOUT|TIMEOUT",
  CHT: "HN|AN|DATE|TOTAL|PAID|PTTYPE|PERSON_ID|SEQ",
  CHA: "HN|AN|DATE|CHRGITEM|AMOUNT|PERSON_ID|SEQ",
  AER: "HN|AN|DATEOPD|AUTHAE|AEDATE|AETIME|AETYPE|REFER_NO|REFMAINI|IREFTYPE|REFMAINO|OREFTYPE|UCAE|EMTYPE|SEQ|AESTATUS|DALERT|TALERT",
  ADP: "HN|AN|DATEOPD|TYPE|CODE|QTY|RATE|SEQ|CAGCODE|DOSE|CA_TYPE|SERIALNO|TOTCOPAY|USE_STATUS|TOTAL|QTYDAY|TMLTCODE|STATUS1|BI|CLINIC|ITEMSRC|PROVIDER|GRAVIDA|GA_WEEK|DCIP/E_SCR|LMP|SP_ITEM",
  LVD: "SEQLVD|AN|DATEOUT|TIMEOUT|DATEIN|TIMEIN|QTYDAY",
  DRU: "HCODE|HN|AN|CLINIC|PERSON_ID|DATE_SERV|DID|DIDNAME|AMOUNT|DRUGPRIC|DRUGCOST|DIDSTD|UNIT|UNIT_PACK|SEQ|DRUGTYPE|DRUGREMARK|PA_NO|TOTCOPAY|USE_STATUS|TOTAL",
};
// ค่าที่มาจากคอลัมน์ชื่ออื่นของแฟ้ม FDH หรือคอลัมน์ช่วย ec_* ใน SQL
const SRC = { "INS.DATEIN": "ec_datein", "INS.DATEEXP": "ec_dateexp", "INS.GOVCODE": "ec_govcode", "INS.GOVNAME": "ec_govname", "INS.DOCNO": "ec_docno", "INS.OWNRPID": "ec_ownrpid", "INS.OWNNAME": "ec_ownname", "INS.HOSPMAIN": "ec_hospmain", "INS.HOSPSUB": "ec_hospsub", "ODX.DRDX": "ec_drdx", "CHT.PTTYPE": "ec_pttype", "ADP.DCIP/E_SCR": "DCIP/E_screen", "ADP.TMLTCODE": "ec_tmlt", "DRU.DRUGPRIC": "DRUGPRICE",
  "DRU.DIDNAME": "ec_didname", "DRU.DIDSTD": "ec_didstd", "DRU.UNIT_PACK": "ec_unitpack" };
for (const f of ["OPD", "ORF", "ODX", "OOP", "ADP", "DRU"]) SRC[`${f}.CLINIC`] = "ec_clinic";

test("column order of every file matches the e-Claim DBF headers", () => {
  for (const [file, header] of Object.entries(DBF)) {
    const cols = header.split("|");
    // ใส่ค่าในแต่ละคอลัมน์เป็นชื่อคอลัมน์เอง แล้วอ่านกลับจากบรรทัดที่ได้
    const row = Object.fromEntries(cols.map((c) => [SRC[`${file}.${c}`] ?? c, c]));
    // ไม่มีแหล่งข้อมูล = ว่าง (DRU.DRUGTYPE) หรือ TXT ของ HOSxP ส่งว่าง
    const empty = ["DRU.DRUGTYPE", "DRU.TOTAL", "ADP.ITEMSRC", "ADP.PROVIDER", "INS.RELINSCL"];
    const expected = cols.map((c) => (empty.includes(`${file}.${c}`) ? "" : c)).join("|");
    assert.equal(eclaimText(file, [row]), `${expected}\r\n`, file);
  }
});

test("chrgGroup: 01–09 digit, 10–19 A–J, unknown J", () => {
  assert.deepEqual(["01", "09", "10", "16", "19", "21", null].map(chrgGroup), ["1", "9", "A", "G", "J", "J", "J"]);
});

test("splitCha: claimable x1 / rest x2, zero parts dropped, helper column removed", () => {
  assert.deepEqual(splitCha({ CHRGITEM: "07", AMOUNT: "150.00", claim_amount: "100.00", SEQ: "v" }), [
    { CHRGITEM: "71", AMOUNT: "100.00", SEQ: "v" },
    { CHRGITEM: "72", AMOUNT: "50.00", SEQ: "v" },
  ]);
  assert.deepEqual(splitCha({ CHRGITEM: "12", AMOUNT: "80.10", claim_amount: "80.10" }), [{ CHRGITEM: "C1", AMOUNT: "80.10" }]);
  assert.deepEqual(splitCha({ CHRGITEM: "03", AMOUNT: "30.00", claim_amount: "0.00", AN: "a1" }), [{ CHRGITEM: "32", AMOUNT: "30.00", AN: "a1" }]);
});

test("CHA OP: drug group 3 becomes 4 (no AN), merged with existing 4 of the same visit/date; IP keeps 3", () => {
  const base = { HN: "1", AN: "", DATE: "2026-11-16", PERSON_ID: "p", SEQ: "v" };
  assert.deepEqual(chaRows([
    { ...base, CHRGITEM: "03", AMOUNT: "100.00", claim_amount: "100.00" },
    { ...base, CHRGITEM: "04", AMOUNT: "20.50", claim_amount: "20.50" },
    { ...base, CHRGITEM: "07", AMOUNT: "50.00", claim_amount: "50.00" },
  ]), [{ ...base, CHRGITEM: "41", AMOUNT: "120.50" }, { ...base, CHRGITEM: "71", AMOUNT: "50.00" }]);
  assert.deepEqual(chaRows([{ ...base, AN: "a1", CHRGITEM: "03", AMOUNT: "10.00", claim_amount: "10.00" }]), [{ ...base, AN: "a1", CHRGITEM: "31", AMOUNT: "10.00" }]);
});

test("CLINIC comes from ec_clinic (spclty.provis_code), not the FDH CLINIC", () => {
  assert.equal(eclaimText("OPD", [{ CLINIC: "01000", ec_clinic: "01101" }]), "|01101||||\r\n");
});

test("sumRows: sums the given columns of otherwise equal rows, ignored columns keep the first row's value", () => {
  assert.deepEqual(sumRows([{ a: "1", q: "1.00", c: "x" }, { a: "1", q: "2.00", c: "y" }, { a: "2", q: "1.00", c: "x" }], ["q"], ["c"]), [
    { a: "1", q: "3.00", c: "x" },
    { a: "2", q: "1.00", c: "x" },
  ]);
});

test("ADP like HOSxP: same item and rate per visit merged, OFC CODE = billcode, OP equipment (TYPE 11) USE_STATUS 2", () => {
  const r = { SEQ: "v", AN: "", TYPE: 15, CODE: "32001", RATE: "100.00", QTY: "1.00", TOTAL: "100.00", TOTCOPAY: "0.00", USE_STATUS: "", ec_billcode: "32001" };
  const out = adpRows([
    { ...r, PROVIDER: "a", ec_clinic: "00101" },
    { ...r, PROVIDER: "b", ec_clinic: "09901" },
    { ...r, RATE: "50.00", QTY: "1.00", TOTAL: "50.00" },
  ]);
  assert.deepEqual(out.map((x) => [x.QTY, x.TOTAL, x.ec_clinic]), [["2.00", "200.00", "00101"], ["1.00", "50.00", undefined]]);
  const ofc = (x) => (x.SEQ === "o" ? "OFC" : "UCS");
  const codes = adpRows([{ ...r, SEQ: "o", CODE: "41003", ec_billcode: "52612" }, { ...r, SEQ: "o", CODE: "XXXXXX", ec_billcode: "" }, { ...r, SEQ: "u", CODE: "41003" }], ofc);
  assert.deepEqual(codes.map((x) => x.CODE), ["52612", "", "41003"]);
  assert.deepEqual(adpRows([{ ...r, TYPE: 11 }, { ...r, TYPE: 11, AN: "a1" }]).map((x) => x.USE_STATUS), ["2", ""]);
});

test("number formats: money 2 decimals, QTY/RATE/TOTCOPAY plain, empty stays empty", () => {
  const adp = eclaimText("ADP", [{ TYPE: 2, QTY: "1.00", RATE: "100.00", TOTCOPAY: "0.00", TOTAL: 100, DATEOPD: "2026-11-02", QTYDAY: "", BI: "", ITEMSRC: "1" }]).split("|");
  assert.deepEqual([adp[2], adp[3], adp[5], adp[6], adp[12], adp[14], adp[15], adp[18], adp[20]], ["20261102", "2", "1", "100", "0", "100.00", "", "", ""]);
  const dru = eclaimText("DRU", [{ AMOUNT: "20", DRUGPRICE: "1.5", TOTCOPAY: "0.00", TOTAL: "30.00" }]).trimEnd().split("|");
  assert.deepEqual([dru[8], dru[9], dru[18], dru[20]], ["20", "1.50", "0", ""]);
  const cht = eclaimText("CHT", [{ TOTAL: "2791.5", PAID: null }]).split("|");
  assert.deepEqual([cht[3], cht[4]], ["2791.50", ""]);
});

test("toEclaim OP: folder per INSCL, all 16 files, empty = 0 bytes, no header, no PHDB/LABFU", () => {
  const files = [
    { file: "INS", columns: [], rows: [
      { HN: "1", INSCL: "UCS", ec_datein: "2026-01-01", DATEEXP: "2027-01-31", ec_dateexp: null, SEQ: "v1" },
      { HN: "1", INSCL: "OFC", SEQ: "v2" },
    ] },
    { file: "PAT", columns: [], rows: [{ HN: "1", DOB: "1990-05-02", NAMEPAT: "นายสมชาย ใจดี", TITLE: "นาย", FNAME: "สมชาย", LNAME: "ใจดี" }] },
    { file: "OPD", columns: [], rows: [{ HN: "1", DATEOPD: "2026-10-31", TIMEOPD: "0905", SEQ: "v1", DETAIL: "x" }, { HN: "1", SEQ: "v1" }, { HN: "1", SEQ: "v2" }] },
    { file: "CHA", columns: [], rows: [{ CHRGITEM: "01", AMOUNT: "10.00", claim_amount: "10.00", SEQ: "v1" }] },
    { file: "DRU", columns: [], rows: [{ SEQ: "v1", AMOUNT: "1", ec_didname: "x|y", USE_STATUS: "1" }, { SEQ: "v1", AMOUNT: "0" }] },
    { file: "LABFU", columns: [], rows: [{ SEQ: "v2" }] },
    { file: "PHDB", columns: [], rows: [{ SEQ: "v1" }] },
  ];
  const [ucs, ofc] = toEclaim(files);
  assert.equal(ucs.name, "UCS-OP");
  assert.deepEqual(ucs.files.map((f) => f.name), Object.keys(DBF).map((f) => `${f}.txt`));
  const text = (d, f) => d.files.find((x) => x.name === `${f}.txt`).data;
  const ins = Array(19).fill("");
  Object.assign(ins, { 0: "1", 1: "UCS", 4: "20260101", 15: "v1" });
  assert.equal(text(ucs, "INS"), `${ins.join("|")}\r\n`);
  assert.equal(text(ucs, "PAT"), "|1|||19900502||||||สมชาย  ใจดี , นาย|นาย|สมชาย|ใจดี|\r\n");
  assert.equal(text(ucs, "OPD"), "1||20261031|0905|v1|\r\n");
  assert.equal(text(ucs, "CHA"), "|||11|10.00||v1\r\n");
  // DRU: จำนวน 0 ไม่ส่ง, ผู้ป่วยนอก USE_STATUS 2 ; OPD visit ละแถว
  assert.deepEqual(text(ucs, "DRU").split("\r\n").filter(Boolean).map((l) => [l.split("|")[7], l.split("|")[19]]), [["x y", "2"]]);
  for (const f of ["ORF", "IPD", "CHT", "ADP", "LVD"]) assert.equal(text(ucs, f), "", f);
  assert.equal(ucs.bytes, ucs.files.reduce((n, f) => n + Buffer.byteLength(f.data), 0));
  assert.equal(ofc.name, "OFC-OP");
  assert.equal(ofc.files.length, 16);
  assert.equal(text(ofc, "CHA"), "");
});

test("ODX/IDX DIAG uses ec_diag (4-char code when the full code is not in icd10_nhso), else DIAG", () => {
  const op = toEclaim([
    { file: "INS", columns: [], rows: [{ HN: "1", INSCL: "UCS", SEQ: "v1" }] },
    { file: "ODX", columns: [], rows: [{ SEQ: "v1", DIAG: "Z1281", ec_diag: "Z128" }, { SEQ: "v1", DIAG: "J069" }] },
  ])[0];
  assert.deepEqual(op.files.find((f) => f.name === "ODX.txt").data.split("\r\n").filter(Boolean).map((l) => l.split("|")[3]), ["Z128", "J069"]);
  const ip = toEclaim([
    { file: "INS", columns: [], rows: [{ HN: "1", INSCL: "UCS", AN: "a1" }] },
    { file: "IPD", columns: [], rows: [{ AN: "a1" }] },
    { file: "IDX", columns: [], rows: [{ AN: "a1", DIAG: "Z1281", ec_diag: "Z128" }, { AN: "a1", DIAG: "A09", ec_diag: null }] },
  ])[0];
  assert.deepEqual(ip.files.find((f) => f.name === "IDX.txt").data.split("\r\n").filter(Boolean).map((l) => l.split("|")[1]), ["Z128", "A09"]);
});

test("OOP like HOSxP: skip ec_skip/0009/no code, dental repeats ec_n, DROPID = ec_dropid cut to 6, Thai medicine rows from hm (eclaim-hm) in OPD visit order", () => {
  const r = { HN: "1", DATEOPD: "2026-11-16", ec_clinic: "01101", PERSON_ID: "p", SEQ: "v1", ec_dropid: null, ec_n: 1, ec_skip: 0 };
  const op = toEclaim([
    { file: "INS", columns: [], rows: [{ HN: "1", INSCL: "OFC", SEQ: "v1" }, { HN: "1", INSCL: "OFC", SEQ: "v2" }] },
    { file: "PAT", columns: [], rows: [{ HN: "1", PERSON_ID: "p" }] },
    { file: "OPD", columns: [], rows: [{ HN: "1", DATEOPD: "2026-11-16", SEQ: "v1", ec_clinic: "01101" }, { HN: "1", DATEOPD: "2026-11-16", SEQ: "v2", ec_clinic: "01401" }, { HN: "1", SEQ: "v2" }] },
    { file: "OOP", columns: [], rows: [
      { ...r, OPER: "9501", DROPID: "พ1234567890" },
      { ...r, OPER: "8931", DROPID: "x", ec_dropid: "ท12345", ec_n: 2 },
      { ...r, OPER: "9309", DROPID: "x", ec_dropid: "-11111", ec_skip: 1 },
      { ...r, OPER: "0009", DROPID: "x", ec_dropid: "-11111" },
      { ...r, OPER: null, DROPID: "x" },
    ] },
  ], undefined, [{ SEQ: "v2", OPER: "8717811", DROPID: "123456" }, { SEQ: "v2", OPER: "8717820", DROPID: "123456" }, { SEQ: "v9", OPER: "8717811", DROPID: "123456" }])[0];
  assert.equal(op.files.find((f) => f.name === "OOP.txt").data, [
    "1|20261116|01101|9501|พ12345|p|v1",
    "1|20261116|01101|8931|ท12345|p|v1",
    "1|20261116|01101|8931|ท12345|p|v1",
    "1|20261116|01401|8717811|123456|p|v2",
    "1|20261116|01401|8717820|123456|p|v2",
  ].map((l) => `${l}\r\n`).join(""));
});

test("toEclaim IP: rows follow INSCL of AN, unknown AN goes to NO-INS", () => {
  const files = [
    { file: "INS", columns: [], rows: [{ HN: "1", INSCL: "OFC", AN: "a1" }] },
    { file: "IPD", columns: [], rows: [{ AN: "a1", DATEDSC: "2026-11-05" }, { AN: "a9", DATEDSC: "2026-11-06" }] },
  ];
  const out = toEclaim(files);
  assert.deepEqual(out.map((f) => f.name), ["OFC-IP", "NO-INS-IP"]);
  assert.equal(out[1].files.find((f) => f.name === "IPD.txt").data.split("|")[1], "a9");
  assert.equal(out[1].files.find((f) => f.name === "INS.txt").data, "");
});
