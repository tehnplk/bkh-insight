// รัน: node --test src/app/api/fund/claim-pipeline/pipeline.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { classify, inGroup, sortRows, summarize } from "./pipeline.ts";

const ctx = { today: "2026-11-14", repFileDate: "2026-10-14" };
const his = (o = {}) => ({ key: "V1", hn: "1", date: "2026-08-10", pttype: "89", pttype_name: "UC", debtor: 100, claim: "closed", ...o });
const rep = (o = {}) => ({ rep_no: "R1", error_codes: [], deny: null, net_nhso: "30.00", net_affiliation: "50.00", status: "a", ...o });
const at = (r) => [r.step, r.reason];

test("each step drops with its reason", () => {
  assert.deepEqual(at(classify("op", his({ claim: "authen_only" }), undefined, undefined, ctx)), ["served", "authen_only"]);
  // มี REP แล้วถือว่าผ่านขั้นปิดสิทธิ
  const passed = classify("op", his({ claim: "authen_only" }), rep(), 50, ctx);
  assert.deepEqual([...at(passed), passed.compensation], ["paid", null, 80]);
  assert.deepEqual(at(classify("ip", his({ claim: "unlocked" }), undefined, undefined, ctx)), ["served", "unlocked"]);
  assert.deepEqual(at(classify("op", his(), rep({ status: "c", error_codes: ["C438"] }), undefined, ctx)), ["rep", "c"]);
  assert.deepEqual(at(classify("op", his(), rep(), undefined, ctx)), ["a", "stm_wait"]);
  assert.deepEqual(at(classify("op", his(), rep(), -10, ctx)), ["a", "stm_wait"]);
  assert.deepEqual(at(classify("op", his(), rep(), 80, ctx)), ["paid", null]);
});

test("no REP: wait within 30 days before latest REP file, else missing; no REP file = wait", () => {
  assert.deepEqual(at(classify("op", his({ date: "2026-09-15" }), undefined, undefined, ctx)), ["closed", "rep_wait"]);
  assert.deepEqual(at(classify("op", his({ date: "2026-09-14" }), undefined, undefined, ctx)), ["closed", "rep_missing"]);
  assert.deepEqual(at(classify("ip", his(), undefined, undefined, { ...ctx, repFileDate: null })), ["closed", "rep_wait"]);
});

test("days and overdue: OP > 15, IP > 30, only without REP", () => {
  const r = classify("op", his({ date: "2026-10-30" }), undefined, undefined, ctx);
  assert.equal(r.days, 15);
  assert.equal(r.overdue, false);
  assert.equal(classify("op", his({ date: "2026-10-29" }), undefined, undefined, ctx).overdue, true);
  assert.equal(classify("op", his({ date: "2026-10-29" }), rep(), undefined, ctx).overdue, false);
  assert.equal(classify("ip", his({ date: "2026-10-15" }), undefined, undefined, ctx).overdue, false);
  assert.equal(classify("ip", his({ date: "2026-10-14" }), undefined, undefined, ctx).overdue, true);
});

test("codes: C codes without DENY marker, then deny values", () => {
  const r = classify("op", his(), rep({ status: "deny", error_codes: ["DENY", "C21"], deny: { "Deny / AE": "D611" } }), undefined, ctx);
  assert.deepEqual([r.reason, r.codes], ["deny", "C21, D611"]);
  assert.equal(classify("op", his(), rep({ deny: { "Deny / AE": "C" } }), undefined, ctx).codes, "");
});

test("funnel counts cumulative steps, amounts and reasons; groups match", () => {
  const rows = [
    classify("op", his({ key: "1", claim: "none", debtor: 10 }), undefined, undefined, ctx),
    classify("op", his({ key: "2", debtor: 20.1 }), rep({ status: "c" }), undefined, ctx),
    classify("op", his({ key: "3", debtor: 30.2 }), rep(), 30, ctx),
  ];
  const f = summarize(rows);
  assert.deepEqual(f.steps.served, { count: 3, amount: 60.3 });
  assert.deepEqual(f.steps.closed, { count: 2, amount: 50.3 });
  assert.deepEqual(f.steps.a, { count: 1, amount: 30.2 });
  assert.deepEqual(f.steps.paid, { count: 1, amount: 30.2 });
  assert.deepEqual([f.reasons.none.count, f.reasons.c.count, f.reasons.stm_wait.count, f.overdue.count], [1, 1, 0, 1]);
  assert.deepEqual(rows.filter((r) => inGroup(r, "rep")).map((r) => r.key), ["2", "3"]);
  assert.deepEqual(rows.filter((r) => inGroup(r, "none")).map((r) => r.key), ["1"]);
  assert.deepEqual(sortRows([...rows], "step", "desc").map((r) => r.key), ["3", "2", "1"]);
});
