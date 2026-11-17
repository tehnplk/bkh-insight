// รัน: node --test src/app/api/home/overview/malnutrition.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { fiscalMonths, fiscalYearOf, fiscalYearRange } from "../../fund/uc-dashboard/dashboard.ts";
import { fillMonths, summarizeMalnutrition } from "./types.ts";

const row = (an, icd10, diagtype, o = {}) => ({ an, icd10, diagtype, icd_name: `EN ${icd10}`, icd_tname: null, adjrw: null, ...o });

test("ไม่มีแถว = 0 ทุกค่า คงตัวหารไว้", () => {
  assert.deepEqual(summarizeMalnutrition([], 704), { discharged: 704, pdx: 0, sdx: 0, adjrw: 0, noAdjrw: 0, codes: [] });
});

test("นับ AN ไม่ซ้ำต่อรหัสและรวม แยกโรคหลักกับวินิจฉัยอื่น เรียงตามรหัส", () => {
  const m = summarizeMalnutrition(
    [
      row("A1", "E46", "2"),
      row("A1", "E440", "2"), // AN เดียวสองรหัส: รวมนับครั้งเดียว
      row("A2", "E440", 1), // diagtype มาเป็นตัวเลขก็ได้
      row("A3", "E43", "3"),
      row("A3", "E43", "2"), // รหัสซ้ำใน AN เดียว
    ],
    100,
  );
  assert.deepEqual(m.codes.map((c) => [c.code, c.pdx, c.sdx]), [["E43", 0, 1], ["E440", 1, 1], ["E46", 0, 1]]);
  assert.equal(m.pdx, 1);
  assert.equal(m.sdx, 2);
});

test("AN ที่มีโรคหลัก E4x รหัสใดก็ได้นับเป็นโรคหลักในยอดรวม", () => {
  const m = summarizeMalnutrition([row("A1", "E46", "2"), row("A1", "E440", "1")], 1);
  assert.equal(m.pdx, 1);
  assert.equal(m.sdx, 0);
  assert.deepEqual(m.codes.map((c) => [c.code, c.pdx, c.sdx]), [["E440", 1, 0], ["E46", 0, 1]]);
});

test("ชื่อใช้ tname ยุบช่องว่าง ไม่มีใช้ name ไม่มีทั้งคู่ใช้รหัส", () => {
  const m = summarizeMalnutrition(
    [row("A1", "E42", "2", { icd_tname: "  ภาวะ   ทุพโภชนาการ " }), row("A2", "E45", "2", { icd_tname: "  " }), row("A3", "E46", "2", { icd_name: null })],
    3,
  );
  assert.deepEqual(m.codes.map((c) => c.name), ["ภาวะ ทุพโภชนาการ", "EN E45", "E46"]);
});

test("Sum AdjRW นับต่อ AN ไม่ซ้ำ (string -> number) AN ที่ไม่มี AdjRW ไม่รวมและนับแยก", () => {
  const m = summarizeMalnutrition(
    [
      row("A1", "E440", "2", { adjrw: "1.2345" }),
      row("A1", "E46", "2", { adjrw: "1.2345" }), // AN เดียวสองรหัส: รวมนับครั้งเดียว
      row("A2", "E440", "2", { adjrw: "2.0913" }),
      row("A3", "E46", "3"), // ยังไม่มี AdjRW
    ],
    10,
  );
  assert.equal(m.adjrw, 3.3258);
  assert.equal(m.noAdjrw, 1);
  assert.deepEqual(m.codes.map((c) => [c.code, c.adjrw]), [["E440", 3.3258], ["E46", 1.2345]]);
});

test("ปีงบ: ต.ค. เป็นปีงบถัดไป ปีงบปัจจุบันจบที่วันนี้", () => {
  assert.equal(fiscalYearOf("2026-11-17"), 2570);
  assert.equal(fiscalYearOf("2026-09-30"), 2569);
  assert.deepEqual(fiscalYearRange(2570, "2026-11-17"), { start: "2026-10-01", end: "2026-11-17" });
  assert.deepEqual(fiscalYearRange(2569, "2026-11-17"), { start: "2025-10-01", end: "2026-09-30" });
});

test("เดือนของปีงบเติม 0 และตัดที่เดือนของวันสุดท้าย", () => {
  const rows = [{ month: "2026-10", cases: 4, adjrw_sum: "3.3258", adjrw_n: 4 }];
  assert.deepEqual(fillMonths(rows, fiscalMonths(2570), "2026-11-17"), [
    { month: "2026-10", cases: 4, adjrw: 3.3258 },
    { month: "2026-11", cases: 0, adjrw: 0 },
  ]);
  const full = fillMonths([{ month: "2026-09", cases: "2", adjrw_sum: null }], fiscalMonths(2569), "2026-09-30");
  assert.equal(full.length, 12);
  assert.deepEqual([full[0].month, full[11]], ["2025-10", { month: "2026-09", cases: 2, adjrw: 0 }]);
});
