// รัน: node --test src/app/api/fund/claim-type/claim-type.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORIES, categoryOf, effectiveCup, summarize } from "./claim-type.ts";
import { CLAIM_FUNDS } from "../../fdh/claim-batch/claim.ts";

const OWN = "11252";
const ctx = { cup: effectiveCup(["11252", "07526", "07527"], [{ hcode: "07527", mode: "exclude" }, { hcode: "99999", mode: "include" }], OWN), chw: "65" };
const uc = (extra = {}) => ({ fund: "UCS", hospmain: OWN, hosp_chw: "65", ucae: null, ...extra });

test("effective CUP = default ∪ include − exclude, own hospital always in", () => {
  assert.deepEqual([...ctx.cup].sort(), ["07526", "11252", "99999"]);
  assert.ok(effectiveCup([], [{ hcode: OWN, mode: "exclude" }], OWN).has(OWN));
});

test("UC by main unit: CUP > province > outside AE/walk-in, missing = unknown", () => {
  assert.equal(categoryOf(uc(), ctx), "ucs_cup");
  assert.equal(categoryOf(uc({ hospmain: "99999", hosp_chw: null }), ctx), "ucs_cup"); // added by admin, even if not in hospcode
  assert.equal(categoryOf(uc({ hospmain: "07527" }), ctx), "ucs_prov"); // excluded from CUP, same province
  assert.equal(categoryOf(uc({ hospmain: "10676", hosp_chw: "10", ucae: "E" }), ctx), "ucs_ae");
  assert.equal(categoryOf(uc({ hospmain: "10676", hosp_chw: "10", ucae: "A" }), ctx), "ucs_ae");
  assert.equal(categoryOf(uc({ hospmain: "10676", hosp_chw: "10", ucae: "N" }), ctx), "ucs_walkin");
  assert.equal(categoryOf(uc({ hospmain: " ", hosp_chw: null }), ctx), "ucs_unknown");
  assert.equal(categoryOf(uc({ hospmain: "12345", hosp_chw: null }), ctx), "ucs_unknown");
  assert.equal(categoryOf(uc({ fund: "WEL", hospmain: "10676", hosp_chw: "10" }), ctx), "ucs_walkin");
});

test("other funds by fund code, unlisted = other", () => {
  assert.equal(categoryOf(uc({ fund: "OFC" }), ctx), "OFC");
  assert.equal(categoryOf(uc({ fund: "CSH" }), ctx), "CSH");
  assert.equal(categoryOf(uc({ fund: "NRD" }), ctx), "other");
  assert.equal(categoryOf(uc({ fund: "UNKNOWN" }), ctx), "other");
});

test("tracked cards = funds that must be claimed (CLAIM_FUNDS)", () => {
  for (const c of CATEGORIES) {
    const fund = c.key.startsWith("ucs_") ? "UCS" : c.key;
    assert.equal(c.tracked, CLAIM_FUNDS.includes(fund), c.key);
  }
});

test("summarize: every card, satang sums, status groups, overdue inside unsent", () => {
  const rows = [
    { cat: "ucs_cup", amount: 0.1, claim: { status: "overdue", at: null } },
    { cat: "ucs_cup", amount: 0.2, claim: { status: "wait_close", at: null } },
    { cat: "ucs_cup", amount: 100, claim: { status: "rep_c", at: null } },
    { cat: "ucs_cup", amount: 5, claim: { status: "unclaimed", at: null } },
    { cat: "OFC", amount: 50, claim: { status: "paid", at: null } },
    { cat: "OFC", amount: 1 },
  ];
  const s = summarize(rows);
  assert.equal(s.length, CATEGORIES.length);
  const cup = s.find((c) => c.key === "ucs_cup");
  assert.equal(cup.visits, 4);
  assert.equal(cup.amount, 105.3);
  assert.deepEqual(cup.counts, { unsent: 2, sent: 0, rep_pass: 0, rep_bad: 1, paid: 0 });
  assert.equal(cup.overdue, 1);
  assert.deepEqual(s.find((c) => c.key === "OFC").counts.paid, 1);
  assert.equal(s.find((c) => c.key === "SSS").visits, 0);
});
