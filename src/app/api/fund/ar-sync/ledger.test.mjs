// รัน: node --test src/app/api/fund/ar-sync/ledger.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { LEDGER_START, allocateCr, capDiff, chunkRange, crRef, dailyWindows, monthRange, parseCase, planCancels, planIpd, planOpd, planRecompute, resolve, toCents } from "./ledger.ts";

const rights = [
  { code: "UCS", name: "UC", main_hcode: "11252", books_ar: true },
  { code: "PP", name: "P&P", main_hcode: null, books_ar: true },
  { code: "SSS", name: "SSS", main_hcode: "10676", books_ar: true },
  { code: "FREE", name: "สวัสดิการ", main_hcode: null, books_ar: false },
];
const rule = (right_code, patient_type, loc, account_code, cap = null, debt_pct = null) => ({ right_code, patient_type, loc, account_code, cap, debt_pct });
const rules = {
  rights,
  pttypes: new Map([["89", "UCS"], ["74", "UCS"], ["53", "PP"], ["S1", "SSS"], ["26", "FREE"]]),
  rules: [
    rule("UCS", "OP", "main", "1102050101.201"),
    rule("UCS", "OP", "province_moph", "1102050101.203", "700.00"),
    rule("UCS", "OP", "province_other", "1102050102.201", "700.00"),
    rule("UCS", "OP", "outside", "1102050101.216"),
    rule("UCS", "OP", "unknown", "1102050101.216"),
    rule("UCS", "IP", "any", "1102050101.202"),
    rule("PP", "OP", "any", "1102050101.209"),
    rule("SSS", "OP", "main", "1102050101.301", null, "45.00"),
    rule("SSS", "OP", "any", "1102050101.309"),
    rule("SSS", "IP", "main", "1102050101.302", null, "55.00"),
    rule("SSS", "IP", "any", "1102050101.308"),
  ],
  cup: new Set(["07526"]),
};
const cov = (o) => ({ patient_type: "OP", pttype: "89", hipdata_code: "UCS", hospmain: null, hospmain_chwpart: null, hospmain_type: null, ...o });
const acc = (o) => resolve(cov(o), rules).account_code;

test("resolve: pttype -> right -> rule by location, then any ; unmapped/no rule = null", () => {
  assert.equal(acc({ hospmain: "11252", hospmain_chwpart: "65", hospmain_type: "7" }), "1102050101.201");
  assert.equal(acc({ hospmain: "07526", hospmain_chwpart: "64" }), "1102050101.201"); // CUP = main
  assert.equal(acc({ hospmain: "10676", hospmain_chwpart: "65", hospmain_type: 5 }), "1102050101.203");
  assert.equal(acc({ hospmain: "11253", hospmain_chwpart: "65", hospmain_type: "7" }), "1102050101.203");
  for (const t of ["11", "12", "15", null]) assert.equal(acc({ hospmain: "41429", hospmain_chwpart: "65", hospmain_type: t }), "1102050102.201");
  assert.equal(acc({ hospmain: "10676", hospmain_chwpart: "64", hospmain_type: "5" }), "1102050101.216");
  assert.equal(acc({ hospmain: "10676" }), "1102050101.216"); // ไม่พบใน hospcode
  assert.equal(acc({}), "1102050101.216"); // ไม่มี hospmain
  assert.equal(acc({ pttype: "74", hospmain: "11252" }), "1102050101.201"); // WEL = UC
  assert.equal(acc({ pttype: "53", hospmain: "10676", hospmain_chwpart: "65", hospmain_type: "5" }), "1102050101.209"); // P&P ทุกที่
  assert.equal(acc({ patient_type: "IP", hospmain: "10676", hospmain_chwpart: "64" }), "1102050101.202");
  assert.equal(acc({ pttype: "S1", hospmain: "10676" }), "1102050101.301");
  assert.equal(acc({ pttype: "S1", hospmain: "11252", hospmain_chwpart: "65", hospmain_type: "7" }), "1102050101.309");
  assert.equal(acc({ pttype: "S1", patient_type: "IP", hospmain: "10676" }), "1102050101.302");
  assert.equal(acc({ pttype: "S1", patient_type: "IP" }), "1102050101.308");
  assert.equal(acc({ pttype: "00" }), null);
  assert.equal(acc({ pttype: null }), null);
  assert.equal(acc({ pttype: "53", patient_type: "IP" }), null); // กลุ่มสิทธิมี แต่ไม่มีกติกา IP
  assert.deepEqual(resolve(cov({ pttype: "26" }), rules), { account_code: null, rule: null, books: false });
});

