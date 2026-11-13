// รัน: node --test src/app/api/opd/admissions/admissions.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { buildRows } from "./admissions.ts";

const fundOf = (p) => ({ "89": "UCS", O1: "OFC" })[p] ?? "UNKNOWN";
const raw = (vn, extra = {}) => ({
  vn, hn: "h", patient_name: " name ", vstdate: "2026-10-01", vsttime: "08:15:30", dep_code: "053", dep_name: "คลินิก", pttype: "89", pttype_name: "UC",
  pdx: " J189 ", pdx_name: "Pneumonia", income: "1500.50", uc_money: "1200", auth_code: " PP1 ", close_code: null, claim_status: "authen_only",
  rcpt_no: "418:52, 418:53", ...extra,
});

test("row shape: numbers parsed, fund from pttype, codes trimmed, unknown department hidden", () => {
  const [r] = buildRows([raw("1")], fundOf);
  assert.equal(r.income, 1500.5);
  assert.equal(r.fund, "UCS");
  assert.equal(r.pdx, "J189");
  assert.equal(r.auth_code, "PP1");
  assert.equal(r.close_code, null);
  assert.equal(r.vsttime, "08:15");
  assert.equal(r.patient_name, "name");
  assert.equal(r.rcpt_no, "418/52, 418/53");
  assert.equal(buildRows([raw("2", { dep_code: "UNKNOWN", dep_name: null })], fundOf)[0].dep_name, null);
  assert.equal(buildRows([raw("3", { dep_code: "077", dep_name: null })], fundOf)[0].dep_name, "077");
});

test("no payment = null receipt", () => {
  assert.equal(buildRows([raw("4", { rcpt_no: null })], fundOf)[0].rcpt_no, null);
  assert.equal(buildRows([raw("5", { rcpt_no: "" })], fundOf)[0].rcpt_no, null);
});
