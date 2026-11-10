// รัน: node --test src/app/api/fund/ar-sync/ledger.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { accountFor, chunkRange, dailyWindows, monthRange, planCancels, planIpd, planOpd } from "./ledger.ts";

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
  assert.equal(accountFor(cov({}), rules), null);
  assert.equal(accountFor(cov({ pttype: "89", hospmain: "11252" }), rules), "1102050101.209");
  assert.equal(accountFor(cov({ patient_type: "IP" }), rules), "1102050101.202");
  assert.equal(accountFor(cov({ hipdata_code: "SSS" }), rules), "1102050101.301");
  assert.equal(accountFor(cov({ hipdata_code: "SSS", patient_type: "IP" }), rules), null);
  assert.equal(accountFor(cov({ hipdata_code: null }), rules), null);
});

const debt = (id, amount, o = {}) => ({
  debt_id: id, vn: `6810010000${id}`, debt_date: "2025-10-02", pttype: "10", hipdata_code: "SSS", amount, hospmain: "", hospmain_chwpart: null, ...o,
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
  assert.deepEqual(entries.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), [["cancel", "2", "-120.00", "2025-10-05"]]);
  assert.equal(skipped, 1);
});

const ipd = (an, uc_money, o = {}) => ({ an, dchdate: "2025-10-03", pttype: "10", hipdata_code: "UCS", uc_money, ...o });
const ist = (an, balance, ref_date = "2025-10-03") => ({ ...state(an, balance), source: "ipt", ref: an, vn: null, an, ref_date, patient_type: "IP", account_code: "1102050101.202" });

test("planIpd: set date by mode, adjust, re-lock, reverse only inside the window", () => {
  const w = { from: "2025-10-01", to: "2025-10-31" };
  const states = new Map([
    ["A2", ist("A2", 10000)], // ยอดเปลี่ยน
    ["A3", ist("A3", 0)], // เคยกลับรายการ แล้วปิดสิทธิ์อีกครั้ง
    ["A4", ist("A4", 5000)], // finance_lock กลับเป็น N
    ["A5", ist("A5", 5000, "2025-12-01")], // นอก window: ไม่แตะ
    ["A6", ist("A6", 0)], // กลับรายการแล้ว: ไม่ซ้ำ
  ]);
  const rows = [ipd("A1", "1000.50"), ipd("A2", 150), ipd("A3", 80), ipd("A7", 0)];
  const back = planIpd(rows, states, rules, w, "backfill", "2026-11-09");
  assert.deepEqual(back.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), [
    ["set", "A1", "1000.50", "2025-10-03"],
    ["adjust", "A2", "50.00", "2026-11-09"],
    ["adjust", "A3", "80.00", "2026-11-09"],
    ["reverse", "A4", "-50.00", "2026-11-09"],
  ]);
  assert.equal(back[0].account_code, "1102050101.202");
  assert.equal(planIpd(rows.slice(0, 1), new Map(), rules, w, "daily", "2026-11-09")[0].entry_date, "2026-11-09");
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