test("capDiff: cap 700, SSS 45%/55%, none", () => {
  const [main, moph] = rules.rules;
  const op = rules.rules[7], ip = rules.rules[9];
  assert.equal(capDiff(90000, moph), -20000);
  assert.equal(capDiff(50000, moph), 0);
  assert.equal(capDiff(10001, op), -5501); // ลูกหนี้ 45.0045 -> 45.00
  assert.equal(capDiff(10000, ip), -4500);
  assert.equal(capDiff(10000, main), 0);
  assert.equal(capDiff(10000, null), 0);
});

const debt = (id, amount, o = {}) => ({
  debt_id: id, vn: `6810010000${id}`, debt_date: "2025-10-02", vstdate: "2025-10-02", pttype: "S1", hipdata_code: "SSS", amount, hospmain: "", hospmain_chwpart: null, hospmain_type: null, ...o,
});
const state = (ref, balance, o = {}) => ({
  source: "rcpt_debt", ref, vn: `vn${ref}`, an: null, ref_date: "2025-10-02", patient_type: "OP", pttype: "S1", hipdata_code: "SSS",
  hospmain: null, hospmain_chwpart: null, hospmain_type: null, account_code: "1102050101.309", balance, diff: 0, cancelled: false, settled: false, ...o,
});

test("planOpd: set on debt_date, adjust by difference on sync date, idempotent, skips zero/cancelled/duplicates", () => {
  const states = new Map([["2", state("2", 10000)], ["3", state("3", 5000)], ["4", state("4", 7000, { cancelled: true })]]);
  const out = planOpd(
    [debt(1, 123.456), debt(1, 123.456), debt(2, 120), debt(3, 50), debt(4, 99), debt(5, 0)],
    states, rules, "2025-11-09",
  );
  assert.deepEqual(out.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), [
    ["set", "1", "123.46", "2025-10-02"],
    ["adjust", "2", "20.00", "2025-11-09"],
  ]);
  assert.equal(out[0].account_code, "1102050101.309"); // S1 ไม่มีหน่วยบริการประจำ = ไม่ใช่ main
  assert.equal(out[0].hospmain, null); // '' -> null
  assert.equal(out[1].account_code, "1102050101.309"); // คัดลอกจากแถว set
});

test("planOpd set: dated by service date, falls back to debt_date, entry_date clamped to LEDGER_START", () => {
  const set = (o) => planOpd([debt(1, 10, o)], new Map(), rules, "2026-11-09")[0];
  const later = set({ vstdate: "2026-10-20", debt_date: "2026-11-02 08:00:00" });
  assert.deepEqual([later.ref_date, later.entry_date], ["2026-10-20", "2026-10-20"]);
  const noOvst = set({ vstdate: null, debt_date: "2026-11-02 08:00:00" });
  assert.deepEqual([noOvst.ref_date, noOvst.entry_date], ["2026-11-02", "2026-11-02"]);
  // หนี้ตั้งในช่วงสมุด แต่รับบริการก่อนวันเริ่มสมุด: ref_date คงวันจริง entry_date = LEDGER_START
  const early = set({ vstdate: "2025-09-28", debt_date: "2025-10-03" });
  assert.deepEqual([early.ref_date, early.entry_date], ["2025-09-28", LEDGER_START]);
});

