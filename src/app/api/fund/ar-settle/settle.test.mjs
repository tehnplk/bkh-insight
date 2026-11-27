// รัน: node --test src/app/api/fund/ar-settle/settle.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { parseSettleBody, planSettle, previewRows, repDebts, repGate, repGateReason, shouldClose, summarize } from "./settle.ts";

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
  assert.deepEqual(ok, { stm_file_id: "7", rep_no: null, receipt_date: "2026-11-20", receipt_no: "R-1", close: new Set(["OP:660000000001"]), keep: new Set() });
  assert.equal(parseSettleBody({ stm_file_id: "7", receipt_date: "2026-11-21" }, "2026-11-20", "2025-10-01").error !== undefined, true);
  assert.equal(parseSettleBody({ stm_file_id: "7", receipt_date: "2025-09-30" }, "2026-11-20", "2025-10-01").error !== undefined, true);
  assert.equal(parseSettleBody({ stm_file_id: "x", receipt_date: "2026-11-20" }, "2026-11-20", "2025-10-01").error !== undefined, true);
  assert.equal(parseSettleBody({ stm_file_id: "7", receipt_date: "2026-11-20", close: ["OP:1 OR 1=1"] }, "2026-11-20", "2025-10-01").error !== undefined, true);
  assert.equal(parseSettleBody({ stm_file_id: "7", receipt_date: "2026-11-20", receipt_no: "  " }, "2026-11-20", "2025-10-01").receipt_no, null);
  // REP: rep_no แทน stm_file_id ต้องมีอย่างใดอย่างหนึ่งเท่านั้น
  const rep = parseSettleBody({ rep_no: "690100077", receipt_date: "2026-11-20" }, "2026-11-20", "2025-10-01");
  assert.deepEqual([rep.stm_file_id, rep.rep_no], [null, "690100077"]);
  assert.ok(parseSettleBody({ stm_file_id: "7", rep_no: "690100077", receipt_date: "2026-11-20" }, "2026-11-20", "2025-10-01").error);
  assert.ok(parseSettleBody({ receipt_date: "2026-11-20" }, "2026-11-20", "2025-10-01").error);
  assert.ok(parseSettleBody({ rep_no: "6901' OR 1=1", receipt_date: "2026-11-20" }, "2026-11-20", "2025-10-01").error);
});

test("summarize: นับกลุ่มและแผนตามค่าเริ่มต้น", () => {
  const rows = preview([line({ id: "1", an: "A1", paid_total: "1200.10" }), line({ id: "2", an: "A2", paid_total: "50.00" })], [debt("A1", "1000.00"), debt("A2", "100.00", { an: "A2" })]);
  const s = summarize(rows);
  assert.deepEqual(s.groups.diff, { n: 2, paid: 1250.1, balance: 1100 });
  assert.deepEqual(s.plan, { settle_n: 2, settle_amount: 1250.1, close_n: 1, close_amount: 200.1 });
});

test("REP อปท.: ตัดได้เฉพาะบัญชี .801/.802 แม้หนี้บัญชีอื่น settles_by_stm ; REP ของ scheme ที่ไม่รองรับไม่ตัดอะไร", () => {
  const ds = [opDebt("D1", "300.00", { account_code: "1102050102.801", settles_by_stm: false }), opDebt("D2", "500.00", { settles_by_stm: true })];
  const l = opLine({ id: "719772061", paid_total: "300.00" });
  const [r] = preview([l], repDebts("LGO", ds), [], "OP");
  assert.deepEqual([r.group, r.account_code, r.balance], ["match", "1102050102.801", 300]);
  assert.deepEqual(plan([l], repDebts("LGO", ds)).map((e) => [e.ref, e.kind, e.amount, e.stm_row_id]), [["D1", "settle", "-300.00", "719772061"]]);
  assert.deepEqual(plan([l], repDebts("UCS", ds)), []);
  // บรรทัดที่ตัดแล้ว (REP อุทธรณ์ส่ง tran_id เดิม) ไม่ตัดซ้ำ
  assert.deepEqual(plan([{ ...l, done: true }], repDebts("LGO", ds)), []);
});

