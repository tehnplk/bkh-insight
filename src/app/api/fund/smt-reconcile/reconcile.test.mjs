// รัน: node --test src/app/api/fund/smt-reconcile/reconcile.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { periodKey, reconcile, smtDate, stmKey, summarize, toLine } from "./reconcile.ts";

const smt = (refDocNo, total, extra = {}) =>
  toLine({ postingDate: "25681223", batchNo: "0190A", refDocNo, fundDescr: "กองทุนผู้ป่วยใน", efundDesc: null, mophId: "1102050101.202", amount: total, wait: 0, debt: 0, total, pmntStts: "P", ...extra });
const stm = (doc_no, period_month, patient_type, run_no, net_total) => ({ doc_no, patient_type, period_month, run_no, transfer_date: "2026-10-02", net_total });

test("periodKey: ต้น refDocNo ที่เป็นงวด STM รวมรูปแบบอุทธรณ์/ยกเลิก Rerun/D1 ; ที่ไม่อ้างงวดคืน null", () => {
  assert.equal(periodKey("6810_IP_01"), "6810_IP_01");
  assert.equal(periodKey("6809_IP_03_อุทธรณ์"), "6809_IP_03");
  assert.equal(periodKey("6808_IP_01(ยกเลิก Rerun)"), "6808_IP_01");
  assert.equal(periodKey("6709_OP_04(D1)"), "6709_OP_04");
  for (const ref of ["DNAP7001100001", "OP REFER6909", "690300059", "PP จัดสรรพลางก่อนร้อยละ 25", "6813_OP_01", "6810_OP_011", null]) assert.equal(periodKey(ref), null, String(ref));
  assert.equal(stmKey({ period_month: "2025-10-01", patient_type: "OP", run_no: 2 }), "6810_OP_02");
  assert.equal(stmKey({ period_month: "2026-01-01", patient_type: "IP", run_no: 1 }), "6901_IP_01");
  assert.equal(smtDate("25691113"), "2026-11-13");
});

test("reconcile: รวม total ต่อ key แบบสตางค์ จับคู่ STM ด้วยงวด และกรองปีงบตามเดือนบริการ", () => {
  const rows = reconcile(
    [
      smt("6810_IP_01", 5858606.18),
      smt("6808_IP_01", 0.1), // ปีงบ 2568 ไม่อยู่ในปีงบ 2569
      smt("6810_OP_01", 0.1),
      smt("6810_OP_01", 0.2, { postingDate: "25681224", batchNo: "0201" }),
      smt("6810_OP_01", 0, { pmntStts: "W", wait: 99, amount: 99 }),
      smt("6909_IP_03_อุทธรณ์", -36343.85),
      smt("6909_IP_03(อุทธรณ์)(ยกเลิก Rerun)", 36343.85),
      smt("DNAP7001100001", 9527),
    ],
    [stm("11252_IPUCS256810_01", "2025-10-01", "IP", 1, "5858606.18"), stm("11252_OPUCS256810_01", "2025-10-01", "OP", 1, "0.30"), stm("11252_OPUCS256909_02", "2026-09-01", "OP", 2, "100.00"), stm("x", "2025-09-01", "OP", 1, "1")],
    2569,
  );
  assert.deepEqual(rows.map((r) => [r.key, r.status, r.smt_total, r.stm_total, r.diff]), [
    ["6810_IP_01", "match", 5858606.18, 5858606.18, 0],
    ["6810_OP_01", "match", 0.3, 0.3, 0], // 0.1 + 0.2 ไม่มี float error ; รอโอนไม่นับ
    ["6909_IP_03", "smt_only", 0, null, null],
    ["6909_OP_02", "stm_only", null, 100, null],
  ]);
  const op = rows[1];
  assert.equal(op.smt_date, "2025-12-24");
  assert.equal(op.batches, "0190A, 0201");
  assert.equal(op.lines.length, 3);
  assert.deepEqual(rows[2], { ...rows[2], period_month: "2026-09-01", patient_type: "IP", run_no: 3 });
  // 6808 (ส.ค. 2568) อยู่ปีงบ 2568 ส่วน 6909 (ก.ย. 2569) อยู่ปีงบ 2569
  assert.ok(!rows.some((r) => r.key.startsWith("6808")));
});

test("reconcile: ส่วนต่าง = SMT − STM และ summarize นับสถานะ", () => {
  const rows = reconcile([smt("6907_IP_02", 3570435.98)], [stm("d", "2026-07-01", "IP", 2, "3578796.44")], 2569);
  assert.equal(rows[0].status, "diff");
  assert.equal(rows[0].diff, -8360.46);
  const s = summarize(rows);
  assert.deepEqual(s.count, { match: 0, diff: 1, smt_only: 0, stm_only: 0 });
  assert.equal(s.diff, -8360.46);
});
