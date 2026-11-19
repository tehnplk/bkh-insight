// รัน: node --test extension/eclaim-sync/lib/ ; คำขอไป e-Claim, protocol ของ extension และ plan/run ด้วย io ปลอม (ไม่ติดต่อ e-Claim)
import assert from "node:assert/strict";
import test from "node:test";
import * as lib from "./sync.js";

const NOV = { from: "2026-11", to: "2026-11" };

test("ecRequest builds e-Claim URLs only from validated fields", () => {
  const r = lib.ecRequest("repList", { m: 11, ye: 2569, scheme: "ucs", hcode: "12345" });
  assert.equal(r.url, "/webComponent/validation/ValidationMainAction.do");
  assert.equal(r.body, "mo=11&ye=2569&repNo=&maininscl=ucs&zp=12345&lev=H&bc=null&bc2=null");
  const u = lib.ecRequest("ucsFile", { doc: "12345_OPUCS256910_01", personType: "1", hcode: "12345", hname: "โรงพยาบาล A&B", provinceName: "จ" });
  assert.match(u.url, /^\/webComponent\/ucs\/statementUCSDownloadAction\.do\?document_no=12345_OPUCS256910_01&/);
  assert.match(u.url, /hname=โรงพยาบาล A%26B&/); // & ใน hname ไม่ตัด query
  assert.equal(lib.ecRequest("repFile", { fn: "../x", hcode: "12345", m: 1, ye: 2569 }).error, "ค่าไม่ถูกต้อง: fn");
  assert.equal(lib.ecRequest("repList", { m: 13, ye: 2569, scheme: "ucs", hcode: "12345" }).error, "ค่าไม่ถูกต้อง: m");
  assert.ok(lib.ecRequest("toString", {}).error);
  assert.ok(lib.ecRequest("repList", null).error);
});

test("checkMessage accepts only the protocol", () => {
  assert.deepEqual(lib.checkMessage({ op: "ping", extra: 1 }), { op: "ping" });
  assert.equal(lib.checkMessage({ op: "list", kind: "repList", p: { m: 1, ye: 2569, scheme: "ofc", hcode: "12345" } }).req.url, "/webComponent/validation/ValidationMainAction.do");
  assert.ok(lib.checkMessage({ op: "list", kind: "repFile", p: {} }).error); // ชนิดไฟล์ใช้กับ list ไม่ได้
  assert.ok(lib.checkMessage({ op: "download", kind: "repList", p: {} }).error);
  assert.deepEqual(lib.checkMessage({ op: "chunk", tabId: 7, start: 0, end: lib.CHUNK }), { op: "chunk", tabId: 7, start: 0, end: lib.CHUNK });
  assert.ok(lib.checkMessage({ op: "chunk", tabId: 7, start: 0, end: lib.CHUNK + 1 }).error);
  assert.ok(lib.checkMessage({ op: "chunk", tabId: "7", start: 0, end: 1 }).error);
  assert.ok(lib.checkMessage({ op: "release" }).error);
  assert.ok(lib.checkMessage({ op: "fetch", url: "https://evil.example" }).error);
  assert.ok(lib.checkMessage("ping").error);
});

const LISTS = {
  repList: (p) => (p.scheme === "ucs" && p.m === 11
    ? [{ fn: "eclaim_12345_IP_25691105_1.ecd", repNo: "690100001" }, { fn: "eclaim_12345_ORF_25691105_2.ecd" }, { fn: "eclaim_12345_OP_25691105_3.ecd" }]
    : []),
  ucsList: (p) => (p.mm === "02"
    ? [
      { doc: "12345_OPUCS256911_01", personType: "1", hcode: "12345", hname: "ร", province: "จ", issued: "15/11/2569", argc: 5 },
      { doc: "12345_IPUCS256909_01", personType: "2", hcode: "12345", hname: "ร", province: "จ", issued: "15/09/2569", argc: 5 },
    ]
    : []),
  ofcList: () => [{ hcode: "12345", maininscl: "OFC", personType: "1", gyear: "2026", gmonth: "11", revision: "1", doc: "12345_OP202611_01", argc: 7 }],
};
const IMPORTED = () => ({ status: 200, body: { status: "imported", rows: 3 } });

/** io ปลอม: รายการตาม LISTS, ไฟล์ขนาด size, บันทึกการอัปโหลดและการคืนไฟล์ */
function fakeIo({ size = 10, upload = IMPORTED, select = { zone: "02", province: "6500" } } = {}) {
  const log = { uploads: [], released: 0 };
  return {
    log,
    list: async (kind, p) => ({ items: LISTS[kind](p) }),
    download: async () => ({ size, tabId: 1 }),
    chunk: async (h, s, e) => ({ b64: `${s}-${e}` }),
    release: async () => {
      log.released++;
    },
    select: async () => select,
    done: async (path) => ({ values: path.includes("rep") ? ["eclaim_12345_OP_25691105_3.xls"] : ["12345_OP202611_01"] }),
    upload: async (path, name, fields, chunks) => {
      log.uploads.push({ path, name, fields, chunks });
      return upload(name);
    },
  };
}

