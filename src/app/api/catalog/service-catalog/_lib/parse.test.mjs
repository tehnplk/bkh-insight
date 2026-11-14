// รัน: node --test src/app/api/catalog/service-catalog/_lib/parse.test.mjs (fixture เล็กในไฟล์ ไม่พึ่งไฟล์จริง)
import assert from "node:assert/strict";
import test from "node:test";
import { UC_HEADERS, parseClaimSheet, parseDmy, parseOfc, parseStpWorkbook, parseUcCatalog } from "./parse.ts";

test("parseDmy: CE dd/mm/yyyy to ISO", () => {
  assert.equal(parseDmy("01/10/2026"), "2026-10-01");
  assert.equal(parseDmy(null), null);
  assert.equal(parseDmy("31/02/2026"), undefined);
});

const ucRow = (o = {}) => ["8 ตรวจวินิจฉัยและรักษาทางรังสีวิทยา", null, "042703", "BMD", "800.0", "ครั้ง", "01/10/2026", null, "02/10/2026", "/", null, null].map((v, i) => (i in o ? o[i] : v));

test("parseUcCatalog: group number, text code with leading zero, price 0 = no rate, fs status, duplicate codes kept", () => {
  const r = parseUcCatalog([UC_HEADERS.slice(), ucRow(), ucRow({ 4: "0.0", 9: null, 10: "/" }), ucRow({ 2: null }), [], ucRow({ 4: "400", 6: "16/07/2026", 7: "30/09/2026", 9: null, 11: "/" })]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows.length, 4);
  assert.deepEqual([r.rows[0].chrgitem_group, r.rows[0].group_name, r.rows[0].code, r.rows[0].price, r.rows[0].fs_status], ["8", "ตรวจวินิจฉัยและรักษาทางรังสีวิทยา", "042703", 800, 1]);
  assert.deepEqual([r.rows[1].price, r.rows[1].fs_status], [null, 2]);
  assert.equal(r.rows[2].code, null);
  assert.deepEqual([r.rows[3].line_no, r.rows[3].end_date, r.rows[3].fs_status], [6, "2026-09-30", 3]);
});

test("parseUcCatalog: rejects other files and reports bad values with Excel line", () => {
  assert.match(parseUcCatalog([["HOSPDRUGCODE"]]).errors[0], /ไม่พบคอลัมน์/);
  const bad = parseUcCatalog([UC_HEADERS.slice(), ucRow({ 4: "abc", 6: "2026-10-01" })]);
  assert.deepEqual(bad.errors, ["แถว 2: ราคาไม่ใช่ตัวเลข (abc)", "แถว 2: วันที่เริ่มต้น ไม่ใช่วันที่ dd/mm/yyyy (2026-10-01)"]);
});

test("parseOfc: keeps source code text, null price and unit", () => {
  const r = parseOfc([{ medSeqno: "u1", medId: "36320", medName: "HBV", remark: " ตามหนังสือ ", unitName: "Test", price: 1800 }, { medId: "ต่อ 47050", medName: "PET", price: 45000 }, { medId: "52999", price: null }]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows.map((x) => [x.line_no, x.code, x.price, x.unit]), [[1, "36320", 1800, "Test"], [2, "ต่อ 47050", 45000, null], [3, "52999", null, null]]);
  assert.equal(r.rows[0].remark, "ตามหนังสือ");
  assert.match(parseOfc([{ medName: "x" }]).errors[0], /ไม่มีรหัส/);
});

