// รัน: node --test src/app/api/fund/fwf-card/fwf.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  addMonths, cardBalance, coveringCard, defaultValidity, matchType, monthsBetween, parseAddCard, parseCardPatch, parseRelease, parseTypePatch,
  planMonthEnd, poolBalance,
} from "./fwf.ts";

const card = (id, o = {}) => ({ id, hn: "1000001", sale_date: "2025-10-05", valid_from: "2025-10-05", valid_to: "2026-10-04", status: "active", pool_amount: "914.00", ...o });
const debt = (ref, balance, o = {}) => ({
  source: "rcpt_debt", ref, vn: `6810${ref.padStart(8, "0")}`, an: null, patient_type: "OP", ref_date: "2025-11-10", pttype: "99", hipdata_code: "NRH",
  hospmain: null, hospmain_chwpart: null, account_code: "1102050101.501", balance, hn: "1000001", service_date: "2025-11-10", ...o,
});

test("ชนิดบัตรจับคู่ (icode, ราคา) เฉพาะ active ; 3002154@500 ไม่ใช่บัตร", () => {
  const types = [
    { id: "1", icode: "3002154", unit_price: "1600.00", label: "1 ปี", months: 12, pool_amount: "914", active: true },
    { id: "2", icode: "3002139", unit_price: 365, label: "เด็ก", months: 12, pool_amount: 257, active: false },
  ];
  assert.equal(matchType(types, "3002154", 1600)?.id, "1");
  assert.equal(matchType(types, "3002154", "500.00"), null);
  assert.equal(matchType(types, "3002139", 365), null);
});

test("อายุบัตร = วันขาย + months − 1 วัน ; ปลายเดือนปัดวันสุดท้าย", () => {
  assert.deepEqual(defaultValidity("2025-03-15", 12), { valid_from: "2025-03-15", valid_to: "2026-03-14" });
  assert.deepEqual(defaultValidity("2025-08-31", 6), { valid_from: "2025-08-31", valid_to: "2026-02-27" });
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.deepEqual(monthsBetween("2025-11-20", "2026-01-02"), ["2025-11", "2025-12", "2026-01"]);
});

test("บัตรที่ใช้ได้: active ในช่วง ใบที่หมดก่อนชนะ", () => {
  const cards = [card("1", { valid_to: "2026-12-31" }), card("2", { valid_to: "2026-06-30" }), card("3", { status: "void", valid_to: "2026-01-01" }), card("4", { hn: "9" })];
  assert.equal(coveringCard(cards, "1000001", "2025-11-01").id, "2");
  assert.equal(coveringCard(cards, "1000001", "2025-10-01"), null);
  assert.equal(coveringCard(cards, "1000001", "2026-09-01").id, "1");
});

test("ยอดบัตรและ pool: remaining/loss, pool นับบัตรที่ขายถึงวันนั้น หักตัด/โอนทั้งหมด", () => {
  assert.deepEqual(cardBalance("914.00", "1000.50", "0"), { remaining: -86.5, loss: 86.5 });
  assert.deepEqual(cardBalance("914.00", "100", "14"), { remaining: 800, loss: 0 });
  assert.deepEqual(cardBalance(null, "100", "0"), { remaining: null, loss: null });
  const cards = [card("1"), card("2", { sale_date: "2025-12-01" }), card("3", { pool_amount: null }), card("4", { status: "void" }), card("5", { sale_date: "2024-09-30" })];
  assert.deepEqual(poolBalance(cards, "300", "14", "2025-11-30"), { pool_in: 914, settled: 300, released: 14, balance: 600, unset: 1 });
});

