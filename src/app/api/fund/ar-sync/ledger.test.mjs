// รัน: node --test src/app/api/fund/ar-sync/ledger.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { LEDGER_START, accountFor, chunkRange, dailyWindows, monthRange, parseCase, planCancels, planIpd, planOpd, toCents } from "./ledger.ts";

const rules = {
  maps: [
    { hipdata_code: "UCS", pttype: null, patient_type: "IP", account_code: "1102050101.202" },
    { hipdata_code: "SSS", pttype: null, patient_type: "OP", account_code: "1102050101.301" },
    { hipdata_code: null, pttype: "89", patient_type: "OP", account_code: "1102050101.209" },
  ],
  cup: new Set(["07526"]),
};
const cov = (o) => ({ patient_type: "OP", pttype: "10", hipdata_code: "UCS", hospmain: null, hospmain_chwpart: null, ...o });

test("accountFor: pttype override > UCS OP by hospmain > fund map > null", () => {
  assert.equal(accountFor(cov({ hospmain: "11252" }), rules), "1102050101.201");
  assert.equal(accountFor(cov({ hospmain: "07526", hospmain_chwpart: "64" }), rules), "1102050101.201");
  assert.equal(accountFor(cov({ hospmain: "10676", hospmain_chwpart: "65" }), rules), "1102050101.203");
  assert.equal(accountFor(cov({ hospmain: "10676", hospmain_chwpart: "64" }), rules), "1102050101.204");
  assert.equal(accountFor(cov({ hospmain: "10676" }), rules), null);
  for (const h of ["14972", "11517", "41429"]) assert.equal(accountFor(cov({ hospmain: h, hospmain_chwpart: "65" }), rules), "1102050102.201");
  assert.equal(accountFor(cov({ hospmain: "41429" }), rules), "1102050102.201");
  assert.equal(accountFor(cov({}), rules), null);
  assert.equal(accountFor(cov({ pttype: "89", hospmain: "11252" }), rules), "1102050101.209");
  assert.equal(accountFor(cov({ patient_type: "IP" }), rules), "1102050101.202");
  assert.equal(accountFor(cov({ hipdata_code: "SSS" }), rules), "1102050101.301");
  assert.equal(accountFor(cov({ hipdata_code: "SSS", patient_type: "IP" }), rules), null);
  assert.equal(accountFor(cov({ hipdata_code: null }), rules), null);
});

const debt = (id, amount, o = {}) => ({
  debt_id: id, vn: `6810010000${id}`, debt_date: "2025-10-02", vstdate: "2025-10-02", pttype: "10", hipdata_code: "SSS", amount, hospmain: "", hospmain_chwpart: null, ...o,
});
const state = (ref, balance, o = {}) => ({
  source: "rcpt_debt", ref, vn: `vn${ref}`, an: null, ref_date: "2025-10-02", patient_type: "OP", pttype: "10", hipdata_code: "SSS",
  hospmain: null, hospmain_chwpart: null, account_code: "1102050101.301", balance, cancelled: false, ...o,
});

test("planOpd: set on debt_date, adjust by difference on sync date, idempotent, skips zero/cancelled/duplicates", () => {
  const states = new Map([["2", state("2", 10000)], ["3", state("3", 5000)], ["4", state("4", 7000, { cancelled: true })]]);
  const out = planOpd(
    [debt(1, 123.456), debt(1, 123.456), debt(2, 120), debt(3, 50), debt(4, 99), debt(5, 0)],
    states, rules, "2025-11-09",
  );
  assert.deepEqual(out.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), [
    ["set", "1", "123.46", "2025-10-02"],
    ["adjust", "2", "20.00", "2025-11-09"],
  ]);
  assert.equal(out[0].account_code, "1102050101.301");
  assert.equal(out[0].hospmain, null); // '' -> null
  assert.equal(out[1].account_code, "1102050101.301"); // คัดลอกจากแถว set
});

