// รัน: node --test src/app/api/fund/close-privilege/dispense.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { dispenseStatus } from "./dispense.ts";

test("dispense status per visit", () => {
  assert.equal(dispenseStatus({ has_drug: 0, dispensed: 0, main_dep: "011" }), "none");
  // บันทึกจ่ายยาจริงชนะแผนกที่จ่ายเอง (PCU มีห้องยาไปช่วย)
  assert.equal(dispenseStatus({ has_drug: 1, dispensed: 1, main_dep: "030" }), "dispensed");
  assert.equal(dispenseStatus({ has_drug: "1", dispensed: "1", main_dep: "001" }), "dispensed");
  assert.equal(dispenseStatus({ has_drug: 1, dispensed: 0, main_dep: "011" }), "er");
  assert.equal(dispenseStatus({ has_drug: 1, dispensed: 0, main_dep: " 034 " }), "self");
  assert.equal(dispenseStatus({ has_drug: 1, dispensed: 0, main_dep: "029" }), "self");
  assert.equal(dispenseStatus({ has_drug: 1, dispensed: 0, main_dep: "001" }), "pending");
  assert.equal(dispenseStatus({ has_drug: 1, dispensed: 0, main_dep: null }), "pending");
});
