// รัน: node --test src/app/api/catalog/service-catalog/_lib/compare.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { compareItems, effectiveUc, normCode } from "./compare.ts";

const item = (o) => ({ icode: "3000001", name: "X", unit: null, price: 100, ipd_price: null, income: "07", nhso_adp_type_id: 15, nhso_adp_code: null, g1_opd: null, g1_ipd: null, g2_opd: null, g2_ipd: null, ...o });
const uc = (o) => ({ code: "31001", name: "CBC", price: 90, start_date: "2020-01-01", end_date: null, fs_status: 1, chrgitem_group: "7", ...o });
const groups = new Map([["7", [15]], ["19", [3, 1, 4]], ["3", null]]);
const TODAY = "2026-11-14";
const problems = (rows, icode = "3000001") => rows.filter((r) => r.icode === icode).map((r) => r.problem).sort();

test("normCode trims and upper-cases", () => {
  assert.equal(normCode("  ab12 "), "AB12");
  assert.equal(normCode(null), "");
});

test("effectiveUc: latest live start, keeps same-start rows, ignores expired and future", () => {
  const rows = [uc({ price: 50, start_date: "2020-01-01", end_date: "2025-09-30" }), uc({ price: 80, start_date: "2025-10-01" }), uc({ price: 85, start_date: "2025-10-01" }), uc({ price: 99, start_date: "2027-01-01" })];
  assert.deepEqual(effectiveUc(rows, TODAY).map((r) => r.price), [80, 85]);
  assert.deepEqual(effectiveUc([uc({ end_date: "2025-01-01" })], TODAY), []);
});

test("no code, unknown code, clean item", () => {
  const rows = compareItems([item({}), item({ icode: "2", nhso_adp_code: "99999" }), item({ icode: "3", nhso_adp_code: " 31001 ", price: 90 })], [uc({})], [], groups, TODAY);
  assert.deepEqual(problems(rows), ["no_code"]);
  assert.deepEqual(problems(rows, "2"), ["unknown_code"]);
  assert.deepEqual(problems(rows, "3"), []);
});

test("OFC matches without leading zeros; over OFC uses group 1 price, falls back to price", () => {
  const ofc = [{ code: "31001", name: "CBC", price: 120 }];
  const rows = compareItems([item({ nhso_adp_code: "031001", price: 100, g1_opd: 150 }), item({ icode: "2", nhso_adp_code: "31001", price: 130 })], [], ofc, groups, TODAY);
  assert.deepEqual(problems(rows), ["over_ofc"]);
  assert.match(rows[0].detail, /OPD 150\.00 เกินอัตรา 120\.00/);
  assert.equal(rows[0].ofc_rate, 120);
  // 2 รายการใช้รหัสเดียวกัน (031001 กับ 31001 เป็นคนละรหัสใน HOSxP จึงไม่ shared)
  assert.deepEqual(problems(rows, "2"), ["over_ofc"]);
});

test("UC: price 0 file rows are null = no rate (never under), fee-schedule status, under UC uses min rate", () => {
  const rows = compareItems(
    [item({ nhso_adp_code: "A1", price: 10 }), item({ icode: "2", nhso_adp_code: "385401", price: 600 }), item({ icode: "4", nhso_adp_code: "S1", price: 1 })],
    [uc({ code: "A1", price: null, fs_status: 2 }), uc({ code: "385401", price: 520 }), uc({ code: "385401", price: 870 }), uc({ code: "S1", fs_status: 3, price: null })],
    [], groups, TODAY,
  );
  assert.deepEqual(problems(rows), ["not_fee_schedule"]);
  assert.equal(rows.find((r) => r.icode === "3000001").detail, "ไม่มีอัตรา");
  assert.deepEqual(problems(rows, "2"), []); // 600 ไม่ต่ำกว่าอัตราต่ำสุด 520
  assert.deepEqual(problems(rows, "4"), ["not_standard"]);
  const under = compareItems([item({ nhso_adp_code: "385401", g2_opd: 500, g2_ipd: 0 })], [uc({ code: "385401", price: 520 }), uc({ code: "385401", price: 870 })], [], groups, TODAY);
  assert.deepEqual(problems(under), ["under_uc"]);
  assert.match(under[0].detail, /^OPD 500\.00 ต่ำกว่าอัตรา 520\.00 \(รหัสนี้มี 2 อัตรา/);
});

test("ADP type vs UC group (group 19 accepts 3/1/4, drug groups skipped) and shared code", () => {
  const rows = compareItems(
    [item({ nhso_adp_code: "31001", nhso_adp_type_id: 3, price: 90 }), item({ icode: "2", nhso_adp_code: "31001", nhso_adp_type_id: 15, price: 90 }), item({ icode: "5", nhso_adp_code: "HC07", nhso_adp_type_id: 1, price: 35 })],
    [uc({}), uc({ code: "HC07", chrgitem_group: "19", price: 35 })],
    [], groups, TODAY,
  );
  assert.deepEqual(problems(rows), ["adp_type", "shared_code"]);
  assert.deepEqual(problems(rows, "2"), ["shared_code"]);
  assert.match(rows.find((r) => r.icode === "2").detail, /^ใช้ร่วมกับอีก 1 รายการ: 3000001$/);
  assert.deepEqual(problems(rows, "5"), []);
});

test("placeholder XXXXXX counts as no code and is never shared; INST (ADP 2) not matched against UC/OFC; ADP 4 unknown gets a hint", () => {
  const rows = compareItems(
    [item({ nhso_adp_code: "XXXXXX" }), item({ icode: "2", nhso_adp_code: "xxxxxx" }), item({ icode: "3", nhso_adp_code: "8602", nhso_adp_type_id: 2 }), item({ icode: "4", nhso_adp_code: "FP002_1", nhso_adp_type_id: 4 })],
    [uc({ code: "8602", chrgitem_group: "7", fs_status: 2, price: null })], [{ code: "8602", name: "x", price: 1 }], groups, TODAY,
  );
  assert.deepEqual(problems(rows), ["no_code"]);
  assert.deepEqual(problems(rows, "2"), ["no_code"]);
  assert.equal(rows[0].detail, "ใช้รหัสชั่วคราว XXXXXX");
  assert.deepEqual(problems(rows, "3"), []);
  assert.match(rows.find((r) => r.icode === "4").detail, /PP/);
});
