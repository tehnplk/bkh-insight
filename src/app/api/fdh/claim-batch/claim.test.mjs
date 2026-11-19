// รัน: node --test src/app/api/fdh/claim-batch/claim.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { batchItems, claimCounts, claimText, classifyClaim, parseBatch } from "./claim.ts";

const TODAY = "2026-11-19";
const op = (extra = {}) => ({ type: "OP", fund: "UCS", date: "2026-11-10", amount: 500, closed: true, ...extra });

test("evidence order: STM > REP > FDH sent > export > unclaimed/failed > none", () => {
  const all = {
    stm: { paid: "120.50", paid_at: "2026-11-15" },
    rep: { status: "c", rep_date: "2026-11-12", rep_no: "690000001" },
    fdh: { resv: "Y", resv_at: "2026-11-10 16:00:00", msg: null, msg_at: null },
    batch: { at: "2026-11-11 09:00:00+07", channel: "eclaim_txt" },
  };
  assert.deepEqual(classifyClaim(op(all), TODAY), { status: "paid", at: "2026-11-15", amount: 120.5 });
  assert.deepEqual(classifyClaim(op({ ...all, stm: { paid: "0", paid_at: null } }), TODAY), { status: "rep_c", at: "2026-11-12", detail: "690000001" });
  assert.equal(classifyClaim(op({ ...all, stm: null, rep: null }), TODAY).status, "nhso");
  assert.deepEqual(classifyClaim(op({ batch: all.batch }), TODAY), { status: "exported", at: "2026-11-11", detail: "ส่งออก e-Claim TEXT" });
  // จองส่งไม่สำเร็จแต่ส่งออกจากระบบนี้ภายหลัง = ส่งออกแล้ว
  assert.equal(classifyClaim(op({ batch: all.batch, fdh: { resv: "N", resv_at: "2026-11-10", msg: null, msg_at: null } }), TODAY).status, "exported");
});

test("FDH messages: positive = sent, unclaimed, negatives ignored, IP ignores FDH", () => {
  const fdh = (msg, resv = null) => ({ fdh: { resv, resv_at: "2026-11-10 10:00:00", msg, msg_at: "2026-11-12 08:00:00" } });
  assert.deepEqual(classifyClaim(op(fdh("approved (อนุมัติ)")), TODAY), { status: "nhso", at: "2026-11-12", detail: "FDH: approved (อนุมัติ)" });
  assert.equal(classifyClaim(op(fdh("unclaimed (ไม่ประสงค์เบิกสปสช.)")), TODAY).status, "unclaimed");
  assert.equal(classifyClaim(op(fdh("ไม่มีรายการนี้ส่งเข้ามาในระบบ")), TODAY).status, "unsent");
  assert.equal(classifyClaim(op(fdh("ยืนยันตัวตนไม่สำเร็จ เนื่องจาก Token หมดอายุ", "N")), TODAY).status, "failed");
  assert.equal(classifyClaim(op(fdh("ไม่มีรายการนี้ส่งเข้ามาในระบบ", "Y")), TODAY).status, "nhso");
  assert.equal(classifyClaim({ ...op(fdh("approved (อนุมัติ)", "Y")), type: "IP" }, TODAY).status, "unsent");
});

test("no evidence: overdue after deadline, wait_close when not closed, none for non-claim funds or zero debtor", () => {
  assert.deepEqual(classifyClaim(op(), TODAY), { status: "unsent", at: "2026-11-10", days: 9 });
  assert.deepEqual(classifyClaim(op({ closed: false }), TODAY), { status: "wait_close", at: "2026-11-10", days: 9 });
  assert.deepEqual(classifyClaim(op({ date: "2026-10-19", closed: false }), TODAY), { status: "overdue", at: "2026-10-19", days: 31 });
  assert.equal(classifyClaim(op({ date: "2026-10-20" }), TODAY).status, "unsent"); // 30 วันพอดียังไม่เกิน
  assert.equal(classifyClaim(op({ fund: "SSS" }), TODAY), undefined);
  assert.equal(classifyClaim(op({ amount: 0 }), TODAY), undefined);
  // กองทุนอื่นที่มีหลักฐานยังแสดง
  assert.equal(classifyClaim(op({ fund: "SSS", batch: { at: "2026-11-11", channel: "fdh" } }), TODAY).status, "exported");
});

