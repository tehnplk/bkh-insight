// รัน: node --test src/app/api/ipd/admissions/admissions.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { buildRows, parseAdjrw, pdxMissing, repFilterValues } from "./admissions.ts";

const FUND = { "89": "UCS", O1: "OFC", S1: "SSS" };
const fundOf = (p) => FUND[p] ?? "UNKNOWN";
const raw = (an, hn, extra = {}) => ({
  an, hn, patient_name: ` name ${an} `, regdate: "2026-10-01", dchdate: "2026-10-03", dchstts: "02", dchstts_name: "Improved", auth_code: " PP0000000001 ", claim_code: "F00000000001", ward: "01", ward_name: "W1", los_days: 2,
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

test("REP: found = latest on any fund, missing = null only on UCS; other funds without REP have no rep key", () => {
  const reps = [
    { an: "1", rep_no: "R1", rep_date: "2026-10-20", status: "c", codes: ["438"] },
    { an: "5", rep_no: "R5", rep_date: "2026-10-21", status: "pass", codes: [] },
  ];
  const rows = buildRows(
    [
      raw("1", "h", { days_since_dch: 45 }), raw("2", "h", { days_since_dch: 45 }), raw("3", "h", { days_since_dch: 30 }),
      raw("4", "h", { pttype: "S1", days_since_dch: 45 }), raw("5", "h", { pttype: "O1", days_since_dch: 45 }),
    ],
    reps,
    fundOf,
  );
  assert.deepEqual(rows[0].rep, { rep_no: "R1", rep_date: "2026-10-20", status: "c", codes: ["438"] });
  assert.equal(rows[1].rep, null);
  assert.equal("rep" in rows[3], false);
  assert.equal(rows[4].rep.rep_no, "R5");
  // overdue = เกิน 30 วันและยังไม่มี REP ; กองทุนที่ไม่มีสถานะ REP ดูจากจำนวนวันอย่างเดียว
  assert.deepEqual(rows.map((r) => r.overdue), [false, true, false, true, false]);
  // โหลด REP ไม่ได้ (reps undefined): แถว UCS ไม่มีสถานะ REP
  assert.equal("rep" in buildRows([raw("8", "h")], undefined, fundOf)[0], false);
  assert.equal(buildRows([raw("6", "h", { days_since_dch: null })], [], fundOf)[0].overdue, false);
});

test("AdjRW amount: UC only, rate by discharge date and out-of-province hospmain", async () => {
  const { rateFor } = await import("./admissions.ts");
  // ขอบช่วง
  assert.equal(rateFor("2026-09-16", true, false), 5100);
  assert.equal(rateFor("2026-09-16", true, true), 9680);
  assert.equal(rateFor("2026-09-15 23:59:59", true, false), 3505.14);
  assert.equal(rateFor("2026-09-15", true, true), 9600);
  assert.equal(rateFor("2025-10-01", true, false), 3505.14);
  assert.equal(rateFor("2025-10-01", true, true), 9600);
  assert.equal(rateFor("2025-09-30", true, false), null);
  assert.equal(rateFor("2025-09-30", true, true), null);
  assert.equal(rateFor(null, true, false), null);
  // ไม่ใช่ UC = ไม่คิดยอดทุกช่วง
  assert.equal(rateFor("2026-10-15", false, false), null);
  assert.equal(rateFor("2026-01-15", false, true), null);

  const FUNDS = { ...FUND, W1: "WEL", D1: "DIS" };
  const amount = (extra) => buildRows([raw("1", "h", extra)], [], (p) => FUNDS[p] ?? "UNKNOWN")[0].adjrw_amount;
  assert.equal(amount({ dchdate: "2026-10-15", adjrw: "0.9067", out_prov: 0 }), 4624.17); // 0.9067 × 5100 = 4624.17
  assert.equal(amount({ dchdate: "2026-10-15", adjrw: "0.9067", out_prov: "1" }), 8776.86); // × 9680 = 8776.856
  assert.equal(amount({ dchdate: "2026-09-15", adjrw: "1.0000", out_prov: 0 }), 3505.14);
  assert.equal(amount({ dchdate: "2026-09-15", adjrw: "1.0000", out_prov: 1 }), 9600);
  assert.equal(amount({ dchdate: "2026-10-15", adjrw: "1.0000", pttype: "W1" }), 5100);
  assert.equal(amount({ dchdate: "2026-10-15", adjrw: "1.0000", pttype: "D1" }), 5100);
  assert.equal(amount({ dchdate: "2026-10-15", adjrw: "1.0000", pttype: "O1" }), null);
  assert.equal(amount({ dchdate: "2026-10-15", adjrw: "1.0000", pttype: "S1", out_prov: 1 }), null);
  assert.equal(amount({ dchdate: "2025-09-15", adjrw: "1.0000" }), null);
  assert.equal(amount({ dchdate: "2026-10-15", adjrw: null }), null);
});

test("rateCase: SQL params follow placeholders, built from ADJRW_RATES/UC_HIPDATA", async () => {
  const { rateCase } = await import("./admissions.ts");
  const { sql, params } = rateCase("OP");
  assert.equal(sql.split("?").length - 1, params.length);
  assert.deepEqual(params, ["UCS", "WEL", "DIS", "2026-09-16", 9680, 5100, "2025-10-01", 9600, 3505.14]);
  assert.equal(
    sql.replace(/\s+/g, " "),
    "CASE WHEN t.hipdata_code IN (?, ?, ?) THEN CASE WHEN i.dchdate >= ? THEN IF(OP, ?, ?) WHEN i.dchdate >= ? THEN IF(OP, ?, ?) END END",
  );
});

test("REP header filter value: latest status on any fund, none only on UCS, blank for other funds without REP", () => {
  const vals = repFilterValues(
    [{ k: "1", pttype: "89" }, { k: "2", pttype: "O1" }, { k: "3", pttype: "89" }, { k: "4", pttype: "O1" }, { k: "5", pttype: null }],
    new Map([["1", "c"], ["2", "pass"]]),
    fundOf,
  );
  assert.deepEqual(vals.map((r) => r.v), ["c", "pass", "none", "", ""]);
});

test("missing PDx: pending within 7 days after discharge, late after (or no discharge date)", () => {
  assert.deepEqual([0, 7, 8, 30, null].map(pdxMissing), ["pending", "pending", "late", "late", "late"]);
});

test("AdjRW range: blank = no bound, one side allowed, invalid on non-number / out of 0–100 / min > max", () => {
  assert.deepEqual(parseAdjrw(null, ""), { min: null, max: null });
  assert.deepEqual(parseAdjrw(" 4 ", null), { min: 4, max: null });
  assert.deepEqual(parseAdjrw("0.5", "2"), { min: 0.5, max: 2 });
  assert.deepEqual(parseAdjrw("2", "2"), { min: 2, max: 2 });
  assert.deepEqual(parseAdjrw("0", "100"), { min: 0, max: 100 });
  for (const [lo, hi] of [["abc", ""], ["-1", ""], ["", "100.1"], ["3", "1"], ["Infinity", ""], ["1,5", ""]]) assert.equal(parseAdjrw(lo, hi), "invalid", `${lo}..${hi}`);
});
