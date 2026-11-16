// รัน: node --test src/app/api/fund/ar-adjust/adjust.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { overReduces } from "./adjust.ts";

test("overReduces: ลดหนี้จนติดลบเท่านั้นที่ไม่ผ่าน", () => {
  assert.equal(overReduces("50.00", "-50.00"), false); // ลดเหลือ 0
  assert.equal(overReduces("0", "-50.00"), true); // ar-sync ยกเลิกไปแล้วระหว่างรออนุมัติ
  assert.equal(overReduces("50.00", "-50.01"), true);
  assert.equal(overReduces("0.3", -(0.1 + 0.2)), false); // เทียบเป็นสตางค์
  assert.equal(overReduces("0", "20.00"), false); // เพิ่มหนี้
  assert.equal(overReduces("-50.00", "50.00"), false); // ยอดติดลบอยู่แล้ว ขอเพิ่มกลับ
});
