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
  assert.equal(lib.ecRequest("hsubList", { fy: 2027 }).body, "PAGE_HEAD=&TYPE_STMT=2&GYEAR=2027&STMT_PERIOD=");
  assert.equal(lib.ecRequest("hsubFile", { fy: "2027", period: "6910_OP_01" }).url,
    "/webComponent/statement_hsub/DownloadExcelPage.do?return_gyear=2027&return_stmt_period=6910_OP_01&TYPE_STMT=2&ZONE=&PROVINCE=&HCODE=&VAR_HCODE2=&gyear_report_excel=2019&hcode_report_excel=13814");
  assert.equal(lib.ecRequest("hsubFile", { fy: "2027", period: "6910_IP_01" }).error, "ค่าไม่ถูกต้อง: period");
  assert.equal(lib.ecRequest("hsubFile", { fy: "2027", period: "6910_OP_01&x=1" }).error, "ค่าไม่ถูกต้อง: period");
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
    ? [{ fn: "eclaim_12345_IP_25691105_1.ecd", repNo: "690100001" }, { fn: "eclaim_12345_IPSSS_25691105_2.ecd" }, { fn: "eclaim_12345_OP_25691105_3.ecd" }]
    : []),
  ucsList: (p) => (p.mm === "02"
    ? [
      { doc: "12345_OPUCS256911_01", personType: "1", hcode: "12345", hname: "ร", province: "จ", issued: "15/11/2569", argc: 5 },
      { doc: "12345_IPUCS256909_01", personType: "2", hcode: "12345", hname: "ร", province: "จ", issued: "15/09/2569", argc: 5 },
    ]
    : []),
  ofcList: () => [{ hcode: "12345", maininscl: "OFC", personType: "1", gyear: "2026", gmonth: "11", revision: "1", doc: "12345_OP202611_01", argc: 7 }],
  bmtList: (p) => (p.personType === "2" && p.m === 11
    ? [{ hcode: "12345", maininscl: "BMT", personType: "2", gyear: "2027", gmonth: "11", revision: "21", doc: "12345_IP202611_21", argc: 7 }]
    : []),
  hsubList: (p) => (p.fy === 2027
    ? [
      { period: "6910_OP_01", gyear: "2027", issued: "10/11/2569", argc: 2 }, // STM อยู่ในระบบแล้ว
      { period: "6910_OP_02", gyear: "2027", issued: "10/11/2569", argc: 2 }, // STM มี Hsub แล้ว
      { period: "6911_OP_01", gyear: "2027", issued: "25/11/2569", argc: 2 }, // STM จะนำเข้าในรอบนี้
      { period: "6911_OP_02", gyear: "2027", issued: "26/11/2569", argc: 2 }, // ไม่มี STM คู่
      { period: "6909_OP_02", gyear: "2027", issued: "27/10/2569", argc: 2 }, // ออกนอกช่วง
    ]
    : []),
};
const STM_ROWS = [
  { id: "7", doc_no: "12345_OP202611_01", has_hsub: false },
  { id: "8", doc_no: "12345_OPUCS256910_01", has_hsub: false },
  { id: "9", doc_no: "12345_OPUCS256910_02", has_hsub: true },
];
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
    // STM ที่อัปโหลดสำเร็จในรอบนี้ได้ id 10
    done: async (path, key) => ({
      values: path.includes("rep")
        ? ["eclaim_12345_OP_25691105_3.xls"]
        : [...STM_ROWS, ...log.uploads.filter((u) => u.path === lib.STM_PATH && u.ok).map((u) => ({ id: "10", doc_no: u.name.slice(4, -4), has_hsub: false }))]
          .map((r) => (Array.isArray(key) ? Object.fromEntries(key.map((k) => [k, r[k]])) : r[key])),
    }),
    upload: async (path, name, fields, chunks) => {
      const r = upload(name);
      log.uploads.push({ path, name, fields: { ...fields }, chunks, ok: r.body?.status === "imported" });
      return r;
    },
  };
}

