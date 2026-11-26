// รัน: node --test src/app/api/fund/stm-trend/trend.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { GROUPS, fiscalMonths, fundBars, fundTable, groupOf, groupTrend } from "./trend.ts";

const months = fiscalMonths(2569);
const ucIp = groupOf("uc-ip");
const row = (period_month, extra = {}) => ({
  period_month, scheme: "UCS", patient_type: "IP", files: 1, paid_all: null, claim_normal: null, claim_claimable: null, paid_claimable: null,
  cases: null, rw_all: null, rw_drg: null, drg_amount: null, first_run_no: 1, lag_first_days: null, lag_avg_days: null, lag_max_days: null, ...extra,
});

test("fiscalMonths: ต.ค. ปีก่อนถึง ก.ย. ; groupOf ค่าที่ไม่รู้จัก = กลุ่มแรก", () => {
  assert.equal(months.length, 12);
  assert.equal(months[0], "2025-10");
  assert.equal(months[11], "2026-09");
  assert.equal(groupOf("x"), GROUPS[0]);
});

test("groupTrend: เติม 12 เดือน เดือนไม่มีไฟล์ = null, หารศูนย์ = null, ยอดทั้งปีหารจากผลรวม", () => {
  const t = groupTrend(
    [
      row("2025-10-01", { paid_all: 50, claim_normal: 100, cases: 2, rw_all: 2, rw_drg: 1, drg_amount: 8000, lag_first_days: 30 }),
      row("2025-11-01", { paid_all: 30, claim_normal: 0, cases: 0, rw_all: 0, lag_first_days: 20 }),
      row("2025-10-01", { scheme: "OFC", paid_all: 999 }),
    ],
    ucIp,
    months,
  );
  assert.deepEqual(t.paid.slice(0, 3), [50, 30, null]);
  assert.deepEqual(t.rate.slice(0, 3), [0.5, null, null]);
  assert.deepEqual(t.bahtPerRw.slice(0, 2), [8000, null]);
  assert.deepEqual(t.cmi.slice(0, 2), [1, null]);
  assert.deepEqual(t.lag.slice(0, 3), [30, 20, null]);
  assert.equal(t.total.paid, 80);
  assert.equal(t.total.rate, 0.5); // เดือนที่ไม่มียอดเรียกเก็บไม่นับในอัตรา
  assert.equal(t.total.cmi, 1);
  assert.equal(t.lagImported, false); // มีแค่ 2 เดือน
});

test("groupTrend: ไม่มีข้อมูลเลย = null ทุกค่า", () => {
  const t = groupTrend([], ucIp, months);
  assert.ok(t.paid.every((v) => v === null));
  assert.deepEqual(t.total, { paid: null, rate: null, bahtPerRw: null, cmi: null });
});

test("lagImported: วันที่ STM งวดแรกทุกเดือนเป็นวันเดียวกัน = วันนำเข้า ; วันโอนกระจายตามเดือน = ไม่เตือน", () => {
  // สิ้นเดือน + lag = 2026-10-02 ทุกเดือน (ต.ค. 31 + 336, พ.ย. 30 + 306, ธ.ค. 31 + 275)
  const imported = groupTrend([row("2025-10-01", { lag_first_days: 336 }), row("2025-11-01", { lag_first_days: 306 }), row("2025-12-01", { lag_first_days: 275 })], ucIp, months);
  assert.equal(imported.lagImported, true);
  const real = groupTrend([row("2025-10-01", { lag_first_days: 40 }), row("2025-11-01", { lag_first_days: 42 }), row("2025-12-01", { lag_first_days: 38 })], ucIp, months);
  assert.equal(real.lagImported, false);
});

test("fundBars: สีผูกกับกองทุนไม่ใช่อันดับ, key ไม่รู้จักรวมเป็นอื่นๆ, กองทุนไม่มียอดไม่แสดง, ค่าติดลบตัดเป็น 0", () => {
  const f = (period_month, fund, amount, scheme = "UCS") => ({ period_month, scheme, patient_type: "IP", fund, amount });
  const { funds, values, others } = fundBars(
    [f("2025-10-01", "INST", 10), f("2025-10-01", "VA", 3), f("2025-10-01", "COVID", 2), f("2025-11-01", "INST", -4), f("2025-10-01", "CARE", 7, "OFC"), f("2025-10-01", "IP", 0)],
    ucIp,
    months,
  );
  assert.deepEqual(funds, [{ key: "INST", color: "--chart-3" }, { key: "OTHER", color: "--chart-other" }]);
  assert.deepEqual(values[0], [10, 5]);
  assert.deepEqual(others, ["COVID", "VA"]);
  assert.deepEqual(values[1], [0, 0]);
  assert.deepEqual(values[2], [0, 0]);
  const ofc = fundBars([f("2025-10-01", "CARE", 7, "OFC")], groupOf("ofc-ip"), months);
  assert.deepEqual(ofc.funds, [{ key: "CARE", color: "--chart-1" }]);
});

