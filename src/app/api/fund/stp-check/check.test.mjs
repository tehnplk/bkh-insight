// รัน: node --test src/app/api/fund/stp-check/check.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { checkItem, gpusOf, needsFix, sortRows, summarize } from "./check.ts";

const entry = (code, o = {}) => ({ code, is_tmt: false, rate: "100.00", opd: true, ipd: true, adp_type: "15", rate_variants: 1, ...o });
const stp = {
  nondrug: new Map([
    ["A1", entry("A1")],
    ["IPONLY", entry("IPONLY", { opd: false })],
    ["NORATE", entry("NORATE", { rate: null })],
    ["MULTI", entry("MULTI", { rate_variants: 3 })],
    ["DRUX", entry("DRUX", { adp_type: "DRU" })],
  ]),
  drug: new Map([
    ["G1", entry("G1", { is_tmt: true, rate: "5.00", adp_type: "DRU" })],
    ["G2", entry("G2", { is_tmt: true, rate: "3.00", adp_type: "DRU" })],
  ]),
};
const tmt = {
  gpuOfTpu: new Map([["T1", ["G1"]], ["T2", ["G9"]], ["T3", ["G1"]], ["T4", ["G2"]]]),
  tpuOfTp: new Map([["P1", ["T3", "T4"]]]),
};
const item = (o = {}) => ({
  hos_guid: "g", vn: "V1", hn: "H1", vstdate: "2026-04-01", icode: "3000001", item_name: "x",
  qty: "2", unitprice: "100.00", sum_price: "200.00", paidst: "02", kind: "ADP", adp_code: "a1", adp_type: 15,
  nhso_adp_code: "a1", nhso_adp_type_id: 15, tpu_code_list: null, tmt_tp_code: null, ...o,
});
const res = (o) => checkItem(item(o), stp, tmt).result;

test("non-drug rules in order", () => {
  assert.equal(res({ paidst: "01" }), "not_fund");
  assert.equal(res({ adp_code: null }), "no_code");
  assert.equal(res({ adp_code: "" }), "no_code");
  assert.equal(res({ adp_code: " xxxxxx " }), "no_code");
  // รหัสที่ส่งออก (billcode/icode เมื่อไม่มี nhso_adp_code) ไม่ใช่ nhso_adp_code
  assert.equal(res({ nhso_adp_code: null, adp_code: "A1" }), "ok");
  assert.equal(res({ nhso_adp_code: "A1", adp_code: "ZZ" }), "not_in_stp");
  assert.equal(res({ adp_code: "IPONLY" }), "no_opd");
  // เทียบ TYPE ที่ส่งออก (ตามหมวดค่ารักษา) ไม่ใช่ nhso_adp_type_id
  assert.equal(res({ adp_type: 3 }), "adp_type");
  assert.equal(res({ adp_type: "15", nhso_adp_type_id: 3 }), "ok");
  assert.equal(res({ adp_type: null }), "adp_type");
  // adp_type ที่ไม่ใช่ตัวเลข (DRU) ไม่เทียบ
  assert.equal(res({ adp_code: "DRUX", adp_type: 3 }), "ok");
  assert.equal(res({ adp_code: "NORATE", unitprice: "9999" }), "ok");
  assert.equal(res({}), "ok");
});

test("over rate: excess = (unitprice - rate) x qty, multiple rates noted", () => {
  const r = checkItem(item({ unitprice: "130.50" }), stp, tmt);
  assert.deepEqual([r.result, r.rate, r.excess, r.code], ["over_rate", 100, 61, "A1"]);
  assert.match(checkItem(item({ adp_code: "MULTI", unitprice: "101" }), stp, tmt).fix, /3 อัตรา/);
});

test("bad amount: <= 0 after export rounding, after not_fund and before code checks", () => {
  assert.equal(res({ qty: "0" }), "bad_amount");
  assert.equal(res({ unitprice: "0.004" }), "bad_amount");
  assert.equal(res({ sum_price: "-5" }), "bad_amount");
  assert.equal(res({ qty: null }), "bad_amount");
  assert.equal(res({ qty: "0", adp_code: null }), "bad_amount");
  assert.equal(res({ qty: "0", paidst: "01" }), "not_fund");
  // ADP ปัดจำนวน 2 ตำแหน่ง ยาปัด 0 ตำแหน่ง
  assert.equal(res({ qty: "0.4" }), "ok");
  assert.equal(res({ unitprice: "0.005" }), "ok");
  const drug = (qty) => checkItem(item({ icode: "1000001", kind: "DRU", adp_code: null, adp_type: null, tpu_code_list: "T1", unitprice: "4", qty }), stp, tmt).result;
  assert.equal(drug("0.4"), "bad_amount");
  assert.equal(drug("0.5"), "ok");
  assert.ok(needsFix("bad_amount"));
});

test("drug: GPU via TPU, TP fallback picks lowest rate, unmapped = manual", () => {
  const drug = (o) => checkItem(item({ icode: "1000001", kind: "DRU", adp_code: null, adp_type: null, nhso_adp_code: null, unitprice: "4", ...o }), stp, tmt);
  assert.deepEqual(gpusOf({ tpu_code_list: null, tmt_tp_code: "P1" }, tmt).sort(), ["G1", "G2"]);
  assert.equal(drug({ tpu_code_list: "T1" }).result, "ok");
  const tp = drug({ tmt_tp_code: "P1" });
  assert.deepEqual([tp.result, tp.code, tp.rate, tp.excess], ["over_rate", "G2", 3, 2]);
  assert.deepEqual([drug({ tpu_code_list: "T2" }).result, drug({ tpu_code_list: "T2" }).code], ["not_in_stp", "G9"]);
  assert.equal(drug({}).result, "manual");
  assert.equal(drug({ tpu_code_list: "T9" }).result, "manual");
});

test("summary and sort", () => {
  const rows = [
    checkItem(item({ hos_guid: "1", unitprice: "150", sum_price: "300" }), stp, tmt),
    checkItem(item({ hos_guid: "2", vn: "V2", adp_code: "ZZ", sum_price: "50.25" }), stp, tmt),
    checkItem(item({ hos_guid: "3", vn: "V2" }), stp, tmt),
  ];
  const s = summarize(rows);
  assert.deepEqual([s.visits, s.items, s.amount, s.excess], [2, 3, 550.25, 100]);
  assert.deepEqual(s.groups.not_in_stp, { count: 1, amount: 50.25 });
  assert.deepEqual(rows.filter((r) => needsFix(r.result)).map((r) => r.id), ["1", "2"]);
  assert.deepEqual(sortRows([...rows], "excess", "desc").map((r) => r.id), ["1", "2", "3"]);
});
