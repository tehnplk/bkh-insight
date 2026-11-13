// รัน: node --test src/app/api/fund/claim-errors/claim-errors.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { fillBuckets, parseFilters } from "./claim-errors.ts";

const parse = (qs) => parseFilters(new URLSearchParams(qs), 2570);

test("no params -> all null", () => {
  assert.deepEqual(parse(""), { ok: true, filters: { type: null, status: null, code: null, fyCe: null, funds: null } });
});

test("maps type, converts fy BE -> CE, dedupes funds", () => {
  const r = parse("type=ip&status=deny&code=D130-1&fy=2569&funds=UCS,WEL,UCS,");
  assert.deepEqual(r, { ok: true, filters: { type: "IP", status: "deny", code: "D130-1", fyCe: 2026, funds: ["UCS", "WEL"] } });
});

test("empty funds list -> null (never an empty array)", () => {
  assert.equal(parse("funds=,").filters.funds, null);
});

test("rejects bad values", () => {
  for (const qs of ["type=OPD", "status=a", "code=30%25", "fy=2026x", "fy=2571", "fy=1999", "funds=UC'S", `funds=${Array.from({ length: 51 }, (_, i) => `F${i}`).join(",")}`]) {
    assert.equal(parse(qs).ok, false, qs);
  }
});

test("fillBuckets fills missing buckets with 0 and converts strings", () => {
  assert.deepEqual(fillBuckets([{ bucket: 4, n: "20921", amount: "10966635.25" }, { bucket: 2, n: "39", amount: "93830.18" }]), [
    { bucket: 1, n: 0, amount: 0 },
    { bucket: 2, n: 39, amount: 93830.18 },
    { bucket: 3, n: 0, amount: 0 },
    { bucket: 4, n: 20921, amount: 10966635.25 },
  ]);
});
