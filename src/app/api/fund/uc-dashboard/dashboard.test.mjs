// รัน: node --test src/app/api/fund/uc-dashboard/dashboard.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { mergeDebtors } from "../uc-debtor/debtor.ts";
import { aggregate, fiscalMonths, fiscalYearOf, fiscalYearRange, parseFiscalYear } from "./dashboard.ts";

test("fiscal year: Oct starts the next BE year, current FY ends today, fy param validated", () => {
  assert.equal(fiscalYearOf("2025-10-01"), 2569);
  assert.equal(fiscalYearOf("2026-09-30"), 2569);
  assert.equal(fiscalYearOf("2026-11-09"), 2570);
  assert.deepEqual(fiscalYearRange(2569, "2026-11-09"), { start: "2025-10-01", end: "2026-09-30" });
  assert.deepEqual(fiscalYearRange(2570, "2026-11-09"), { start: "2026-10-01", end: "2026-11-09" });
  assert.deepEqual([fiscalMonths(2569)[0], fiscalMonths(2569)[2], fiscalMonths(2569)[3], fiscalMonths(2569)[11]], ["2025-10", "2025-12", "2026-01", "2026-09"]);
  assert.equal(parseFiscalYear("2569", 2570), 2569);
  assert.equal(parseFiscalYear("2566", 2570), 2566);
  for (const bad of ["2565", "2571", "25.69", "2569x", "", "-2569"]) assert.equal(parseFiscalYear(bad, 2570), null, bad);
});

const d = (key, date, debtor) => ({ key, date, debtor });
const rep = (key, comp, error_codes = []) => ({ key, rep_no: "", net_nhso: comp, net_affiliation: null, error_codes });

test("totals, months, aging of no-REP rows and error ranking (multi-code visit counted under each code)", () => {
  const opd = mergeDebtors(
    [d("1", "2025-10-05", 100.1), d("2", "2025-10-20", 200.2), d("3", "2026-08-01", 50), d("4", "2026-09-25", 10), d("5", "2026-01-10", 30)],
    [rep("1", "90.05"), rep("2", "0", ["305", "514"]), rep("5", "0", ["305", "305"])],
  );
  const ipd = mergeDebtors([d("A", "2026-09-30", 1000)], [rep("A", "800", ["514"])]);
  const r = aggregate({ opd, ipd }, 2569, "2026-11-09");

  assert.deepEqual(r.totals.opd.paid, { count: 1, debtor: 100.1, comp: 90.05 });
  assert.deepEqual(r.totals.opd.error, { count: 2, debtor: 230.2, comp: 0 });
  assert.deepEqual(r.totals.opd.none, { count: 2, debtor: 60, comp: 0 });
  assert.deepEqual(r.totals.opd.total, { count: 5, debtor: 390.3, comp: 90.05 });
  assert.deepEqual(r.totals.ipd.error, { count: 1, debtor: 1000, comp: 800 });

  assert.equal(r.months.length, 12);
  assert.deepEqual(r.months[0].opd.total, { count: 2, debtor: 300.3, comp: 90.05 });
  assert.equal(r.months[11].ipd.error.debtor, 1000);

  // 2026-09-25 -> 45 วัน, 2026-08-01 -> 100 วัน
  assert.deepEqual(r.aging.map((a) => [a.bucket, a.opd.count, a.opd.debtor]), [["0-30", 0, 0], ["31-60", 1, 10], ["61-90", 0, 0], ["90+", 1, 50]]);

  assert.deepEqual(r.errors.map((e) => [e.code, e.count, e.debtor]), [["514", 2, 1200.2], ["305", 2, 230.2]]);
  assert.deepEqual(r.errors[0].ipd, { count: 1, debtor: 1000, last: "2026-09-30" });
  assert.equal(r.errors[1].opd.last, "2026-01-10");
});
