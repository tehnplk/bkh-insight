// รัน: node --test src/app/api/fund/ar-trial-balance/trial-balance.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// trial-balance.ts import "../ar-journal/journal" แบบไม่มีนามสกุล (ตามที่ Next/TS ต้องการ) จึงเติม .ts ให้
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith(".")) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
});
const { fiscalStart, snapshotChanges, trialBalance, RETAINED_NAME } = await import("./trial-balance.ts");

const AR = "1102050101.202", REV = "4301020105.202", UNDER = "4301020105.231", OVER = "4301020105.232";
const g = (bucket, kind, amount, o = {}) => ({
  bucket, account_code: AR, account_name: "UC-IP", kind, revenue_code: REV, diff_under_code: UNDER, diff_over_code: OVER, n: 1, amount, ...o,
});
const allKinds = (bucket) => [g(bucket, "set", "1000"), g(bucket, "cancel", "-100"), g(bucket, "settle", "-700"), g(bucket, "diff", "-50"), g(bucket, "diff", "20")];
const row = (tb, type, code) => tb.rows.find((r) => r.type === type && r.code === code);

test("Dr = Cr for opening, period and closing when every kind is in every bucket", () => {
  const tb = trialBalance(["prior", "ytd", "month"].flatMap(allKinds));
  const t = tb.totals;
  assert.equal(t.opening_dr, t.opening_cr);
  assert.equal(t.dr, t.cr);
  assert.equal(t.closing_dr, t.closing_cr);
  assert.equal(t.dr, 1000 + 100 + 700 + 50 + 20);
  // ลูกหนี้: แต่ละ bucket สุทธิ 1000 − 100 − 700 − 50 + 20 = 170
  assert.deepEqual(row(tb, "ar", AR), { type: "ar", code: AR, name: "UC-IP", opening_dr: 340, opening_cr: null, dr: 1020, cr: 850, closing_dr: 510, closing_cr: null });
  assert.equal(tb.missing, 0);
});

test("fiscal year close: nominal opening is ytd only, prior goes to the retained row", () => {
  const tb = trialBalance([g("prior", "set", "1000"), g("prior", "settle", "-600"), g("ytd", "set", "200"), g("month", "set", "50")]);
  assert.deepEqual(row(tb, "revenue", REV), { type: "revenue", code: REV, name: "รายได้", opening_dr: null, opening_cr: 200, dr: 0, cr: 50, closing_dr: null, closing_cr: 250 });
  const retained = row(tb, "retained", null);
  assert.equal(retained.name, RETAINED_NAME);
  assert.deepEqual([retained.opening_cr, retained.closing_cr, retained.dr, retained.cr], [1000, 1000, 0, 0]);
  // บัญชีจริงยกมาสะสมข้ามปี
  assert.equal(row(tb, "ar", AR).opening_dr, 1000 - 600 + 200);
  assert.equal(row(tb, "cash", null).opening_dr, 600);
  assert.equal(tb.totals.opening_dr, tb.totals.opening_cr);
  assert.equal(tb.rows.at(-1).type, "retained");
});

test("October has no ytd: fiscalStart is the month itself", () => {
  assert.equal(fiscalStart("2025-10"), "2025-10-01");
  assert.equal(fiscalStart("2026-09"), "2025-10-01");
  assert.equal(fiscalStart("2026-01"), "2025-10-01");
  const tb = trialBalance([g("prior", "set", "500"), g("month", "set", "10")]);
  assert.equal(row(tb, "revenue", REV).opening_cr, null);
  assert.equal(row(tb, "revenue", REV).closing_cr, 10);
});

test("negative opening balance sits on the credit side", () => {
  const tb = trialBalance([g("ytd", "set", "100"), g("ytd", "settle", "-150")]);
  const ar = row(tb, "ar", AR);
  assert.deepEqual([ar.opening_dr, ar.opening_cr, ar.closing_dr, ar.closing_cr], [null, 50, null, 50]);
});

test("missing codes are listed per type, cash is not counted", () => {
  const tb = trialBalance([
    g("month", "set", "100", { revenue_code: null }),
    g("month", "diff", "-10", { diff_under_code: null }),
    g("month", "settle", "-50"),
    g("month", "set", "5", { account_code: null, account_name: null, revenue_code: null }),
  ]);
  assert.deepEqual(tb.rows.map((r) => [r.type, r.code]), [["ar", AR], ["ar", null], ["cash", null], ["revenue", null], ["diff_under", null]]);
  assert.equal(row(tb, "revenue", null).cr, 105);
  assert.equal(tb.missing, 3);
});

test("snapshotChanges counts changed, added and removed accounts", () => {
  const snap = JSON.parse(JSON.stringify(trialBalance(allKinds("month"))));
  assert.equal(snapshotChanges(trialBalance(allKinds("month")), snap), 0);
  // บัญชีรายได้ของลูกหนี้ถูกแก้หลังปิด: REV หาย, รหัสใหม่เพิ่ม
  const moved = trialBalance(allKinds("month").map((x) => ({ ...x, revenue_code: "4301020105.299" })));
  assert.equal(snapshotChanges(moved, snap), 2);
  const changed = trialBalance([...allKinds("month"), g("month", "set", "1")]);
  assert.equal(snapshotChanges(changed, snap), 2); // ลูกหนี้ + รายได้
});
