// รัน: node --test src/lib/sex-age.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { sexAgeText } from "./sex-age.ts";

test("sexAgeText: sex + age, all units shown, missing parts hidden", () => {
  assert.equal(sexAgeText("1", 25, 10, 15), "ชาย 25ปี 10ด 15ว");
  assert.equal(sexAgeText("2", 0, 3, 0), "หญิง 0ปี 3ด 0ว");
  assert.equal(sexAgeText("9", 40, 0, 1), "40ปี 0ด 1ว");
  assert.equal(sexAgeText("1", null, null, null), "ชาย");
  assert.equal(sexAgeText(null, null, null, null), null);
});
