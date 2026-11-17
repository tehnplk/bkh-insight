// รัน: node --test src/lib/dx-groups.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { DX_GROUPS, dxGroupSql, parseDx } from "./dx-groups.ts";

test("parseDx: ไม่ส่ง dx = ไม่กรอง ไม่สน dxpos ที่ถูกต้อง", () => {
  assert.equal(parseDx(null, null), null);
  assert.equal(parseDx("", "pdx"), null);
  assert.equal(parseDx(" , ", null), null);
});

test("parseDx: key ซ้ำตัดออก ตำแหน่งเริ่มต้น all", () => {
  assert.deepEqual(parseDx("malnutrition,malnutrition", null), { keys: ["malnutrition"], pos: "all" });
  assert.deepEqual(parseDx("malnutrition", "sdx"), { keys: ["malnutrition"], pos: "sdx" });
});

test("parseDx: key หรือ dxpos ที่ไม่รู้จัก = invalid", () => {
  assert.equal(parseDx("bogus", null), "invalid");
  assert.equal(parseDx("malnutrition,bogus", null), "invalid");
  assert.equal(parseDx("malnutrition", "x"), "invalid");
  assert.equal(parseDx(null, "x"), "invalid");
});

test("dxGroupSql: ช่วงเป็น bind parameter จาก DX_GROUPS", () => {
  assert.deepEqual(dxGroupSql({ icd10: "d.icd10" }, ["malnutrition"]), {
    sql: "(LEFT(d.icd10, 3) BETWEEN ? AND ?)",
    params: ["E40", "E46"],
  });
  assert.equal(DX_GROUPS.find((g) => g.key === "malnutrition")?.ranges[0].join("-"), "E40-E46");
});

test("dxGroupSql: ตำแหน่งรหัส sdx รวม diagtype ว่าง", () => {
  const cols = { icd10: "dg.icd10", diagtype: "dg.diagtype" };
  assert.equal(dxGroupSql(cols, ["malnutrition"], "pdx").sql, "((LEFT(dg.icd10, 3) BETWEEN ? AND ?) AND dg.diagtype = '1')");
  assert.equal(
    dxGroupSql(cols, ["malnutrition"], "sdx").sql,
    "((LEFT(dg.icd10, 3) BETWEEN ? AND ?) AND (dg.diagtype IS NULL OR dg.diagtype <> '1'))",
  );
});
