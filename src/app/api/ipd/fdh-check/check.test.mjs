// รัน: node --test src/app/api/ipd/fdh-check/check.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { checkDru } from "./check.ts";

const v = (code, unit_price, date_effective, extra = {}) => ({ code, unit_price, date_effective, date_approved: "2020-01-01", line_no: 1, product_cat: "1", ...extra });
const versions = [
  v("A", "61.50", "2012-10-01", { line_no: 2 }),
  v("A", "46.00", "2023-01-01", { line_no: 3 }),
  v("B", "10.00", "2020-01-01", { product_cat: "6" }),
];

test("checkDru: passes when code, date and price match the version in effect", () => {
  assert.deepEqual(checkDru([{ icode: "A", price: "46.00", date_serv: "2026-10-01" }], versions), []);
  assert.deepEqual(checkDru([{ icode: "A", price: 61.5, date_serv: "2022-12-31" }], versions), []);
});

test("checkDru: C562 unknown code, C573 before first DATEEFFECTIVE, C195 price differs, C574 PRODUCTCAT not 1-5; row index kept", () => {
  const f = checkDru(
    [
      { icode: "A", price: "46.00", date_serv: "2026-10-01" },
      { icode: "Z", price: "1", date_serv: "2026-10-01" },
      { icode: "A", price: "61.5", date_serv: "2011-01-01" },
      { icode: "A", price: "61.5", date_serv: "2026-10-01" },
      { icode: "B", price: "12", date_serv: "2026-10-01" },
    ],
    versions,
  );
  assert.deepEqual(f.map((x) => [x.row, x.codes]), [[1, ["562"]], [2, ["573"]], [3, ["195"]], [4, ["195", "574"]]]);
  assert.match(f[2].found, /ราคาเบิก 61\.50 \/ catalog 46\.00/);
});

test("checkDru: same DATEEFFECTIVE uses the later approval / later file line", () => {
  const vs = [v("C", "5", "2024-01-01", { date_approved: "2024-01-02", line_no: 1 }), v("C", "7", "2024-01-01", { date_approved: "2024-02-01", line_no: 2 })];
  assert.deepEqual(checkDru([{ icode: "C", price: "7", date_serv: "2024-03-01" }], vs), []);
  assert.deepEqual(checkDru([{ icode: "C", price: "5", date_serv: "2024-03-01" }], vs)[0].codes, ["195"]);
});
