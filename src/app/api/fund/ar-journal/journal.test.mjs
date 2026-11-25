// รัน: node --test src/app/api/fund/ar-journal/journal.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { journalLines } from "./journal.ts";

const g = (kind, amount, o = {}) => ({ account_code: "1102050101.202", account_name: "UC-IP", kind, revenue_code: "4301020105.202", diff_under_code: "4301020105.231", diff_over_code: "4301020105.232", n: 1, amount, ...o });
const pick = (l) => [l.kind, l.dr_code, l.cr_code, l.amount];

test("set, cancel, settle, both diffs", () => {
  const lines = journalLines([g("set", "1000.50"), g("cancel", "-100"), g("settle", "-700"), g("diff", "-200.50"), g("diff", "30", { n: 2 })]);
  assert.deepEqual(lines.map(pick), [
    ["ตั้งหนี้", "1102050101.202", "4301020105.202", 1000.5],
    ["ยกเลิก", "4301020105.202", "1102050101.202", 100],
    ["รับชำระ", null, "1102050101.202", 700],
    ["ส่วนต่าง", "1102050101.202", "4301020105.232", 30],
    ["ส่วนต่าง", "4301020105.231", "1102050101.202", 200.5],
  ]);
  assert.equal(lines.find((l) => l.kind === "รับชำระ").dr_name, "เงินฝากธนาคาร");
  assert.deepEqual(lines.map((l) => [l.dr_type, l.cr_type]), [["ar", "revenue"], ["revenue", "ar"], ["cash", "ar"], ["ar", "diff_over"], ["diff_under", "ar"]]);
});

test("same direction groups merge; zero skipped; missing revenue stays null", () => {
  const lines = journalLines([g("adjust", "10"), g("adjust", "5"), g("set", "0"), g("set", "1", { revenue_code: null })]);
  assert.deepEqual(lines.map(pick), [["ตั้งหนี้", "1102050101.202", null, 1], ["ปรับปรุง", "1102050101.202", "4301020105.202", 15]]);
});

test("settle ของ source fwf ลง Dr เงินรับล่วงหน้า แยกจากรับชำระเงินฝาก ; diff ไม่ขึ้นกับ source", () => {
  const o = { account_code: "1102050101.501", revenue_code: "4301020106.503", diff_under_code: "4301020106.505", diff_over_code: null };
  const lines = journalLines([g("settle", "-500", { ...o, source: "fwf" }), g("settle", "-100", { ...o, source: "manual" }), g("diff", "-40", { ...o, source: "fwf" })]);
  assert.deepEqual(lines.map((l) => [l.kind, l.dr_type, l.dr_code, l.cr_code, l.amount]), [
    ["รับชำระ", "pool", "2103010103.502", "1102050101.501", 500],
    ["รับชำระ", "cash", null, "1102050101.501", 100],
    ["ส่วนต่าง", "diff_under", "4301020106.505", "1102050101.501", 40],
  ]);
});

test("diff ตามเพดาน/สัดส่วน (source HOSxP): ลบ Dr diff_under ; บวก (ยกเลิก) กลับข้างในบัญชีเดียวกัน ไม่ใช่ diff_over", () => {
  const o = { account_code: "1102050101.203", revenue_code: "4301020105.203", diff_under_code: "4301020105.239", diff_over_code: "4301020105.240", source: "rcpt_debt" };
  const lines = journalLines([g("diff", "-200", o), g("diff", "200", o)]);
  assert.deepEqual(lines.map((l) => [l.dr_type, l.dr_code, l.cr_type, l.cr_code, l.amount]), [
    ["ar", "1102050101.203", "diff_under", "4301020105.239", 200],
    ["diff_under", "4301020105.239", "ar", "1102050101.203", 200],
  ]);
});
