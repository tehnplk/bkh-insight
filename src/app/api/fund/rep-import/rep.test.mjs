// รัน: node --test src/app/api/fund/rep-import/rep.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
// ใช้ workbook สังเคราะห์ในหน่วยความจำ ไม่มีข้อมูลผู้ป่วยจริง
import assert from "node:assert/strict";
import test from "node:test";
import { utils, write } from "xlsx";
import { dateTime, list, num, parseFileName, parseRep, printedAt, schemeOf, text } from "./rep.ts";

const range = (r0, c0, r1, c1) => ({ s: { r: r0, c: c0 }, e: { r: r1, c: c1 } });

function detailSheet({ tranHeader = "TRAN_ID" } = {}) {
  const row = () => Array(120).fill("-");
  const aoa = [["ออกรายงานวันที่ 06/11/2569 เวลา 14:31"], [], [], [], []];
  const h5 = Array(120).fill(null);
  const h6 = Array(120).fill(null);
  const h7 = Array(120).fill(null);
  Object.assign(h5, {
    0: "REP No.", 1: "ลำดับที่", 2: tranHeader, 3: "HN", 4: "AN", 5: "PID", 6: "ชื่อ-สกุล", 7: "ประเภทผู้ป่วย", 8: "วันเข้ารักษา",
    9: "วันจำหน่าย", 10: "ชดเชยสุทธิ", 13: "Error Code", 36: "RW", 47: "AdjRW_NHSO\n(7)", 49: "จ่ายชดเชย\n(9 = 4x5x8)",
    54: "ค่าใช้จ่ายสูง (HC)", 75: "โรคเฉพาะ (DMIS)", 104: "Deny", 113: "VA", 114: " Remark", 116: "รูปแบบการจ่าย", 117: "SEQ NO",
  });
  Object.assign(h6, { 75: "CATARACT", 104: "HC", 105: "AE" });
  Object.assign(h7, { 54: "IPHC", 55: "OPHC", 75: "CATARACT", 76: "ค่าภาระงาน(สสจ.)" });
  // คอลัมน์กองทุนอื่นๆ ต้องมีหัวไม่ซ้ำกัน (ไฟล์จริงก็เป็นแบบนี้)
  for (let c = 56; c < 113; c++) if (c !== 75 && c !== 76 && (c < 104 || c > 108)) h7[c] ??= `F${c}`;
  aoa.push(h5, h6, h7);

  const op = row();
  Object.assign(op, {
    0: "690100001", 1: 1, 2: "000000101", 3: "0000001", 4: "", 5: "0000000000001", 6: "ทดสอบ", 7: "OP", 8: "05/01/2026 08:30:00",
    10: 150.5, 11: 20, 13: "-", 14: " ", 15: "OPAE, HC09", 21: "UCS", 22: "-", 36: "", 40: 300, 47: "0.5122", 49: 150.5,
    55: 120, 75: 30, 76: 0, 104: "C", 114: "", 116: "จ่ายรายวัน", 117: "690105083012",
  });
  const ip = row();
  Object.assign(ip, {
    0: "690100001", 1: 2, 2: "000000102", 3: "0000002", 4: "690000123", 7: "IP", 8: "01/01/2026 10:00:00", 9: "04/01/2026 12:15:00",
    10: 9000, 13: "151,349", 14: "IP01", 36: "1.2175", 117: "",
  });
  const again = [...op];
  again[10] = 99; // TRAN_ID ซ้ำในไฟล์ ใช้แถวหลังสุด
  aoa.push(op, ip, again, [null, null, null], ["หมายเหตุ: ตัวอย่าง"]);

  const ws = utils.aoa_to_sheet(aoa);
  ws["!merges"] = [range(5, 54, 5, 55), range(5, 75, 5, 95), range(6, 75, 6, 77), range(5, 104, 5, 108), range(6, 104, 7, 104)];
  return ws;
}

