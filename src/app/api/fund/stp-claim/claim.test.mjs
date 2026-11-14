// รัน: node --test src/app/api/fund/stp-claim/claim.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { buildRows, isPending, parseSave, sortRows, summarize } from "./claim.ts";

const hisCase = (ref, o = {}) => ({
  ref, hn: "H1", date: "2026-01-05", pttype: "S1", authen_code: null,
  fdh_claim_status_message: null, fdh_claim_status_datetime: null, claim_amount: "100.10", has_pdx: 1, ...o,
});
const log = (ref, status, created_at, o = {}) => ({ ref, status, note: null, recorded_by: "A", created_at, ...o });

test("สถานะปัจจุบัน = log ล่าสุด ไม่มี log = not_sent", () => {
  const rows = buildRows(
    [hisCase("1"), hisCase("2", { has_pdx: 0, authen_code: " ", claim_amount: "0.20" })],
    [log("1", "submitted", "2026-02-02 10:00:00+07", { note: "ส่งแล้ว", recorded_by: "B" }), log("1", "uploaded", "2026-02-01 09:00:00+07")],
    (p) => `name-${p}`,
  );
  assert.equal(rows[0].status, "submitted");
  assert.equal(rows[0].status_by, "B");
  assert.equal(rows[0].note, "ส่งแล้ว");
  assert.equal(rows[0].history.length, 2);
  assert.equal(rows[0].pttype_name, "name-S1");
  assert.equal(rows[1].status, "not_sent");
  assert.equal(rows[1].history.length, 0);
  assert.equal(rows[1].has_pdx, false);
  assert.equal(rows[1].authen_code, null);
});

test("ยังไม่กดส่งเคลม = not_sent, uploaded, fix", () => {
  assert.deepEqual(
    ["not_sent", "uploaded", "fix", "submitted", "approved", "rejected", "paid", "capitation", "unclaimed", "cancelled"].map(isPending),
    [true, true, true, false, false, false, false, false, false, false],
  );
});

test("สรุปนับทุกสถานะ มูลค่ารวมเฉพาะที่ยังไม่กดส่งเคลม (ไม่มีเศษทศนิยมลอย)", () => {
  const rows = buildRows(
    [hisCase("1", { claim_amount: "0.10" }), hisCase("2", { claim_amount: "0.20" }), hisCase("3", { claim_amount: "50" })],
    [log("3", "paid", "2026-02-01 09:00:00+07")],
    () => "",
  );
  const s = summarize(rows);
  assert.equal(s.total, 3);
  assert.equal(s.counts.not_sent, 2);
  assert.equal(s.counts.paid, 1);
  assert.deepEqual(s.pending, { count: 2, amount: 0.3 });
});

test("เรียงสถานะตามขั้นตอน ค่าว่างอยู่ท้าย", () => {
  const rows = buildRows(
    [hisCase("1"), hisCase("2"), hisCase("3")],
    [log("1", "paid", "2026-02-01 09:00:00+07"), log("2", "uploaded", "2026-02-01 09:00:00+07")],
    () => "",
  );
  assert.deepEqual(sortRows([...rows], "status", "asc").map((r) => r.ref), ["3", "2", "1"]);
  assert.deepEqual(sortRows([...rows], "status_at", "desc").map((r) => r.ref), ["1", "2", "3"]);
});

test("ตรวจ body ของ POST", () => {
  const ok = { type: "op", start: "2026-01-01", end: "2026-01-31", refs: ["690101000001", "690101000001"], status: "submitted", note: "  x " };
  const r = parseSave(ok);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { type: "OP", refs: ["690101000001"], status: "submitted", note: "x", start: "2026-01-01", end: "2026-01-31" });
  assert.equal(parseSave({ ...ok, note: "   " }).value.note, null);
  for (const bad of [
    null,
    { ...ok, type: "xx" },
    { ...ok, refs: [] },
    { ...ok, refs: Array(101).fill("1") },
    { ...ok, refs: ["69'; DROP"] },
    { ...ok, refs: [1] },
    { ...ok, status: "done" },
    { ...ok, note: 5 },
    { ...ok, note: "x".repeat(501) },
    { ...ok, start: undefined },
  ]) assert.equal(parseSave(bad).ok, false, JSON.stringify(bad)?.slice(0, 60));
});