test("planCancels: minus the ledger balance on cancel date, skip never-set, dedupe", () => {
  const states = new Map([["2", state("2", 12000)], ["4", state("4", 7000, { cancelled: true })]]);
  const { entries, skipped } = planCancels(
    [
      { debt_id: 2, cancel_datetime: "2025-10-05 10:00:00" },
      { debt_id: 2, cancel_datetime: "2025-10-06 10:00:00" },
      { debt_id: 4, cancel_datetime: "2025-10-06 10:00:00" },
      { debt_id: 9, cancel_datetime: "2025-10-06 10:00:00" },
    ],
    states,
  );
  assert.deepEqual(entries.map((e) => [e.kind, e.ref, e.amount, e.entry_date, e.ref_date]), [["cancel", "2", "-120.00", "2025-10-05", "2025-10-02"]]);
  assert.equal(skipped, 1);
});

const ipd = (an, uc_money, o = {}) => ({ an, dchdate: "2025-10-03", pttype: "89", hipdata_code: "UCS", uc_money, hospmain: "11252", hospmain_chwpart: "65", hospmain_type: 7, ...o });
const ist = (an, balance, ref_date = "2025-10-03") => ({ ...state(an, balance), source: "ipt", ref: an, vn: null, an, ref_date, patient_type: "IP", pttype: "89", account_code: "1102050101.202" });

test("planIpd: set on dchdate, adjust/reverse on sync date, re-lock, reverse only inside the window", () => {
  const w = { from: "2025-10-01", to: "2025-10-31" };
  const states = new Map([
    ["A2", ist("A2", 10000)], // ยอดเปลี่ยน
    ["A3", ist("A3", 0)], // เคยกลับรายการ แล้วปิดสิทธิอีกครั้ง
    ["A4", ist("A4", 5000)], // finance_lock กลับเป็น N
    ["A5", ist("A5", 5000, "2025-12-01")], // นอก window: ไม่แตะ
    ["A6", ist("A6", 0)], // กลับรายการแล้ว: ไม่ซ้ำ
  ]);
  const rows = [ipd("A1", "1000.50"), ipd("A2", 150), ipd("A3", 80), ipd("A7", 0)];
  const back = planIpd(rows, states, rules, w, "2026-11-09");
  assert.deepEqual(back.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), [
    ["set", "A1", "1000.50", "2025-10-03"],
    ["adjust", "A2", "50.00", "2026-11-09"],
    ["adjust", "A3", "80.00", "2026-11-09"],
    ["reverse", "A4", "-50.00", "2026-11-09"],
  ]);
  assert.equal(back[0].account_code, "1102050101.202");
  assert.equal(back[0].ref_date, "2025-10-03");
});