function summarySheet() {
  const aoa = [["* หมายเหตุ"], [], [], [], [], ["-", "11252", "690100001", "3", "2", "1", 100, 80]];
  Object.assign(aoa[1], { 0: "งวด", 1: "HCODE", 2: "REP NO.", 3: "ข้อมูลปกติ", 20: "จ่ายชดเชยต้นสังกัด", 21: "จ่ายชดเชยทั้งสิ้น" });
  Object.assign(aoa[3], { 3: "จำนวนราย", 6: "HC" });
  Object.assign(aoa[4], { 3: "ทั้งหมด", 4: "ผ่าน", 5: "ไม่ผ่าน", 6: "เรียกเก็บ", 7: "ชดเชย" });
  Object.assign(aoa[5], { 20: 0, 21: 230.5 });
  const ws = utils.aoa_to_sheet(aoa);
  ws["!merges"] = [range(1, 3, 2, 19), range(3, 3, 3, 5), range(3, 6, 3, 7)];
  return ws;
}

function book(detail = detailSheet()) {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, detail, "Detail");
  utils.book_append_sheet(wb, summarySheet(), "Summary");
  return write(wb, { type: "buffer", bookType: "xlsx" });
}

// REP สิทธิอื่น: CS (59 คอลัมน์ มี IPCS_ORS) / LGO (58 คอลัมน์) หัวตาราง 2 ชั้น
function otherDetailSheet({ lgo = false } = {}) {
  const funds = lgo ? ["IPLG", "OPLG", "PALG", "INSTLG", "OTLG", "PP", "DRUG"] : ["IPCS", "IPCS_ORS", "OPCS", "PACS", "INSTCS", "OTCS", "PP", "DRUG"];
  const denies = lgo ? ["IPLG", "OPLG", "PALG", "INSTLG", "OTLG"] : ["IPCS", "OPCS", "PACS", "INSTCS", "OTCS"];
  const deny = 40 + funds.length;
  const ors = deny + denies.length;
  const width = ors + 6;
  const h5 = Array(width).fill(null);
  const h6 = Array(width).fill(null);
  Object.assign(h5, {
    0: "REP", 1: "ลำดับที่", 2: "TRAN_ID", 3: "HN", 4: "AN", 5: "PID", 6: "ชื่อ - สกุล", 7: "ประเภทผู้ป่วย", 8: "วันเข้ารักษา", 9: "วันจำหน่าย",
    10: "ชดเชยสุทธิ", 12: "Error Code", 13: "กองทุน", 18: "สิทธิหลัก", 19: "สิทธิรอง", 25: "PROJ", 27: "DRG", 28: "RW",
    29: lgo ? "เรียกเก็บ" : "ชดเชยสุทธิ", 31: "เบิกได้", 33: "ชำระเอง", 38: "AdjRW", 40: "กรณี", [deny]: "Deny",
    [ors]: "ORS", [ors + 1]: "VA", [ors + 2]: "AUDIT RESULTS", [ors + 3]: "SEQ NO", [ors + 4]: "INVOICE NO", [ors + 5]: "INVOICE LT",
  });
  Object.assign(h6, { 10: "ค่ารักษา", 11: "PP (รับจาก สปสช.)", 29: "ค่ารักษา", 30: "PP" });
  funds.forEach((f, i) => (h6[40 + i] = f));
  denies.forEach((f, i) => (h6[deny + i] = f));

  const row = () => Array(width).fill("-");
  const ip = row();
  Object.assign(ip, {
    0: "690000001", 1: 1, 2: "800000001", 3: "0000003", 4: "690000456", 5: "0000000000003", 6: "ทดสอบ", 7: "IP",
    8: "01/10/2026 09:00:00", 9: "05/10/2026 10:00:00", 10: 1200.5, 11: 0, 13: lgo ? "IPLG,OTLG" : "IPCS,OTCS", 18: lgo ? "LGO" : "OFC",
    19: lgo ? "L2" : "O4", 27: "06590", 28: "1.2345", 29: 1500, 30: 0, 33: 100, 38: "1.1111", 40: 1000.5, [40 + funds.length - 3]: 200,
    [deny]: "C", [ors + 2]: null, [ors + 3]: "",
  });
  const op = row();
  Object.assign(op, {
    0: "690000001", 1: 2, 2: "800000002", 3: "0000004", 4: "", 7: "OP", 8: "02/10/2026 08:00:00", 10: 0, 11: 0, 12: "438,179",
    13: "", 18: "LGO", 29: 300, 30: 0, 33: 0, [ors + 3]: "691002080001",
  });
  const ws = utils.aoa_to_sheet([["ออกรายงานวันที่ 16/11/2569 เวลา 11:20"], [], [], [], [], h5, h6, ip, op, ["PP=ประกอบด้วยกลุ่มกองทุน"]]);
  ws["!merges"] = [range(5, 10, 5, 11), range(5, 29, 5, 30), range(5, 40, 5, deny - 1), range(5, deny, 5, ors - 1), range(5, 0, 6, 0), range(5, 2, 6, 2)];
  return ws;
}

