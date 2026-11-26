// รัน: node --test src/app/api/fund/ar-transfer/transfer.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { PRIOR_YEAR_ACCOUNT, budgetYear, findMapping, fundDetail, fundKey, keyBudgetYear, mapKey, parseTransferInput, parseTransferPatch, planImport, rowSide, smtKey, summarize } from "./transfer.ts";

const row = (extra = {}) => ({
  budgetSource: "UC", postingDate: "25691009", batchNo: "Y004", refDocNo: "OP จัดสรรพลางก่อนร้อยละ 25", mouGrpCode: "70010101",
  mophId: "4301020105.214", mophDesc: "รายได้กองทุน  UC -OP แบบเหมาจ่าย", fundDescr: "กองทุนผู้ป่วยนอก",
  efundDesc: "งบบริการผู้ป่วยนอกจ่ายแบบเหมาจ่ายต่อผู้มีสิทธิ", total: 7224700, pmntStts: "P", ...extra,
});
const MAP = () => new Map([
  [mapKey("UC|4301020105.214|010101", "ALL"), { account_code: "4301020105.214", ignore: false }],
  [mapKey("UC|4301020105.223|160301", "ALL"), { account_code: null, ignore: true }],
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
  assert.deepEqual(p.newFunds, [{ fund_key: "UC|4301020105.228|011801", side: "ALL", fund_name: "งบค่าบริการเพิ่มเติม", smt_account_name: "รายได้กองทุน  UC -OP แบบเหมาจ่าย" }]);
  assert.deepEqual(p.unmapped, [{ fund_key: "UC|4301020105.228|011801", fund_name: "งบค่าบริการเพิ่มเติม", n: 2, total: 100.3 }]);
});

test("planImport: แถวในงวดที่ปิดแล้วไม่เพิ่ม/ไม่แก้ แต่แถวที่แก้แล้วยังนับ kept", () => {
  const p = planImport([row(), row({ batchNo: "E1" })], MAP(), new Map([[smtKey(row({ batchNo: "E1" })), { amount: 1, account_code: "4301020105.214", edited: false, cancelled: true }]]), "2026-10");
  assert.deepEqual([p.counts.closed, p.counts.kept, p.inserts.length], [1, 1, 0]);
});

test("planImport: งบปีก่อนวันโอนลง 3102010102.201 ; จัดสรรพลางก่อนต้นปีงบไม่ย้าย ; แถวเดิมที่ยังไม่แก้ย้ายบัญชีเมื่อนำเข้าใหม่", () => {
  const MAP2 = new Map([...MAP(), [mapKey("UC|4301020105.217|160301", "ALL"), { account_code: "4301020105.217", ignore: false }], [mapKey("UC||010101", "ALL"), { account_code: "4301020105.214", ignore: false }]]);
  const alloc = row({ postingDate: "25681008", mophId: " ", mouGrpCode: "69010101", refDocNo: "จัดสรร OP ไปพลางก่อน" }); // 8 ต.ค. 2568 ปีงบ 2569 งบ 69
  const refer = row({ postingDate: "25691116", batchNo: "R1", mouGrpCode: "69010101", refDocNo: "OP REFER6909", total: -27931.75 }); // ปีงบ 2570 งบ 69
  const pp = row({ postingDate: "25681020", batchNo: "P1", mophId: "4301020105.217", mouGrpCode: "68160301", refDocNo: "6808_OP_02", total: 14650 });
  const sept = row({ postingDate: "25690930", batchNo: "S1", mouGrpCode: "69010101" }); // 30 ก.ย. ยังปีงบ 2569
  const edited = row({ postingDate: "25691120", batchNo: "E1", mouGrpCode: "69010101" });
  const existing = new Map([
    [smtKey(refer), { amount: "-27931.75", account_code: "4301020105.214", edited: false, cancelled: false }],
    [smtKey(edited), { amount: "7224700", account_code: "4301020105.214", edited: true, cancelled: false }],
  ]);
  const p = planImport([alloc, refer, pp, sept, edited], MAP2, existing, null);
  assert.deepEqual(p.inserts.map((r) => [r.ref_doc_no, r.account_code]), [
    ["จัดสรร OP ไปพลางก่อน", "4301020105.214"], ["6808_OP_02", PRIOR_YEAR_ACCOUNT.code], ["OP จัดสรรพลางก่อนร้อยละ 25", "4301020105.214"],
  ]);
  assert.deepEqual(p.updates, [{ smt_key: smtKey(refer), account_code: "3102010102.201", amount: -27931.75 }]);
  assert.deepEqual([p.counts.kept, p.counts.updated, p.counts.new], [1, 1, 3]);
  assert.deepEqual([budgetYear("70160301"), budgetYear(" 69010101 "), budgetYear("6901"), keyBudgetYear(smtKey(pp)), keyBudgetYear(null)], [2570, 2569, null, 2568, null]);
});

test("rowSide/findMapping: ฝั่งจากเลขงวดต้น refDocNo ; OP/IP ที่ยังไม่ตั้งใช้ตาม ALL", () => {
  assert.deepEqual(
    ["6909_IP_02", "6909_OP_01_อุทธรณ์", "6905_IP_01(ยกเลิก Rerun)", "OP REFER6909", "DDSA6923070023", "งบIPเติมตามเกณฑ์", null].map((refDocNo) => rowSide({ refDocNo })),
    ["IP", "OP", "IP", null, null, null, null],
  );
  const fk = "UC|1102050101.216/222|010406";
  const all = { account_code: "1102050101.216", ignore: false }, ip = { account_code: "1102050101.217", ignore: false };
  const m = new Map([[mapKey(fk, "ALL"), all], [mapKey(fk, "IP"), ip], [mapKey(fk, "OP"), { account_code: null, ignore: false }]]);
  assert.deepEqual([findMapping(m, fk, "IP"), findMapping(m, fk, "OP"), findMapping(m, fk, null), findMapping(m, "x", "IP")], [ip, all, all, undefined]);
});