test("date windows: ≤31-day chunks, daily windows clamp to ledger start, month range", () => {
  assert.deepEqual(chunkRange("2026-07-13", "2026-11-09").map((c) => c.from), ["2026-07-13", "2026-08-13", "2026-09-13", "2026-10-14"]);
  assert.equal(chunkRange("2026-07-13", "2026-11-09").at(-1).to, "2026-11-09");
  assert.deepEqual(chunkRange("2026-01-02", "2026-01-01"), []);
  assert.deepEqual(dailyWindows("2026-11-09", "2026-11-01"), {
    opd: { from: "2026-10-27", to: "2026-11-09" },
    cancel: { from: "2026-10-31", to: "2026-11-09" },
    ipd: { from: "2026-07-13", to: "2026-11-09" },
  });
  assert.deepEqual(dailyWindows("2025-10-05", null).ipd, { from: "2025-10-01", to: "2025-10-05" });
  assert.deepEqual(monthRange("2026-02", "2026-11-09"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthRange("2026-11", "2026-11-09"), { from: "2026-11-01", to: "2026-11-09" });
  assert.deepEqual(monthRange("2025-12", "2026-11-09"), { from: "2025-12-01", to: "2025-12-31" });
  assert.equal(monthRange("2025-09", "2026-11-09"), null);
  assert.equal(monthRange("2026-12", "2026-11-09"), null);
  assert.equal(monthRange("2026-13", "2026-11-09"), null);
});

test("parseCase: vn 12 digits or an 9–12 digits, exactly one", () => {
  assert.deepEqual(parseCase({ vn: "690511062430" }), { vn: "690511062430" });
  assert.deepEqual(parseCase({ an: "690001234" }), { an: "690001234" });
  for (const bad of [null, {}, { vn: "690511062430", an: "690001234" }, { vn: "69051106243" }, { vn: 690511062430 }, { an: "69000123x" }, { an: "6900012" }, { vn: "' OR 1=1" }])
    assert.ok("error" in parseCase(bad), JSON.stringify(bad));
});

// จำลอง ledger หลัง INSERT: ใช้ตรวจว่ากดดึงใหม่ซ้ำแล้วไม่ได้รายการเพิ่ม
const applied = (states, entries) => {
  const next = new Map([...states].map(([k, v]) => [k, { ...v }]));
  for (const e of entries) {
    const s = next.get(e.ref);
    if (e.kind === "set") next.set(e.ref, { ...e, balance: toCents(e.amount), diff: 0, cancelled: false, settled: false });
    else if (e.kind === "diff") s.diff += toCents(e.amount);
    else Object.assign(s, { balance: s.balance + toCents(e.amount), cancelled: s.cancelled || e.kind === "cancel" });
  }
  return next;
};

test("case resync OPD: set then cancel in one run, adjust on change, second run books nothing", () => {
  const today = "2026-11-15";
  // VN มีหนี้ 2 ใบ: ใบ 2 ยอดเปลี่ยน (ยังไม่เคยลงยกเลิก), ใบ 7 ยังไม่เคยตั้งและถูกยกเลิกแล้ว (H1 ไม่คืนแถว ABORT แต่ H2 คืน)
  const debts = [debt(2, 150), debt(7, 80)];
  const cancels = [{ debt_id: 7, cancel_datetime: "2026-11-14 09:00:00" }];
  let states = new Map([["2", state("2", 10000)]]);
  const opd = planOpd(debts, states, rules, today);
  assert.deepEqual(opd.map((e) => [e.kind, e.ref, e.amount]), [["adjust", "2", "50.00"], ["set", "7", "80.00"]]);
  states = applied(states, opd);
  const { entries } = planCancels(cancels, states);
  assert.deepEqual(entries.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), [["cancel", "7", "-80.00", "2026-11-14"]]);
  states = applied(states, entries);
  assert.deepEqual(planOpd(debts, states, rules, today), []);
  assert.deepEqual(planCancels(cancels, states).entries, []);
});

test("case resync IPD: whole-ledger window reverses an old AN whose finance_lock is no longer Y, once", () => {
  const today = "2026-11-15";
  const w = { from: LEDGER_START, to: today };
  // จำหน่ายเกิน 120 วัน รายวันไม่เห็นแล้ว ; his ไม่คืนแถว (finance_lock <> 'Y') states มาจาก [an]
  let states = new Map([["A9", ist("A9", 5000, "2026-01-02")]]);
  const out = planIpd([], states, rules, w, today);
  assert.deepEqual(out.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), [["reverse", "A9", "-50.00", today]]);
  states = applied(states, out);
  assert.deepEqual(planIpd([], states, rules, w, today), []);
  // ปิดสิทธิอีกครั้งด้วยยอดใหม่ แล้วกดซ้ำ
  const rows = [ipd("A9", 70, { dchdate: "2026-01-02" })];
  const again = planIpd(rows, states, rules, w, today);
  assert.deepEqual(again.map((e) => [e.kind, e.amount]), [["adjust", "70.00"]]);
  assert.deepEqual(planIpd(rows, applied(states, again), rules, w, today), []);
});

// UC ในจังหวัด สังกัด สธ. (เพดาน 700) และ SSS main (45%) ใช้ทดสอบ diff
const uc = { pttype: "89", hipdata_code: "UCS", hospmain: "10676", hospmain_chwpart: "65", hospmain_type: "5" };
const capState = (ref, balance, diff, o = {}) => state(ref, balance, { ...uc, account_code: "1102050101.203", diff, ...o });