function otherSummarySheet({ lgo = false } = {}) {
  const pc = lgo ? 20 : 22;
  const aoa = [["* รายการที่แสดงจะแสดงรายการที่ผ่านเท่านั้น"], [], [], [], [], ["-", "11252", "690000001", 2, 1, 1, 1800, 1200.5]];
  Object.assign(aoa[1], { 0: "งวด", 1: "HCODE", 2: "REP NO.", 3: "ข้อมูลปกติ", [pc]: "ชดเชยสุทธิ" });
  Object.assign(aoa[3], { 3: "จำนวนราย", 6: lgo ? "OPLG" : "OPCS", [pc]: "ค่ารักษา", [pc + 1]: "PP (รับจาก สปสช.)" });
  Object.assign(aoa[4], { 3: "ทั้งหมด", 4: "ผ่าน", 5: "ไม่ผ่าน", 6: "เรียกเก็บ", 7: "ชดเชย" });
  Object.assign(aoa[5], { [pc]: 1200.5, [pc + 1]: 0 });
  const ws = utils.aoa_to_sheet(aoa);
  ws["!merges"] = [range(1, 3, 2, pc - 1), range(1, pc, 2, pc + 1), range(3, 3, 3, 5), range(3, 6, 3, 7)];
  return ws;
}

function otherBook(opts) {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, otherDetailSheet(opts), "Detail");
  utils.book_append_sheet(wb, otherSummarySheet(opts), "Summary");
  return write(wb, { type: "buffer", bookType: "xlsx" });
}

test("file name -> hcode, type, CE date", () => {
  assert.deepEqual(parseFileName("eclaim_11252_IPCS_25691005_145720713 (1).xls"), { hcode: "11252", type: "IPCS", fileDate: "2026-10-05" });
  assert.deepEqual(parseFileName("eclaim_11252_OPCS_25691105_143000123.xls"), { hcode: "11252", type: "OPCS", fileDate: "2026-11-05" });
  assert.deepEqual(parseFileName("eclaim_11252_OPLGO_25691103_154808375 (12).xls"), { hcode: "11252", type: "OPLGO", fileDate: "2026-11-03" });
  assert.equal(parseFileName("eclaim_11252_IPCS_25691005_145720713(1).xls"), null);
  assert.deepEqual(parseFileName("eclaim_11252_OP_APPEAL_CD_25690821_115328402.xls"), { hcode: "11252", type: "OP_APPEAL_CD", fileDate: "2026-08-21" });
  assert.deepEqual(parseFileName("eclaim_11252_IP_25681002_171025461.xls"), { hcode: "11252", type: "IP", fileDate: "2025-10-02" });
  assert.equal(parseFileName("eclaim_11252_IP_25681002_171025461.xlsx"), null);
  assert.equal(parseFileName("eclaim_11252_IP_25680230_1.xls"), null); // 30 ก.พ.
  assert.equal(parseFileName("report.xls"), null);
});

