// รัน: node --test src/app/api/admin/ar-funds/rules.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { REASON, checkRules, classifyVisits, expandAdpTypes, icdMatch, parseCodeList, repPay, ruleReady, ruleSide, subfundFilterLabel, subfundFilterValues } from "./rules.ts";

const rule = (o) => ({
  code: "X", name: "x", match_mode: "items", hipdata_codes: ["UCS"], pttypes: [], incomes: [], icodes: [], icd10: [], icd_scope: "any", required_icodes: [], adp_types: [], exclude_icodes: [],
  rep_keys: ["K"], account_op: null, account_ip: null, updated_by: null, updated_at: "", activities: [], ...o,
});
const it = (vn, icode, income, amount, o = {}) => ({ vn, icode, income, pttype: "89", fund: "UCS", amount, ...o });
const items = [
  it("1", "A", "02", "100.10"),
  it("1", "B", "07", "50"),
  it("2", "C", "02", "0.20"),
  it("3", "A", "02", "999", { fund: "OFC", pttype: "10" }),
  it("4", "B", "07", "30"),
];
const rep = [
  { vn: "1", key: "K", amount: "80" },
  { vn: "5", key: "K", amount: "40" },
  { vn: "3", key: "K", amount: "10" },
  { vn: "4", key: "K", amount: "5" },
  { vn: "2", key: "OTHER", amount: "9" },
];
const visits = new Map([["1", { pttype: "89", fund: "UCS" }], ["3", { pttype: "10", fund: "OFC" }], ["4", { pttype: "89", fund: "UCS" }], ["2", { pttype: "89", fund: "UCS" }]]);

test("income match, fund filter, reasons for REP-only", () => {
  const [r] = checkRules([rule({ incomes: ["02"] })], items, new Map(), rep, [], visits);
  assert.equal(r.ready, true);
  assert.deepEqual(r.his, { vns: 2, amount: 100.3 });
  assert.equal(r.both, 1);
  assert.deepEqual(r.hisOnly.cases, [{ vn: "2", his: 0.2, rep: 0 }]);
  assert.deepEqual(Object.fromEntries(r.repOnly.cases.map((c) => [c.vn, c.reason])), { 5: REASON.noVisit, 3: REASON.rights, 4: REASON.noItems });
  assert.deepEqual(r.itemStats, [{ icode: "A", vns: 1, paid: 1 }, { icode: "C", vns: 1, paid: 0 }]);
});

test("icd prefix, range, pdx scope", () => {
  assert.equal(icdMatch("E119", ["E11"]), true);
  assert.equal(icdMatch("C509", ["C00-C96"]), true);
  assert.equal(icdMatch("C97", ["C00-C96"]), false);
  assert.equal(icdMatch("C50.5", ["C50.1-C50.9"]), true);
  const diags = new Map([["1", [{ icd10: "I10", pdx: true }, { icd10: "E119", pdx: false }]], ["4", [{ icd10: "E110", pdx: true }]]]);
  const [anyDx] = checkRules([rule({ icodes: ["B"], icd10: ["E11"] })], items, diags, []);
  assert.equal(anyDx.his.vns, 2);
  const [pdx] = checkRules([rule({ icodes: ["B"], icd10: ["E11"], icd_scope: "pdx" })], items, diags, []);
  assert.deepEqual(pdx.his, { vns: 1, amount: 30 });
});

test("activities: any/all, no cross-activity, item counted once", () => {
  const acts = [
    { id: "1", rule_code: "X", name: "ANC", items_mode: "all", incomes: [], icodes: ["A", "B"], icd10: [], icd_scope: "any", active: true },
    { id: "2", rule_code: "X", name: "Lab", items_mode: "any", incomes: [], icodes: ["B"], icd10: ["Z34"], icd_scope: "any", active: true },
    { id: "3", rule_code: "X", name: "Off", items_mode: "any", incomes: ["07"], icodes: [], icd10: [], icd_scope: "any", active: false },
  ];
  const diags = new Map([["1", [{ icd10: "Z340", pdx: true }]]]);
  const [r] = checkRules([rule({ activities: acts })], items, diags, []);
  assert.deepEqual(r.his, { vns: 1, amount: 150.1 }); // vn 1: ANC (A+B) และ Lab (B) นับ B ครั้งเดียว ; vn 4 มีแค่ B ไม่มี Z34
  assert.deepEqual(r.activityVns, { ANC: 1, Lab: 1 });
});

test("rights mode uses visit totals; required items", () => {
  const totals = [{ vn: "1", pttype: "89", fund: "UCS", amount: "500" }, { vn: "3", pttype: "10", fund: "OFC", amount: "70" }, { vn: "6", pttype: "89", fund: "UCS", amount: "0" }];
  const [r] = checkRules([rule({ match_mode: "rights", pttypes: ["89"] })], items, new Map(), [], totals);
  assert.deepEqual(r.his, { vns: 1, amount: 500 });
  const [q] = checkRules([rule({ incomes: ["02"], required_icodes: ["B"] })], items, new Map(), []);
  assert.deepEqual(q.missingRequired, { vns: 1, cases: [{ vn: "2", missing: ["B"] }] });
});

