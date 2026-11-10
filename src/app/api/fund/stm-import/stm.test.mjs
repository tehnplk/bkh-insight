// รัน: node --test src/app/api/fund/stm-import/stm.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
// ใช้ workbook สังเคราะห์ในหน่วยความจำ ไม่มีข้อมูลผู้ป่วยจริง
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { utils, write } from "xlsx";

// stm.ts import "../rep-import/rep" แบบไม่มีนามสกุล (ตามที่ Next/TS ต้องการ) node ESM หาไฟล์เองไม่ได้ จึงเติม .ts ให้
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith(".")) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
});
const { amount, parseStm, stmDateTime, StmUnsupportedError } = await import("./stm.ts");

const top = (doc) => [[null], ["ออกรายงานวันที่ 06/11/2569 เวลา 08:57"], [], ["โรงพยาบาล 11252 รพ.ทดสอบ"], [], [], [`เลขที่เอกสาร ${doc}`], [], []];

// ---------- UC ----------

function ucDetailHead() {
  const h1 = Array(43).fill(null);
  Object.assign(h1, {
    0: "REP", 1: "ลำดับที่", 2: "TRAN_ID", 3: "HN", 4: "AN", 5: "PID", 6: "ชื่อ - สกุล", 7: "วันเข้ารักษา", 8: "วันจำหน่าย", 9: "MAININSCL",
    10: "PROJCODE", 11: "เรียกเก็บ", 12: "กองทุน IP", 21: "พึงรับ", 37: "ยอดชดเชยทั้งสิ้น", 38: "VA", 39: "COVID", 40: "แหล่งข้อมูล", 41: "SEQ NO",
  });
  const h2 = Array(43).fill(null);
  Object.assign(h2, { 12: "พรบ.", 13: "AdjRW", 21: "OP", 22: "IP", 24: "HC", 26: "AE", 28: "INST", 29: "DMIS", 32: "Palliative care", 33: "DMISHD", 34: "PP", 35: "FS", 36: "OPBKK" });
  return [h1, h2, Array(43).fill(null)];
}

// paid เป็น number (เหมือนไฟล์จริง) ส่วนกองทุนเป็นข้อความมีจุลภาค
function ucRow(rep, no, tran, { paid, op = "0.00", hc = "0.00", covid = 0, seq = "", an = "" } = {}) {
  const r = Array(43).fill("0.00");
  Object.assign(r, {
    0: rep, 1: String(no), 2: tran, 3: "0000001", 4: an, 5: "0000000000001", 6: "ทดสอบ ทดสอบ", 7: "05/01/2026 08:30:00", 8: "",
    9: "UCS", 10: "", 11: "1,500.25", 13: ".7628", 21: op, 24: hc, 37: paid, 38: "", 39: covid, 40: "FDH", 41: seq,
  });
  return r;
}
const ucSum = (v) => Object.assign(Array(43).fill(null), { 36: "รวม", 37: v });

