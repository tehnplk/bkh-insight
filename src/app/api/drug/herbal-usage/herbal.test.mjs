// รัน: node --test src/app/api/drug/herbal-usage/herbal.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { buildReport, reasons } from "./herbal.ts";

const months = ["2026-10", "2026-11", "2026-12"];
const item = (icode, cat = 3, ttmt = false) => ({ icode, name: icode, units: "ขวด", active: true, cat, ttmt });

test("reasons: category 3/4 and TTMT", () => {
  assert.deepEqual(reasons({ cat: 3, ttmt: false }), ["หมวด 3"]);
  assert.deepEqual(reasons({ cat: 4, ttmt: true }), ["หมวด 4", "TTMT"]);
  assert.deepEqual(reasons({ cat: 1, ttmt: true }), ["TTMT"]);
});

test("report: months filled, future null, share per side and total, unused items last", () => {
  const items = [item("A"), item("B"), item("C", null, true)];
  const usage = [
    { month: "2026-10", icode: "A", side: "OP", rows: 224, visits: 224, qty: 439, amt: 6818.5 },
    { month: "2026-10", icode: "A", side: "IP", rows: 95, visits: 37, qty: 105, amt: 1630 },
    { month: "2026-11", icode: "B", side: "OP", rows: 150, visits: 150, qty: 5030, amt: 10060 },
    // ไม่อยู่ในรายการ / เดือนที่ยังไม่ถึง: ไม่นับ
    { month: "2026-11", icode: "Z", side: "OP", rows: 1, visits: 1, qty: 1, amt: 999 },
    { month: "2026-12", icode: "A", side: "OP", rows: 1, visits: 1, qty: 1, amt: 999 },
  ];
  const drug = [
    { month: "2026-10", side: "OP", rows: 32960, amt: 4653224.27 },
    { month: "2026-10", side: "IP", rows: 16391, amt: 551090.53 },
    { month: "2026-11", side: "OP", rows: 100, amt: 100000 },
  ];
  const r = buildReport(months, 2, items, usage, drug);

  assert.deepEqual(r.monthly.op, [6818.5, 10060, null]);
  assert.deepEqual(r.monthly.ip, [1630, 0, null]);
  assert.ok(Math.abs(r.monthly.share.op[0] - (6818.5 / 4653224.27) * 100) < 1e-9);
  assert.ok(Math.abs(r.monthly.share.all[0] - (8448.5 / 5204314.8) * 100) < 1e-9);
  assert.equal(r.monthly.share.ip[1], null); // ไม่มียอดยา IP เดือนนั้น
  assert.equal(r.monthly.share.all[2], null);

  assert.deepEqual(r.items.map((x) => x.icode), ["B", "A", "C"]);
  const a = r.items[1];
  assert.deepEqual(a.op, { rows: 224, visits: 224, qty: 439, amt: 6818.5 });
  assert.equal(a.amt, 8448.5);
  assert.ok(Math.abs(a.share - (8448.5 / 18508.5) * 100) < 1e-9);
  assert.equal(r.items[2].share, 0);

  assert.equal(r.year.amt, 18508.5);
  assert.equal(r.year.drugAmt, 5304314.8);
  assert.equal(r.year.rows, 469);
  assert.equal(r.year.used, 2);
  assert.ok(Math.abs(r.year.share.ip - (1630 / 551090.53) * 100) < 1e-9);
});

test("no usage, no drug value: shares null, nothing used", () => {
  const r = buildReport(months, 1, [item("A")], [], []);
  assert.deepEqual(r.monthly.op, [0, null, null]);
  assert.equal(r.year.share.all, null);
  assert.equal(r.items[0].share, null);
  assert.equal(r.year.used, 0);
});
