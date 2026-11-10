// รัน: node --test src/app/api/fund/uc-debtor/items/items.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { groupDebtorItems } from "./items.ts";

test("groups by income, sums debtor (paidst 02) vs other, name falls back to icode", () => {
  const names = new Map([["03", "ค่ายา"], ["12", "ค่าบริการ"]]);
  const r = groupDebtorItems(
    [
      { income: "03", icode: "1001", name: "Paracetamol 500 mg", unitprice: "1.50", paidst: "02", qty: "10", amount: "15.00" },
      { income: "12", icode: "3001", name: null, unitprice: 50, paidst: "02", qty: 1, amount: 50 },
      { income: "03", icode: "1002", name: "Vitamin", unitprice: 0.1, paidst: "03", qty: 3, amount: 0.3 },
      { income: "03", icode: "1003", name: "Other", unitprice: 0.2, paidst: null, qty: 1, amount: 0.2 },
    ],
    (c) => names.get(c) ?? c,
  );
  assert.equal(r.debtor, 65);
  assert.equal(r.other, 0.5);
  assert.equal(r.total, 65.5);
  assert.deepEqual(r.categories.map((c) => [c.income_code, c.income_name, c.amount, c.items.length]), [
    ["12", "ค่าบริการ", 50, 1],
    ["03", "ค่ายา", 15.5, 3],
  ]);
  assert.equal(r.categories[0].items[0].name, "3001");
  assert.deepEqual(r.categories[1].items[0], { icode: "1001", name: "Paracetamol 500 mg", qty: 10, unitprice: 1.5, amount: 15, paidst: "02" });
});

test("no rows -> zero totals, no categories", () => {
  assert.deepEqual(groupDebtorItems([], (c) => c), { debtor: 0, other: 0, total: 0, categories: [] });
});