test("cell helpers: '-' and blanks are null, numeric text becomes a number", () => {
  assert.equal(text(" - "), null);
  assert.equal(text(""), null);
  assert.equal(text("0001"), "0001");
  assert.equal(num("-"), null);
  assert.equal(num("0.5122"), 0.5122);
  assert.equal(num(12.5), 12.5);
  assert.deepEqual(list("-"), []);
  assert.deepEqual(list(" "), []);
  assert.deepEqual(list("140,151 ,179"), ["140", "151", "179"]);
  assert.equal(dateTime("05/01/2026 08:30:00"), "2026-01-05 08:30:00");
  assert.equal(dateTime("-"), null);
  assert.equal(dateTime("31/02/2026 08:30:00"), null);
  assert.equal(printedAt("ออกรายงานวันที่ 06/11/2569 เวลา 14:31"), "2026-11-06 14:31:00");
});

test("Detail rows map to records, notes skipped, duplicate TRAN_ID keeps the last", () => {
  const { printedAt: at, rows, summaries } = parseRep(book());
  assert.equal(at, "2026-11-06 14:31:00");
  assert.deepEqual(rows.map((r) => r.tran_id), ["000000101", "000000102"]);
  const [op, ip] = rows;
  assert.equal(op.net_nhso, 99);
  assert.equal(op.hn, "0000001");
  assert.equal(op.an, null);
  assert.equal(op.seq_no, "690105083012");
  assert.equal(op.discharge_at, null);
  assert.equal(op.admit_at, "2026-01-05 08:30:00");
  assert.deepEqual(op.error_codes, []);
  assert.deepEqual(op.main_fund, []);
  assert.deepEqual(op.sub_fund, ["OPAE", "HC09"]);
  assert.equal(op.sub_inscl, null);
  assert.equal(op.rw, null);
  assert.equal(op.adjrw, 0.5122);
  assert.equal(op.claim_total, 300);
  assert.equal(op.pay_mode, "จ่ายรายวัน");
  // label จากหัวตาราง 3 ชั้น (merge แล้ว) เก็บเฉพาะตัวเลขที่ไม่ใช่ 0
  assert.deepEqual(op.fund_amounts, { "ค่าใช้จ่ายสูง (HC) / OPHC": 120, "โรคเฉพาะ (DMIS) / CATARACT": 30 });
  assert.deepEqual(op.deny, { "Deny / HC": "C" });
  assert.equal("ชื่อ" in op || Object.values(op).includes("ทดสอบ"), false);
  assert.equal(ip.an, "690000123");
  assert.equal(ip.seq_no, null);
  assert.equal(ip.discharge_at, "2026-01-04 12:15:00");
  assert.deepEqual(ip.error_codes, ["151", "349"]);
  assert.equal(ip.rw, 1.2175);
  assert.equal(ip.net_affiliation, null);
  assert.equal(ip.deny, null);

  assert.equal(summaries.length, 1);
  const [s] = summaries;
  assert.deepEqual([s.rep_no, s.sheet, s.period, s.total_cases, s.passed, s.failed, s.paid_affiliation, s.paid_total], ["690100001", "Summary", null, 3, 2, 1, 0, 230.5]);
  assert.deepEqual(s.amounts, { "ข้อมูลปกติ / HC / เรียกเก็บ": 100, "ข้อมูลปกติ / HC / ชดเชย": 80 });
});

test("a different layout is rejected with the column that differs", () => {
  assert.throws(() => parseRep(book(detailSheet({ tranHeader: "TRANS" }))), /คอลัมน์ 3 ต้องเป็น "TRAN_ID"/);
  assert.throws(() => parseRep(new Uint8Array([1, 2, 3])), /ไม่พบชีต|อ่านไฟล์ไม่ได้/);
});