test("plan splits found / already / pending / skipped", async () => {
  const progress = [];
  const res = await lib.plan(NOV, fakeIo(), { delayMs: 0, onProgress: (p) => progress.push(p) });
  assert.equal(res.hcode, "12345"); // จากชื่อ REP ที่นำเข้าแล้ว
  assert.deepEqual(res.stats["REP UCS"], { found: 3, already: 1, pending: 1, imported: 0, failed: 0, skipped: 1 });
  assert.deepEqual(res.skips, [{ g: "REP UCS", reason: "ยังไม่รองรับ ORF", n: 1 }]);
  assert.equal(res.stats["STM UCS"].found, 1); // ฉบับที่ออกนอกช่วงไม่นับ
  assert.deepEqual(res.stats["STM OFC"], { found: 1, already: 1, pending: 0, imported: 0, failed: 0, skipped: 0 });
  assert.deepEqual(res.todo.map((t) => [t.g, t.name, t.kind]), [
    ["REP UCS", "eclaim_12345_IP_25691105_1.xls", "repFile"],
    ["STM UCS", "STM_12345_OPUCS256911_01.xls", "ucsFile"],
  ]);
  assert.deepEqual(res.todo[1].fields, { transfer_date: "2026-11-15" });
  for (const t of res.todo) assert.ok(!lib.ecRequest(t.kind, t.p).error, t.name); // ค่าที่ plan ส่งต่อผ่านการตรวจของ extension
  assert.equal(progress.length, 5 + 12 + 1 + 1);
  assert.deepEqual(progress.at(-1), { done: 18, total: 18, label: "" });
});

test("plan stops on expired e-Claim, cancel and unknown hcode; HTTP errors per list continue", async () => {
  const exp = fakeIo();
  exp.list = async () => ({ expired: true });
  await assert.rejects(lib.plan(NOV, exp, { delayMs: 0 }), { message: lib.EXPIRED });
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(lib.plan(NOV, fakeIo(), { delayMs: 0, signal: ac.signal }), { message: lib.CANCELLED });
  const none = fakeIo();
  none.done = async () => ({ values: [] });
  await assert.rejects(lib.plan(NOV, none, { delayMs: 0 }), lib.Stop);
  const err = fakeIo();
  err.list = async () => ({ status: 500 });
  assert.equal((await lib.plan(NOV, err, { delayMs: 0 })).failures.length, 18);
  const noExt = fakeIo();
  noExt.list = async () => null; // extension ไม่ตอบ
  await assert.rejects(lib.plan(NOV, noExt, { delayMs: 0 }), lib.Stop);
});

test("plan skips OFC without zone/province", async () => {
  const res = await lib.plan(NOV, fakeIo({ select: { zone: null, province: null } }), { delayMs: 0 });
  assert.equal(res.stats["STM OFC"].skipped, 1);
});

test("run transfers in chunks, releases, and classifies results", async () => {
  const io = fakeIo({
    size: lib.CHUNK + 5,
    upload: (name) => (name.startsWith("STM") ? { status: 400, body: { status: "error", error: "ไฟล์เสีย" } } : IMPORTED()),
  });
  const res = await lib.plan(NOV, io, { delayMs: 0 });
  const seen = [];
  await lib.run(res, io, { delayMs: 0, onItem: (it) => seen.push(it.result.status) });
  assert.deepEqual(seen, ["imported", "error"]);
  assert.deepEqual(io.log.uploads[0].chunks, [`0-${lib.CHUNK}`, `${lib.CHUNK}-${lib.CHUNK + 5}`]);
  assert.equal(io.log.released, 2);
  assert.equal(res.stats["REP UCS"].imported, 1);
  assert.equal(res.stats["REP UCS"].pending, 0);
  assert.deepEqual(res.failures.at(-1), { g: "STM UCS", what: "STM_12345_OPUCS256911_01.xls", msg: "ไฟล์เสีย" });
  await lib.run(res, io, { delayMs: 0 }); // รันซ้ำ (เช่น นำเข้าต่อหลังยกเลิก) ไม่อัปโหลดไฟล์ที่ทำแล้ว
  assert.equal(io.log.uploads.length, 2);
});

test("run: oversize file fails without upload, app 401 stops", async () => {
  const big = fakeIo({ size: lib.MAX_BYTES + 1 });
  const res = await lib.plan(NOV, big, { delayMs: 0 });
  await lib.run(res, big, { delayMs: 0 });
  assert.equal(big.log.uploads.length, 0);
  assert.equal(big.log.released, 2);
  assert.equal(res.failures[0].msg, "ไฟล์ใหญ่เกิน 30 MB");
  const exp = fakeIo({ upload: () => ({ status: 401, body: null }) });
  const r2 = await lib.plan(NOV, exp, { delayMs: 0 });
  await assert.rejects(lib.run(r2, exp, { delayMs: 0 }), { message: lib.APP_EXPIRED });
});
