// รัน: node --test src/lib/grid-query.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { facetRows, filterRows, inFilterSql, parseColumnFilters } from "./grid-query.ts";

test("filterRows / facetRows: in-memory filters, blank = '', except own column, counts sorted", () => {
  const rows = [{ s: "a", n: 1 }, { s: "b", n: 1 }, { s: "a", n: 2 }, { s: null, n: 2 }];
  const get = { s: (r) => r.s, n: (r) => r.n };
  assert.equal(filterRows(rows, { s: ["a"] }, get).length, 2);
  assert.equal(filterRows(rows, { s: [""] }, get).length, 1);
  assert.equal(filterRows(rows, { s: ["a"], n: ["2"] }, get).length, 1);
  assert.equal(filterRows(rows, { s: ["a"], n: ["2"] }, get, "s").length, 2);
  assert.deepEqual(facetRows(rows, get.s, "").values.map((v) => [v.value, v.count]), [["a", 2], ["", 1], ["b", 1]]);
  assert.deepEqual(facetRows(rows, get.s, "B", (v) => v.toUpperCase()).values, [{ value: "b", label: "B", count: 1 }]);
});

const p = (o) => new URLSearchParams(o);

test("parseColumnFilters: allowlist, JSON shape, dedupe, empty arrays dropped", () => {
  const ok = parseColumnFilters(p({ cf: JSON.stringify({ fund: ["UCS", "UCS", ""], dep: [] }), facet: "dep", facetQ: " ab " }), ["fund", "dep"]);
  assert.deepEqual(ok, { ok: true, query: { filters: { fund: ["UCS", ""] }, facet: "dep", facetQ: "ab" } });
  assert.equal(parseColumnFilters(p({ cf: '{"x":["1"]}' }), ["fund"]).ok, false);
  assert.equal(parseColumnFilters(p({ cf: "not json" }), ["fund"]).ok, false);
  assert.equal(parseColumnFilters(p({ cf: '{"fund":[1]}' }), ["fund"]).ok, false);
  assert.equal(parseColumnFilters(p({ cf: '["fund"]' }), ["fund"]).ok, false);
  assert.equal(parseColumnFilters(p({ facet: "drop table" }), ["fund"]).ok, false);
});

test("inFilterSql: placeholders, blank = NULL or ''", () => {
  const q = () => "?";
  assert.deepEqual(inFilterSql("t.x", ["a", "b"], q), { sql: "(t.x IN (?, ?))", params: ["a", "b"] });
  assert.deepEqual(inFilterSql("t.x", ["a", ""], q), { sql: "(t.x IN (?) OR t.x IS NULL OR t.x = '')", params: ["a"] });
  assert.deepEqual(inFilterSql("t.x", [""], q), { sql: "(t.x IS NULL OR t.x = '')", params: [] });
  assert.equal(inFilterSql("r.k", ["a", "b"], (n) => `$${n}`, 3).sql, "(r.k IN ($3, $4))");
});