for (const lgo of [false, true]) {
  test(`non-UC REP (${lgo ? "LGO 58" : "CS 59"} columns) maps to records by header labels`, () => {
    const { layout, printedAt: at, rows, summaries } = parseRep(otherBook({ lgo }));
    assert.equal(layout, "other");
    assert.equal(at, "2026-11-16 11:20:00");
    assert.deepEqual(rows.map((r) => r.tran_id), ["800000001", "800000002"]);
    const [ip, op] = rows;
    assert.equal(ip.rep_no, "690000001");
    assert.equal(ip.patient_type, "IP");
    assert.equal(ip.an, "690000456");
    assert.equal(ip.seq_no, null); // IP ไม่มี SEQ NO ใช้ AN
    assert.equal(ip.admit_at, "2026-10-01 09:00:00");
    assert.equal(ip.discharge_at, "2026-10-05 10:00:00");
    assert.equal(ip.net_nhso, 1200.5);
    assert.equal(ip.net_affiliation, 0);
    assert.equal(ip.claim_total, 1500);
    assert.equal(ip.self_pay, 100);
    assert.deepEqual(ip.error_codes, []);
    assert.deepEqual(ip.main_fund, lgo ? ["IPLG", "OTLG"] : ["IPCS", "OTCS"]);
    assert.equal(ip.main_inscl, lgo ? "LGO" : "OFC");
    assert.equal(ip.drg, "06590");
    assert.equal(ip.rw, 1.2345);
    assert.equal(ip.adjrw, 1.1111);
    const [f0, ot] = lgo ? ["IPLG", "OTLG"] : ["IPCS", "OTCS"];
    assert.deepEqual(ip.fund_amounts, { [`กรณี / ${f0}`]: 1000.5, [`กรณี / ${ot}`]: 200 });
    assert.deepEqual(ip.deny, { [`Deny / ${f0}`]: "C" });
    assert.equal(Object.values(ip).includes("ทดสอบ"), false);
    assert.equal(op.seq_no, "691002080001");
    assert.equal(op.an, null);
    assert.equal(op.discharge_at, null);
    assert.deepEqual(op.error_codes, ["438", "179"]);
    assert.deepEqual(op.fund_amounts, {});
    assert.equal(op.deny, null);

    assert.equal(summaries.length, 1);
    const [s] = summaries;
    assert.deepEqual([s.rep_no, s.total_cases, s.passed, s.failed, s.paid_affiliation, s.paid_total], ["690000001", 2, 1, 1, null, 1200.5]);
    assert.equal(s.amounts[`ข้อมูลปกติ / ${lgo ? "OPLG" : "OPCS"} / ชดเชย`], 1200.5);
    assert.equal("ชดเชยสุทธิ / ค่ารักษา" in s.amounts, false);
  });
}