test("planOpd set: dated by service date, falls back to debt_date, entry_date clamped to LEDGER_START", () => {
  const set = (o) => planOpd([debt(1, 10, o)], new Map(), rules, "2026-11-09")[0];
  const later = set({ vstdate: "2026-10-20", debt_date: "2026-11-02 08:00:00" });
  assert.deepEqual([later.ref_date, later.entry_date], ["2026-10-20", "2026-10-20"]);
  const noOvst = set({ vstdate: null, debt_date: "2026-11-02 08:00:00" });
  assert.deepEqual([noOvst.ref_date, noOvst.entry_date], ["2026-11-02", "2026-11-02"]);
  // หนี้ตั้งในช่วงสมุด แต่รับบริการก่อนวันเริ่มสมุด: ref_date คงวันจริง entry_date = LEDGER_START
  const early = set({ vstdate: "2025-09-28", debt_date: "2025-10-03" });
  assert.deepEqual([early.ref_date, early.entry_date], ["2025-09-28", LEDGER_START]);
});

test("planCancels: minus the ledger balance on cancel date, skip never-set, dedupe", () => {
  const states = new Map([["2", state("2", 12000)], ["4", state("4", 7000, { cancelled: true })]]);
  const { entries, skipped } = planCancels(
    [
      { debt_id: 2, cancel_datetime: "2025-10-05 10:00:00" },
      { debt_id: 2, cancel_datetime: "2025-10-06 10:00:00" },
      { debt_id: 4, cancel_datetime: "2025-10-06 10:00:00" },
      { debt_id: 9, cancel_datetime: "2025-10-06 10:00:00" },
    ],
    states,
  );
  assert.deepEqual(entries.map((e) => [e.kind, e.ref, e.amount, e.entry_date, e.ref_date]), [["cancel", "2", "-120.00", "2025-10-05", "2025-10-02"]]);
  assert.equal(skipped, 1);
});

const ipd = (an, uc_money, o = {}) => ({ an, dchdate: "2025-10-03", pttype: "10", hipdata_code: "UCS", uc_money, ...o });
const ist = (an, balance, ref_date = "2025-10-03") => ({ ...state(an, balance), source: "ipt", ref: an, vn: null, an, ref_date, patient_type: "IP", account_code: "1102050101.202" });

test("planIpd: set on dchdate, adjust/reverse on sync date, re-lock, reverse only inside the window", () => {
  const w = { from: "2025-10-01", to: "2025-10-31" };
  const states = new Map([
    ["A2", ist("A2", 10000)], // ยอดเปลี่ยน
    ["A3", ist("A3", 0)], // เคยกลับรายการ แล้วปิดสิทธิอีกครั้ง
    ["A4", ist("A4", 5000)], // finance_lock กลับเป็น N
    ["A5", ist("A5", 5000, "2025-12-01")], // นอก window: ไม่แตะ
    ["A6", ist("A6", 0)], // กลับรายการแล้ว: ไม่ซ้ำ
  ]);
  const rows = [ipd("A1", "1000.50"), ipd("A2", 150), ipd("A3", 80), ipd("A7", 0)];
  const back = planIpd(rows, states, rules, w, "2026-11-09");
  assert.deepEqual(back.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), [
    ["set", "A1", "1000.50", "2025-10-03"],
    ["adjust", "A2", "50.00", "2026-11-09"],
    ["adjust", "A3", "80.00", "2026-11-09"],
    ["reverse", "A4", "-50.00", "2026-11-09"],
  ]);
  assert.equal(back[0].account_code, "1102050101.202");
  assert.equal(back[0].ref_date, "2025-10-03");
});