function ucBook({ summaryTotal = 13845.5 } = {}) {
  const doc = "11252_OPUCS256812_01";
  const detail = [
    ...top(doc), ["ข้อมูลปกติ"], [], ...ucDetailHead(),
    ucRow("681200051", 1, "726484616", { paid: 12345.5, op: "12,000.00", hc: "345.50", seq: "681127132212" }),
    ucRow("681200051", 2, "726484617", { paid: 0, seq: "HN0012345" }),
    ucSum(12345.5), [], [],
    ["ความหมายแต่ละคอลัมน์"],
    ["681200051", "9", "999999999"], // หลังคำอธิบายต้องไม่ถูกอ่านเป็นข้อมูล
  ];
  const appeal = [...top(doc), ["ข้อมูลอุทธรณ์"], [], ...ucDetailHead(), ucRow("681200099", 1, "726500001", { paid: 1000, op: "1,000.00" }), ucSum(1000)];
  const d1 = [
    ...top(doc), ["ข้อมูลปกติ (ผู้พิการ D1)"], [], ...ucDetailHead(), ucRow("681200070", 1, "726600001", { paid: 500, covid: 500 }), ucSum(500),
    [], ["ข้อมูลอุทธรณ์ (ผู้พิการ D1)"], [], ...ucDetailHead(), ucSum(0),
  ];

  const sh1 = Object.assign(Array(28).fill(null), { 0: "งวด", 1: "HCODE", 2: "REP NO.", 3: "ประเภท", 4: "ทั้งหมดที่ผ่าน", 5: "เรียกเก็บ", 6: "พรบ.", 7: "พึงรับ", 23: "พึงรับทั้งหมด", 24: "COVID", 25: "แหล่งข้อมูล" });
  const sh2 = Object.assign(Array(28).fill(null), { 7: "OP", 8: "IP", 10: "HC", 12: "AE", 14: "INST", 15: "DMIS", 22: "OPBKK" });
  const sRow = (rep, paid, op, covid = 0) => Object.assign(Array(28).fill("0.00"), { 0: "6812_OP_01", 1: "11252", 2: rep, 3: "ข้อมูลปกติ", 4: "2", 5: "3,000.50", 7: op, 23: paid, 24: covid, 25: "FDH" });
  const sTotal = (v) => Object.assign(Array(28).fill(null), { 22: "รวม", 23: v });
  const summary = [
    ...top(doc), ["ข้อมูลปกติ"], [], sh1, sh2, [], sRow("681200051", 12345.5, "12,000.00"), sTotal(12345.5), [],
    ["ข้อมูลอุทธรณ์"], [], sh1, sh2, [], sRow("681200099", 1000, "1,000.00"), sTotal(1000),
  ];
  const summaryD1 = [...top(doc), ["ข้อมูลปกติ (ผู้พิการ D1"], [], sh1, sh2, [], sRow("681200070", 500, "0.00", 500), sTotal(500), ["ข้อมูลอุทธรณ์ (ผู้พิการ D1)"], [], sh1, sh2, [], sTotal(0)];
  // แถวรวมของส่วนปกติแก้ได้เพื่อทดสอบการ reject
  summary[summary.findIndex((r) => r[22] === "รวม")][23] = summaryTotal - 1500;

  const rHead = ["ประเภท", "จำนวน REP ที่ส่ง", "จำนวนราย (ผ่าน A)", "ผลรวม ADJRW", "จ่ายชดเชย", "ยอดหักเงินเดือน สป.", "ยอดหักเงินเดือน adjrw paid*380"];
  const receivable = [
    ["ออกรายงานวันที่ 06/11/2569 เวลา 08:57"], [], ["โรงพยาบาล 11252 รพ.ทดสอบ"], [], [], [`เลขที่เอกสาร ${doc}`], [], [],
    ["ข้อมูลปกติ"], [], rHead, ["ผู้ป่วยนอก", "1", "2", "0.0000", 12345.5, 345.5, 0], [null, null, null, null, null, "รวม", 12000], [], [], [],
    ["ข้อมูลอุทธรณ์"], [], rHead, ["ผู้ป่วยนอก", "1", "1", "0.0000", 1000, 0, 0], [null, null, null, null, null, "รวม", 1000],
  ];
  const receivableD1 = [
    ["ออกรายงานวันที่ 06/11/2569 เวลา 08:57"], [], [], [], [], [`เลขที่เอกสาร ${doc}`], [], [],
    ["ข้อมูลปกติ (ผู้พิการ D1)"], [], rHead.slice(0, 5), ["ผู้ป่วยนอก", "1", "1", "0.0000", 500], [null, null, null, "รวม", 500],
    ["ข้อมูลอุทธรณ์ (ผู้พิการ D1)"], [], rHead.slice(0, 5), [null, null, null, "รวม", 0],
  ];

  const wb = utils.book_new();
  for (const [name, aoa] of [
    [" รายงานพึงรับ ", receivable], [" รายงานสรุป OP", summary], [" รายละเอียด(ข้อมูลปกติ) 1 OP", detail], [" รายละเอียด(ข้อมูลอุทธรณ์) OP", appeal],
    [" รายงานพึงรับ (ผู้พิการ D1) ", receivableD1], [" รายงานสรุป (ผู้พิการ D1) OP", summaryD1], [" รายละเอียด (ผู้พิการ D1) OP", d1],
  ]) utils.book_append_sheet(wb, utils.aoa_to_sheet(aoa), name);
  return write(wb, { type: "buffer", bookType: "xlsx" });
}