// REP OP Refer (ORF): โครงตามไฟล์จริง (พ.ย. 2569) หัว 4 ชั้นแถว 6-9 ข้อมูลแถว 10 ; ค่าทั้งหมดสมมติ
function orfBook({ seq = "", invoice = "690901083012" } = {}) {
  const W = 113;
  const blank = () => Array(W).fill(null);
  const g = blank(); // แถว 6 กลุ่ม
  Object.assign(g, {
    0: "ข้อมูลทั่วไป", 21: "ยอดรวมค่าใช้จ่าย(เฉพาะเบิกได้) (1)", 22: "เข้าเกณฑ์ central reimburse (2)", 24: "ชำระเอง (3)", 25: "พรบ. (4)",
    26: "เข้าเกณฑ์ OP REFER", 29: "ผลรวมทั้ง Case (8=5+7)", 30: "ผู้รับผิดชอบ (9)=(8)", 32: "ชดเชยสุทธิ (บาท) (10=8)", 33: "ชำระบัญชีโดย", 34: "PS",
    35: "รายละเอียดการจ่าย central reimburse", 63: "รายละเอียดที่ขอเบิกกรณี OP Refer", 101: "Error Code", 102: "Deny", 106: "VA", 107: "Remark",
    108: "AUDIT RESULTS", 109: "รูปแบบการจ่าย", 110: "SEQ NO", 111: "INVOICE NO", 112: "INVOICE LT",
  });
  const n = blank(); // แถว 8 ชื่อคอลัมน์
  Object.assign(n, {
    0: "REP", 1: "NO.", 2: "TRAN_ID", 3: "HN", 4: "PID", 5: "ชื่อ", 6: "ว/ด/ป ที่รับบริการ", 7: "เลขที่ใบส่งต่อ", 8: "หน่วยบริการ", 15: "DX.",
    22: "กรณี", 23: "จำนวนเงิน", 26: "รายการ OPREF (5)", 27: "ค่ารักษาอื่นๆ", 30: "CUP / จังหวัด", 31: "สปสช", 61: "ชดเชยสุทธิ (บาท)", 62: "ชำระโดย",
  });
  for (let c = 35; c <= 60; c++) n[c] = c === 35 ? "OPHC" : `กองทุน${c}`;
  const s = blank(); // แถว 9 ชั้นย่อย
  Object.assign(s, { 8: "รักษา(Htype1)", 10: "รักษา(Hcode)", 13: "ประจำ(Hmain2)", 14: "รับส่งต่อ(Href)", 27: "ก่อนปรับลด (6)", 28: "หลังปรับลด (7)", 30: "<=1600", 31: ">1600", 35: "HC01", 102: "HC", 103: "AE", 104: "INST", 105: "DMIS" });
  const row = blank();
  Object.assign(row, {
    0: "690900007", 1: 1, 2: "900000001", 3: "0000001", 4: "1111111111111", 5: "ทดสอบ ระบบ", 6: "01/09/2026 08:30:12", 7: "12/69",
    10: "12345 รพ.ทดสอบ", 13: "54321 รพ.ต้นทาง", 14: "00001 สอ.ทดสอบ", 21: 850, 23: 0, 24: 50, 26: 300, 28: 200, 31: 500, 32: 500, 35: 120,
    61: 120, 101: "C438", 102: "C", 107: "หมายเหตุ", 109: "จ่ายรายวัน", 110: seq, 111: invoice,
  });
  const aoa = [["ออกรายงานวันที่ 26/11/2569 เวลา 15:00"], [null, null, "กองทุนเขต"], [], [null, null, "จังหวัด"], [], g, blank(), n, s, row, ["หมายเหตุท้ายตาราง"]];
  const detail = utils.aoa_to_sheet(aoa);
  detail["!merges"] = [range(5, 0, 5, 20), range(5, 26, 5, 28), range(5, 30, 5, 31), range(5, 35, 5, 62), range(5, 102, 5, 105), range(7, 27, 7, 28)];
  const h = Array(55).fill(null);
  Object.assign(h, { 0: "งวด", 1: "HCODE", 2: "REP NO.", 3: "ข้อมูลปกติ", 18: "จ่ายชดเชยทั้งสิ้น", 19: "ข้อมูลอุทธรณ์", 48: "ชดเชยสุทธิ", 50: "ข้อมูลปกติ OPREFER", 53: "ชดเชยสุทธิ OPREFER" });
  const h4 = Array(55).fill(null);
  Object.assign(h4, { 3: "จำนวนราย", 6: "HC" });
  const h5 = Array(55).fill(null);
  Object.assign(h5, { 3: "ทั้งหมด", 4: "ผ่าน", 5: "ไม่ผ่าน", 6: "เรียกเก็บ", 7: "ชดเชย", 50: "จ่ายชดเชย" });
  const data = Array(55).fill(0);
  Object.assign(data, { 0: "-", 1: "12345", 2: "690900007", 3: 1, 4: 0, 5: 1, 6: 300, 7: 120, 18: 120, 50: 500 });
  const summary = utils.aoa_to_sheet([["* หมายเหตุ"], h, [], h4, h5, data]);
  summary["!merges"] = [range(1, 3, 1, 17), range(3, 6, 3, 7)];
  const wb = utils.book_new();
  utils.book_append_sheet(wb, detail, "Detail");
  utils.book_append_sheet(wb, summary, "Summary");
  return write(wb, { type: "buffer", bookType: "xlsx" });
}