test("planOpd cap: set full + diff on service date, adjust recomputes diff, settled keeps diff, free right not booked", () => {
  const set = planOpd([debt(1, 900, uc)], new Map(), rules, "2026-11-09");
  assert.deepEqual(set.map((e) => [e.kind, e.amount, e.entry_date, e.account_code]), [
    ["set", "900.00", "2025-10-02", "1102050101.203"],
    ["diff", "-200.00", "2025-10-02", "1102050101.203"],
  ]);
  assert.equal(set[1].note, "ลูกหนี้ไม่เกิน 700 บาท");
  assert.equal(set[0].hospmain_type, "5");
  // ยอด HOSxP 900 -> 1000: adjust +100 ส่วนต่าง -200 -> -300 ; 900 -> 500: adjust -400 และยกเลิกส่วนต่าง +200
  const up = planOpd([debt(2, 1000, uc)], new Map([["2", capState("2", 90000, -20000)]]), rules, "2026-11-09");
  assert.deepEqual(up.map((e) => [e.kind, e.amount, e.entry_date]), [["adjust", "100.00", "2026-11-09"], ["diff", "-100.00", "2026-11-09"]]);
  const down = planOpd([debt(3, 500, uc)], new Map([["3", capState("3", 90000, -20000)]]), rules, "2026-11-09");
  assert.deepEqual(down.map((e) => [e.kind, e.amount]), [["adjust", "-400.00"], ["diff", "200.00"]]);
  assert.equal(down[1].note, "ยกเลิกส่วนต่างตามเพดาน/สัดส่วน");
  // ไม่เปลี่ยน = ไม่มีแถว ; ตัดด้วย STM แล้ว = ปรับยอดได้แต่ไม่แตะ diff
  assert.deepEqual(planOpd([debt(4, 900, uc)], new Map([["4", capState("4", 90000, -20000)]]), rules, "2026-11-09"), []);
  const settled = planOpd([debt(5, 1000, uc)], new Map([["5", capState("5", 90000, 0, { settled: true })]]), rules, "2026-11-09");
  assert.deepEqual(settled.map((e) => [e.kind, e.amount]), [["adjust", "100.00"]]);
  // SSS main 45%
  const sss = planOpd([debt(6, 1000, { hospmain: "10676" })], new Map(), rules, "2026-11-09");
  assert.deepEqual(sss.map((e) => [e.kind, e.amount, e.account_code]), [["set", "1000.00", "1102050101.301"], ["diff", "-550.00", "1102050101.301"]]);
  // สวัสดิการ: ไม่ตั้ง ; ที่ตั้งไว้แล้วปรับเป็น 0
  assert.deepEqual(planOpd([debt(7, 100, { pttype: "26" })], new Map(), rules, "2026-11-09"), []);
  const free = planOpd([debt(8, 100, { pttype: "26" })], new Map([["8", state("8", 10000, { pttype: "26" })]]), rules, "2026-11-09");
  assert.deepEqual(free.map((e) => [e.kind, e.amount, e.note]), [["adjust", "-100.00", "สิทธินี้ไม่ตั้งลูกหนี้"]]);
});

test("planCancels / planIpd reverse: close both the full amount and the cap diff", () => {
  const { entries } = planCancels([{ debt_id: 2, cancel_datetime: "2026-11-05 10:00:00" }], new Map([["2", capState("2", 90000, -20000)]]));
  assert.deepEqual(entries.map((e) => [e.kind, e.amount, e.entry_date]), [["cancel", "-900.00", "2026-11-05"], ["diff", "200.00", "2026-11-05"]]);
  const w = { from: "2025-10-01", to: "2025-10-31" };
  const sssIp = { ...ist("A1", 100000), pttype: "S1", hipdata_code: "SSS", hospmain: "10676", account_code: "1102050101.302", diff: -45000 };
  const rev = planIpd([], new Map([["A1", sssIp]]), rules, w, "2026-11-09");
  assert.deepEqual(rev.map((e) => [e.kind, e.amount]), [["reverse", "-1000.00"], ["diff", "450.00"]]);
  const set = planIpd([ipd("A2", 1000, { pttype: "S1", hipdata_code: "SSS", hospmain: "10676" })], new Map(), rules, w, "2026-11-09");
  assert.deepEqual(set.map((e) => [e.kind, e.amount, e.account_code]), [["set", "1000.00", "1102050101.302"], ["diff", "-450.00", "1102050101.302"]]);
});

