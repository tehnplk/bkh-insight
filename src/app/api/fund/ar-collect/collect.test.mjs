// รัน: node --test src/app/api/fund/ar-collect/collect.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { SENT_STATUSES, countSent, hospKey, pivotGroups, sentOf } from "./collect.ts";
import { CLAIM_STATUSES } from "../../fdh/claim-batch/claim.ts";

test("SENT_STATUSES = สถานะเคลมตั้งแต่ exported ขึ้นไป", () => {
  assert.deepEqual(SENT_STATUSES, CLAIM_STATUSES.slice(0, CLAIM_STATUSES.indexOf("exported") + 1));
});

test("sentOf ตาม send_mode", () => {
  assert.equal(sentOf("auto", 5, undefined), 5);
  assert.equal(sentOf("book", 5, 3), 0);
  assert.equal(sentOf("none", 5, 3), 0);
  assert.equal(sentOf(null, 5, 3), 0);
  assert.equal(sentOf("claim", 5, 3), 3);
  assert.equal(sentOf("claim", 5, undefined), null);
});

test("countSent นับ key ไม่ซ้ำ ทั้งกลุ่มนับครั้งเดียวแม้มีหลาย hospmain", () => {
  const status = { "OP:1": "exported", "OP:2": "unsent", "IP:9": "paid", "OP:3": "rep_c" };
  const keys = [
    { patient_type: "OP", k: "1", hospmain: "10676", hipdata_code: "UCS" },
    { patient_type: "OP", k: "1", hospmain: "10676", hipdata_code: "UCS" }, // หนี้ซ้ำของ vn เดียวกัน
    { patient_type: "OP", k: "1", hospmain: "11256", hipdata_code: "UCS" },
    { patient_type: "OP", k: "2", hospmain: "10676", hipdata_code: "UCS" },
    { patient_type: "OP", k: "3", hospmain: null, hipdata_code: null },
    { patient_type: "IP", k: "9", hospmain: "10676", hipdata_code: "UCS" },
  ];
  const m = countSent(keys, (t, k) => status[`${t}:${k}`]);
  assert.equal(m.get("OP"), 2);
  assert.equal(m.get("IP"), 1);
  assert.equal(m.get(hospKey("OP", "10676", "UCS")), 1);
  assert.equal(m.get(hospKey("OP", "11256", "UCS")), 1);
  assert.equal(m.get(hospKey("OP", null, null)), 1);
});

test("pivotGroups รวม OP/IP ต่อกลุ่ม และแถวรวม (claim นับไม่ได้ = null)", () => {
  const row = (grp, send_mode, patient_type, visits, extra = {}) => ({
    grp, name: grp == null ? null : `g${grp}`, send_mode, patient_type, visits: String(visits), closed: "1",
    cost: "100.005", debt: "80", diff: "-20", received: "10", balance: "70", ...extra,
  });
  const rows = [row(4, "claim", "OP", 3), row(4, "claim", "IP", 2), row(6, "auto", "OP", 7), row(null, null, "OP", 1)];
  const ok = pivotGroups(rows, new Map([[4, new Map([["OP", 2]])]]));
  assert.equal(ok.rows.length, 3);
  assert.deepEqual(ok.rows[0].OP, { visits: 3, closed: 1, sent: 2 });
  assert.deepEqual(ok.rows[0].IP, { visits: 2, closed: 1, sent: 0 });
  assert.equal(ok.rows[0].cost, 200.02);
  assert.equal(ok.rows[1].OP.sent, 7);
  assert.equal(ok.rows[2].OP.sent, 0);
  assert.deepEqual(ok.totals.OP, { visits: 11, closed: 3, sent: 9 });
  const failed = pivotGroups(rows, new Map());
  assert.equal(failed.rows[0].OP.sent, null);
  assert.equal(failed.totals.OP.sent, null);
});
