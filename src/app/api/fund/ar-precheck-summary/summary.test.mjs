// รัน: node --test src/app/api/fund/ar-precheck-summary/summary.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { summarizePanel } from "./summary.ts";

const line = (fund, extra = {}) => ({
  fund, fund_name: `ชื่อ ${fund}`, rx_total: 100, rx_pay: 40, income: 100, paid_money: 40, rcpt_money: 40, pp: 0, mismatch: false, ...extra,
});

test("ลูกหนี้ = ค่าใช้จ่ายทั้งหมด − ชำระเงินแล้ว − PPFS (รวมส่วนชำระเองที่ยังค้าง)", () => {
  // ตัวเลขจากภาพตัวอย่าง: UCS 7,504,381.35 − 56,998 − 39,005 ; A1 ค้างชำระ 54,320 ยังเป็นลูกหนี้
  const { funds } = summarizePanel([
    line("UCS", { income: 7_504_381.35, rcpt_money: 56_998, pp: 39_005 }),
    line("A1", { income: 133_357.5, paid_money: 129_207.5, rcpt_money: 74_887.5 }),
  ]);
  assert.deepEqual(funds.map((f) => [f.fund, f.debt]), [["A1", 58_470], ["UCS", 7_408_378.35]]);
});

test("ยอดรวมเป็นสตางค์ ไม่เพี้ยนจากทศนิยมลอยตัว", () => {
  // ยอด OPD ต.ค. 2569 ของ รพ. (prove-query): 17,476,377.02 − 269,575.95 − 148,895 = 17,057,906.07
  const { total } = summarizePanel([
    line("UCS", { income: 17_000_000.01, rcpt_money: 200_000.05, pp: 148_000 }),
    line("OFC", { income: 476_377.01, rcpt_money: 69_575.9, pp: 895 }),
  ]);
  assert.equal(total.income, 17_476_377.02);
  assert.equal(total.rcpt_money, 269_575.95);
  assert.equal(total.pp, 148_895);
  assert.equal(total.debt, 17_057_906.07);
  const sum = summarizePanel([line("A", { rx_total: 0.1 }), line("A", { rx_total: 0.2 })]).total.rx_total;
  assert.equal(sum, 0.3);
});

test("ไม่มีข้อมูลสรุป (null) นับเป็น 0, นับราย/ไม่ตรง และเรียงรหัสโดย UNKNOWN ท้ายสุด", () => {
  const p = summarizePanel([
    line("UNKNOWN", { income: null, paid_money: null, rcpt_money: null, mismatch: true }),
    line("UCS"),
    line("UCS", { mismatch: true }),
    line("A9"),
  ]);
  assert.deepEqual(p.funds.map((f) => [f.fund, f.count, f.mismatch]), [["A9", 1, 0], ["UCS", 2, 1], ["UNKNOWN", 1, 1]]);
  assert.equal(p.funds.at(-1).income, 0);
  assert.deepEqual([p.total.count, p.total.mismatch, p.total.income], [4, 2, 300]);
});

test("ไม่มีราย = ยอด 0 และไม่มีกลุ่มสิทธิ", () => {
  const p = summarizePanel([]);
  assert.deepEqual(p.funds, []);
  assert.equal(p.total.count, 0);
  assert.equal(p.total.debt, 0);
});