test("text and counts", () => {
  assert.equal(claimText(undefined), "");
  assert.equal(claimText({ status: "paid", at: "2026-11-15", amount: 120.5 }), "ได้รับเงิน · 120.50 บาท · 2026-11-15");
  assert.deepEqual(claimCounts([{ v: "unsent" }, { v: "wait_close" }, { v: "overdue" }, { v: "" }, { v: "rep_pass" }]), { unsent: 2, overdue: 1 });
});

test("batchItems: one item per OPD/IPD case, fields from INS/CHT/DX", () => {
  const files = [
    { file: "OPD", rows: [{ SEQ: "691110080000", HN: "000123", DATEOPD: "2026-11-10" }, { SEQ: "691110080000", HN: "000123", DATEOPD: "2026-11-10" }, { SEQ: "691110090000", HN: "000124", DATEOPD: "2026-11-10" }] },
    { file: "INS", rows: [{ SEQ: "691110080000", INSCL: "UCS", SUBTYPE: "89", HOSPMAIN: "11252" }, { SEQ: "691110080000", INSCL: "OFC" }] },
    { file: "CHT", rows: [{ SEQ: "691110080000", TOTAL: "350.5" }] },
    { file: "ODX", rows: [{ SEQ: "691110080000", DIAG: "Z000", DXTYPE: "4" }, { SEQ: "691110080000", DIAG: "J00", DXTYPE: "1" }] },
  ];
  assert.deepEqual(batchItems(files, "OP"), [
    { ref: "691110080000", hn: "000123", service_date: "2026-11-10", scheme: "UCS", subtype: "89", hospmain: "11252", cht_total: 350.5, pdx: "J00" },
    { ref: "691110090000", hn: "000124", service_date: "2026-11-10", scheme: null, subtype: null, hospmain: null, cht_total: null, pdx: null },
  ]);
  const ip = [{ file: "IPD", rows: [{ AN: "690001234", HN: "000123", DATEDSC: "2026-11-01" }] }, { file: "IDX", rows: [{ AN: "690001234", DIAG: "A09", DXTYPE: "1" }] }];
  assert.deepEqual(batchItems(ip, "IP")[0], { ref: "690001234", hn: "000123", service_date: "2026-11-01", scheme: null, subtype: null, hospmain: null, cht_total: null, pdx: "A09" });
});

test("parseBatch validates the browser payload", () => {
  const item = { ref: "691110080000", hn: "000123", service_date: "2026-11-10", scheme: "UCS", subtype: "89", hospmain: "11252", cht_total: 350.5, pdx: "J00" };
  const ok = parseBatch({ channel: "fdh", patient_type: "OP", file_sha256: null, items: [item] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.items, [item]);
  // field อื่น (เช่น cid) ไม่ถูกเก็บ
  assert.deepEqual(parseBatch({ channel: "fdh", patient_type: "OP", items: [{ ref: "1", cid: "x" }] }).value.items[0], { ref: "1", hn: null, service_date: null, scheme: null, subtype: null, hospmain: null, cht_total: null, pdx: null });
  for (const bad of [
    null,
    { channel: "x", patient_type: "OP", items: [item] },
    { channel: "fdh", patient_type: "XX", items: [item] },
    { channel: "fdh", patient_type: "OP", items: [] },
    { channel: "fdh", patient_type: "OP", items: [item, item] },
    { channel: "fdh", patient_type: "OP", items: [{ ...item, ref: "1; DROP" }] },
    { channel: "fdh", patient_type: "OP", items: [{ ...item, cht_total: "1" }] },
    { channel: "fdh", patient_type: "OP", items: [{ ...item, service_date: "10/11/2569" }] },
    { channel: "fdh", patient_type: "OP", file_sha256: "abc", items: [item] },
    { channel: "fdh", patient_type: "OP", items: Array.from({ length: 5001 }, (_, i) => ({ ref: String(i + 1) })) },
  ])
    assert.equal(parseBatch(bad).ok, false, JSON.stringify(bad)?.slice(0, 80));
});