// ---------- OFC ----------

const ofcHead = [
  ["REP", "ลำดับที่", "HN", "AN", "PID", "ชื่อ - สกุล", "วันเข้ารักษา", "วันจำหน่าย", "PROJCODE", "AdjRW", "เรียกเก็บ", "พรบ.", "พึงรับ", null, null, null, null, null, null, "พึงรับทั้งหมด", "SEQ NO"],
  [null, null, null, null, null, null, null, null, null, null, null, null, "ค่าห้อง", "ค่าอวัยวะฯ", "ค่ายา", "ค่ารักษา", "ค่ารถ", "กรณีพักรอจำหน่าย", "ค่าบริการอื่นๆ", null, null],
];
const ofcRow = (rep, no, drug, care, seq) => [rep, String(no), "0000001", "-", "0000000000001", "ทดสอบ ทดสอบ", "17/11 /2025 13:52:00", "", "", "0.0000", drug + care + 50, 0, 0, 0, drug, care, 0, 0, 0, drug + care, seq];

function ofcBook({ rep2Paid = 700 } = {}) {
  const detail = [
    ["ออกรายงานวันที่ 06/11/2569 เวลา 09:28"], [], ["โรงพยาบาล 11252 รพ.ทดสอบ"], [], [], ["เลขที่เอกสาร 11252_OP202512_01"], [],
    ["REP NO : 681200002"], [], ...ofcHead, ofcRow("681200002", 1, 150.25, 50, "681117135211"), ofcRow("681200002", 2, 0, 250, "681114144931"),
    [], ["REP NO : 681200008"], [], ...ofcHead, ofcRow("681200008", 3, 0, 700, "681128122548"),
    [], [null, "หมายเหตุ", "PROJCODE : ", " : "],
  ];
  const summary = [
    ["งวด", "HCODE", "REP NO", "ข้อมูลปกติ", null, null, "เรียกเก็บ", "พรบ.", "พึงรับ", null, null, null, null, null, null, "จ่ายชดเชยทั้งสิ้น"],
    [null, null, null, "จำนวนราย"],
    [null, null, null, "ทั้งหมด", "ผ่าน", "ไม่ผ่าน", null, null, "ค่าห้อง", "ค่าอวัยวะฯ", "ค่ายา", "ค่ารักษา", "ค่ารถ", "กรณีพักรอจำหน่าย", "ค่าบริการอื่นๆ", null],
    ["-", "11252", "681200002", "2", "2", "0", 550.25, 0, 0, 0, 150.25, 300, 0, 0, 0, 450.25],
    ["-", "11252", "681200008", "1", "1", "0", 750, 0, 0, 0, 0, 700, 0, 0, 0, rep2Paid],
  ];
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.aoa_to_sheet(detail), "พึงรับ");
  utils.book_append_sheet(wb, utils.aoa_to_sheet(summary), "สรุป(พึงรับ)");
  return write(wb, { type: "buffer", bookType: "xlsx" });
}

// ---------- tests ----------

test("amount reads comma text, leading-dot decimals and negatives; '-' and blank are null", () => {
  assert.equal(amount("12,345.00"), 12345);
  assert.equal(amount("-1,234.50"), -1234.5);
  assert.equal(amount(".7628"), 0.7628);
  assert.equal(amount("              1.0000"), 1);
  assert.equal(amount(2673.72), 2673.72);
  assert.equal(amount("-"), null);
  assert.equal(amount(""), null);
  assert.equal(amount("100%"), null);
  assert.equal(stmDateTime("17/11 /2025 13:52:00"), "2025-11-17 13:52:00");
  assert.equal(stmDateTime("22/11/2025 18:21:00"), "2025-11-22 18:21:00");
  assert.equal(stmDateTime(""), null);
});

