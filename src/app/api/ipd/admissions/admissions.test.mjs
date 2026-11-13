// รัน: node --test src/app/api/ipd/admissions/admissions.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { buildRows } from "./admissions.ts";

const FUND = { "89": "UCS", O1: "OFC", S1: "SSS" };
const fundOf = (p) => FUND[p] ?? "UNKNOWN";
const raw = (an, hn, extra = {}) => ({
  an, hn, patient_name: ` name ${an} `, regdate: "2026-10-01", dchdate: "2026-10-03", dchstts: "02", dchstts_name: "Improved", auth_code: " PP0000000001 ", claim_code: "F00000000001", ward_name: "W1", los_days: 2,
  income: "1500.50", uc_money: "1200.00", pttype: "89", pttype_name: "UC", finance_lock: "Y", ipt_summary_status_id: 1,
  summary_status_name: "สรุปแล้ว", pdx: "J189", pdx_name: "Pneumonia", drg: "", rw: "0.8123", adjrw: null,
  days_since_dch: 10, ...extra,
});

test("row shape: numbers parsed, fund from pttype, PDx kept", () => {
  const [r] = buildRows([raw("1", "h1")], [], fundOf);
  assert.equal(r.income, 1500.5);
  assert.equal(r.rw, 0.8123);
  assert.equal(r.adjrw, null);
  assert.equal(r.drg, null);
  assert.equal(r.patient_name, "name 1");
  assert.equal(r.fund, "UCS");
  assert.equal(r.pdx, "J189");
  assert.equal(r.auth_code, "PP0000000001");
  assert.equal(r.claim_code, "F00000000001");
  assert.equal(r.dchstts_name, "Improved");
  const e = buildRows([raw("7", "h", { auth_code: "", claim_code: null, dchstts_name: null })], [], fundOf)[0];
  assert.equal(e.auth_code, null);
  assert.equal(e.claim_code, null);
  assert.equal(buildRows([raw("2", "h", { pttype: "O1" })], [], fundOf)[0].fund, "OFC");
  assert.equal(buildRows([raw("4", "h", { pdx: "", pdx_name: null })], [], fundOf)[0].pdx, null);
});

test("REP only on UCS rows: found = latest, missing = null; other funds have no rep key", () => {
  const reps = [{ an: "1", rep_no: "R1", rep_date: "2026-10-20", status: "c", codes: ["438"] }];
  const rows = buildRows(
    [raw("1", "h", { days_since_dch: 45 }), raw("2", "h", { days_since_dch: 45 }), raw("3", "h", { days_since_dch: 30 }), raw("4", "h", { pttype: "S1", days_since_dch: 45 })],
    reps,
    fundOf,
  );
  assert.deepEqual(rows[0].rep, { rep_no: "R1", rep_date: "2026-10-20", status: "c", codes: ["438"] });
  assert.equal(rows[1].rep, null);
  assert.equal("rep" in rows[3], false);
  // overdue = เกิน 30 วันและยังไม่มี REP ; กองทุนที่ไม่มี REP ดูจากจำนวนวันอย่างเดียว
  assert.deepEqual(rows.map((r) => r.overdue), [false, true, false, true]);
  // โหลด REP ไม่ได้ (reps undefined): แถว UCS ไม่มีสถานะ REP
  assert.equal("rep" in buildRows([raw("5", "h")], undefined, fundOf)[0], false);
  assert.equal(buildRows([raw("6", "h", { days_since_dch: null })], [], fundOf)[0].overdue, false);
});

test("AdjRW amount: rate by discharge date, none before the oldest rate", async () => {
  const { rateFor } = await import("./admissions.ts");
  assert.equal(rateFor("2026-10-01"), 5119);
  assert.equal(rateFor("2026-09-30 10:00:00"), 3505.14);
  assert.equal(rateFor("2025-10-01"), 3505.14);
  assert.equal(rateFor("2025-09-30"), null);
  assert.equal(rateFor(null), null);
  const amount = (dchdate, adjrw) => buildRows([raw("1", "h", { dchdate, adjrw })], [], fundOf)[0].adjrw_amount;
  assert.equal(amount("2026-10-15", "0.9067"), 4641.40); // 0.9067 × 5119 = 4641.3973
  assert.equal(amount("2026-09-15", "1.0000"), 3505.14);
  assert.equal(amount("2025-09-15", "1.0000"), null);
  assert.equal(amount("2026-10-15", null), null);
});
