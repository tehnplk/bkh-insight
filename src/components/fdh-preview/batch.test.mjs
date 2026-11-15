// รัน: node --test src/components/fdh-preview/batch.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { chunkIds, mergeChecks, mergePreviews } from "./batch.ts";

test("chunkIds: unique, sorted, fixed size", () => {
  assert.deepEqual(chunkIds(["3", "1", "2", "1", "5"], 2), [["1", "2"], ["3", "5"]]);
  assert.deepEqual(chunkIds([], 2), []);
});

test("mergePreviews: rows in chunk order, PAT deduped by HN, counts per chunk", () => {
  const cols = { PAT: ["HN"], DRU: ["SEQ", "DID"] };
  const part = (pat, dru) => ({ files: [{ file: "PAT", columns: cols.PAT, rows: pat }, { file: "DRU", columns: cols.DRU, rows: dru }] });
  const m = mergePreviews([
    part([{ HN: "1" }, { HN: "2" }], [{ SEQ: "a", DID: "x" }]),
    part([{ HN: "2" }, { HN: "3" }], [{ SEQ: "b", DID: "y" }, { SEQ: "b", DID: "z" }]),
  ]);
  assert.deepEqual(m.files.map((f) => f.file), ["PAT", "DRU"]);
  assert.deepEqual(m.files[0].rows.map((r) => r.HN), ["1", "2", "3"]);
  assert.deepEqual(m.files[1].rows.map((r) => r.DID), ["x", "y", "z"]);
  assert.deepEqual(m.counts, { PAT: [2, 1], DRU: [1, 2] });
});

test("mergeChecks: DRU row offset, union of rules/info, truncated if any chunk", () => {
  const r = (findings, extra = {}) => ({ file: "DRU", rules: ["562"], findings, info: {}, ...extra });
  const m = mergeChecks(
    [
      r([{ row: 0, codes: ["562"] }, { seq: "a", codes: ["C1"] }], { info: { 562: "x" } }),
      r([{ row: 1, codes: ["573"] }], { rules: ["562", "573"], truncated: true, info: { 573: "y" } }),
    ],
    [3, 2],
  );
  assert.deepEqual(m.findings.map((f) => f.row), [0, undefined, 4]);
  assert.deepEqual(m.rules, ["562", "573"]);
  assert.deepEqual(m.info, { 562: "x", 573: "y" });
  assert.equal(m.truncated, true);
  assert.equal(mergeChecks([r([])]).truncated, false);
  // PAT finding เดียวกันจากสองชุดเหลือรายการเดียว
  const pat = { hn: "1", codes: ["C104"], found: "x" };
  assert.equal(mergeChecks([r([pat]), r([{ ...pat }])]).findings.length, 1);
});
