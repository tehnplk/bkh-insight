// รัน: node --test src/app/api/fund/ar-journal/journal.test.mjs
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// journal.ts import "../ar-transfer/transfer" แบบไม่มีนามสกุล (ตามที่ Next/TS ต้องการ) จึงเติม .ts ให้
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith(".")) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
});
const { journalLines } = await import("./journal.ts");

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

test("transfer (ar_transfer ติดลบ = รับ): Dr เงินฝากธนาคาร / Cr บัญชีรายได้ ; ถูกหักคืนกลับข้าง ; บัญชีไม่ขึ้นต้น 4 เป็น ar", () => {
  const o = { account_name: null, revenue_code: null, diff_under_code: null, diff_over_code: null, source: "transfer" };
  const lines = journalLines([
    g("transfer", "-7224700", { ...o, account_code: "4301020105.214" }),
    g("transfer", "27931.75", { ...o, account_code: "4301020105.214" }),
    g("transfer", "-100", { ...o, account_code: "1102050101.222", account_name: "OP REFER" }),
  ]);
  assert.deepEqual(lines.map((l) => [l.kind, l.dr_type, l.dr_code, l.dr_name, l.cr_type, l.cr_code, l.cr_name, l.amount]), [
    ["รับเงินโอน", "revenue", "4301020105.214", "รายได้", "cash", null, "เงินฝากธนาคาร", 27931.75],
    ["รับเงินโอน", "cash", null, "เงินฝากธนาคาร", "ar", "1102050101.222", "OP REFER", 100],
    ["รับเงินโอน", "cash", null, "เงินฝากธนาคาร", "revenue", "4301020105.214", "รายได้", 7224700],
  ]);
});

test("transfer เข้าลูกหนี้ที่ settles_by_stm ไม่เกิดบรรทัด (ลงผ่าน settle ของ STM แล้ว) ; transfer เข้า .214 ยังเกิด", () => {
  const o = { account_name: null, revenue_code: null, diff_under_code: null, diff_over_code: null, source: "transfer" };
  const lines = journalLines([
    g("transfer", "-41410000", { ...o, account_code: "1102050101.202", settles_by_stm: true }),
    g("transfer", "500", { ...o, account_code: "1102050101.216", settles_by_stm: true }),
    g("transfer", "-100", { ...o, account_code: "4301020105.214", settles_by_stm: false }),
  ]);
  assert.deepEqual(lines.map((l) => [l.kind, l.dr_type, l.cr_code, l.amount]), [["รับเงินโอน", "cash", "4301020105.214", 100]]);
});

test("transfer งบปีก่อน (3102010102.201 ไม่อยู่ใน ar_account): Cr บัญชีทุน equity ชื่อจาก PRIOR_YEAR_ACCOUNT", () => {
  const o = { account_name: null, revenue_code: null, diff_under_code: null, diff_over_code: null, source: "transfer", account_code: "3102010102.201" };
  const lines = journalLines([g("transfer", "-500", o)]);
  assert.deepEqual(lines.map((l) => [l.dr_type, l.dr_code, l.cr_type, l.cr_code, l.cr_name, l.amount]), [
    ["cash", null, "equity", "3102010102.201", "กำไร/ขาดทุนสะสมจากข้อผิดพลาดเงินกองทุน UC ปีก่อน", 500],
  ]);
});

test("capitation: settle Dr clear_code (รายได้) / Cr ลูกหนี้ ; diff Dr clear_short_code / Cr ลูกหนี้ ; ไม่ใช่เงินฝากหรือ diff_under ของบัญชี", () => {
  const o = { account_code: "1102050101.201", revenue_code: "4301020105.201", diff_under_code: null, diff_over_code: null, source: "capitation", clear_code: "4301020105.214", clear_short_code: "4301020105.229" };
  const lines = journalLines([g("settle", "-7245901.67", o), g("diff", "-6925267.64", { ...o, n: 3 })]);
  assert.deepEqual(lines.map((l) => [l.kind, l.dr_type, l.dr_code, l.cr_type, l.cr_code, l.n, l.amount]), [
    ["รับชำระ", "revenue", "4301020105.214", "ar", "1102050101.201", 1, 7245901.67],
    ["ส่วนต่าง", "diff_under", "4301020105.229", "ar", "1102050101.201", 3, 6925267.64],
  ]);
});

test("diff ตอนรับเงินของบริการปีงบก่อน (prior_year): บัญชีคู่ 3102010102.102 equity ทั้งสองทิศ ; ปีเดียวกันใช้ diff_under/over เดิม ; Dr = Cr", () => {
  const stm = { source: "stm" };
  const lines = journalLines([
    g("diff", "-200", { ...stm, prior_year: true }),
    g("diff", "50", { ...stm, prior_year: true }),
    g("diff", "-10", { source: "manual", prior_year: true }),
    g("diff", "-30", { ...stm, prior_year: false }),
    g("diff", "40", stm),
  ]);
  assert.deepEqual(lines.map((l) => [l.dr_type, l.dr_code, l.cr_type, l.cr_code, l.amount]), [
    ["ar", "1102050101.202", "equity", "3102010102.102", 50],
    ["ar", "1102050101.202", "diff_over", "4301020105.232", 40],
    ["equity", "3102010102.102", "ar", "1102050101.202", 210],
    ["diff_under", "4301020105.231", "ar", "1102050101.202", 30],
  ]);
});
