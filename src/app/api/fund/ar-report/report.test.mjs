// รัน: node --test src/app/api/fund/ar-report/report.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { BALANCE_SQL, DAILY_SQL, parseSigners, toReport } from "./report.ts";

test("จำนวนรวมใช้ total_n ไม่ใช่ผลรวมแถว ; เงินรวมปัด 2 ตำแหน่ง ; แถว NULL = ยังไม่กำหนดบัญชี", () => {
  const raw = [
    { account_code: "1102050101.201", account_name: "UC OP ใน CUP", n: "10", gross: "100.10", booked: "90.20", total_n: "12" },
    { account_code: "1102050101.216", account_name: "UC CR", n: "3", gross: "0.20", booked: "0.10", total_n: "12" },
    { account_code: null, account_name: null, n: "0", gross: "0", booked: "0", total_n: "12" },
  ];
  const { rows, total } = toReport(raw, "daily");
  assert.deepEqual(total, { n: 12, money: [100.3, 90.3] });
  assert.equal(rows[2].account_name, "ยังไม่กำหนดบัญชี");
  assert.deepEqual(rows[0].money, [100.1, 90.2]);
  assert.deepEqual(toReport([], "balance").total, { n: 0, money: [0] });
});

test("SQL ใช้ placeholder ของ patient_type ตามรายงาน", () => {
  assert.match(DAILY_SQL, /\$3::text = 'OP'/);
  assert.doesNotMatch(DAILY_SQL, /\$2::text = 'OP'/);
  assert.match(BALANCE_SQL, /\$2::text = 'IP'/);
});

test("parseSigners: ครบ 3 ช่อง slot ไม่ซ้ำ หัวข้อบังคับ ช่องว่าง = null", () => {
  const ok = parseSigners({ signers: [
    { slot: 3, role_label: "ผู้อำนวยการ", person_name: "  ", position: "ผอ." },
    { slot: 1, role_label: " ก ", person_name: "นาย ข", position: "" },
    { slot: 2, role_label: "ค", person_name: null, position: null },
  ] });
  assert.ok(ok.ok);
  assert.deepEqual(ok.signers.map((s) => [s.slot, s.role_label, s.person_name, s.position]), [[1, "ก", "นาย ข", null], [2, "ค", null, null], [3, "ผู้อำนวยการ", null, "ผอ."]]);
  assert.equal(parseSigners({ signers: [{ slot: 1, role_label: "a" }, { slot: 1, role_label: "b" }, { slot: 2, role_label: "c" }] }).ok, false);
  assert.equal(parseSigners({ signers: [{ slot: 1, role_label: "" }, { slot: 2, role_label: "b" }, { slot: 3, role_label: "c" }] }).ok, false);
  assert.equal(parseSigners(null).ok, false);
});