test("rule without conditions counts REP only", () => {
  const [r] = checkRules([rule({ icd10: ["E11"] })], items, new Map(), rep);
  assert.equal(r.ready, false);
  assert.equal(r.his.vns, 0);
  assert.equal(r.repOnly.cases[0].reason, undefined);
});

test("parseCodeList", () => {
  assert.deepEqual(parseCodeList("e11, i10\nE11", /^[A-Z]\d{0,4}$/), ["E11", "I10"]);
  assert.deepEqual(parseCodeList("", /x/), []);
  assert.deepEqual(parseCodeList("E11;", /^[A-Z]\d{0,4}$/), { invalid: "E11;" });
});

test("classifyVisits: per-visit funds with items, activities, icd, missing", () => {
  const acts = [{ id: "1", rule_code: "Y", name: "ANC", items_mode: "any", incomes: [], icodes: ["B"], icd10: ["Z34"], icd_scope: "pdx", active: true }];
  const diags = new Map([["1", [{ icd10: "Z340", pdx: true }, { icd10: "I10", pdx: false }]]]);
  const map = classifyVisits(
    [rule({ code: "X", incomes: ["02"], required_icodes: ["Z"] }), rule({ code: "Y", name: "y", activities: acts })],
    items, diags,
  );
  assert.deepEqual([...map.keys()].sort(), ["1", "2"]); // vn 3 สิทธิ OFC, vn 4 ไม่มี Z34
  const [x, y] = map.get("1");
  assert.equal(x.code, "X");
  assert.equal(x.amount, 100.1);
  assert.deepEqual(x.items, [{ icode: "A", name: null, amount: 100.1 }]);
  assert.deepEqual(x.missing, [{ icode: "Z", name: null }]);
  assert.deepEqual(y, { code: "Y", name: "y", amount: 50, rep: "none", rep_amount: null, items: [{ icode: "B", name: null, amount: 50 }], icds: ["Z340"], activities: ["ANC"], missing: [] });
  // ผลรวมตรงกับ checkRules
  const [cx] = checkRules([rule({ code: "X", incomes: ["02"] })], items, diags, []);
  assert.equal(cx.his.amount, [...map.values()].flat().filter((f) => f.code === "X").reduce((s, f) => s + f.amount, 0));
});

test("repPay, ruleSide, filter values", () => {
  assert.deepEqual(repPay(["K"], undefined), { rep: "none", rep_amount: null });
  assert.deepEqual(repPay(["K", "L"], { K: 10.1, L: "0.2", M: 9 }), { rep: "paid", rep_amount: 10.3 });
  assert.deepEqual(repPay(["K"], { M: 9 }), { rep: "unpaid", rep_amount: 0 });
  assert.deepEqual(repPay(["K"], null), { rep: "unpaid", rep_amount: 0 });
  assert.equal(ruleSide({ account_op: "1", account_ip: null }, "OP"), true);
  assert.equal(ruleSide({ account_op: "1", account_ip: null }, "IP"), false);
  assert.equal(ruleSide({ account_op: null, account_ip: null }, "IP"), true);
  assert.equal(ruleSide({ account_op: "1", account_ip: "2" }, "IP"), true);
  const funds = new Map([["1", [{ code: "INST", rep: "paid" }, { code: "PP", rep: "none" }]]]);
  assert.deepEqual(subfundFilterValues(["1", "2"], funds), [{ k: "1", v: "INST:paid" }, { k: "1", v: "PP:none" }, { k: "2", v: "" }]);
  assert.equal(subfundFilterLabel("INST:unpaid"), "INST · REP ไม่จ่าย");
});

test("ADP type: expands to icodes minus exclusions, exclusions also drop income matches", () => {
  const adp = [{ icode: "A", adp_type: 2 }, { icode: "C", adp_type: "2" }, { icode: "X", adp_type: 2 }, { icode: "B", adp_type: 3 }];
  const inst = rule({ code: "INST", adp_types: ["2"], exclude_icodes: ["X", "C"] });
  assert.equal(ruleReady(inst), true);
  const [r] = expandAdpTypes([inst], adp);
  assert.deepEqual(r.icodes, ["A"]);
  const out = classifyVisits([r], [...items, it("6", "X", "02", "70")], new Map());
  assert.deepEqual([...out].map(([vn, f]) => [vn, f[0].amount]), [["1", 100.1]]);
  // ไม่มี adp_types = คงเดิม ; exclusions ตัดรายการที่ตรงหมวดรายรับด้วย
  assert.equal(expandAdpTypes([rule({ icodes: ["B"] })], adp)[0].icodes[0], "B");
  const byIncome = classifyVisits([rule({ incomes: ["02"], exclude_icodes: ["A"] })], items, new Map());
  assert.deepEqual([...byIncome.keys()], ["2"]);
});
