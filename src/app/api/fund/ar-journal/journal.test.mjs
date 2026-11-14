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
});

test("same direction groups merge; zero skipped; missing revenue stays null", () => {
  const lines = journalLines([g("adjust", "10"), g("adjust", "5"), g("set", "0"), g("set", "1", { revenue_code: null })]);
  assert.deepEqual(lines.map(pick), [["ตั้งหนี้", "1102050101.202", null, 1], ["ปรับปรุง", "1102050101.202", "4301020105.202", 15]]);
});
