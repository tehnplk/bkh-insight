// รัน: node --test src/app/api/fund/ar-precheck/precheck.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { MAX_STALE_VNS, buildRows, isMismatch, isStaleSlip, lockOverdue, matches, parseStaleVns, planStaleSlip, sortRows, summarize } from "./precheck.ts";

const src = (key, extra = {}) => ({
  key, vn: key, an: null, hn: `hn${key}`, patient_name: `name ${key}`, date: "2026-11-01", regdate: null,
  pttype: "89", pttype_name: "UC", fund: "UCS", fund_name: "สิทธิหลักประกันสุขภาพ",
  has_stat: 1, income: "100.00", paid_money: "40.00", rcpt_money: "40.00", uc_money: "60.00",
  debt_amount: "60.00", finance_lock: "Y", ...extra,
});
const rx = (key, rx_total = "100.00", rx_pay = "40.00", rx_debt = "60.00") => ({ key, n_items: "3", rx_total, rx_pay, rx_debt });
const TODAY = "2026-11-18"; // พ.
const statusOf = (type, s, r = [rx(s.key)]) => buildRows(type, [s], r, [], TODAY)[0].status;

test("OPD status order: no_stat > total > split > debt > unpaid > ok", () => {
  assert.equal(statusOf("opd", src("1", { has_stat: 0, income: null })), "no_stat");
  // ไม่มีข้อมูลสรุปนำหน้าแม้ยอดอื่นจะไม่ตรงด้วย
  assert.equal(statusOf("opd", src("1", { has_stat: 0, income: null }), [rx("1", "999")]), "no_stat");
  assert.equal(statusOf("opd", src("1", { debt_amount: null }), [rx("1", "99.99")]), "total");
  assert.equal(statusOf("opd", src("1", { debt_amount: null }), [rx("1", "100", "50", "50")]), "split");
  // ใบลูกหนี้มากกว่ารายการลูกหนี้ (paidst 02)
  assert.equal(statusOf("opd", src("1", { debt_amount: "70" })), "debt");
  assert.equal(statusOf("opd", src("1", { rcpt_money: "10" })), "unpaid");
  assert.equal(statusOf("opd", src("1")), "ok");
  // ไม่มีรายการในใบสั่งยา = ยอด 0
  assert.equal(statusOf("opd", src("1", { income: "0", paid_money: "0", rcpt_money: "0", uc_money: "0", debt_amount: null }), []), "ok");
  // ไม่มีใบลูกหนี้ (0) แต่มีรายการลูกหนี้ 60
  assert.equal(statusOf("opd", src("1", { debt_amount: null })), "keyed_after");
  assert.equal(statusOf("opd", src("1"), []), "total");
});

test("IPD: ตั้งหนี้แล้ว = uc_money เมื่อ lock, ไม่ lock = 0 และสถานะ unlocked", () => {
  const [locked, open] = buildRows("ipd", [src("A", { an: "A", finance_lock: "Y" }), src("B", { an: "B", finance_lock: "N" })], [rx("A"), rx("B")], [], TODAY);
  assert.deepEqual([locked.debt, locked.diff_debt, locked.status], [60, 0, "ok"]);
  assert.deepEqual([open.debt, open.diff_debt, open.status], [0, 60, "unlocked"]);
  // split มาก่อน unlocked
  assert.equal(statusOf("ipd", src("C", { an: "C", finance_lock: "N" }), [rx("C", "100", "41", "59")]), "split");
  assert.equal(statusOf("ipd", src("D", { an: "D", finance_lock: "Y", rcpt_money: "0" })), "unpaid");
});

test("compare in satang: 0.1 + 0.2 equals 0.3", () => {
  const s = src("1", { income: "0.3", paid_money: "0.3", rcpt_money: "0.3", uc_money: "0", debt_amount: null });
  const [r] = buildRows("opd", [s], [{ key: "1", n_items: 2, rx_total: 0.1 + 0.2, rx_pay: 0.1 + 0.2, rx_debt: 0 }], [], TODAY);
  assert.equal(r.status, "ok");
  assert.equal(r.diff_total, 0);
});

test("ledger: string → number, missing = 0, insight failed = null everywhere", () => {
  const rows = buildRows("opd", [src("1"), src("2")], [rx("1"), rx("2")], [{ key: "1", booked: "60.00" }], TODAY);
  assert.deepEqual(rows.map((r) => r.booked), [60, 0]);
  assert.equal(summarize(rows).total.booked, 60);
  const failed = buildRows("opd", [src("1")], [rx("1")], null, TODAY);
  assert.equal(failed[0].booked, null);
  assert.equal(summarize(failed).total.booked, null);
});

