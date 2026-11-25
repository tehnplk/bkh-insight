// รัน: node --test src/app/api/fund/ar-transfer/transfer.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { fundKey, parseTransferInput, parseTransferPatch, planImport, smtKey, summarize } from "./transfer.ts";

const row = (extra = {}) => ({
  budgetSource: "UC", postingDate: "25691009", batchNo: "Y004", refDocNo: "OP จัดสรรพลางก่อนร้อยละ 25", mouGrpCode: "70010101",
  mophId: "4301020105.214", mophDesc: "รายได้กองทุน  UC -OP แบบเหมาจ่าย", fundDescr: "กองทุนผู้ป่วยนอก",
  efundDesc: "งบบริการผู้ป่วยนอกจ่ายแบบเหมาจ่ายต่อผู้มีสิทธิ", total: 7224700, pmntStts: "P", ...extra,
});
const MAP = () => new Map([
  ["UC|4301020105.214|010101", { account_code: "4301020105.214", ignore: false }],
  ["UC|4301020105.223|160301", { account_code: null, ignore: true }],
]);

test("fundKey ไม่รวมปีของ mouGrpCode และแยก mophId ; mophId ว่าง (' ') เป็นช่องว่าง", () => {
  assert.equal(fundKey(row()), "UC|4301020105.214|010101");
  assert.equal(fundKey(row({ mouGrpCode: "69010101" })), "UC|4301020105.214|010101");
  assert.equal(fundKey(row({ mophId: " " })), "UC||010101");
  assert.equal(smtKey(row()), "UC|25691009|Y004|OP จัดสรรพลางก่อนร้อยละ 25|70010101|4301020105.214");
});

test("planImport: ใหม่, เหมือนเดิม, SMT เปลี่ยน, การเงินแก้/ยกเลิก, รอโอน, ยอด 0, ยังไม่จับคู่, ไม่ใช้", () => {
  const a = row(), b = row({ batchNo: "3891", refDocNo: "OP REFER6909", total: -27931.75, postingDate: "25691116" });
  const c = row({ batchNo: "C1" }), d = row({ batchNo: "D1" }), e = row({ batchNo: "E1" });
  const existing = new Map([
    [smtKey(c), { amount: "7224700.00", account_code: "4301020105.214", edited: false, cancelled: false }],
    [smtKey(d), { amount: "1.00", account_code: "4301020105.214", edited: false, cancelled: false }],
    [smtKey(e), { amount: "1.00", account_code: "4301020105.214", edited: true, cancelled: false }],
  ]);
  const rows = [
    a, b, c, d, e,
    row({ batchNo: "W1", pmntStts: "W" }),
    row({ batchNo: "Z1", total: 0 }),
    row({ batchNo: "U1", mophId: "4301020105.228", mouGrpCode: "69011801", efundDesc: "งบค่าบริการเพิ่มเติม", total: 100.1 }),
    row({ batchNo: "U2", mophId: "4301020105.228", mouGrpCode: "69011801", efundDesc: "งบค่าบริการเพิ่มเติม", total: 0.2 }),
    row({ batchNo: "I1", mophId: "4301020105.223", mouGrpCode: "69160301" }),
  ];
  const p = planImport(rows, MAP(), existing, null);
  assert.deepEqual(p.counts, { new: 2, updated: 1, unchanged: 1, kept: 1, unmapped: 2, ignored: 1, pending: 1, closed: 0 });
  assert.deepEqual(p.inserts.map((r) => [r.transfer_date, r.amount, r.account_code]), [["2026-10-09", 7224700, "4301020105.214"], ["2026-11-16", -27931.75, "4301020105.214"]]);
  assert.deepEqual(p.updates, [{ smt_key: smtKey(d), account_code: "4301020105.214", amount: 7224700 }]);
  assert.deepEqual(p.newFunds, [{ fund_key: "UC|4301020105.228|011801", fund_name: "งบค่าบริการเพิ่มเติม", smt_account_name: "รายได้กองทุน  UC -OP แบบเหมาจ่าย" }]);
  assert.deepEqual(p.unmapped, [{ fund_key: "UC|4301020105.228|011801", fund_name: "งบค่าบริการเพิ่มเติม", n: 2, total: 100.3 }]);
});

test("planImport: แถวในงวดที่ปิดแล้วไม่เพิ่ม/ไม่แก้ แต่แถวที่แก้แล้วยังนับ kept", () => {
  const p = planImport([row(), row({ batchNo: "E1" })], MAP(), new Map([[smtKey(row({ batchNo: "E1" })), { amount: 1, account_code: "4301020105.214", edited: false, cancelled: true }]]), "2026-10");
  assert.deepEqual([p.counts.closed, p.counts.kept, p.inserts.length], [1, 1, 0]);
});

test("summarize: ต่อบัญชีต่อเดือน ไม่นับยกเลิก .214/.217 ขึ้นก่อน", () => {
  const s = summarize([
    { account_code: "4301020105.228", transfer_date: "2026-10-01", amount: "10.10", cancelled: false },
    { account_code: "4301020105.214", transfer_date: "2026-10-09", amount: "0.10", cancelled: false },
    { account_code: "4301020105.214", transfer_date: "2026-10-20", amount: "0.20", cancelled: false },
    { account_code: "4301020105.214", transfer_date: "2026-11-16", amount: "-5", cancelled: false },
    { account_code: "4301020105.214", transfer_date: "2026-11-16", amount: "999", cancelled: true },
  ]);
  assert.deepEqual(s, [
    { account_code: "4301020105.214", months: { "2026-10": 0.3, "2026-11": -5 }, total: -4.7 },
    { account_code: "4301020105.217", months: {}, total: 0 },
    { account_code: "4301020105.228", months: { "2026-10": 10.1 }, total: 10.1 },
  ]);
});

test("parseTransferInput/parseTransferPatch", () => {
  const ok = { transfer_date: "2026-11-01", account_code: " 4301020105.214 ", amount: 0.29, note: " x " };
  assert.deepEqual(parseTransferInput(ok, "2025-10-01", "2026-11-25"), { transfer_date: "2026-11-01", account_code: "4301020105.214", amount: 0.29, note: "x" });
  for (const bad of [
    { ...ok, transfer_date: "2026-11-26" }, { ...ok, transfer_date: "2025-09-30" }, { ...ok, transfer_date: "2026-02-30" },
    { ...ok, account_code: "4301020105.21" }, { ...ok, amount: 0 }, { ...ok, amount: 1.005 }, { ...ok, amount: "5" }, { ...ok, note: "x".repeat(501) },
  ]) assert.ok("error" in parseTransferInput(bad, "2025-10-01", "2026-11-25"), JSON.stringify(bad));
  assert.equal(parseTransferInput({ ...ok, amount: -17891.5 }, "2025-10-01", "2026-11-25").amount, -17891.5);
  assert.deepEqual(parseTransferPatch({ id: 3, action: "cancel", reason: " ซ้ำ " }, "2025-10-01", "2026-11-25"), { id: "3", action: "cancel", reason: "ซ้ำ" });
  assert.ok("error" in parseTransferPatch({ id: 3, action: "cancel", reason: " " }, "2025-10-01", "2026-11-25"));
  assert.equal(parseTransferPatch({ id: "3", action: "edit", ...ok }, "2025-10-01", "2026-11-25").action, "edit");
  assert.ok("error" in parseTransferPatch({ id: "x", action: "edit", ...ok }, "2025-10-01", "2026-11-25"));
});