test("ORF (OP Refer) maps to rep_row: INVOICE NO is the VN when SEQ NO is empty", () => {
  const { layout, rows, summaries } = parseRep(orfBook());
  assert.equal(layout, "orf");
  assert.equal(rows.length, 1);
  const [r] = rows;
  assert.deepEqual([r.tran_id, r.rep_no, r.patient_type, r.hn, r.an, r.seq_no], ["900000001", "690900007", "OP", "0000001", null, "690901083012"]);
  assert.equal(r.admit_at, "2026-09-01 08:30:12");
  assert.deepEqual([r.claim_total, r.central_reimburse, r.self_pay, r.net_nhso], [850, 0, 50, 500]);
  assert.deepEqual(r.error_codes, ["C438"]);
  assert.equal(r.hmain, "54321");
  assert.deepEqual(r.deny, { "Deny / HC": "C" });
  assert.deepEqual(r.fund_amounts, {
    "เข้าเกณฑ์ OP REFER / รายการ OPREF (5)": 300,
    "เข้าเกณฑ์ OP REFER / ค่ารักษาอื่นๆ / หลังปรับลด (7)": 200,
    "ผู้รับผิดชอบ (9)=(8) / สปสช / >1600": 500,
    "รายละเอียดการจ่าย central reimburse / OPHC / HC01": 120,
  });
  assert.equal(Object.values(r).includes("ทดสอบ ระบบ"), false); // ไม่เก็บชื่อ
  assert.equal(parseRep(orfBook({ seq: "690901083099" })).rows[0].seq_no, "690901083099"); // มี SEQ NO ใช้ SEQ NO
  const [s] = summaries;
  assert.deepEqual([s.rep_no, s.total_cases, s.passed, s.failed, s.paid_affiliation, s.paid_total], ["690900007", 1, 0, 1, null, 120]);
  assert.equal(s.amounts["ข้อมูลปกติ OPREFER / จ่ายชดเชย"], 500);
  assert.equal("จ่ายชดเชยทั้งสิ้น" in s.amounts, false);
  assert.equal(schemeOf("ORF", layout), "UCS");
});

test("scheme from file type and layout", () => {
  assert.equal(schemeOf("OP_APPEAL_CD", "uc"), "UCS");
  assert.equal(schemeOf("IPCS", "other"), "OFC");
  assert.equal(schemeOf("OPCS", "other"), "OFC");
  assert.equal(schemeOf("IPLGO", "other"), "LGO");
  assert.equal(schemeOf("OPLGO", "other"), "LGO");
  assert.equal(schemeOf("OPBKK", "other"), "BKK");
  assert.equal(schemeOf("OPBMT", "other"), "BMT");
  assert.equal(schemeOf("IPBKK", "other"), "BKK");
  assert.equal(schemeOf("IPBMT", "other"), "BMT");
  // อุทธรณ์อยู่กองทุนเดียวกับ REP ปกติ (ไม่งั้นชน TRAN_ID ของแถวเดิม)
  assert.equal(schemeOf("OPLGO_APPEAL", "other"), "LGO");
  assert.equal(schemeOf("OPBMT_APPEAL", "other"), "BMT");
  assert.equal(parseRep(book()).layout, "uc");
});