test("summary totals and per-fund groups", () => {
  const rows = buildRows(
    "opd",
    [src("1"), src("2", { rcpt_money: "0" }), src("3", { fund: "OFC", fund_name: "ข้าราชการ", income: "50.10" })],
    [rx("1"), rx("2"), rx("3", "50.20", "0.10", "50.10")],
    [{ key: "1", booked: "60" }],
    TODAY,
  );
  const { total, funds } = summarize(rows);
  assert.equal(total.count, 3);
  assert.equal(total.rx_total, 250.2);
  assert.equal(total.income, 250.1);
  assert.equal(total.rcpt_money, 80);
  assert.equal(total.mismatch, 2);
  assert.equal(total.diff_total, 0.1);
  assert.deepEqual(funds.map((f) => [f.fund, f.count, f.mismatch, f.uc_money]), [["UCS", 2, 1, 120], ["OFC", 1, 1, 60]]);
});

test("OPD admitted visit keeps AN, search and sort by admit", () => {
  const rows = buildRows("opd", [src("1", { an: "690000001" }), src("2")], [], [], TODAY);
  assert.deepEqual(rows.map((r) => r.admit), ["yes", "no"]);
  assert.ok(matches(rows[0], "690000001") && matches(rows[1], "hn2") && !matches(rows[1], "6900"));
  assert.deepEqual(sortRows([...rows], "admit", "desc").map((r) => r.key), ["1", "2"]);
  assert.deepEqual(sortRows([...rows], "admit", "asc").map((r) => r.key), ["1", "2"]);
});

test("OPD admitted: ใบลูกหนี้ค้างเมื่อมีใบแต่รายการย้ายไป AN หมด ไม่งั้นตรวจที่ผู้ป่วยใน", () => {
  const admitted = (extra) => src("1", { an: "690000001", ...extra });
  assert.equal(statusOf("opd", admitted({ debt_amount: "50" }), []), "stale_slip");
  assert.equal(statusOf("opd", admitted({ debt_amount: null }), []), "admitted");
  // ยังมีรายการที่ vn = ตรวจที่ผู้ป่วยใน แม้ยอดไม่ตรง ; admit นำหน้าการล็อก
  assert.equal(statusOf("opd", admitted({ finance_lock: null }), [rx("1", "999")]), "admitted");
  // ไม่มีข้อมูลสรุปยังนำหน้า
  assert.equal(statusOf("opd", admitted({ has_stat: 0 }), []), "no_stat");
  assert.ok(isMismatch("stale_slip") && !isMismatch("admitted"));
});

test("lockOverdue: เกิน 3 วันทำการ (จ.-ศ.) หลังวันรับบริการ", () => {
  // ศ. 13 พ.ย. 2569: จ. 16, อ. 17, พ. 18 = 3 ยังไม่เกิน ; พฤ. 19 = 4 เกิน
  assert.equal(lockOverdue("2026-11-13", "2026-11-18"), false);
  assert.equal(lockOverdue("2026-11-13", "2026-11-19"), true);
  // เสาร์-อาทิตย์ไม่นับ
  assert.equal(lockOverdue("2026-11-13", "2026-11-15"), false);
  assert.equal(lockOverdue("2026-11-18", "2026-11-18"), false);
  assert.equal(lockOverdue("2026-01-01", "2026-11-18"), true);
});

test("OPD ยังไม่ล็อก: ภายใน 3 วันทำการ = รอ, เกิน = ค้างล็อก (NULL และ N เหมือนกัน)", () => {
  assert.equal(statusOf("opd", src("1", { date: "2026-11-13", finance_lock: null })), "pending_lock");
  assert.equal(statusOf("opd", src("1", { date: "2026-11-13", finance_lock: "N" }), [rx("1", "999")]), "pending_lock");
  assert.equal(statusOf("opd", src("1", { date: "2026-11-12", finance_lock: "N" })), "overdue_lock");
  assert.ok(isMismatch("overdue_lock") && !isMismatch("pending_lock"));
});

test("OPD ล็อกแล้ว: ใบลูกหนี้ตรงรายการแต่ vn_stat ค้าง / คีย์รายการหลังออกใบ", () => {
  // rx_debt 60, ใบ 60, vn_stat.uc_money 50 (ค้าง)
  assert.equal(statusOf("opd", src("1", { uc_money: "50", paid_money: "50", rcpt_money: "50" })), "stale_stat");
  // ใบ 50 น้อยกว่ารายการลูกหนี้ 60
  assert.equal(statusOf("opd", src("1", { debt_amount: "50" })), "keyed_after");
  // ค่าใช้จ่ายไม่ตรงนำหน้า
  assert.equal(statusOf("opd", src("1", { uc_money: "50" }), [rx("1", "110", "50", "60")]), "total");
  // ยกเว้นค่าธรรมเนียม 30 บาทด้วยการลบรายการ: income คำนวณใหม่ 445 แต่ paid_money ค้าง 30 (ข้อมูลจริง 12 พ.ย. 2569)
  const exempt = src("1", { income: "445", paid_money: "30", rcpt_money: "0", uc_money: "445", debt_amount: "445" });
  assert.equal(statusOf("opd", exempt, [rx("1", "445", "0", "445")]), "stale_stat");
  // มีรายการค่าธรรมเนียม 30 บาท (paidst 03) จริงและยอดสรุปตรง = ok
  const fee = src("1", { income: "475", paid_money: "30", rcpt_money: "30", uc_money: "445", debt_amount: "445" });
  assert.equal(statusOf("opd", fee, [rx("1", "475", "30", "445")]), "ok");
  assert.ok(isMismatch("stale_stat") && isMismatch("keyed_after"));
  // นับ "ไม่ตรง" ไม่รวมรายที่รอ
  const rows = buildRows("opd", [src("1"), src("2", { finance_lock: null, date: "2026-11-17" }), src("3", { debt_amount: "50" })], [rx("1"), rx("2"), rx("3")], [], TODAY);
  assert.deepEqual(rows.map((r) => r.status), ["ok", "pending_lock", "keyed_after"]);
  assert.equal(summarize(rows).total.mismatch, 1);
});

