// รัน: node --test src/components/fdh-preview/dbf.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { tis620, writeDbf } from "./dbf.ts";
import { dbfFields, toEclaim } from "./eclaim.ts";

/** อ่าน DBF กลับ: หัวไฟล์ + ระเบียนเป็นข้อความ (ถอด TIS-620) */
function parseDbf(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint32(4, true), hl = v.getUint16(8, true), rl = v.getUint16(10, true);
  const fields = [];
  for (let o = 32; b[o] !== 0x0d; o += 32) {
    const raw = b.subarray(o, o + 11);
    fields.push({ name: String.fromCharCode(...raw.subarray(0, raw.indexOf(0) < 0 ? 11 : raw.indexOf(0))), type: String.fromCharCode(b[o + 11]), length: b[o + 16], decimals: b[o + 17] });
  }
  const text = (x) => String.fromCodePoint(...[...x].map((c) => (c >= 0xa1 ? c + 0x0d60 : c)));
  const records = [];
  for (let i = 0; i < n; i++) {
    let o = hl + i * rl;
    const del = b[o++];
    records.push({ del, values: fields.map((f) => text(b.subarray(o, (o += f.length)))) });
  }
  return { version: b[0], date: [b[1], b[2], b[3]], n, hl, rl, ldid: b[29], fields, records, terminator: b[hl - 1], eof: b[b.length - 1], size: b.length };
}

