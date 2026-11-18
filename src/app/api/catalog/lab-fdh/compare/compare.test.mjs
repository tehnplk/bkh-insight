// รัน: node --test src/app/api/catalog/lab-fdh/compare/compare.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { compareLab, isLive } from "./compare.ts";

const TODAY = "2026-11-18";
const PLANS = ["OFC", "SSS", "STP", "UCS"];
const his = (o) => ({ icode: "3000408", name: "SGPT", istatus: "Y", income: "07", price: 50, nhso_adp_code: "32311", lab_items_codes: "21", tmlt_codes: "320151", tmlt_n: 1, sks_code: "32311", price_ofc: 40, ...o });
const catRow = (o) => ({ lab_code: "3000408", benefit_plan: "OFC", cgd_code: "32311", name: "SGPT/ALT", price: 40, tmlt_code: "320151", start_at: "2006-12-01 00:00:00", end_at: "9999-12-31 23:59:00", ...o });
/** แถวเดียวกันทั้ง 4 สิทธิ์เหมือนไฟล์จริง */
const cat = (o) => PLANS.map((benefit_plan) => catRow({ ...o, benefit_plan }));
const problems = (rows, code = "3000408") => rows.filter((r) => r.code === code).map((r) => r.problem).sort();

test("isLive: 9999 end, future start, expired", () => {
  assert.equal(isLive(catRow({}), TODAY), true);
  assert.equal(isLive(catRow({ start_at: "2027-01-01 00:00:00" }), TODAY), false);
  assert.equal(isLive(catRow({ end_at: "2026-11-17 23:59:00" }), TODAY), false);
  assert.equal(isLive(catRow({ end_at: "2026-11-18 00:00:00" }), TODAY), true);
});

test("clean item across 4 plans has no problems; one row per code", () => {
  assert.deepEqual(compareLab([his({})], cat({}), TODAY), []);
});

test("not_in_catalog: income 07 and income 06 linked to lab_items; inactive or non-lab skipped; expired catalog row", () => {
  const rows = compareLab(
    [his({ icode: "1" }), his({ icode: "2", income: "06" }), his({ icode: "3", istatus: "N" }), his({ icode: "4", income: "02", tmlt_n: null }), his({ icode: "5", tmlt_n: null, tmlt_codes: null }), his({})],
    cat({ end_at: "2025-01-01 00:00:00" }),
    TODAY,
  );
  assert.deepEqual(problems(rows, "1"), ["not_in_catalog"]);
  assert.deepEqual(problems(rows, "2"), ["not_in_catalog"]);
  assert.deepEqual(problems(rows, "3"), []);
  assert.deepEqual(problems(rows, "4"), []);
  assert.equal(rows.find((r) => r.code === "5").detail, "ไม่ผูก lab_items");
  assert.match(rows.find((r) => r.code === "3000408").detail, /ไม่มีแถวที่มีผลวันนี้/);
});

test("not_in_hosxp and inactive stop further checks", () => {
  const rows = compareLab([his({ istatus: "N", price_ofc: 999 })], [...cat({}), ...cat({ lab_code: "9999999", cgd_code: null })], TODAY);
  assert.deepEqual(problems(rows), ["inactive"]);
  assert.deepEqual(problems(rows, "9999999"), ["not_in_hosxp"]);
  assert.equal(rows.find((r) => r.code === "9999999").name, "SGPT/ALT");
});

test("TMLT: none in lab_items, not linked, multiple, different", () => {
  const rows = compareLab(
    [his({ tmlt_codes: null, tmlt_n: 0 }), his({ icode: "2", tmlt_codes: null, tmlt_n: null }), his({ icode: "3", tmlt_codes: "320151,320152", tmlt_n: 2 }), his({ icode: "4", tmlt_codes: "999999" })],
    ["3000408", "2", "3", "4"].flatMap((lab_code) => cat({ lab_code })),
    TODAY,
  );
  assert.deepEqual(problems(rows), ["no_tmlt"]);
  assert.equal(rows.find((r) => r.code === "3000408").detail, "lab_items 21 ไม่มี TMLT");
  assert.equal(rows.find((r) => r.code === "2").detail, "icode นี้ไม่ผูก lab_items");
  assert.deepEqual(problems(rows, "3"), ["tmlt_mismatch"]);
  assert.match(rows.find((r) => r.code === "3").detail, /2 TMLT/);
  assert.deepEqual(problems(rows, "4"), ["tmlt_mismatch"]);
});

test("CGD: two catalog codes for one Lab Code, 6-digit HOSxP code, empty code with sks hint", () => {
  const two = [...cat({ lab_code: "3001351", cgd_code: "31301" }), ...cat({ lab_code: "3001351", cgd_code: "30309" })];
  const rows = compareLab(
    [his({ icode: "3001351", nhso_adp_code: "30309" }), his({ nhso_adp_code: "350850", sks_code: "350850" }), his({ icode: "5", nhso_adp_code: " ", sks_code: "32311" })],
    [...two, ...cat({}), ...cat({ lab_code: "5" })],
    TODAY,
  );
  assert.deepEqual(problems(rows, "3001351"), []);
  assert.equal(rows.find((r) => r.code === "3000408").detail, "");
  assert.equal(rows.find((r) => r.code === "5").detail, "HOSxP ไม่มีรหัส ADP ; TMLT ของ HOSxP ระบุรหัส 32311");
  assert.deepEqual(problems(compareLab([his({ icode: "3001351", nhso_adp_code: "30309" })], two, TODAY), "3001351"), []);
});

test("over_price: OFC price first, falls back to sale price, max catalog price, price 0 skipped", () => {
  const rows = compareLab(
    [his({ price_ofc: 45 }), his({ icode: "2", price_ofc: null, price: 60 }), his({ icode: "3", price_ofc: 60 }), his({ icode: "4", price_ofc: 500, nhso_adp_code: "30309" })],
    [...cat({}), ...cat({ lab_code: "2" }), ...cat({ lab_code: "3", price: 0 }), ...cat({ lab_code: "4", cgd_code: "31301", price: 100 }), ...cat({ lab_code: "4", cgd_code: "30309", price: 600 })],
    TODAY,
  );
  assert.deepEqual(problems(rows), ["over_price"]);
  assert.equal(rows.find((r) => r.code === "3000408").detail, "45.00 เกินราคากลาง 40.00");
  assert.deepEqual(problems(rows, "2"), ["over_price"]);
  assert.deepEqual(problems(rows, "3"), ["catalog_incomplete"]);
  assert.deepEqual(problems(rows, "4"), []);
});

test("plan_gap and catalog_incomplete (no CGD, price 0, TMLT 390013); keys unique", () => {
  const rows = compareLab(
    [his({}), his({ icode: "7", tmlt_codes: "390013", nhso_adp_code: null })],
    [...cat({}).filter((r) => r.benefit_plan !== "STP"), ...cat({ lab_code: "7", cgd_code: null, price: 0, tmlt_code: "390013" })],
    TODAY,
  );
  assert.deepEqual(problems(rows), ["plan_gap"]);
  assert.equal(rows.find((r) => r.code === "3000408").detail, "ไม่มีใน STP");
  assert.equal(rows.find((r) => r.code === "3000408").plans, "OFC, SSS, UCS");
  assert.deepEqual(problems(rows, "7"), ["catalog_incomplete"]);
  assert.equal(rows.find((r) => r.code === "7").detail, "ไม่มีรหัสกรมบัญชีกลาง, ไม่มีราคากลาง, TMLT 390013");
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
});