test("ตัดสิ้นเดือน: เรียงวันรับบริการ ตัดจน pool หมด ที่เหลือลง diff ; ไม่มีบัตร = ต้องตรวจ", () => {
  const debts = [
    debt("3", "500.00", { service_date: "2025-11-20" }),
    debt("1", "700.00", { service_date: "2025-11-02" }),
    debt("2", "400.00", { service_date: "2025-11-05", hn: "2000002" }),
    debt("4", "50.00", { service_date: "2025-12-01" }),
    debt("5", "0"),
    debt("6", "80.00", { hn: null, service_date: null, ref_date: "2025-11-01" }),
  ];
  const plan = planMonthEnd(debts, [card("10")], "1000.00", "2025-11-30");
  assert.deepEqual(plan.rows.map((r) => [r.ref, r.status, r.settle, r.diff]), [
    ["6", "check", 0, 0], ["1", "settle", 700, 0], ["2", "check", 0, 0], ["3", "partial", 300, 200],
  ]);
  assert.deepEqual(plan.entries.map((e) => [e.ref, e.kind, e.amount, e.entry_date, e.fwf_card_id, e.source]), [
    ["1", "settle", "-700.00", "2025-11-30", "10", "fwf"],
    ["3", "settle", "-300.00", "2025-11-30", "10", "fwf"],
    ["3", "diff", "-200.00", "2025-11-30", "10", "fwf"],
  ]);
  assert.equal(plan.pool_after, 0);
  assert.deepEqual(plan.totals, { settle: 1000, diff: 200, settle_n: 2, diff_n: 1, check_n: 2, blocked_n: 0 });
  assert.deepEqual(plan.blocked, []);
});

test("สิทธิของ visit ใน HOSxP ไม่ใช่ 99 แล้ว = ต้องตรวจ ; IP ใช้วัน admit หาบัตร", () => {
  const ip = debt("6900001", "300", { source: "ipt", vn: null, an: "6900001", patient_type: "IP", account_code: "1102050101.502", ref_date: "2025-11-20", service_date: "2025-10-01" });
  const plan = planMonthEnd([debt("1", "100", { his_pttype: "10" }), debt("2", "100", { his_pttype: "99" }), ip], [card("10")], "1000", "2025-11-30");
  assert.deepEqual(plan.rows.map((r) => [r.ref, r.status]), [["6900001", "check"], ["1", "check"], ["2", "settle"]]);
  assert.match(plan.rows[1].reason, /ไม่ใช่ 99/);
  assert.match(plan.rows[0].reason, /ไม่มีบัตร/);
  const ok = planMonthEnd([{ ...ip, service_date: "2025-10-10" }], [card("10")], "1000", "2025-11-30");
  assert.deepEqual(ok.entries.map((e) => [e.patient_type, e.ref, e.kind, e.amount]), [["IP", "6900001", "settle", "-300.00"]]);
  assert.equal("his_pttype" in ok.entries[0], false);
});

test("pool หมด/ติดลบ = diff ทั้งก้อน ; บัตรชนิดไม่กำหนด pool = ยืนยันไม่ได้", () => {
  assert.deepEqual(planMonthEnd([debt("1", "100")], [card("10")], "-5", "2025-11-30").rows.map((r) => [r.status, r.settle, r.diff]), [["diff", 0, 100]]);
  const plan = planMonthEnd([debt("1", "100")], [card("10", { pool_amount: null })], "500", "2025-11-30");
  assert.equal(plan.rows[0].status, "blocked");
  assert.equal(plan.entries.length, 0);
  assert.equal(plan.blocked.length, 1);
});

test("ตรวจ body", () => {
  const today = "2026-11-24";
  assert.ok("error" in parseAddCard({ hn: "12a" }, today));
  assert.deepEqual(parseAddCard({ hn: " 1000001 ", hos_guid: "{AB-12}" }, today), { kind: "hosxp", hn: "1000001", hos_guid: "{AB-12}" });
  assert.ok("error" in parseAddCard({ hn: "1", card_type_id: "2", sale_date: "2024-09-01" }, today));
  assert.equal(parseAddCard({ hn: "1", card_type_id: "2", sale_date: "2025-01-01", valid_from: "2025-02-01", valid_to: "2025-01-01" }, today).error, "วันหมดอายุต้องไม่ก่อนวันเริ่ม");
  assert.ok("error" in parseCardPatch({ id: "1", action: "void", reason: "  " }));
  assert.deepEqual(parseCardPatch({ id: "1", action: "void", reason: "ขายซ้ำ" }), { id: "1", action: "void", reason: "ขายซ้ำ" });
  assert.ok("error" in parseRelease({ card_id: "1", amount: "10.001", released_on: "2026-01-01" }, today));
  assert.ok("error" in parseRelease({ card_id: "1", amount: 10, released_on: "2026-11-25" }, today));
  assert.equal(parseRelease({ card_id: "1", amount: 10, released_on: today }, today).amount, "10.00");
  assert.equal(parseTypePatch({ id: "1", label: "x", months: 12, pool_amount: "", active: true }).pool_amount, null);
  assert.ok("error" in parseTypePatch({ id: "1", label: "x", months: 0, active: true }));
});
