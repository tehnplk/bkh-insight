// รัน: node --test src/app/api/fund/ar-precheck/precheck.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { buildRows, matches, sortRows, summarize } from "./precheck.ts";

const src = (key, extra = {}) => ({
  key, vn: key, an: null, hn: `hn${key}`, patient_name: `name ${key}`, date: "2026-11-01", regdate: null,
  pttype: "89", pttype_name: "UC", fund: "UCS", fund_name: "สิทธิหลักประกันสุขภาพ",
  has_stat: 1, income: "100.00", paid_money: "40.00", rcpt_money: "40.00", uc_money: "60.00",
  debt_amount: "60.00", finance_lock: null, ...extra,
});
const rx = (key, rx_total = "100.00", rx_pay = "40.00", rx_debt = "60.00") => ({ key, n_items: "3", rx_total, rx_pay, rx_debt });
const statusOf = (type, s, r = [rx(s.key)]) => buildRows(type, [s], r, [])[0].status;

test("OPD status order: no_stat > total > split > debt > unpaid > ok", () => {
  assert.equal(statusOf("opd", src("1", { has_stat: 0, income: null })), "no_stat");
  // ไม่มีข้อมูลสรุปนำหน้าแม้ยอดอื่นจะไม่ตรงด้วย
  assert.equal(statusOf("opd", src("1", { has_stat: 0, income: null }), [rx("1", "999")]), "no_stat");
  assert.equal(statusOf("opd", src("1", { debt_amount: null }), [rx("1", "99.99")]), "total");
  assert.equal(statusOf("opd", src("1", { debt_amount: null }), [rx("1", "100", "50", "50")]), "split");
  assert.equal(statusOf("opd", src("1", { debt_amount: null, paid_money: "40", rcpt_money: "0" })), "debt");
  assert.equal(statusOf("opd", src("1", { rcpt_money: "10" })), "unpaid");
  assert.equal(statusOf("opd", src("1")), "ok");
  // ไม่มีรายการในใบสั่งยา = ยอด 0
  assert.equal(statusOf("opd", src("1", { income: "0", paid_money: "0", rcpt_money: "0", uc_money: "0", debt_amount: null }), []), "ok");
  assert.equal(statusOf("opd", src("1"), []), "total");
});

test("IPD: ตั้งหนี้แล้ว = uc_money เมื่อ lock, ไม่ lock = 0 และสถานะ unlocked", () => {
  const [locked, open] = buildRows("ipd", [src("A", { an: "A", finance_lock: "Y" }), src("B", { an: "B", finance_lock: "N" })], [rx("A"), rx("B")], []);
  assert.deepEqual([locked.debt, locked.diff_debt, locked.status], [60, 0, "ok"]);
  assert.deepEqual([open.debt, open.diff_debt, open.status], [0, 60, "unlocked"]);
  // split มาก่อน unlocked
  assert.equal(statusOf("ipd", src("C", { an: "C", finance_lock: "N" }), [rx("C", "100", "41", "59")]), "split");
  assert.equal(statusOf("ipd", src("D", { an: "D", finance_lock: "Y", rcpt_money: "0" })), "unpaid");
});

test("compare in satang: 0.1 + 0.2 equals 0.3", () => {
  const s = src("1", { income: "0.3", paid_money: "0.3", rcpt_money: "0.3", uc_money: "0", debt_amount: null });
  const [r] = buildRows("opd", [s], [{ key: "1", n_items: 2, rx_total: 0.1 + 0.2, rx_pay: 0.1 + 0.2, rx_debt: 0 }], []);
  assert.equal(r.status, "ok");
  assert.equal(r.diff_total, 0);
});

test("ledger: string → number, missing = 0, insight failed = null everywhere", () => {
  const rows = buildRows("opd", [src("1"), src("2")], [rx("1"), rx("2")], [{ key: "1", booked: "60.00" }]);
  assert.deepEqual(rows.map((r) => r.booked), [60, 0]);
  assert.equal(summarize(rows).total.booked, 60);
  const failed = buildRows("opd", [src("1")], [rx("1")], null);
  assert.equal(failed[0].booked, null);
  assert.equal(summarize(failed).total.booked, null);
});

test("summary totals and per-fund groups", () => {
  const rows = buildRows(
    "opd",
    [src("1"), src("2", { rcpt_money: "0" }), src("3", { fund: "OFC", fund_name: "ข้าราชการ", income: "50.10" })],
    [rx("1"), rx("2"), rx("3", "50.20", "0.10", "50.10")],
    [{ key: "1", booked: "60" }],
  );
  const { total, funds } = summarize(rows);
  assert.equal(total.count, 3);
  assert.equal(total.rx_total, 250.2);
  assert.equal(total.income, 250.1);
  assert.equal(total.rcpt_money, 80);
  assert.equal(total.mismatch, 2);
  assert.equal(total.diff_total, 0.1);
  assert.deepEqual(funds.map((f) => [f.fund, f.count, f.mismatch, f.uc_money]), [["UCS", 2, 1, 120], ["OFC", 1, 1, 60]]);
});

test("OPD admitted visit keeps AN, search and sort by admit", () => {
  const rows = buildRows("opd", [src("1", { an: "690000001" }), src("2")], [], []);
  assert.deepEqual(rows.map((r) => r.admit), ["yes", "no"]);
  assert.ok(matches(rows[0], "690000001") && matches(rows[1], "hn2") && !matches(rows[1], "6900"));
  assert.deepEqual(sortRows([...rows], "admit", "desc").map((r) => r.key), ["1", "2"]);
  assert.deepEqual(sortRows([...rows], "admit", "asc").map((r) => r.key), ["1", "2"]);
});