// หัว DBF ของไฟล์ส่งออก e-Claim ของ HOSxP ที่นำเข้าได้จริง: [header length, record length, ชื่อ:ชนิด:ความยาว:ทศนิยม]
const SAMPLE = {
  INS: [673, 694, "HN:C:15:0 INSCL:C:3:0 SUBTYPE:C:2:0 CID:C:16:0 HCODE:C:9:0 DATEIN:D:8:0 DATEEXP:D:8:0 HOSPMAIN:C:9:0 HOSPSUB:C:9:0 GOVCODE:C:6:0 GOVNAME:C:250:0 PERMITNO:C:30:0 DOCNO:C:30:0 OWNRPID:C:13:0 OWNNAME:C:250:0 AN:C:15:0 SEQ:C:15:0 SUBINSCL:C:2:0 RELINSCL:C:2:0 HTYPE:C:1:0"],
  PAT: [513, 205, "HCODE:C:9:0 HN:C:15:0 CHANGWAT:C:2:0 AMPHUR:C:2:0 DOB:D:8:0 SEX:C:1:0 MARRIAGE:C:1:0 OCCUPA:C:3:0 NATION:C:3:0 PERSON_ID:C:13:0 NAMEPAT:C:36:0 TITLE:C:30:0 FNAME:C:40:0 LNAME:C:40:0 IDTYPE:C:1:0"],
  OPD: [225, 49, "HN:C:15:0 CLINIC:C:5:0 DATEOPD:D:8:0 TIMEOPD:C:4:0 SEQ:C:15:0 UUC:C:1:0"],
  ORF: [225, 54, "HN:C:15:0 DATEOPD:D:8:0 CLINIC:C:5:0 REFER:C:9:0 REFERTYPE:C:1:0 SEQ:C:15:0"],
  ODX: [289, 80, "HN:C:15:0 DATEDX:D:8:0 CLINIC:C:5:0 DIAG:C:7:0 DXTYPE:C:1:0 DRDX:C:15:0 PERSON_ID:C:13:0 SEQ:C:15:0"],
  OOP: [257, 70, "HN:C:15:0 DATEOPD:D:8:0 CLINIC:C:5:0 OPER:C:7:0 DROPID:C:6:0 PERSON_ID:C:13:0 SEQ:C:15:0"],
  IPD: [449, 72, "HN:C:15:0 AN:C:15:0 DATEADM:D:8:0 TIMEADM:C:4:0 DATEDSC:D:8:0 TIMEDSC:C:4:0 DISCHS:C:1:0 DISCHT:C:1:0 WARDDSC:C:4:0 DEPT:C:2:0 ADM_W:N:7:3 UUC:C:1:0 SVCTYPE:C:1:0"],
  IRF: [129, 26, "AN:C:15:0 REFER:C:9:0 REFERTYPE:C:1:0"],
  IDX: [161, 30, "AN:C:15:0 DIAG:C:7:0 DXTYPE:C:1:0 DRDX:C:6:0"],
  IOP: [289, 56, "AN:C:15:0 OPER:C:9:0 OPTYPE:C:1:0 DROPID:C:6:0 DATEIN:D:8:0 TIMEIN:C:4:0 DATEOUT:D:8:0 TIMEOUT:C:4:0"],
  CHT: [289, 93, "HN:C:15:0 AN:C:15:0 DATE:D:8:0 TOTAL:N:12:2 PAID:N:12:2 PTTYPE:C:2:0 PERSON_ID:C:13:0 SEQ:C:15:0"],
  CHA: [257, 81, "HN:C:15:0 AN:C:15:0 DATE:D:8:0 CHRGITEM:C:2:0 AMOUNT:N:12:2 PERSON_ID:C:13:0 SEQ:C:15:0"],
  AER: [609, 140, "HN:C:15:0 AN:C:15:0 DATEOPD:D:8:0 AUTHAE:C:12:0 AEDATE:D:8:0 AETIME:C:4:0 AETYPE:C:1:0 REFER_NO:C:20:0 REFMAINI:C:9:0 IREFTYPE:C:4:0 REFMAINO:C:9:0 OREFTYPE:C:4:0 UCAE:C:1:0 EMTYPE:C:1:0 SEQ:C:15:0 AESTATUS:C:1:0 DALERT:D:8:0 TALERT:C:4:0"],
  ADP: [897, 228, "HN:C:15:0 AN:C:15:0 DATEOPD:D:8:0 TYPE:C:2:0 CODE:C:20:0 QTY:N:4:0 RATE:N:12:2 SEQ:C:15:0 CAGCODE:C:10:0 DOSE:C:10:0 CA_TYPE:C:1:0 SERIALNO:C:24:0 TOTCOPAY:N:12:2 USE_STATUS:C:1:0 TOTAL:N:12:2 QTYDAY:N:3:0 TMLTCODE:C:20:0 STATUS1:C:1:0 BI:N:3:0 CLINIC:C:5:0 ITEMSRC:N:3:0 PROVIDER:C:15:0 GRAVIDA:C:2:0 GA_WEEK:C:2:0 DCIP/E_SCR:C:2:0 LMP:D:8:0 SP_ITEM:C:2:0"],
  LVD: [257, 46, "SEQLVD:C:3:0 AN:C:15:0 DATEOUT:D:8:0 TIMEOUT:C:4:0 DATEIN:D:8:0 TIMEIN:C:4:0 QTYDAY:C:3:0"],
  DRU: [705, 503, "HCODE:C:9:0 HN:C:15:0 AN:C:15:0 CLINIC:C:5:0 PERSON_ID:C:13:0 DATE_SERV:D:8:0 DID:C:30:0 DIDNAME:C:250:0 AMOUNT:C:12:0 DRUGPRIC:C:14:0 DRUGCOST:C:14:0 DIDSTD:C:24:0 UNIT:C:20:0 UNIT_PACK:C:20:0 SEQ:C:15:0 DRUGTYPE:C:2:0 DRUGREMARK:C:2:0 PA_NO:C:9:0 TOTCOPAY:N:12:2 USE_STATUS:C:1:0 TOTAL:N:12:2"],
};

