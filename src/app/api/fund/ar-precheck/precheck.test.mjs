// รัน: node --test src/app/api/fund/ar-precheck/precheck.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { buildRows, isMismatch, lockOverdue, matches, sortRows, summarize } from "./precheck.ts";

const src = (key, extra = {}) => ({
  key, vn: key, an: null, hn: `hn${key}`, patient_name: `name ${key}`, date: "2026-11-01", regdate: null,
  pttype: "89", pttype_name: "UC", fund: "UCS", fund_name: "สิทธิหลักประกันสุขภาพ",
  has_stat: 1, income: "100.00", paid_money: "40.00", rcpt_money: "40.00", uc_money: "60.00",
  debt_amount: "60.00", finance_lock: "Y", ...extra,
});
const rx = (key, rx_total = "100.00", rx_pay = "40.00", rx_debt = "60.00") => ({ key, n_items: "3", rx_total, rx_pay, rx_debt });
const TODAY = "2026-11-18"; // พ.
const statusOf = (type, s, r = [rx(s.key)]) => buildRows(type, [s], r, [], TODAY)[0].status;

test("OPD status order: no_stat > total > split > debt > unpaid > ok", () => {
  assert.equal(statusOf("opd", src("1", { has_stat: 0, income: null })), "no_stat");
  // ไม่มีข้อมูลสรุปนำหน้าแม้ยอดอื่นจะไม่ตรงด้วย
  assert.equal(statusOf("opd", src("1", { has_stat: 0, income: null }), [rx("1", "999")]), "no_stat");
  assert.equal(statusOf("opd", src("1", { debt_amount: null }), [rx("1", "99.99")]), "total");
  assert.equal(statusOf("opd", src("1", { debt_amount: null }), [rx("1", "100", "50", "50")]), "split");
  // ใบลูกหนี้มากกว่ารายการลูกหนี้ (paidst 02)
  assert.equal(statusOf("opd", src("1", { debt_amount: "70" })), "debt");
  assert.equal(statusOf("opd", src("1", { rcpt_money: "10" })), "unpaid");
  assert.equal(statusOf("opd", src("1")), "ok");
  // ไม่มีรายการในใบสั่งยา = ยอด 0
  assert.equal(statusOf("opd", src("1", { income: "0", paid_money: "0", rcpt_money: "0", uc_money: "0", debt_amount: null }), []), "ok");
  // ไม่มีใบลูกหนี้ (0) แต่มีรายการลูกหนี้ 60
  assert.equal(statusOf("opd", src("1", { debt_amount: null })), "keyed_after");
  assert.equal(statusOf("opd", src("1"), []), "total");
});

test("IPD: ตั้งหนี้แล้ว = uc_money เมื่อ lock, ไม่ lock = 0 และสถานะ unlocked", () => {
  const [locked, open] = buildRows("ipd", [src("A", { an: "A", finance_lock: "Y" }), src("B", { an: "B", finance_lock: "N" })], [rx("A"), rx("B")], [], TODAY);
  assert.deepEqual([locked.debt, locked.diff_debt, locked.status], [60, 0, "ok"]);
  assert.deepEqual([open.debt, open.diff_debt, open.status], [0, 60, "unlocked"]);
  // split มาก่อน unlocked
  assert.equal(statusOf("ipd", src("C", { an: "C", finance_lock: "N" }), [rx("C", "100", "41", "59")]), "split");
  assert.equal(statusOf("ipd", src("D", { an: "D", finance_lock: "Y", rcpt_money: "0" })), "unpaid");
});

test("compare in satang: 0.1 + 0.2 equals 0.3", () => {
  const s = src("1", { income: "0.3", paid_money: "0.3", rcpt_money: "0.3", uc_money: "0", debt_amount: null });
  const [r] = buildRows("opd", [s], [{ key: "1", n_items: 2, rx_total: 0.1 + 0.2, rx_pay: 0.1 + 0.2, rx_debt: 0 }], [], TODAY);
  assert.equal(r.status, "ok");
  assert.equal(r.diff_total, 0);
});

test("ledger: string → number, missing = 0, insight failed = null everywhere", () => {
  const rows = buildRows("opd", [src("1"), src("2")], [rx("1"), rx("2")], [{ key: "1", booked: "60.00" }], TODAY);
  assert.deepEqual(rows.map((r) => r.booked), [60, 0]);
  assert.equal(summarize(rows).total.booked, 60);
  const failed = buildRows("opd", [src("1")], [rx("1")], null, TODAY);
  assert.equal(failed[0].booked, null);
  assert.equal(summarize(failed).total.booked, null);
});

