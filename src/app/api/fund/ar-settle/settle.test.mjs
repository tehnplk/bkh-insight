// รัน: node --test src/app/api/fund/ar-settle/settle.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { parseSettleBody, planSettle, previewRows, shouldClose, summarize } from "./settle.ts";

const debt = (ref, balance, o = {}) => ({
  source: "ipt", ref, vn: null, an: "A1", patient_type: "IP", ref_date: "2026-10-01", pttype: "89", hipdata_code: "UCS",
  hospmain: null, hospmain_chwpart: null, account_code: "1102050101.202", settles_by_stm: true, balance, ...o,
});
const opDebt = (ref, balance, o = {}) => debt(ref, balance, { source: "rcpt_debt", vn: "660000000001", an: null, patient_type: "OP", account_code: "1102050101.216", ...o });
const line = (o = {}) => ({ id: "1", patient_type: "IP", rep_no: "R1", tran_id: "T1", hn: "1", vn: null, an: "A1", paid_total: "800.00", done: false, ...o });
const opLine = (o = {}) => line({ patient_type: "OP", vn: "660000000001", an: null, ...o });
const sum = (es) => es.reduce((s, e) => s + Math.round(Number(e.amount) * 100), 0);
const plan = (lines, debts, close = () => false) => planSettle(lines, debts, { entryDate: "2026-11-20", close });
const preview = (lines, debts, missing = [], pt = "IP") => previewRows(lines, debts, missing, pt);

test("ตรงยอด: settle เท่าหนี้ คงเหลือ 0", () => {
  const [r] = preview([line()], [debt("A1", "800.00")]);
  assert.deepEqual([r.group, r.status, r.remaining, r.closable], ["match", "match", 0, false]);
  const es = plan([line()], [debt("A1", "800.00")]);
  assert.deepEqual(es.map((e) => [e.kind, e.amount, e.entry_date, e.stm_row_id]), [["settle", "-800.00", "2026-11-20", "1"]]);
});

test("ได้รับต่ำกว่า: ไม่ติ๊ก = คงเหลือ (รับบางส่วน), ติ๊ก = diff ปิดเป็น 0", () => {
  const [r] = preview([line()], [debt("A1", "1000.00")]);
  assert.deepEqual([r.group, r.status, r.remaining, r.close_default], ["diff", "under", 200, false]);
  assert.deepEqual(plan([line()], [debt("A1", "1000.00")]).map((e) => e.kind), ["settle"]);
  const closed = plan([line()], [debt("A1", "1000.00")], () => true);
  assert.deepEqual(closed.map((e) => [e.kind, e.amount]), [["settle", "-800.00"], ["diff", "-200.00"]]);
  assert.equal(100000 + sum(closed), 0);
});

test("ได้รับสูงกว่า: ค่าเริ่มต้นติ๊ก ปิดด้วย diff บวก ; เอาติ๊กออก (keep) = คงเหลือติดลบ", () => {
  const [r] = preview([line({ paid_total: 1200 })], [debt("A1", "1000.00")]);
  assert.deepEqual([r.status, r.close_default], ["over", true]);
  assert.equal(shouldClose(r, new Set(), new Set()), true);
  assert.equal(shouldClose(r, new Set(), new Set([r.key])), false);
  const es = plan([line({ paid_total: 1200 })], [debt("A1", "1000.00")], (x) => shouldClose(x, new Set(), new Set()));
  assert.deepEqual(es.map((e) => [e.kind, e.amount]), [["settle", "-1200.00"], ["diff", "200.00"]]);
});

test("หลายหนี้ต่อ VN: คงเหลือมากก่อน ส่วนขาดค้างที่หนี้เล็ก", () => {
  const debts = [opDebt("11", "30.00"), opDebt("12", "70.00")];
  const es = plan([opLine({ paid_total: 80 })], debts);
  assert.deepEqual(es.map((e) => [e.ref, e.kind, e.amount]), [["12", "settle", "-70.00"], ["11", "settle", "-10.00"]]);
  const [r] = preview([opLine({ paid_total: 80 })], debts, [], "OP");
  assert.deepEqual([r.key, r.balance, r.remaining], ["OP:660000000001", 100, 20]);
  const closed = plan([opLine({ paid_total: 80 })], debts, () => true);
  assert.deepEqual(closed.at(-1), { ...closed.at(-1), ref: "11", kind: "diff", amount: "-20.00", stm_row_id: "1" });
});

test("สองบรรทัดของรายเดียว: ตัดต่อกัน diff อ้างบรรทัดสุดท้าย", () => {
  const lines = [line({ id: "5", paid_total: 300 }), line({ id: "9", paid_total: 200 })];
  const [r] = preview(lines, [debt("A1", "1000.00")]);
  assert.deepEqual([r.lines, r.paid, r.remaining], [2, 500, 500]);
  const es = plan(lines, [debt("A1", "1000.00")], () => true);
  assert.deepEqual(es.map((e) => [e.kind, e.amount, e.stm_row_id]), [["settle", "-300.00", "5"], ["settle", "-200.00", "9"], ["diff", "-500.00", "9"]]);
});

