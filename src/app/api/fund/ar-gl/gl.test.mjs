// รัน: node --test src/app/api/fund/ar-gl/gl.test.mjs
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// gl.ts/journal.ts import ไฟล์ข้างเคียงแบบไม่มีนามสกุล (ตามที่ Next/TS ต้องการ) จึงเติม .ts ให้
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
const { glVoucher, glSalesOp, glCode } = await import("./gl.ts");

const UC = { account_code: "1102050101.201", account_name: "UC-OP ใน CUP", revenue_code: "4301020105.201", diff_under_code: "4301020105.239", diff_over_code: null };
const OFC = { account_code: "1102050101.401", account_name: "OFC-OP", revenue_code: "4301020105.401", diff_under_code: null, diff_over_code: null };
const g = (acc, kind, amount, o = {}) => ({ ...acc, kind, source: "rcpt_debt", n: 1, amount, ...o });
const pick = (l) => [l.code, l.dr, l.cr];

test("หักกลบ set/adjust/diff ต่อบัญชี เรียง ลูกหนี้ Dr → Cr → ส่วนต่าง Dr", () => {
  const v = glVoucher("2026-10-05", [
    g(OFC, "set", "500"),
    g(UC, "set", "1000.50"),
    g(UC, "adjust", "-100.25"),
    g(UC, "diff", "-200"),
  ]);
  assert.deepEqual(v.lines.map(pick), [
    ["1102050101.201", 700.25, 0],
    ["1102050101.401", 500, 0],
    ["4301020105.201", 0, 900.25],
    ["4301020105.401", 0, 500],
    ["4301020105.239", 200, 0],
  ]);
  assert.equal(v.dr, 1400.25);
  assert.equal(v.cr, 1400.25);
  assert.equal(v.error, null);
});

test("ยอดสุทธิติดลบกลับฝั่ง ไม่มีค่าติดลบและไม่มีบรรทัด 0", () => {
  const v = glVoucher("2026-10-06", [g(UC, "set", "50"), g(UC, "cancel", "-80"), g(OFC, "set", "10"), g(OFC, "cancel", "-10")]);
  assert.deepEqual(v.lines.map(pick), [["1102050101.201", 0, 30], ["4301020105.201", 30, 0]]);
  assert.ok(v.lines.every((l) => l.dr >= 0 && l.cr >= 0 && l.dr + l.cr > 0));
});

test("map .203 → .20301 ตั้งแต่ปีงบ 2570 เท่านั้น", () => {
  const acc = { account_code: "1102050101.203", account_name: "UC นอก CUP", revenue_code: "4301020105.203", diff_under_code: null, diff_over_code: null };
  assert.deepEqual(glVoucher("2026-10-01", [g(acc, "set", "10")]).lines.map(pick), [["1102050101.20301", 10, 0], ["4301020105.20301", 0, 10]]);
  assert.deepEqual(glVoucher("2026-09-30", [g(acc, "set", "10")]).lines.map(pick), [["1102050101.203", 10, 0], ["4301020105.203", 0, 10]]);
  assert.equal(glCode("1102050101.201", "2026-10-01"), "1102050101.201");
});

test("บัญชีไม่ระบุที่ยอดไม่ 0 = ใบใช้ไม่ได้ ; หักกลบเป็น 0 ในวันเดียว = ใช้ได้", () => {
  const none = { account_code: null, account_name: null, revenue_code: null, diff_under_code: null, diff_over_code: null };
  const bad = glVoucher("2026-10-07", [g(UC, "set", "100"), g(none, "set", "6490")]);
  assert.match(bad.error, /ยังไม่กำหนดบัญชี/);
  assert.deepEqual(bad.lines.map(pick), [["1102050101.201", 100, 0], ["4301020105.201", 0, 100]]);
  const ok = glVoucher("2026-10-07", [g(UC, "set", "100"), g(none, "set", "6490"), g(none, "reverse", "-6490")]);
  assert.equal(ok.error, null);
});

test("glSalesOp กรอง OP rcpt_debt และแยกใบตามวัน", () => {
  const r = (date, o) => ({ entry_date: date, patient_type: "OP", ...g(UC, "set", "10"), ...o });
  const vs = glSalesOp([
    r("2026-10-02"),
    r("2026-10-01"),
    r("2026-10-01", { patient_type: "IP" }),
    r("2026-10-01", { source: "stm", kind: "settle", amount: "-5" }),
    r("2026-10-01", { kind: "settle", amount: "-5" }),
  ]);
  assert.deepEqual(vs.map((v) => [v.date, v.dr]), [["2026-10-01", 10], ["2026-10-02", 10]]);
});
