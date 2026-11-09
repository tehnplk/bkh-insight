// รัน: node --test src/app/api/fund/rep-import/detail/file-detail.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { chunks, countMatched } from "./file-detail.ts";

test("chunks splits into batches of at most size, empty input gives no batch", () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunks([1, 2], 1000), [[1, 2]]);
  assert.deepEqual(chunks([], 1000), []);
});

test("countMatched counts only uc_money > 0 (string decimals, 0 and NULL do not match)", () => {
  assert.equal(countMatched([{ uc_money: "150.50" }, { uc_money: "0.00" }, { uc_money: null }, { uc_money: 20 }, { uc_money: "-5" }]), 2);
  assert.equal(countMatched([]), 0);
});