test("plan splits found / already / pending / skipped", async () => {
  const progress = [];
  const res = await lib.plan(NOV, fakeIo(), { delayMs: 0, onProgress: (p) => progress.push(p) });
  assert.equal(res.hcode, "12345"); // จากชื่อ REP ที่นำเข้าแล้ว
  assert.deepEqual(res.stats["REP UCS"], { found: 3, already: 1, pending: 1, imported: 0, failed: 0, skipped: 1 });
  assert.deepEqual(res.skips[0], { g: "REP UCS", reason: "ยังไม่รองรับ IPSSS", n: 1 });
  assert.equal(res.stats["STM UCS"].found, 1); // ฉบับที่ออกนอกช่วงไม่นับ
  assert.deepEqual(res.stats["STM OFC"], { found: 1, already: 1, pending: 0, imported: 0, failed: 0, skipped: 0 });
  assert.deepEqual(res.todo.map((t) => [t.g, t.name, t.kind]), [
    ["REP UCS", "eclaim_12345_IP_25691105_1.xls", "repFile"],
    ["STM UCS", "STM_12345_OPUCS256911_01.xls", "ucsFile"],
    ["Hsub รพ.สต.", "Hsub_6910_OP_01.xls", "hsubFile"],
    ["Hsub รพ.สต.", "Hsub_6911_OP_01.xls", "hsubFile"],
    ["STM BMT", "STM_BMT_12345_IP202611_21.xls", "bmtFile"],
  ]);
  assert.deepEqual(res.todo[1].fields, { transfer_date: "2026-11-15" });
  assert.deepEqual(res.todo[2].fields, { stm_file_id: "8" });
  assert.deepEqual(res.todo[3].fields, {}); // STM คู่ยังไม่นำเข้า run หา id เอง
  assert.deepEqual(res.todo[4].fields, { scheme: "BMT" }); // ไฟล์ BMT เหมือน OFC ทุกช่อง route จึงต้องรู้สิทธิจากที่นี่
  assert.deepEqual(res.stats["STM BMT"], { found: 1, already: 0, pending: 1, imported: 0, failed: 0, skipped: 0 });
  assert.deepEqual(res.stats["Hsub รพ.สต."], { found: 4, already: 1, pending: 2, imported: 0, failed: 0, skipped: 1 });
  assert.deepEqual(res.skips.at(-1), { g: "Hsub รพ.สต.", reason: lib.HSUB_NO_STM, n: 1 });
  for (const t of res.todo) assert.ok(!lib.ecRequest(t.kind, t.p).error, t.name); // ค่าที่ plan ส่งต่อผ่านการตรวจของ extension
  assert.equal(progress.length, 5 + 12 + 1 + 1 + 2 + 1); // REP, STM UC, Hsub, OFC, BMT OP/IP, จบ
  assert.deepEqual(progress.at(-1), { done: 21, total: 21, label: "" });
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
  assert.equal((await lib.plan(NOV, err, { delayMs: 0 })).failures.length, 21);
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
    upload: (name) => (name.startsWith("STM_12345") ? { status: 400, body: { status: "error", error: "ไฟล์เสีย" } } : IMPORTED()),
  });
  const res = await lib.plan(NOV, io, { delayMs: 0 });
  const seen = [];
  await lib.run(res, io, { delayMs: 0, onItem: (it) => seen.push(it.result.status) });
  assert.deepEqual(seen, ["imported", "error", "imported", "error", "imported"]);
  assert.deepEqual(io.log.uploads[0].chunks, [`0-${lib.CHUNK}`, `${lib.CHUNK}-${lib.CHUNK + 5}`]);
  assert.equal(io.log.released, 4); // Hsub ที่ไม่มี STM คู่ไม่ดาวน์โหลด
  assert.equal(res.stats["REP UCS"].imported, 1);
  assert.equal(res.stats["REP UCS"].pending, 0);
  assert.deepEqual(res.failures.slice(-2), [
    { g: "STM UCS", what: "STM_12345_OPUCS256911_01.xls", msg: "ไฟล์เสีย" },
    { g: "Hsub รพ.สต.", what: "Hsub_6911_OP_01.xls", msg: lib.HSUB_STM_FAILED },
  ]);
  await lib.run(res, io, { delayMs: 0 }); // รันซ้ำ (เช่น นำเข้าต่อหลังยกเลิก) ไม่อัปโหลดไฟล์ที่ทำแล้ว
  assert.equal(io.log.uploads.length, 4);
  assert.deepEqual(io.log.uploads.filter((u) => u.name.startsWith("STM_BMT")).map((u) => [u.path, u.fields]), [[lib.STM_PATH, { scheme: "BMT" }]]);
  assert.equal(res.stats["STM BMT"].imported, 1);
});

test("run: Hsub uploads after its STM is imported in the same run", async () => {
  const io = fakeIo({ upload: (name) => (name === "Hsub_6910_OP_01.xls" ? { status: 200, body: { status: "duplicate", cases: 3 } } : IMPORTED()) });
  const res = await lib.plan(NOV, io, { delayMs: 0 });
  await lib.run(res, io, { delayMs: 0 });
  const hsub = io.log.uploads.filter((u) => u.path === lib.HSUB_PATH);
  assert.deepEqual(hsub.map((u) => [u.name, u.fields]), [
    ["Hsub_6910_OP_01.xls", { stm_file_id: "8" }],
    ["Hsub_6911_OP_01.xls", { stm_file_id: "10" }],
  ]);
  assert.deepEqual(res.stats["Hsub รพ.สต."], { found: 4, already: 2, pending: 0, imported: 1, failed: 0, skipped: 1 });
});

test("run: oversize file fails without upload, app 401 stops", async () => {
  const big = fakeIo({ size: lib.MAX_BYTES + 1 });
  const res = await lib.plan(NOV, big, { delayMs: 0 });
  await lib.run(res, big, { delayMs: 0 });
  assert.equal(big.log.uploads.length, 0);
  assert.equal(big.log.released, 4);
  assert.equal(res.failures[0].msg, "ไฟล์ใหญ่เกิน 30 MB");
  const exp = fakeIo({ upload: () => ({ status: 401, body: null }) });
  const r2 = await lib.plan(NOV, exp, { delayMs: 0 });
  await assert.rejects(lib.run(r2, exp, { delayMs: 0 }), { message: lib.APP_EXPIRED });
});
