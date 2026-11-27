// รัน: node --test src/app/api/fund/ar-capitation/capitation.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { capBlock, fyStartOf, planCapitation, poolAvailable } from "./capitation.ts";

const debt = (ref, ref_date, balance, o = {}) => ({
  ref, vn: `v${ref}`, an: null, patient_type: "OP", ref_date, pttype: "89", hipdata_code: "UCS", hospmain: "10709", hospmain_chwpart: "65",
  hospmain_type: "5", account_code: "1102050101.201", balance, ...o,
});
const FROM = "2026-10-01", END = "2026-10-31";

test("ตัดตามวันที่ตั้งหนี้แล้ว ref ; หนี้สุดท้ายที่ pool ไม่พอตัดบางส่วน ที่เหลือลง diff", () => {
  const p = planCapitation([debt("3", "2026-10-05", "100"), debt("2", "2026-10-02", "300.50"), debt("1", "2026-10-05", "200")], "450.50", FROM, END);
  assert.deepEqual(p.rows.map((r) => [r.ref, r.settle, r.diff]), [["2", 300.5, 0], ["1", 150, 50], ["3", 0, 100]]);
  assert.deepEqual(p.entries.map((e) => [e.ref, e.kind, e.amount, e.entry_date, e.source]), [
    ["2", "settle", "-300.50", END, "capitation"],
    ["1", "settle", "-150.00", END, "capitation"],
    ["1", "diff", "-50.00", END, "capitation"],
    ["3", "diff", "-100.00", END, "capitation"],
  ]);
  assert.equal(p.entries[0].balance, undefined);
  assert.equal(p.entries[0].account_code, "1102050101.201");
  assert.deepEqual([p.pool_before, p.pool_after], [450.5, 0]);
  assert.deepEqual(p.totals, { n: 3, balance: 600.5, settle: 450.5, diff: 150, settle_n: 2, diff_n: 2 });
});

test("pool เกินหนี้: ตัดครบ ไม่มี diff เงินเหลือคงไว้", () => {
  const p = planCapitation([debt("1", "2026-10-01", "10")], "100", FROM, END);
  assert.deepEqual(p.entries.map((e) => e.kind), ["settle"]);
  assert.equal(p.pool_after, 90);
});

test("pool 0 หรือติดลบ: ทุกรายลง diff", () => {
  for (const pool of ["0", "-50"]) {
    const p = planCapitation([debt("1", "2026-10-01", "10"), debt("2", "2026-10-02", "5")], pool, FROM, END);
    assert.deepEqual(p.entries.map((e) => [e.kind, e.amount]), [["diff", "-10.00"], ["diff", "-5.00"]]);
    assert.deepEqual([p.pool_before, p.pool_after], [0, 0]);
  }
});

test("ข้ามหนี้คงเหลือ ≤ 0 (ตัดแล้ว) และหนี้นอกปีงบ/หลังสิ้นเดือน ; ตัดครบแล้วไม่มีรายการ", () => {
  const p = planCapitation([
    debt("1", "2026-10-03", "0"), debt("2", "2026-10-03", "-20"), debt("3", "2026-09-30", "50"), debt("4", "2026-11-01", "50"), debt("5", null, "50"),
  ], "1000", FROM, END);
  assert.deepEqual(p.rows, []);
  assert.deepEqual(p.entries, []);
  assert.equal(p.pool_after, 1000);
});

test("ปีงบและ pool คงเหลือ", () => {
  assert.equal(fyStartOf("2026-10"), "2026-10-01");
  assert.equal(fyStartOf("2026-09"), "2025-10-01");
  assert.equal(fyStartOf("2027-01"), "2026-10-01");
  assert.equal(poolAvailable("7245901.67", "1000.10"), 7244901.57);
  assert.equal(poolAvailable("100", "150"), 0);
});

test("capBlock: มีเงินโอนรอออกใบเสร็จ = ยืนยันไม่ได้ (ก่อนเหตุอื่นของบัญชี) ; ไม่มีเหตุ = null", () => {
  const ok = { ended: true, month: "2026-10", through: "2026-09", code: "1102050101.201", clear_code: "4301020105.214", clear_short_code: "4301020104.229", pending_n: 0, entries: 5 };
  assert.equal(capBlock(ok), null);
  assert.match(capBlock({ ...ok, pending_n: 3 }), /4301020105\.214 รอออกใบเสร็จ 3 รายการ/);
  assert.match(capBlock({ ...ok, pending_n: 1, clear_short_code: null, entries: 0 }), /รอออกใบเสร็จ/);
  assert.equal(capBlock({ ...ok, ended: false, pending_n: 1 }), "ยืนยันได้เมื่อจบเดือนแล้ว");
  assert.match(capBlock({ ...ok, through: "2026-10", pending_n: 1 }), /ปิดแล้ว/);
  assert.match(capBlock({ ...ok, clear_short_code: null }), /ยังไม่กำหนดบัญชีส่วนต่าง/);
  assert.equal(capBlock({ ...ok, entries: 0 }), "ไม่มีหนี้คงเหลือที่ต้องตัด");
});
