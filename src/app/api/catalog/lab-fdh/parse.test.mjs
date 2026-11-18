// รัน: node --test src/app/api/catalog/lab-fdh/parse.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { read, utils, write } from "xlsx";
import { LAB_FDH_HEADERS, parseDmyTime, parseLabFdh } from "./parse.ts";

// สร้าง workbook จริงแล้วอ่านกลับแบบเดียวกับ route (หัวรายงาน 3 แถว + แถวว่าง + หัวตารางแถว 5 ทุกช่องเป็นข้อความ)
const sheetOf = (aoa) => {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.aoa_to_sheet(aoa), "Lab Catalog");
  const back = read(write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  return utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1, defval: null, raw: true });
};
const report = (hcode = "11252") => [["รายการ Catalogue Lab STP"], [`หน่วยบริการ : ${hcode} - โรงพยาบาลบางระกำ `], ["ออกรายงาน : วันที่ 17/11/2026 เวลา 16:53"], []];
const item = (o = {}) => {
  const base = { row: "1", "สิทธิประโยชน์": "OFC", "รหัสกรมบัญชีกลาง": "32311", "ชื่อ": "SGPT/ALT", "หน่วย": "U/L", "ราคากลาง": "40", gyear: "2023", "วันที่เริ่มต้น": "01-12-2006 00:00", "วันที่สิ้นสุด": "31-12-9999 23:59", flag: "A", "TMLT Code": "320151", "TMLT Name": "Alanine aminotransferase [U/L] in Serum or Plasma", "Lab Code": "3000408", LOINC: "1742-6", Exception: "" };
  return LAB_FDH_HEADERS.map((h) => ({ ...base, ...o })[h]);
};

test("parseDmyTime: dd-mm-yyyy hh:mm to ISO, 9999 end kept, empty null, invalid undefined", () => {
  assert.equal(parseDmyTime("01-12-2006 00:00"), "2006-12-01 00:00");
  assert.equal(parseDmyTime("31-12-9999 23:59"), "9999-12-31 23:59");
  assert.equal(parseDmyTime("1-1-2018"), "2018-01-01 00:00");
  assert.equal(parseDmyTime(""), null);
  assert.equal(parseDmyTime(null), null);
  assert.equal(parseDmyTime("31-02-2018 00:00"), undefined);
  assert.equal(parseDmyTime("01/12/2006 00:00"), undefined);
  assert.equal(parseDmyTime("01-12-2006 24:00"), undefined);
});

test("parseLabFdh: header found below report header, maps columns, empty -> null, counts items across plans", () => {
  const r = parseLabFdh(sheetOf([
    ...report(),
    LAB_FDH_HEADERS.slice(),
    item(),
    item({ row: "2", "รหัสกรมบัญชีกลาง": "", "หน่วย": "", LOINC: "", "Lab Code": "3000999", "ชื่อ": "No CGD" }),
    [],
    item({ row: "3", "สิทธิประโยชน์": "UCS" }),
  ]), "11252");
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows.length, 3);
  assert.equal(r.itemCount, 2);
  const [a, b, c] = r.rows;
  assert.equal(a.line_no, 6);
  assert.deepEqual(
    { plan: a.benefit_plan, cgd: a.cgd_code, price: a.price, gyear: a.gyear, start: a.start_at, end: a.end_at, lab: a.lab_code, exc: a.exception },
    { plan: "OFC", cgd: "32311", price: 40, gyear: 2023, start: "2006-12-01 00:00", end: "9999-12-31 23:59", lab: "3000408", exc: null },
  );
  assert.equal(b.cgd_code, null);
  assert.equal(b.unit, null);
  assert.equal(b.loinc, null);
  assert.equal(c.line_no, 9);
  assert.equal(c.benefit_plan, "UCS");
});

test("parseLabFdh: wrong hospital, missing hospital line, missing header, bad values with Excel line", () => {
  const rows = [LAB_FDH_HEADERS.slice(), item()];
  assert.match(parseLabFdh(sheetOf([...report("10676"), ...rows]), "11252").errors[0], /หน่วยบริการ 10676 ไม่ใช่ 11252/);
  assert.match(parseLabFdh(sheetOf(rows), "11252").errors[0], /ไม่พบรหัสหน่วยบริการ/);
  assert.match(parseLabFdh(sheetOf([...report(), LAB_FDH_HEADERS.slice(0, 14), item()]), "11252").errors[0], /ไม่พบแถวหัวตาราง/);
  const bad = parseLabFdh(sheetOf([...report(), LAB_FDH_HEADERS.slice(), item({ "ราคากลาง": "abc", "วันที่เริ่มต้น": "2006-12-01" }), item({ "Lab Code": "" })]), "11252");
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[0], /^แถว 6: ราคากลาง/);
  assert.match(bad.errors[1], /^แถว 6: วันที่เริ่มต้น/);
  assert.match(bad.errors[2], /^แถว 7: ไม่มี Lab Code/);
  assert.equal(bad.rows.length, 1);
});