test("ตัดแล้วรับบางส่วน: ไม่ settle ซ้ำ ปิดส่วนต่างภายหลังได้", () => {
  const done = line({ done: true });
  const [r] = preview([done], [debt("A1", "200.00")]);
  assert.deepEqual([r.group, r.status, r.paid, r.closable], ["done", "partial", 0, true]);
  assert.deepEqual(plan([done], [debt("A1", "200.00")]), []);
  assert.deepEqual(plan([done], [debt("A1", "200.00")], () => true).map((e) => [e.kind, e.amount, e.stm_row_id]), [["diff", "-200.00", "1"]]);
  assert.equal(preview([done], [debt("A1", "0")])[0].status, "settled");
});

test("ถูกเรียกคืน: settle บวก หนี้เพิ่ม", () => {
  const [r] = preview([line({ paid_total: -100 })], [debt("A1", "0")]);
  assert.deepEqual([r.group, r.status, r.remaining], ["diff", "recall", 100]);
  assert.deepEqual(plan([line({ paid_total: -100 })], [debt("A1", "0")]).map((e) => [e.kind, e.amount, e.note]), [["settle", "100.00", "STM เรียกคืน"]]);
});

test("ค: ไม่พบ VN/AN, ยังไม่ลงสมุด, บัญชีไม่ตัด, ไม่ระบุบัญชี, จ่าย 0 ; ไม่ลงแถวใด", () => {
  const cases = [
    [line({ an: null }), [], "no_ref"],
    [line(), [], "no_debt"],
    [line(), [debt("A1", "1.00", { settles_by_stm: false })], "not_stm"],
    [line(), [debt("A1", "1.00", { settles_by_stm: false, account_code: null })], "no_account"],
    [line({ paid_total: 0 }), [debt("A1", "1.00")], "zero"],
  ];
  for (const [l, ds, status] of cases) {
    const [r] = preview([l], ds);
    assert.deepEqual([r.group, r.status], ["none", status]);
    assert.deepEqual(plan([l], ds, () => true), []);
  }
  assert.equal(preview([line({ an: null })], [])[0].key, "row:1");
});

test("ง: รวมหนี้ของ VN เดียวเป็นแถวเดียว", () => {
  const rows = preview([], [], [
    { tran_id: "T1", rep_no: "R1", hn: "1", vn: "660000000001", ref: "11", account_code: "x", balance: "10.50" },
    { tran_id: "T1", rep_no: "R1", hn: "1", vn: "660000000001", ref: "12", account_code: "x", balance: "4.50" },
  ], "OP");
  assert.deepEqual(rows.map((r) => [r.key, r.group, r.balance]), [["OP:660000000001", "missing", 15]]);
});

test("parseSettleBody", () => {
  const ok = parseSettleBody({ stm_file_id: "7", receipt_date: "2026-11-20", receipt_no: " R-1 ", close: ["OP:660000000001"] }, "2026-11-20", "2025-10-01");
  assert.deepEqual(ok, { stm_file_id: "7", receipt_date: "2026-11-20", receipt_no: "R-1", close: new Set(["OP:660000000001"]), keep: new Set() });
  assert.equal(parseSettleBody({ stm_file_id: "7", receipt_date: "2026-11-21" }, "2026-11-20", "2025-10-01").error !== undefined, true);
  assert.equal(parseSettleBody({ stm_file_id: "7", receipt_date: "2025-09-30" }, "2026-11-20", "2025-10-01").error !== undefined, true);
  assert.equal(parseSettleBody({ stm_file_id: "x", receipt_date: "2026-11-20" }, "2026-11-20", "2025-10-01").error !== undefined, true);
  assert.equal(parseSettleBody({ stm_file_id: "7", receipt_date: "2026-11-20", close: ["OP:1 OR 1=1"] }, "2026-11-20", "2025-10-01").error !== undefined, true);
  assert.equal(parseSettleBody({ stm_file_id: "7", receipt_date: "2026-11-20", receipt_no: "  " }, "2026-11-20", "2025-10-01").receipt_no, null);
});

test("summarize: นับกลุ่มและแผนตามค่าเริ่มต้น", () => {
  const rows = preview([line({ id: "1", an: "A1", paid_total: "1200.10" }), line({ id: "2", an: "A2", paid_total: "50.00" })], [debt("A1", "1000.00"), debt("A2", "100.00", { an: "A2" })]);
  const s = summarize(rows);
  assert.deepEqual(s.groups.diff, { n: 2, paid: 1250.1, balance: 1100 });
  assert.deepEqual(s.plan, { settle_n: 2, settle_amount: 1250.1, close_n: 1, close_amount: 200.1 });
});
