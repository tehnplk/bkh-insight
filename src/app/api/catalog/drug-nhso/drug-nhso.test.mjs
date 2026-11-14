// รัน: node --test src/app/api/catalog/drug-nhso/drug-nhso.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { DRUG_NHSO_HEADERS, parseDmy, parseDrugNhso } from "./drug-nhso.ts";

const row = (o = {}) => DRUG_NHSO_HEADERS.map((h) => (h in o ? o[h] : null));
const base = { HOSPDRUGCODE: "1000044", PRODUCTCAT: "1", TMTID: "661235", GENERICNAME: "X", UNITPRICE: "61.5", UPDATEFLAG: "A", DATEEFFECTIVE: "01/10/2012", DATE_APPROVED: "13/01/2015" };

test("parseDmy: dd/mm/yyyy (with optional time) to ISO, empty null, invalid undefined", () => {
  assert.equal(parseDmy("13/01/2015"), "2015-01-13");
  assert.equal(parseDmy("1/9/2013 00:00"), "2013-09-01");
  assert.equal(parseDmy("31/12/9999 23:59"), "9999-12-31");
  assert.equal(parseDmy(""), null);
  assert.equal(parseDmy(null), null);
  assert.equal(parseDmy("31/02/2015"), undefined);
  assert.equal(parseDmy("2015-01-13"), undefined);
});

test("parseDrugNhso: maps columns, keeps every history row, counts distinct codes", () => {
  const r = parseDrugNhso([DRUG_NHSO_HEADERS.slice(), row(base), row({ ...base, UPDATEFLAG: "U", UNITPRICE: "46", DATEEFFECTIVE: "01/01/2023" }), row({}), row({ ...base, HOSPDRUGCODE: "2" })]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows.length, 3);
  assert.equal(r.itemCount, 2);
  assert.equal(r.rows[0].line_no, 2);
  assert.equal(r.rows[0].unit_price, 61.5);
  assert.equal(r.rows[1].date_effective, "2023-01-01");
  assert.equal(r.rows[0].date_change, null);
});

test("parseDrugNhso: header order/case free, missing column rejected, bad values reported with Excel line", () => {
  const shuffled = DRUG_NHSO_HEADERS.slice().reverse().map((h) => h.toLowerCase());
  const reordered = parseDrugNhso([shuffled, DRUG_NHSO_HEADERS.slice().reverse().map((h) => base[h] ?? null)]);
  assert.equal(reordered.rows[0].hosp_drug_code, "1000044");
  assert.match(parseDrugNhso([["HOSPDRUGCODE"]]).errors[0], /ไม่พบคอลัมน์/);
  const bad = parseDrugNhso([DRUG_NHSO_HEADERS.slice(), row({ ...base, UNITPRICE: "abc", DATEEFFECTIVE: "2015-01-01" }), row({ ...base, HOSPDRUGCODE: "" })]);
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[0], /^แถว 2: DATEEFFECTIVE/);
  assert.match(bad.errors[2], /^แถว 3: ไม่มี HOSPDRUGCODE/);
});
