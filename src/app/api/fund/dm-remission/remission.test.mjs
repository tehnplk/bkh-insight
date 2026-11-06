// รัน: node --test src/app/api/fund/dm-remission/remission.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { ageAt, hasCandidatePair, normalizeResults, remissionEvents } from "./remission.ts";

const r = (date, value, vn = date) => ({ vn, date, value });

test("first payment needs two consecutive results < 6.5, >= 90 days apart, no drug between", () => {
  const h = normalizeResults([r("2025-01-01", 6.4), r("2025-03-01", 6.0), r("2025-06-15", 6.1)]);
  // 01-01 -> 03-01 ห่าง 59 วัน ไม่ผ่าน, 03-01 -> 06-15 ห่าง 106 วัน ผ่าน
  const [e] = remissionEvents(h, []);
  assert.equal(e.kind, "ครั้งแรก");
  assert.equal(e.cur.date, "2025-06-15");
  assert.equal(e.days, 106);
  assert.equal(e.amount, 4000);
  // ยาในช่วง [ผลก่อน, ผลหลัง) ตัดคู่นั้น วันของผลหลังไม่นับ
  assert.deepEqual(remissionEvents(h, ["2025-03-01"]), []);
  assert.equal(remissionEvents(h, ["2025-06-15"]).length, 1);
});

test("a result >= 6.5 breaks the pair", () => {
  const h = normalizeResults([r("2025-01-01", 6.0), r("2025-03-01", 7.0), r("2025-05-01", 6.0)]);
  assert.deepEqual(remissionEvents(h, []), []);
});

test("extra payment only for the next result, 90-183 days, once", () => {
  const h = normalizeResults([r("2025-01-01", 6.0), r("2025-04-15", 6.0), r("2025-08-01", 6.2), r("2025-11-15", 6.1)]);
  const ev = remissionEvents(h, []);
  assert.deepEqual(ev.map((e) => [e.kind, e.cur.date, e.amount]), [["ครั้งแรก", "2025-04-15", 4000], ["เพิ่มเติม", "2025-08-01", 2000]]);
  // ห่างเกิน 183 วัน ไม่ได้เพิ่มเติม
  const far = normalizeResults([r("2025-01-01", 6.0), r("2025-04-15", 6.0), r("2025-12-01", 6.0)]);
  assert.equal(remissionEvents(far, []).length, 1);
});

test("same-day duplicates keep the highest value, sorted by date", () => {
  const h = normalizeResults([r("2025-05-01", 6.0, "b"), r("2025-01-01", 6.1), r("2025-05-01", 6.8, "a")]);
  assert.deepEqual(h.map((x) => [x.date, x.value]), [["2025-01-01", 6.1], ["2025-05-01", 6.8]]);
});

test("candidate pair must end inside the range", () => {
  const h = normalizeResults([r("2025-01-01", 6.0), r("2025-04-15", 6.0)]);
  assert.equal(hasCandidatePair(h, "2025-04-01", "2025-04-30"), true);
  assert.equal(hasCandidatePair(h, "2025-05-01", "2025-05-31"), false);
});

test("ageAt counts full years", () => {
  assert.equal(ageAt("2007-06-15", "2025-06-14"), 17);
  assert.equal(ageAt("2007-06-15", "2025-06-15"), 18);
  assert.equal(ageAt("0000-00-00", "2025-06-15"), null);
  assert.equal(ageAt(null, "2025-06-15"), null);
});