test("UC IP แยก CR: ค่าพาหนะ (cr_paid) ตัด .217 ก่อนไม่เกินคงเหลือ ที่เหลือ .202 ; ไม่จ่าย AE = .217 ค้าง ; มีแต่หนี้ CR = แบ่งรอบเดียว", () => {
  const ds = [debt("A1", "9500.00"), debt("A1:CR", "500.00", { account_code: "1102050101.217" })];
  const l = line({ paid_total: "3749.21", cr_paid: "500" });
  const [r] = preview([l], ds);
  assert.deepEqual([r.group, r.balance, r.remaining], ["diff", 10000, 6250.79]);
  assert.deepEqual(plan([l], ds).map((e) => [e.ref, e.account_code, e.amount]), [["A1:CR", "1102050101.217", "-500.00"], ["A1", "1102050101.202", "-3249.21"]]);
  // STM จ่าย AE เกินหนี้ CR: CR ได้เท่าคงเหลือ ส่วนเกินไปหนี้หลัก
  assert.deepEqual(plan([line({ paid_total: "1000", cr_paid: "700" })], ds).map((e) => [e.ref, e.amount]), [["A1:CR", "-500.00"], ["A1", "-500.00"]]);
  // ไม่มี AE: CR ค้าง ; ปิดส่วนต่างปิดทั้งสองหนี้
  const none = plan([line({ paid_total: "3000" })], ds, () => true);
  assert.deepEqual(none.map((e) => [e.ref, e.kind, e.amount]), [["A1", "settle", "-3000.00"], ["A1", "diff", "-6500.00"], ["A1:CR", "diff", "-500.00"]]);
  // หนี้หลักตัดไม่ได้ (เช่น ตัดครบแล้วไม่อยู่) = มีแถว settle เดียวต่อหนี้ CR
  assert.deepEqual(plan([line({ paid_total: "800", cr_paid: "500" })], [ds[1]]).map((e) => [e.ref, e.amount]), [["A1:CR", "-800.00"]]);
});

test("repGate: ตัดด้วย REP ได้เมื่อเงินโอน SMT ของ REP รับแล้วทุกแถว ลงบัญชีลูกหนี้ และยอดรวมตรงยอด REP ระดับสตางค์", () => {
  const agg = (o = {}) => ({ n: 1, pending_n: 0, other_n: 0, total: "53873.81", receipt_no: "40485/61", receipt_date: "2026-11-27", receipts: 1, ...o });
  const fmt = (n) => n.toFixed(2);
  const ok = repGate("53873.81", agg());
  assert.deepEqual([ok.status, ok.receipt], ["ready", { receipt_no: "40485/61", receipt_date: "2026-11-27", receipts: 1 }]);
  assert.equal(repGateReason(ok, fmt), null);
  assert.equal(repGate("100", agg({ n: 0, total: null, receipt_date: null })).status, "none");
  // รับแล้วบางแถว (REP เดียวโอนหลายชุด) = ยังรอ
  assert.equal(repGate("100", agg({ n: 2, pending_n: 1 })).status, "pending");
  assert.equal(repGate("53873.81", agg({ other_n: 1 })).status, "other_account");
  const bad = repGate("1160.00", agg({ total: "-50.00" }));
  assert.equal(bad.status, "mismatch");
  assert.equal(repGateReason(bad, fmt), "ยอดโอน -50.00 บาท ไม่ตรงยอด REP 1160.00 บาท");
  // REP เดียวสองชุดโอน (ยอดบวก + หักติดลบ) รวมแล้วตรง = พร้อม ใช้ใบเสร็จล่าสุด
  const two = repGate("2450.00", agg({ n: 2, total: "2450.00", receipts: 2 }));
  assert.deepEqual([two.status, two.receipt.receipts], ["ready", 2]);
  // REP อุทธรณ์ย้าย tran_id ออกไป ยอด REP เดิมลด = ไม่ตรง ต้องตรวจเอง
  assert.equal(repGate("43700.35", agg({ total: "43950.35" })).status, "mismatch");
});