test("UC: normal + appeal + D1 sections, totals checked, stops at the column notes", () => {
  const p = parseStm(ucBook());
  assert.deepEqual(
    [p.docNo, p.hcode, p.scheme, p.layout, p.patientType, p.periodMonth, p.runNo, p.printedAt],
    ["11252_OPUCS256812_01", "11252", "UCS", "uc", "OP", "2025-12-01", 1, "2026-11-06 08:57:00"],
  );
  assert.deepEqual([p.paidTotal, p.deduction, p.netTotal], [13845.5, 345.5, 13500]);
  assert.deepEqual(p.rows.map((r) => [r.section, r.tran_id]), [
    ["normal", "726484616"], ["normal", "726484617"], ["appeal", "726500001"], ["d1_normal", "726600001"],
  ]);
  const [a, b, , d1] = p.rows;
  assert.deepEqual([a.rep_no, a.line_no, a.seq_no, a.an, a.admit_at, a.discharge_at, a.main_inscl, a.source], ["681200051", 1, "681127132212", null, "2026-01-05 08:30:00", null, "UCS", "FDH"]);
  assert.deepEqual([a.claim_total, a.adjrw, a.paid_total], [1500.25, 0.7628, 12345.5]);
  assert.deepEqual(a.fund_amounts, { OP: 12000, HC: 345.5 });
  assert.equal(b.seq_no, "HN0012345");
  assert.deepEqual(b.fund_amounts, {});
  assert.deepEqual(d1.fund_amounts, { COVID: 500 });
  assert.equal(p.rows.some((r) => Object.values(r).includes("ทดสอบ ทดสอบ")), false);

  assert.deepEqual(p.summaries.map((s) => [s.section, s.rep_no, s.paid_total]), [["normal", "681200051", 12345.5], ["appeal", "681200099", 1000], ["d1_normal", "681200070", 500]]);
  const [s] = p.summaries;
  assert.deepEqual([s.period_label, s.passed, s.claim_total, s.source], ["6812_OP_01", 2, 3000.5, "FDH"]);
  assert.deepEqual(s.amounts, { OP: 12000 });
});

test("UC: a total that disagrees between sheets rejects the file", () => {
  assert.throws(() => parseStm(ucBook({ summaryTotal: 13845.49 })), /ยอดรวมไม่ตรงกัน \(normal\)/);
});

test("OFC: REP blocks, odd date spacing, '-' AN, totals per REP", () => {
  const p = parseStm(ofcBook());
  assert.deepEqual([p.docNo, p.scheme, p.layout, p.patientType, p.periodMonth, p.runNo], ["11252_OP202512_01", "OFC", "csmbs", "OP", "2025-12-01", 1]);
  assert.deepEqual([p.paidTotal, p.deduction, p.netTotal], [1150.25, 0, 1150.25]);
  assert.deepEqual(p.rows.map((r) => [r.rep_no, r.line_no, r.paid_total]), [["681200002", 1, 200.25], ["681200002", 2, 250], ["681200008", 3, 700]]);
  const [r] = p.rows;
  assert.deepEqual([r.tran_id, r.an, r.admit_at, r.seq_no, r.main_inscl], [null, null, "2025-11-17 13:52:00", "681117135211", null]);
  assert.deepEqual(r.fund_amounts, { DRUG: 150.25, CARE: 50 });
  assert.deepEqual(p.summaries.map((s) => [s.rep_no, s.cases, s.passed, s.failed, s.paid_total]), [["681200002", 2, 2, 0, 450.25], ["681200008", 1, 1, 0, 700]]);
});

test("OFC: a REP whose detail and summary differ rejects the file", () => {
  assert.throws(() => parseStm(ofcBook({ rep2Paid: 699.99 })), /ยอดรวมไม่ตรงกัน \(REP 681200008\)/);
});

test("other workbooks are unsupported or unreadable", () => {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.aoa_to_sheet([["x"]]), "Detail");
  assert.throws(() => parseStm(write(wb, { type: "buffer", bookType: "xlsx" })), StmUnsupportedError);
  assert.throws(() => parseStm(new Uint8Array([1, 2, 3])), /อ่านไฟล์ไม่ได้|ไม่ใช่ไฟล์ STM/);
});