const title = ["รายการ ... บุคคลที่มีปัญหาสถานะและสิทธิ"];
const general = [
  [null],
  title,
  [null],
  [null],
  ["ลำดับ", "CODE", "รายการ", "QTY", "RATE (บาท)", "หมวด", "ADP TYPE", "ประเภท", null, "หมายเหตุ"],
  [null, null, null, null, null, null, null, "OPD", "IPD"],
  [1, 21301, "เตียงสังเกตอาการ", "ครั้ง", 100, 1, 10, "Yes", "No"],
  ["1) หัวข้อย่อย"],
  [1681, null, "E.C.G.", "ครั้ง", 200, 9, 9, "Yes", "No"],
  [null, 4720, "Transradial Set", "ชุดละ", null, 2, 2, "Yes", "Yes", "ยกเลิก "],
];
const drug = [
  title,
  [null, "1. กรณี OPD ..."],
  ["ลำดับ", "CODE/ \nTMT_ID", "ชื่อสามัญทางยา", "ความแรงของยา", "รูปแบบของยา", "ปริมาณ", "หน่วยนับ", "QTY", "RATE (บาท)", "หมวด", "แฟ้ม ", "ประเภท", null, "หมวดการใช้ยา", null, "หมายเหตุ"],
  [null, null, null, null, null, null, null, null, null, null, null, "OPD", "IPD", "ยาใน รพ.", "ยากลับบ้าน"],
  [1, "707782", "urea", "5 g/100 g", "cream", 20, "g", "jar", 60.5, "3 หรือ 4", "DRU", "Yes", "No", "USE_STATUS 1 ", "USE_STATUS 2"],
  [2, "-", "5-FU 250 mg", null, null, null, null, "vial", "จ่ายตามจริง", "3 หรือ 4", "แฟ้ม DRU", "Yes", "Yes", "USE_STATUS 1 ", null],
];

test("parseClaimSheet: shifted header, sub-headings skipped, rows without code kept", () => {
  const rows = parseClaimSheet("1.FS ทั่วไป", general);
  assert.deepEqual(rows.map((r) => [r.line_no, r.code, r.rate]), [[7, "21301", 100], [9, null, 200], [10, "4720", null]]);
  assert.deepEqual([rows[0].chrgitem_group, rows[0].adp_type, rows[0].opd, rows[0].ipd, rows[0].tmt_id], ["1", "10", true, false, null]);
  assert.equal(rows[2].note, "ยกเลิก");
});

test("parseClaimSheet: drug sheet builds name, TMT, use status, '-' code is null, text rate goes to note", () => {
  const [a, b] = parseClaimSheet("1.FS ยา", drug);
  assert.equal(a.name, "urea 5 g/100 g cream 20 g");
  assert.deepEqual([a.code, a.tmt_id, a.adp_type, a.use_status, a.qty], ["707782", "707782", "DRU", "1,2", "jar"]);
  assert.deepEqual([b.code, b.tmt_id, b.rate, b.adp_type, b.use_status, b.note], [null, null, null, "DRU", "1", "RATE: จ่ายตามจริง"]);
});

test("parseClaimSheet: 16-file recording column (OPAE) goes to note", () => {
  const [r] = parseClaimSheet("1.OPAE", [
    title,
    ["ลำดับ", "CODE", "รายการ", "QTY", "RATE (บาท)", "ประเภท", null, "การบันทึกข้อมูล 16 แฟ้ม", "หมายเหตุ"],
    [null, null, null, null, null, "OPD", "IPD"],
    [1, "-", "OPAE", "ตามเงื่อนไข", "ตามเงื่อนไข", "Yes", "No", "บันทึกแฟ้ม AER", "Fee Schedule"],
  ]);
  assert.deepEqual([r.code, r.rate, r.note], [null, null, "RATE: ตามเงื่อนไข ; บันทึกแฟ้ม AER ; Fee Schedule"]);
});

test("parseStpWorkbook: skips sheets without table, rejects other documents", () => {
  const r = parseStpWorkbook([{ name: "หมวดรายการเบิกจ่าย 16 แฟ้ม", rows: [[null], ["หมวด ... ปัญหาสถานะและสิทธิ"]] }, { name: "1.FS ทั่วไป ", rows: general }, { name: "1.FS ยา", rows: drug }]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.sheets, [{ name: "1.FS ทั่วไป", rows: 3 }, { name: "1.FS ยา", rows: 2 }]);
  assert.match(parseStpWorkbook([{ name: "x", rows: general.slice(4) }]).errors[0], /ไม่ใช่ไฟล์/);
});