test("date windows: ≤31-day chunks, daily windows clamp to ledger start, month range", () => {
  assert.deepEqual(chunkRange("2026-07-13", "2026-11-09").map((c) => c.from), ["2026-07-13", "2026-08-13", "2026-09-13", "2026-10-14"]);
  assert.equal(chunkRange("2026-07-13", "2026-11-09").at(-1).to, "2026-11-09");
  assert.deepEqual(chunkRange("2026-01-02", "2026-01-01"), []);
  assert.deepEqual(dailyWindows("2026-11-09", "2026-11-01"), {
    opd: { from: "2026-10-27", to: "2026-11-09" },
    cancel: { from: "2026-10-31", to: "2026-11-09" },
    ipd: { from: "2026-07-13", to: "2026-11-09" },
  });
  assert.deepEqual(dailyWindows("2025-10-05", null).ipd, { from: "2025-10-01", to: "2025-10-05" });
  assert.deepEqual(monthRange("2026-02", "2026-11-09"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthRange("2026-11", "2026-11-09"), { from: "2026-11-01", to: "2026-11-09" });
  assert.deepEqual(monthRange("2025-12", "2026-11-09"), { from: "2025-12-01", to: "2025-12-31" });
  assert.equal(monthRange("2025-09", "2026-11-09"), null);
  assert.equal(monthRange("2026-12", "2026-11-09"), null);
  assert.equal(monthRange("2026-13", "2026-11-09"), null);
});

test("parseCase: vn 12 digits or an 9–12 digits, exactly one", () => {
  assert.deepEqual(parseCase({ vn: "690511062430" }), { vn: "690511062430" });
  assert.deepEqual(parseCase({ an: "690001234" }), { an: "690001234" });
  for (const bad of [null, {}, { vn: "690511062430", an: "690001234" }, { vn: "69051106243" }, { vn: 690511062430 }, { an: "69000123x" }, { an: "6900012" }, { vn: "' OR 1=1" }])
    assert.ok("error" in parseCase(bad), JSON.stringify(bad));
});

// จำลอง ledger หลัง INSERT: ใช้ตรวจว่ากดดึงใหม่ซ้ำแล้วไม่ได้รายการเพิ่ม
const applied = (states, entries) => {
  const next = new Map([...states].map(([k, v]) => [k, { ...v }]));
  for (const e of entries) {
    const s = next.get(e.ref);
    if (e.kind === "set") next.set(e.ref, { ...e, balance: toCents(e.amount), cancelled: false });
    else Object.assign(s, { balance: s.balance + toCents(e.amount), cancelled: s.cancelled || e.kind === "cancel" });
  }
  return next;
};

test("case resync OPD: set then cancel in one run, adjust on change, second run books nothing", () => {
  const today = "2026-11-15";
  // VN มีหนี้ 2 ใบ: ใบ 2 ยอดเปลี่ยน (ยังไม่เคยลงยกเลิก), ใบ 7 ยังไม่เคยตั้งและถูกยกเลิกแล้ว (H1 ไม่คืนแถว ABORT แต่ H2 คืน)
  const debts = [debt(2, 150), debt(7, 80)];
  const cancels = [{ debt_id: 7, cancel_datetime: "2026-11-14 09:00:00" }];
  let states = new Map([["2", state("2", 10000)]]);
  const opd = planOpd(debts, states, rules, today);
  assert.deepEqual(opd.map((e) => [e.kind, e.ref, e.amount]), [["adjust", "2", "50.00"], ["set", "7", "80.00"]]);
  states = applied(states, opd);
  const { entries } = planCancels(cancels, states);
  assert.deepEqual(entries.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), [["cancel", "7", "-80.00", "2026-11-14"]]);
  states = applied(states, entries);
  assert.deepEqual(planOpd(debts, states, rules, today), []);
  assert.deepEqual(planCancels(cancels, states).entries, []);
});

test("case resync IPD: whole-ledger window reverses an old AN whose finance_lock is no longer Y, once", () => {
  const today = "2026-11-15";
  const w = { from: LEDGER_START, to: today };
  // จำหน่ายเกิน 120 วัน รายวันไม่เห็นแล้ว ; his ไม่คืนแถว (finance_lock <> 'Y') states มาจาก [an]
  let states = new Map([["A9", ist("A9", 5000, "2026-01-02")]]);
  const out = planIpd([], states, rules, w, today);
  assert.deepEqual(out.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), [["reverse", "A9", "-50.00", today]]);
  states = applied(states, out);
  assert.deepEqual(planIpd([], states, rules, w, today), []);
  // ปิดสิทธิอีกครั้งด้วยยอดใหม่ แล้วกดซ้ำ
  const rows = [ipd("A9", 70, { dchdate: "2026-01-02" })];
  const again = planIpd(rows, states, rules, w, today);
  assert.deepEqual(again.map((e) => [e.kind, e.amount]), [["adjust", "70.00"]]);
  assert.deepEqual(planIpd(rows, applied(states, again), rules, w, today), []);
});
