// รัน: node --test src/app/api/opd/admissions/admissions.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { admitStatus, buildRows, formatCid } from "./admissions.ts";

const fundOf = (p) => ({ "89": "UCS", O1: "OFC" })[p] ?? "UNKNOWN";
const raw = (vn, extra = {}) => ({
  vn, hn: "h", patient_name: " name ", vstdate: "2026-10-01", vsttime: "08:15:30", dep_code: "053", dep_name: "คลินิก", pttype: "89", pttype_name: "UC",
  pdx: " J189 ", pdx_name: "Pneumonia", ovst_status: "ตรวจแล้ว", ovst_export: "1", income: "1500.50", uc_money: "1200", auth_code: " PP1 ", close_code: null, claim_status: "authen_only",
  rcpt_no: "418:52, 418:53", ...extra,
});

test("row shape: numbers parsed, fund from pttype, codes trimmed, unknown department hidden", () => {
  const [r] = buildRows([raw("1")], [], fundOf);
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
  assert.equal(buildRows([raw("2", { dep_code: "UNKNOWN", dep_name: null })], [], fundOf)[0].dep_name, null);
  assert.equal(buildRows([raw("3", { dep_code: "077", dep_name: null })], [], fundOf)[0].dep_name, "077");
});

test("discharge status from export code; queue states = not discharged", () => {
  const label = (ovst_export, ovst_status) => buildRows([raw("6", { ovst_export, ovst_status })], [], fundOf)[0].ovst_status;
  assert.equal(label("3", "ส่งต่อสถานพยาบาลอื่น"), "ส่งต่อ");
  assert.equal(label("2", "Admit แผนกอายุรกรรม"), "Admit");
  assert.equal(label("4", "เสียชีวิต"), "เสียชีวิต");
  assert.equal(label("1", "รอผลตรวจ"), "ยังไม่จำหน่าย");
  assert.equal(label(null, null), null);
  assert.equal(label("9", "อื่นๆ"), "อื่นๆ");
});

test("no payment = null receipt", () => {
  assert.equal(buildRows([raw("4", { rcpt_no: null })], [], fundOf)[0].rcpt_no, null);
  assert.equal(buildRows([raw("5", { rcpt_no: "" })], [], fundOf)[0].rcpt_no, null);
});

test("REP: found = latest on any fund, missing = null only on UCS, not loaded = no rep key", () => {
  const reps = [
    { vn: "1", rep_no: "R1", rep_date: "2026-10-20", status: "deny", codes: ["D01"] },
    { vn: "3", rep_no: "R3", rep_date: "2026-10-21", status: "pass", codes: [] },
  ];
  const rows = buildRows([raw("1"), raw("2"), raw("3", { pttype: "O1" }), raw("4", { pttype: "O1" })], reps, fundOf);
  assert.deepEqual(rows[0].rep, { rep_no: "R1", rep_date: "2026-10-20", status: "deny", codes: ["D01"] });
  assert.equal(rows[1].rep, null);
  assert.equal(rows[2].rep.status, "pass");
  assert.equal("rep" in rows[3], false);
  assert.equal("rep" in buildRows([raw("1")], undefined, fundOf)[0], false);
});

test("formatCid: 13 digits grouped 1-4-5-2-1, others raw, empty blank", () => {
  assert.equal(formatCid("1234567890123"), "1-2345-67890-12-3");
  assert.equal(formatCid(" 1234567890123 "), "1-2345-67890-12-3");
  assert.equal(formatCid("12345"), "12345");
  assert.equal(formatCid("A123456789012"), "A123456789012");
  assert.equal(formatCid(null), "");
  assert.equal(formatCid("  "), "");
});

test("admit: AN + OPD leftover from SQL ; status none/clear/left", () => {
  const [none, clear, left, zero] = buildRows(
    [raw("7", { an: null, opd_left: null }), raw("8", { an: " 690001234 ", opd_left: null }), raw("9", { an: "690001235", opd_left: "1230.50" }), raw("10", { an: "690001236", opd_left: "0" })],
    [], fundOf);
  assert.equal(none.an, null);
  assert.equal(clear.an, "690001234");
  assert.equal(left.opd_left, 1230.5);
  assert.deepEqual([none, clear, left, zero].map(admitStatus), ["none", "clear", "left", "left"]);
  assert.equal(admitStatus({ an: "", opd_left: null }), "none");
});
