// รัน: node --test src/app/api/fund/ar-ledger/receipt/receipt.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { planReceipt } from "./receipt.ts";

test("รับบางส่วน: ไม่ติ๊ก = คงเหลือเก็บไว้ ; ติ๊ก = diff ปิดเป็น 0", () => {
  assert.deepEqual(planReceipt(100000, 80000, false), { settle: -80000, diff: 0 });
  assert.deepEqual(planReceipt(100000, 80000, true), { settle: -80000, diff: -20000 });
  assert.deepEqual(planReceipt(100000, 100000, true), { settle: -100000, diff: 0 });
});

test("รับเกินคงเหลือ หรือไม่มีคงเหลือ = error", () => {
  assert.ok("error" in planReceipt(100000, 100001, false));
  assert.ok("error" in planReceipt(0, 100, false));
  assert.ok("error" in planReceipt(100, 0, false));
});