test("fundBars: UC OP ใช้รายการกองทุนของตัวเอง (OP/PALLIATIVE ไม่ตกไปอื่นๆ) ไม่ปนกับ UC IP", () => {
  const f = (fund, amount, patient_type = "OP") => ({ period_month: "2025-10-01", scheme: "UCS", patient_type, fund, amount });
  const op = fundBars([f("INST", 1), f("OP", 2), f("PALLIATIVE", 3), f("HC", 4), f("IP", 9, "IP")], groupOf("uc-op"), months);
  assert.deepEqual(op.funds, [
    { key: "INST", color: "--chart-1" },
    { key: "OP", color: "--chart-6" },
    { key: "PALLIATIVE", color: "--chart-7" },
    { key: "OTHER", color: "--chart-other" },
  ]);
  assert.deepEqual(op.others, ["HC"]);
  const ip = fundBars([f("INST", 1, "IP")], ucIp, months);
  assert.deepEqual(ip.funds, [{ key: "INST", color: "--chart-3" }]); // สีของ UC IP คงเดิม
});

test("groupTrend: UC OP อัตรา = paid_claimable ÷ claim_claimable ; กลุ่มอื่นยังใช้ paid_all ÷ claim_normal", () => {
  const op = (period_month, extra) => row(period_month, { patient_type: "OP", ...extra });
  const t = groupTrend(
    [
      op("2025-10-01", { paid_all: 500, claim_normal: 10000, paid_claimable: 20, claim_claimable: 100 }),
      op("2025-11-01", { paid_all: 500, claim_normal: 10000, paid_claimable: 30, claim_claimable: 200 }),
      op("2025-12-01", { paid_all: 500, claim_normal: 10000, paid_claimable: 5, claim_claimable: null }),
    ],
    groupOf("uc-op"),
    months,
  );
  assert.deepEqual(t.rate.slice(0, 3), [0.2, 0.15, null]);
  assert.equal(t.total.rate, 50 / 300); // รวมก่อนหาร ไม่นับเดือนที่ไม่มียอดเรียกเก็บ
  assert.equal(t.total.paid, 1500); // ยอดชดเชยยังเป็น paid_all
  const ip = groupTrend([row("2025-10-01", { paid_all: 50, claim_normal: 100, paid_claimable: 1, claim_claimable: 1 })], ucIp, months);
  assert.equal(ip.total.rate, 0.5);
});

test("fundTable: กองทุนชุดเดียวกับ fundBars, แถวรวม = ผลรวมกองทุน, เดือนไม่มีไฟล์ = null, ค่าติดลบคงไว้", () => {
  const f = (period_month, fund, amount, scheme = "UCS") => ({ period_month, scheme, patient_type: "IP", fund, amount });
  const funds = [f("2025-10-01", "IP", 100), f("2025-10-01", "INST", 20), f("2025-10-01", "VA", 5), f("2025-11-01", "IP", -10), f("2025-10-01", "CARE", 7, "OFC")];
  const t = fundTable({ funds, months: [row("2025-10-01"), row("2025-11-01"), row("2025-12-01", { scheme: "OFC" })] }, ucIp, months);
  assert.deepEqual(t.funds.map((r) => r.key), fundBars(funds, ucIp, months).funds.map((r) => r.key));
  assert.deepEqual(t.funds.map((r) => r.key), ["IP", "INST", "OTHER"]);
  assert.deepEqual(t.funds[0].values.slice(0, 3), [100, -10, null]); // ธ.ค. มีแต่ไฟล์ OFC = ไม่มีไฟล์ของกลุ่ม
  assert.deepEqual(t.funds[1].values.slice(0, 2), [20, 0]); // มีไฟล์แต่กองทุนไม่มียอด = 0
  assert.deepEqual(t.total.values.slice(0, 3), [125, -10, null]);
  assert.ok(t.total.values.slice(2).every((v) => v === null));
  assert.equal(t.total.total, 115);
  assert.equal(t.funds.reduce((s, r) => s + r.total, 0), t.total.total);
  assert.equal(t.funds[0].share, 90 / 115);
  assert.deepEqual(t.others, ["VA"]);
  const empty = fundTable({ funds: [], months: [] }, ucIp, months);
  assert.deepEqual(empty.funds, []);
  assert.equal(empty.total.total, 0);
});
