// รัน: node --test src/app/api/fund/rep-import/rep.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
// ใช้ workbook สังเคราะห์ในหน่วยความจำ ไม่มีข้อมูลผู้ป่วยจริง
import assert from "node:assert/strict";
import test from "node:test";
import { utils, write } from "xlsx";
import { dateTime, list, num, parseFileName, parseRep, printedAt, text } from "./rep.ts";

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

test("file name -> hcode, type, CE date", () => {
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