test("field descriptors, header and record length of every file equal the HOSxP sample", () => {
  for (const [file, [hl, rl, spec]] of Object.entries(SAMPLE)) {
    const d = parseDbf(writeDbf(dbfFields(file), [], new Date(2026, 10, 18)));
    assert.equal(d.fields.map((f) => `${f.name}:${f.type}:${f.length}:${f.decimals}`).join(" "), spec, file);
    assert.deepEqual([d.hl, d.rl, d.n, d.version, d.ldid, d.terminator, d.eof, d.size, d.date], [hl, rl, 0, 3, 0, 0x0d, 0x1a, hl + 1, [126, 11, 18]], file);
  }
});

test("round trip: C left/space padded and truncated by bytes, N right aligned with decimals (empty = 0), D YYYYMMDD, Thai TIS-620", () => {
  const fields = [
    { name: "NAME", type: "C", length: 6, decimals: 0 },
    { name: "AMT", type: "N", length: 8, decimals: 2 },
    { name: "QTY", type: "N", length: 3, decimals: 0 },
    { name: "DT", type: "D", length: 8, decimals: 0 },
  ];
  const b = writeDbf(fields, [["สมชาย ใจดี", "12.5", "", "20261116"], ["ab€", "", "12345", ""]]);
  const d = parseDbf(b);
  assert.deepEqual(d.records, [
    { del: 0x20, values: ["สมชาย ", "   12.50", "  0", "20261116"] },
    { del: 0x20, values: ["ab?   ", "    0.00", "***", "        "] },
  ]);
  assert.equal(d.size, d.hl + 2 * d.rl + 1);
  assert.deepEqual([...tis620("กฮ๛a")], [0xa1, 0xce, 0xfb, 0x61]);
});

test("toEclaim with a DBF writer: {FILE}.dbf per folder, INS has HCODE, same rows and values as TEXT", () => {
  const files = [
    { file: "INS", columns: [], rows: [{ HN: "1", INSCL: "OFC", HCODE: "11252", ec_datein: "2026-01-01", SEQ: "v1", HTYPE: "1" }] },
    { file: "PAT", columns: [], rows: [{ HCODE: "11252", HN: "1", DOB: "1990-05-02", TITLE: "นาย", FNAME: "สมชาย", LNAME: "ใจดี" }] },
    { file: "CHA", columns: [], rows: [{ HN: "1", DATE: "2026-11-16", CHRGITEM: "03", AMOUNT: "150.00", claim_amount: "100.00", SEQ: "v1" }] },
    { file: "DRU", columns: [], rows: [{ SEQ: "v1", AMOUNT: "20", DRUGPRICE: "1.5", TOTCOPAY: "0.00", TOTAL: "30.00" }] },
  ];
  const [ofc] = toEclaim(files, (f, r) => writeDbf(f, r));
  assert.equal(ofc.name, "OFC-OP");
  assert.deepEqual(ofc.files.map((f) => f.name), Object.keys(SAMPLE).map((f) => `${f}.dbf`));
  assert.equal(ofc.bytes, ofc.files.reduce((n, f) => n + f.data.length, 0));
  const rec = (f) => parseDbf(ofc.files.find((x) => x.name === `${f}.dbf`).data).records.map((r) => r.values.map((v) => v.trim()));
  const ins = rec("INS")[0];
  assert.deepEqual([ins[0], ins[1], ins[4], ins[5], ins[6], ins[16], ins[19]], ["1", "OFC", "11252", "20260101", "", "v1", "1"]);
  assert.equal(rec("PAT")[0][10], "สมชาย  ใจดี , นาย");
  assert.deepEqual(rec("CHA"), [["1", "", "20261116", "41", "100.00", "", "v1"], ["1", "", "20261116", "42", "50.00", "", "v1"]]);
  const dru = rec("DRU")[0];
  assert.deepEqual([dru[8], dru[9], dru[18], dru[19], dru[20]], ["20", "1.50", "0.00", "2", "0.00"]);
  assert.equal(parseDbf(ofc.files.find((x) => x.name === "ADP.dbf").data).n, 0);
});
