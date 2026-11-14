// รัน: node --test src/app/api/fdh/claim-codes/readiness.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { assess, problemOf } from "./readiness.ts";

const item = (icode, adp, o = {}) => ({ icode, name: icode, income: "02", adp, unitprice: 100, adp_type: null, adp_name: null, ...o });
const refs = new Set(["3001", "8602"]);

test("problem order", () => {
  assert.equal(problemOf("INST", item("a", ""), refs), "empty");
  assert.equal(problemOf("INST", item("a", "XXXXXX"), refs), "placeholder");
  assert.equal(problemOf("INST", item("a", "XXXX2"), refs), "placeholder");
  assert.equal(problemOf("INST", item("a", " 3001 "), refs), null);
  assert.equal(problemOf("INST", item("a", "0401", { adp_type: 2, adp_name: "ยกเลิกแล้ว - x" }), refs), "cancelled");
  assert.equal(problemOf("INST", item("a", "9999", { adp_type: 2 }), refs), "not_in_list");
  assert.equal(problemOf("INST", item("a", "55020", { adp_type: 17 }), refs), "other_type");
  assert.equal(problemOf("INST", item("a", "ABC"), refs), "unknown");
});

test("assess splits ok / fix by usage / missing codes", () => {
  const r = assess("INST", [{ code: "3001", name: null, rate: 104 }, { code: "8602", name: null, rate: 150 }, { code: "1001", name: null, rate: 12000 }],
    [item("i1", "3001"), item("i2", ""), item("i3", "XXX"), item("i4", "3001")],
    new Map([["i3", { n: 9, qty: 9, amount: 900 }], ["i2", { n: 2, qty: 2, amount: 200 }]]));
  assert.deepEqual(r.ok.map((x) => x.icode), ["i1", "i4"]);
  assert.deepEqual(r.fix.map((x) => [x.icode, x.problem]), [["i3", "placeholder"], ["i2", "empty"]]);
  assert.deepEqual(r.missing.map((x) => x.code), ["8602", "1001"]);
  assert.equal(r.mappedCodes, 1);
});
