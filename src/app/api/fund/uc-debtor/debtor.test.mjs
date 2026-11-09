// รัน: node --test src/app/api/fund/uc-debtor/debtor.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { matches, mergeDebtors, sortRows, summarize } from "./debtor.ts";

const d = (key, debtor, extra = {}) => ({
  key, vn: key, an: null, hn: `hn${key}`, date: "2025-10-01", full_name: `name ${key}`, pttype_name: "UC",
  drg: null, adjrw: null, debtor, debt_amount: null, ...extra,
});
const rep = (key, net_nhso, net_affiliation, error_codes = []) => ({ key, rep_no: `R${key}`, net_nhso, net_affiliation, error_codes });

test("compensation = net_nhso + net_affiliation (string from pg, null affiliation = 0), status from error_codes", () => {
  const rows = mergeDebtors(
    [d("1", 500), d("2", 300.5), d("3", 100)],
    [rep("1", "0.00", "450.25"), rep("2", "300.50", null, ["C438", "509"])],
  );
  assert.deepEqual(rows.map((r) => [r.status, r.compensation, r.diff, r.rep_no]), [
    ["paid", 450.25, 49.75, "R1"],
    ["error", 300.5, 0, "R2"],
    ["none", null, null, null],
  ]);
  assert.deepEqual(rows[1].error_codes, ["C438", "509"]);
});

test("summary totals over filtered rows, status counts over rows before the status filter", () => {
  const all = mergeDebtors([d("1", 500), d("2", 300), d("3", 100)], [rep("1", "400", "0"), rep("2", "350", null, ["X"])]);
  const s = summarize(all.filter((r) => r.status !== "none"), all);
  assert.deepEqual(s, { count: 2, debtor: 800, compensation: 750, diff: 50, status: { paid: 1, error: 1, none: 1 } });
});

test("search covers VN/AN/HN/name/REP; sort puts nulls last both ways", () => {
  const rows = mergeDebtors([d("1", 10), d("2", 30), d("3", 20)], [rep("1", "5", null), rep("2", "1", null)]);
  assert.ok(matches(rows[0], "R1") && matches(rows[0], "hn1") && !matches(rows[2], "R"));
  assert.deepEqual(sortRows([...rows], "compensation", "asc").map((r) => r.key), ["2", "1", "3"]);
  assert.deepEqual(sortRows([...rows], "compensation", "desc").map((r) => r.key), ["1", "2", "3"]);
  assert.deepEqual(sortRows([...rows], "debtor", "desc").map((r) => r.key), ["2", "3", "1"]);
});