test("planImport: แยกบัญชี OP/IP ; กองทุนที่มีทั้ง OP และ IP ได้แถว mapping ว่างของ OP/IP (มีแล้วไม่เพิ่ม) ; ฝั่งที่ไม่ใช้", () => {
  const fk = "UC|1102050101.216/222|010406";
  const cr = (extra) => row({ mophId: "1102050101.216/222", mouGrpCode: "70010406", efundDesc: "บริการกรณีเฉพาะ", mophDesc: "ลูกหนี้ CR", total: 10, ...extra });
  const rows = [cr({ batchNo: "O1", refDocNo: "6909_OP_02" }), cr({ batchNo: "I1", refDocNo: "6909_IP_02" }), cr({ batchNo: "N1", refDocNo: "DDSA7001100001" })];
  const p = planImport(rows, new Map([[mapKey(fk, "ALL"), { account_code: "1102050101.216", ignore: false }]]), new Map(), null);
  assert.deepEqual(p.inserts.map((r) => [r.ref_doc_no, r.account_code]), [["6909_OP_02", "1102050101.216"], ["6909_IP_02", "1102050101.216"], ["DDSA7001100001", "1102050101.216"]]);
  assert.deepEqual(p.newFunds.map((f) => [f.fund_key, f.side, f.fund_name]), [[fk, "OP", "บริการกรณีเฉพาะ"], [fk, "IP", "บริการกรณีเฉพาะ"]]);
  const split = new Map([
    [mapKey(fk, "ALL"), { account_code: null, ignore: false }],
    [mapKey(fk, "OP"), { account_code: "1102050101.216", ignore: false }],
    [mapKey(fk, "IP"), { account_code: null, ignore: true }],
  ]);
  const q = planImport(rows, split, new Map([[smtKey(rows[0]), { amount: 10, account_code: "1102050101.222", edited: false, cancelled: false }]]), null);
  assert.deepEqual(q.updates, [{ smt_key: smtKey(rows[0]), account_code: "1102050101.216", amount: 10 }]);
  assert.deepEqual([q.counts.ignored, q.counts.unmapped, q.newFunds.length, q.unmapped[0].n], [1, 1, 0, 1]);
  // มีแต่ฝั่ง OP ไม่สร้างแถวแยก
  assert.deepEqual(planImport([rows[0], rows[2]], new Map(), new Map(), null).newFunds.map((f) => f.side), ["ALL"]);
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

test("fundDetail: กรองตาม fund_key, เรียงวันโอน, ยอดไม่นับรอโอน, แยกงบปี, ธงงบปีก่อน", () => {
  const rows = [
    row({ batchNo: "B2", postingDate: "25691116", mouGrpCode: "69010101", refDocNo: "OP REFER6909", total: -27931.75 }),
    row({ batchNo: "B1", total: 100.1, amount: 110.1, wait: 10, debt: 0, fundGroupDescr: "กองทุนค่าบริการทางการแพทย์", countRecord: 3 }),
    row({ batchNo: "B3", total: 0.2 }),
    row({ batchNo: "W1", total: 50, pmntStts: "W" }),
    row({ batchNo: "X1", mophId: "4301020105.217" }),
  ];
  const d = fundDetail(rows, "UC|4301020105.214|010101");
  assert.deepEqual(d.lines.map((l) => l.batch_no), ["B1", "B3", "W1", "B2"]);
  assert.equal(d.n, 3);
  assert.equal(d.total, -27831.45);
  assert.equal(d.pending, 1);
  assert.equal(d.pending_total, 50);
  assert.deepEqual(d.years, [{ budget_year: 2569, n: 1, total: -27931.75 }, { budget_year: 2570, n: 2, total: 100.3 }]);
  assert.equal(d.lines[3].prior_year, true);
  assert.equal(d.lines[0].prior_year, false);
  assert.deepEqual([d.lines[0].amount, d.lines[0].wait, d.lines[0].group, d.lines[0].count, d.lines[0].date], [110.1, 10, "กองทุนค่าบริการทางการแพทย์", 3, "2026-10-09"]);
  assert.equal(d.lines[2].status, "รอโอน");
  assert.equal(d.lines[1].amount, 0.2); // ไม่มี amount ใช้ total
  assert.deepEqual(d.sides, []); // ไม่มีแถว OP/IP
});

test("fundDetail: ยอดโอนแล้วแยก OP/IP/ไม่ระบุ ไม่นับรอโอน", () => {
  const d = fundDetail([
    row({ batchNo: "O1", refDocNo: "6909_OP_02", total: 10.1 }), row({ batchNo: "O2", refDocNo: "6910_OP_01", total: 0.2 }),
    row({ batchNo: "I1", refDocNo: "6909_IP_02", total: 5, pmntStts: "W" }), row({ batchNo: "N1", total: 1 }),
  ], "UC|4301020105.214|010101");
  assert.deepEqual(d.sides, [{ side: "OP", n: 2, total: 10.3 }, { side: null, n: 1, total: 1 }]);
  assert.equal(d.lines.find((l) => l.batch_no === "I1").side, "IP");
});
