// รัน: node --test src/lib/grid-query.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { inFilterSql, parseColumnFilters } from "./grid-query.ts";

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