test("planRecompute: move account, add missing diff on set date, skip settled, reverse free right, keep when no rule, idempotent", () => {
  const rs = (ref, balance, o = {}) => ({ ...state(ref, balance), set_date: "2026-10-05", ...o });
  const states = [
    rs("1", 90000, { ...uc, account_code: "1102050101.201" }), // .201 -> .203 + diff -200
    rs("2", 90000, { ...uc, account_code: "1102050101.203", settled: true }), // ตัดแล้ว: ย้ายไม่ได้ลง diff
    rs("3", 10000, { pttype: "26", account_code: null }), // สวัสดิการ: กลับรายการ
    rs("4", 10000, { pttype: "00", account_code: "1102050101.401" }), // ไม่มีกติกา: คงบัญชีเดิม
    rs("5", 0, { ...uc, account_code: "1102050101.203", cancelled: true }), // ยกเลิกแล้ว
  ];
  const plan = planRecompute(states, rules);
  assert.deepEqual(plan.map((p) => [p.state.ref, p.to, p.entries.map((e) => [e.kind, e.amount, e.entry_date, e.account_code]), p.noRule, p.settledSkip]), [
    ["1", "1102050101.203", [["diff", "-200.00", "2026-10-05", "1102050101.203"]], false, false],
    ["2", "1102050101.203", [], false, true],
    ["3", null, [["reverse", "-100.00", "2026-10-05", null]], false, false],
    ["4", "1102050101.401", [], true, false],
    ["5", "1102050101.203", [], false, false],
  ]);
  // หลังลงแล้วกดซ้ำ ไม่มีอะไรเปลี่ยน
  const after = [{ ...states[0], account_code: "1102050101.203", diff: -20000 }, states[1], { ...states[2], balance: 0 }, states[3], states[4]];
  assert.ok(planRecompute(after, rules).every((p) => p.entries.length === 0 && p.to === p.state.account_code));
});

// ---- ช่วง 4a: แยก HC + INST ของ UC OP ใน CUP (.201) เป็นหนี้ CR (.216) ----
const cup = { pttype: "89", hipdata_code: "UCS", hospmain: "07526", hospmain_chwpart: "65", hospmain_type: "18" };
const vnOf = (id) => `6810010000${id}`;
const crState = (id, balance, o = {}) => state(crRef(String(id)), balance, { ...cup, vn: vnOf(id), account_code: "1102050101.216", ...o });
const mainState = (id, balance, o = {}) => state(String(id), balance, { ...cup, vn: vnOf(id), account_code: "1102050101.201", ...o });

test("allocateCr: per vn in debt_id order, capped at each debt", () => {
  const out = allocateCr([{ ref: "12", vn: "A", cap: 500 }, { ref: "3", vn: "A", cap: 300 }, { ref: "4", vn: "B", cap: 100 }], new Map([["A", 700], ["B", 0]]));
  assert.deepEqual([...out], [["3", 300], ["12", 400]]);
});

test("planOpd CR: new .201 debt splits HC+INST, sum unchanged, idempotent ; non-.201 not split", () => {
  const today = "2026-11-25";
  const cr = new Map([[vnOf(1), 30000], [vnOf(2), 5000]]);
  const debts = [debt(1, 1000, cup), debt(2, 100, uc)]; // 2 = ในจังหวัด .203 ไม่แยก
  const out = planOpd(debts, new Map(), rules, today, cr);
  assert.deepEqual(out.map((e) => [e.kind, e.ref, e.account_code, e.amount, e.entry_date]), [
    ["set", "1", "1102050101.201", "700.00", "2025-10-02"],
    ["set", "1:CR", "1102050101.216", "300.00", "2025-10-02"],
    ["set", "2", "1102050101.203", "100.00", "2025-10-02"],
  ]);
  assert.equal(out[1].vn, vnOf(1));
  const states = applied(new Map(), out);
  assert.deepEqual(planOpd(debts, states, rules, today, cr), []);
  // CR เกินยอดหนี้ = แยกได้ไม่เกินยอด ; หนี้หลักห้ามยอด 0 จึงตั้งเต็มแล้วปรับลด
  const full = planOpd([debt(1, 100, cup)], new Map(), rules, today, cr);
  assert.deepEqual(full.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), [["set", "1", "100.00", "2025-10-02"], ["adjust", "1", "-100.00", "2025-10-02"], ["set", "1:CR", "100.00", "2025-10-02"]]);
  assert.ok(full.every((e) => Number(e.amount) !== 0));
  assert.deepEqual(planOpd([debt(1, 100, cup)], applied(new Map(), full), rules, today, cr), []);
});

