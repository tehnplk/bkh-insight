// รัน: node --test src/app/api/opd/admissions/admissions.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { buildRows } from "./admissions.ts";

const fundOf = (p) => ({ "89": "UCS", O1: "OFC" })[p] ?? "UNKNOWN";
const raw = (vn, extra = {}) => ({
  vn, hn: "h", patient_name: " name ", vstdate: "2026-10-01", vsttime: "08:15:30", dep_code: "053", dep_name: "คลินิก", pttype: "89", pttype_name: "UC",
  pdx: " J189 ", pdx_name: "Pneumonia", ovst_status: "ตรวจแล้ว", ovst_export: "1", income: "1500.50", uc_money: "1200", auth_code: " PP1 ", close_code: null, claim_status: "authen_only",
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
  assert.equal(r.ovst_status, "กลับบ้าน");
  assert.equal(r.ovst_status_detail, "ตรวจแล้ว");
  assert.equal(r.patient_name, "name");
  assert.equal(r.rcpt_no, "418/52, 418/53");
  assert.equal(buildRows([raw("2", { dep_code: "UNKNOWN", dep_name: null })], fundOf)[0].dep_name, null);
  assert.equal(buildRows([raw("3", { dep_code: "077", dep_name: null })], fundOf)[0].dep_name, "077");
});

test("discharge status from export code; queue states = not discharged", () => {
  const label = (ovst_export, ovst_status) => buildRows([raw("6", { ovst_export, ovst_status })], fundOf)[0].ovst_status;
  assert.equal(label("3", "ส่งต่อสถานพยาบาลอื่น"), "ส่งต่อ");
  assert.equal(label("2", "Admit แผนกอายุรกรรม"), "Admit");
  assert.equal(label("4", "เสียชีวิต"), "เสียชีวิต");
  assert.equal(label("1", "รอผลตรวจ"), "ยังไม่จำหน่าย");
  assert.equal(label(null, null), null);
  assert.equal(label("9", "อื่นๆ"), "อื่นๆ");
});

test("no payment = null receipt", () => {
  assert.equal(buildRows([raw("4", { rcpt_no: null })], fundOf)[0].rcpt_no, null);
  assert.equal(buildRows([raw("5", { rcpt_no: "" })], fundOf)[0].rcpt_no, null);
});
