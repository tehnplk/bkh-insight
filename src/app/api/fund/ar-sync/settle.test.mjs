// รัน: node --test src/app/api/fund/ar-sync/settle.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { planSettle } from "./settle.ts";

const debt = (ref, balance, o = {}) => ({ source: "ipt", ref, vn: null, an: ref, patient_type: "IP", ref_date: "2026-10-01", pttype: "89", hipdata_code: "UCS", hospmain: null, hospmain_chwpart: null, account_code: "1102050101.202", balance, cancelled: false, ...o });
const line = (o) => ({ id: "1", patient_type: "IP", vn: null, an: "A1", paid_total: "800.00", transfer_date: "2026-11-10", ...o });
const sum = (es) => es.reduce((s, e) => s + Math.round(Number(e.amount) * 100), 0);

test("under-paid: settle paid + diff closes to zero", () => {
  const { entries } = planSettle([line({})], new Map([["IP:A1", [debt("A1", 100000)]]]));
  assert.deepEqual(entries.map((e) => [e.kind, e.amount, e.entry_date, e.stm_row_id]), [["settle", "-800.00", "2026-11-10", "1"], ["diff", "-200.00", "2026-11-10", "1"]]);
  assert.equal(100000 + sum(entries), 0);
});

test("over-paid: positive diff, balance zero", () => {
  const { entries } = planSettle([line({ paid_total: 1200 })], new Map([["IP:A1", [debt("A1", 100000)]]]));
  assert.deepEqual(entries.map((e) => [e.kind, e.amount]), [["settle", "-1200.00"], ["diff", "200.00"]]);
});

test("two debts on one VN: larger first, all closed; later STM on closed debt = extra over-diff", () => {
  const debts = new Map([["OP:V1", [debt("11", 3000, { patient_type: "OP", vn: "V1", an: null }), debt("12", 7000, { patient_type: "OP", vn: "V1", an: null })]]]);
  const first = planSettle([line({ patient_type: "OP", vn: "V1", an: null, paid_total: 80 })], debts).entries;
  assert.deepEqual(first.map((e) => [e.ref, e.kind, e.amount]), [["12", "settle", "-70.00"], ["11", "settle", "-10.00"], ["11", "diff", "-20.00"]]);
  const later = planSettle([line({ id: "2", patient_type: "OP", vn: "V1", an: null, paid_total: 5 })], debts).entries;
  assert.equal(sum(later), 0);
  assert.equal(later.filter((e) => e.kind === "diff").reduce((s, e) => s + Number(e.amount), 0), 5);
});

test("no debt for key = unmatched", () => {
  assert.deepEqual(planSettle([line({ an: "X" })], new Map()), { entries: [], unmatched: 1 });
});