test("OPD ใบค้าง: ปรับปรุงในสมุดจนคงเหลือ 0 = stale_fixed (ไม่นับไม่ตรง) ; ยังไม่ลงสมุด/ติดลบ/อ่านสมุดไม่ได้ ยังเป็น stale_slip", () => {
  const stale = src("1", { an: "690000001", debt_amount: "50" });
  const status = (booked) => buildRows("opd", [stale], [], booked, TODAY)[0].status;
  assert.equal(status([{ key: "1", booked: "50.00", balance: "0.00" }]), "stale_fixed");
  assert.equal(status([{ key: "1", booked: "50.00", balance: "50.00" }]), "stale_slip");
  assert.equal(status([{ key: "1", booked: "50.00", balance: "-50.00" }]), "stale_slip");
  assert.equal(status([]), "stale_slip");
  assert.equal(status(null), "stale_slip");
  // booked ยังเป็นยอดของ HOSxP ไม่รวม manual
  assert.equal(buildRows("opd", [stale], [], [{ key: "1", booked: "50.00", balance: "0.00" }], TODAY)[0].booked, 50);
  assert.ok(!isMismatch("stale_fixed"));
});

test("isStaleSlip: ค่าจาก mysql2 (has_stat 0/1, debt NULL, n_items string)", () => {
  const v = { vn: "1", an: "690000001", has_stat: 1, debt_amount: "50.00", n_items: "0" };
  assert.ok(isStaleSlip(v));
  assert.ok(!isStaleSlip({ ...v, has_stat: 0 }));
  assert.ok(!isStaleSlip({ ...v, an: null }));
  assert.ok(!isStaleSlip({ ...v, debt_amount: null }));
  assert.ok(!isStaleSlip({ ...v, n_items: 2 }));
});

test("parseStaleVns: VN 12 หลัก ไม่ซ้ำ ไม่เกิน MAX_STALE_VNS", () => {
  assert.deepEqual(parseStaleVns(["691001000001", "691001000001"]), ["691001000001"]);
  assert.ok("error" in parseStaleVns([]));
  assert.ok("error" in parseStaleVns("691001000001"));
  assert.ok("error" in parseStaleVns(["69100100000"]));
  assert.ok("error" in parseStaleVns(["691001000001; --"]));
  assert.ok("error" in parseStaleVns(Array.from({ length: MAX_STALE_VNS + 1 }, (_, i) => String(691001000000 + i))));
});

test("planStaleSlip: ลดให้คงเหลือ 0 ต่อ debt_id ข้ามพร้อมเหตุผล", () => {
  const visit = (vn, extra = {}) => ({ vn, an: "690000001", has_stat: 1, debt_amount: "50.00", n_items: 0, ...extra });
  const debt = (vn, ref, balance, settled = false) => ({ vn, ref, balance, settled });
  const vns = ["A", "B", "C", "D", "E", "F"];
  const { requests, skipped } = planStaleSlip(
    vns,
    [visit("A", { debt_amount: "80.10" }), visit("B", { n_items: "3" }), visit("C"), visit("D"), visit("E")],
    [debt("A", "11", "50.00"), debt("A", "12", "30.10"), debt("D", "41", "50.00", true), debt("E", "51", "0.00"), debt("E", "52", "50.00"), debt("C2", "99", "50.00")],
    new Set(["52"]),
  );
  // vn เดียวหลายใบ = หลายคำขอ ยอดเป็นสตางค์
  assert.deepEqual(requests, [{ vn: "A", ref: "11", amount: "-50.00" }, { vn: "A", ref: "12", amount: "-30.10" }]);
  assert.deepEqual(skipped.map((s) => [s.vn, s.ref]), [["B", null], ["C", null], ["D", "41"], ["E", "51"], ["E", "52"], ["F", null]]);
  assert.match(skipped[0].reason, /ไม่ได้เป็นใบลูกหนี้ค้าง/);
  assert.match(skipped[1].reason, /ยังไม่ลงสมุด/);
  assert.match(skipped[2].reason, /STM/);
  assert.match(skipped[3].reason, /ไม่มากกว่า 0/);
  assert.match(skipped[4].reason, /รออนุมัติ/);
  assert.match(skipped[5].reason, /ไม่พบ visit/);
});