test("summary totals and per-fund groups", () => {
  const rows = buildRows(
    "opd",
    [src("1"), src("2", { rcpt_money: "0" }), src("3", { fund: "OFC", fund_name: "ข้าราชการ", income: "50.10" })],
    [rx("1"), rx("2"), rx("3", "50.20", "0.10", "50.10")],
    [{ key: "1", booked: "60" }],
    TODAY,
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
  const rows = buildRows("opd", [src("1", { an: "690000001" }), src("2")], [], [], TODAY);
  assert.deepEqual(rows.map((r) => r.admit), ["yes", "no"]);
  assert.ok(matches(rows[0], "690000001") && matches(rows[1], "hn2") && !matches(rows[1], "6900"));
  assert.deepEqual(sortRows([...rows], "admit", "desc").map((r) => r.key), ["1", "2"]);
  assert.deepEqual(sortRows([...rows], "admit", "asc").map((r) => r.key), ["1", "2"]);
});

test("OPD admitted: ใบลูกหนี้ค้างเมื่อมีใบแต่รายการย้ายไป AN หมด ไม่งั้นตรวจที่ผู้ป่วยใน", () => {
  const admitted = (extra) => src("1", { an: "690000001", ...extra });
  assert.equal(statusOf("opd", admitted({ debt_amount: "50" }), []), "stale_slip");
  assert.equal(statusOf("opd", admitted({ debt_amount: null }), []), "admitted");
  // ยังมีรายการที่ vn = ตรวจที่ผู้ป่วยใน แม้ยอดไม่ตรง ; admit นำหน้าการล็อก
  assert.equal(statusOf("opd", admitted({ finance_lock: null }), [rx("1", "999")]), "admitted");
  // ไม่มีข้อมูลสรุปยังนำหน้า
  assert.equal(statusOf("opd", admitted({ has_stat: 0 }), []), "no_stat");
  assert.ok(isMismatch("stale_slip") && !isMismatch("admitted"));
});

test("lockOverdue: เกิน 3 วันทำการ (จ.-ศ.) หลังวันรับบริการ", () => {
  // ศ. 13 พ.ย. 2569: จ. 16, อ. 17, พ. 18 = 3 ยังไม่เกิน ; พฤ. 19 = 4 เกิน
  assert.equal(lockOverdue("2026-11-13", "2026-11-18"), false);
  assert.equal(lockOverdue("2026-11-13", "2026-11-19"), true);
  // เสาร์-อาทิตย์ไม่นับ
  assert.equal(lockOverdue("2026-11-13", "2026-11-15"), false);
  assert.equal(lockOverdue("2026-11-18", "2026-11-18"), false);
  assert.equal(lockOverdue("2026-01-01", "2026-11-18"), true);
});

test("OPD ยังไม่ล็อก: ภายใน 3 วันทำการ = รอ, เกิน = ค้างล็อก (NULL และ N เหมือนกัน)", () => {
  assert.equal(statusOf("opd", src("1", { date: "2026-11-13", finance_lock: null })), "pending_lock");
  assert.equal(statusOf("opd", src("1", { date: "2026-11-13", finance_lock: "N" }), [rx("1", "999")]), "pending_lock");
  assert.equal(statusOf("opd", src("1", { date: "2026-11-12", finance_lock: "N" })), "overdue_lock");
  assert.ok(isMismatch("overdue_lock") && !isMismatch("pending_lock"));
});

test("OPD ล็อกแล้ว: ใบลูกหนี้ตรงรายการแต่ vn_stat ค้าง / คีย์รายการหลังออกใบ", () => {
  // rx_debt 60, ใบ 60, vn_stat.uc_money 50 (ค้าง)
  assert.equal(statusOf("opd", src("1", { uc_money: "50", paid_money: "50", rcpt_money: "50" })), "stale_stat");
  // ใบ 50 น้อยกว่ารายการลูกหนี้ 60
  assert.equal(statusOf("opd", src("1", { debt_amount: "50" })), "keyed_after");
  // ค่าใช้จ่ายไม่ตรงนำหน้า
  assert.equal(statusOf("opd", src("1", { uc_money: "50" }), [rx("1", "110", "50", "60")]), "total");
  assert.ok(isMismatch("stale_stat") && isMismatch("keyed_after"));
  // นับ "ไม่ตรง" ไม่รวมรายที่รอ
  const rows = buildRows("opd", [src("1"), src("2", { finance_lock: null, date: "2026-11-17" }), src("3", { debt_amount: "50" })], [rx("1"), rx("2"), rx("3")], [], TODAY);
  assert.deepEqual(rows.map((r) => r.status), ["ok", "pending_lock", "keyed_after"]);
  assert.equal(summarize(rows).total.mismatch, 1);
});