test("planOpd CR: existing unsplit debt splits on its set date, later changes adjust on sync date, settled not split", () => {
  const today = "2026-11-25";
  const cr = new Map([[vnOf(1), 20000]]);
  let states = new Map([["1", mainState(1, 100000)]]);
  const first = planOpd([debt(1, 1000, cup)], states, rules, today, cr);
  assert.deepEqual(first.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), [["adjust", "1", "-200.00", "2025-10-02"], ["set", "1:CR", "200.00", "2025-10-02"]]);
  states = applied(states, first);
  // HOSxP: ยอดรวม 1,100 และ HC+INST 250
  const next = planOpd([debt(1, 1100, cup)], states, rules, today, new Map([[vnOf(1), 25000]]));
  assert.deepEqual(next.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), [["adjust", "1:CR", "50.00", today], ["adjust", "1", "50.00", today]]);
  // ไม่ใช่ .201 แล้ว (สิทธิไม่ตั้งลูกหนี้) = CR กลับเป็น 0 และหนี้หลักเป็น 0
  const free = new Map([["1", { ...states.get("1"), pttype: "26" }], ["1:CR", states.get("1:CR")]]);
  assert.deepEqual(planOpd([debt(1, 1000, cup)], free, rules, today, cr).map((e) => [e.ref, e.amount]), [["1:CR", "-200.00"], ["1", "-800.00"]]);
  // ตัดเหมาจ่ายแล้วและยังไม่เคยแยก: ไม่แยก
  assert.deepEqual(planOpd([debt(1, 1000, cup)], new Map([["1", mainState(1, 100000, { settled: true })]]), rules, today, cr), []);
});

test("planCancels CR: cancelling a debt_id closes both refs once", () => {
  const states = new Map([["1", mainState(1, 80000)], ["1:CR", crState(1, 20000)]]);
  const cancels = [{ debt_id: 1, cancel_datetime: "2025-10-05 10:00:00" }];
  const { entries } = planCancels(cancels, states);
  assert.deepEqual(entries.map((e) => [e.kind, e.ref, e.amount, e.account_code]), [["cancel", "1", "-800.00", "1102050101.201"], ["cancel", "1:CR", "-200.00", "1102050101.216"]]);
  assert.deepEqual(planCancels(cancels, applied(states, entries)).entries, []);
});

test("planRecompute CR: splits .201 on set date, adjusts existing CR, keeps CR account, skips settled, idempotent", () => {
  const rs = (s) => ({ ...s, set_date: "2026-10-05" });
  const states = [rs(mainState(1, 100000)), rs(mainState(2, 80000)), rs(crState(2, 10000)), rs(mainState(3, 50000, { settled: true }))];
  const cr = new Map([[vnOf(1), 30000], [vnOf(2), 15000], [vnOf(3), 1000]]);
  const plan = planRecompute(states, rules, cr);
  assert.deepEqual(plan.map((p) => [p.state.ref, p.to, p.entries.map((e) => [e.kind, e.ref, e.amount, e.entry_date]), p.settledSkip]), [
    ["1", "1102050101.201", [["adjust", "1", "-300.00", "2026-10-05"], ["set", "1:CR", "300.00", "2026-10-05"]], false],
    ["2", "1102050101.201", [["adjust", "2", "-50.00", "2026-10-05"]], false],
    ["3", "1102050101.201", [], true],
    ["2:CR", "1102050101.216", [["adjust", "2:CR", "50.00", "2026-10-05"]], false],
  ]);
  const after = [rs(mainState(1, 70000)), rs(crState(1, 30000)), rs(mainState(2, 75000)), rs(crState(2, 15000)), states[3]];
  assert.ok(planRecompute(after, rules, cr).every((p) => p.entries.length === 0 && p.to === p.state.account_code));
});
