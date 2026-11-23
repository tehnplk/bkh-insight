// รัน: node --test src/app/api/fund/dept-trend/trend.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { aggregate, assignSlots, fiscalMonths, hospitalValues, monthRanges, parseSlots, partialMonth, selectedTotal, summarize, valuesByDep } from "./trend.ts";

test("selected total sums selected departments; hospital total = all departments", () => {
  const months = ["2026-10", "2026-11"];
  const rows = [
    { month: "2026-10", dep: "010", fund: "OFC", visits: 1, income: 100, claim: 100 },
    { month: "2026-11", dep: "UNKNOWN", fund: "OFC", visits: 1, income: 0.1, claim: 0.2 },
    { month: "2026-11", dep: "030", fund: "UCS", visits: 1, income: 50, claim: 50 },
  ];
  assert.equal(selectedTotal([], 2), null);
  assert.deepEqual(selectedTotal([[100, 0], [1, 2]], 2), summarize([101, 2], 2));
  assert.deepEqual(hospitalValues(valuesByDep(rows, months, new Set(["OFC"]), "claim"), months), [100, 0.2]);
  assert.deepEqual(hospitalValues(valuesByDep(rows, months, null, "income"), months), [100, 50.1]);
  assert.deepEqual(hospitalValues(new Map(), months), [0, 0]);
});

test("fiscal months Oct..Sep in CE", () => {
  const m = fiscalMonths(2569);
  assert.equal(m.length, 12);
  assert.equal(m[0], "2025-10");
  assert.equal(m[11], "2026-09");
});

test("month ranges: started months only, current cut at today, live = this + previous month", () => {
  const r = monthRanges(2570, "2026-11-23");
  assert.deepEqual(r.map((x) => x.month), ["2026-10", "2026-11"]);
  assert.deepEqual(r[0], { month: "2026-10", start: "2026-10-01", end: "2026-10-31", live: true, complete: true });
  assert.deepEqual(r[1], { month: "2026-11", start: "2026-11-01", end: "2026-11-23", live: true, complete: false });
  const past = monthRanges(2569, "2026-11-23");
  assert.equal(past.length, 12);
  assert.ok(past.every((x) => x.complete && !x.live));
  assert.equal(past[4].end, "2026-02-28");
  // วันสุดท้ายของเดือน = ยังไม่ครบ (วันนี้ยังลงข้อมูลอยู่)
  assert.equal(monthRanges(2570, "2026-10-31")[0].complete, false);
});

test("partial month = current month with day count; finished fiscal year = null", () => {
  const months = fiscalMonths(2570);
  assert.deepEqual(partialMonth({ months, loaded: 2, complete: 1, through: "2026-11-23" }), { month: "2026-11", days: 23 });
  assert.deepEqual(partialMonth({ months, loaded: 1, complete: 0, through: "2026-10-01" }), { month: "2026-10", days: 1 });
  assert.equal(partialMonth({ months: fiscalMonths(2569), loaded: 12, complete: 12, through: "2026-09-30" }), null);
});

test("aggregate pttype rows to fund, money rounded", () => {
  const fundOf = (p) => ({ A1: "OFC", A2: "OFC", B1: "LGO" })[p] ?? "UNKNOWN";
  const rows = aggregate(
    [{ month: "2026-10", rows: [
      { dep: "010", pttype: "A1", visits: 2, income: 100.1, claim: 50.05 },
      { dep: "010", pttype: "A2", visits: 1, income: 0.2, claim: 0.1 },
      { dep: "010", pttype: null, visits: 1, income: 5, claim: 0 },
      { dep: "020", pttype: "B1", visits: 3, income: 30, claim: 30 },
    ] }],
    fundOf,
  );
  assert.deepEqual(rows.find((r) => r.dep === "010" && r.fund === "OFC"), { month: "2026-10", dep: "010", fund: "OFC", visits: 3, income: 100.3, claim: 50.15 });
  assert.equal(rows.find((r) => r.dep === "010" && r.fund === "UNKNOWN").visits, 1);
  assert.equal(rows.length, 3);
});

test("values by dep filter funds, zero-fill months", () => {
  const rows = [
    { month: "2026-10", dep: "010", fund: "OFC", visits: 1, income: 10, claim: 5 },
    { month: "2026-11", dep: "010", fund: "LGO", visits: 1, income: 10, claim: 7 },
    { month: "2026-11", dep: "020", fund: "OFC", visits: 1, income: 99, claim: 20 },
    { month: "2026-11", dep: "030", fund: "UCS", visits: 9, income: 999, claim: 999 },
  ];
  const by = valuesByDep(rows, ["2026-10", "2026-11"], new Set(["OFC", "LGO"]), "claim");
  assert.deepEqual(by.get("010"), [5, 7]);
  assert.deepEqual(by.get("020"), [0, 20]);
  assert.equal(by.has("030"), false);
  assert.deepEqual([...valuesByDep(rows, ["2026-10", "2026-11"], null, "visits").get("030")], [0, 9]);
});

test("slots keep each department's color position", () => {
  assert.deepEqual(parseSlots(""), []);
  assert.deepEqual(parseSlots("a,,c"), ["a", "", "c"]);
  assert.deepEqual(assignSlots(["a", "b", "c"], ["a", "c"]), ["a", "", "c"]);
  assert.deepEqual(assignSlots(["a", "", "c"], ["a", "c", "d"]), ["a", "d", "c"]);
  assert.deepEqual(assignSlots(["a", "b"], ["b"]), ["", "b"]);
  assert.deepEqual(assignSlots(["a", "b"], ["a"]), ["a"]);
  assert.equal(assignSlots([], ["1", "2", "3", "4", "5", "6", "7", "8"]).length, 7);
});

test("summary: avg over complete months, last loaded month (even partial) vs previous month", () => {
  // ปีงบนี้: ต.ค. จบแล้ว พ.ย. ยังไม่จบ -> เทียบ พ.ย. กับ ต.ค. แต่เฉลี่ยนับแค่ ต.ค.
  assert.deepEqual(summarize([157569.85, 1262296.89], 1), {
    total: 1419866.74, avg: 157569.85, last: 1262296.89, prev: 157569.85, diff: 1104727.04, pct: (1104727.04 / 157569.85) * 100,
  });
  // ปีงบที่จบแล้ว: เดือนสุดท้ายเทียบเดือนก่อนหน้า
  assert.deepEqual(summarize([100, 150, 30], 3), { total: 280, avg: 93.33, last: 30, prev: 150, diff: -120, pct: -80 });
  // มีเดือนเดียว (ยังไม่จบหรือจบแล้ว) = ไม่มีคู่เทียบ
  assert.deepEqual(summarize([100], 1), { total: 100, avg: 100, last: 100, prev: null, diff: null, pct: null });
  assert.deepEqual(summarize([40], 0), { total: 40, avg: null, last: 40, prev: null, diff: null, pct: null });
  assert.deepEqual(summarize([], 0), { total: 0, avg: null, last: null, prev: null, diff: null, pct: null });
  assert.equal(summarize([0, 10], 2).pct, null);
  assert.equal(summarize([10, 5], 2).diff, -5);
  // รวมแผนกที่เลือก: เดือนไม่ครบก็เทียบเหมือนกัน
  assert.deepEqual(selectedTotal([[10, 20], [5, 40]], 1), { total: 75, avg: 15, last: 60, prev: 15, diff: 45, pct: 300 });
});
