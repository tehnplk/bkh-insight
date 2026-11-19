// รัน: node --test src/app/api/opd/right-check/srm.test.mjs (mock fetch ไม่ยิง สปสช. จริง)
import assert from "node:assert/strict";
import test from "node:test";
import { SRM_DELAY_MS, cacheMap, checkVisits, compareRight, fetchRight, freshResults, pickFund, readResponse, srmText, wait } from "./srm.ts";

const his = { vn: "691118000114", hn: "0004253", name: "นาย ก", fund: "UCS", pttype_name: "บัตรทอง 30 บาท", hospmain: "11252", hospsub: "07535" };
const fund = (extra = {}) => ({
  fundType: "Y", mainInscl: { id: "UCS", name: "สิทธิหลักประกันสุขภาพแห่งชาติ" }, subInscl: { id: "89", name: "ช่วงอายุ 12-59 ปี" },
  hospMain: { hcode: "11252", hname: "รพ.ก" }, hospSub: { hcode: "07535", hname: "รพ.สต.ข" },
  startDateTime: "2020-01-01T00:00:00", expireDateTime: "9999-12-31T00:00:00", ...extra,
});

test("main fund: fundType Y, else first", () => {
  assert.equal(pickFund([fund({ fundType: "N", mainInscl: { id: "OFC" } }), fund()]).mainInscl.id, "UCS");
  assert.equal(pickFund([fund({ fundType: "N", mainInscl: { id: "OFC" } })]).mainInscl.id, "OFC");
  assert.equal(pickFund([]), null);
  assert.equal(pickFund(undefined), null);
});

test("compare: ok, WEL = UCS, right mismatch wins, hcode only when NHSO gives one", () => {
  const ok = compareRight(his, { funds: [fund()] });
  assert.equal(ok.status, "ok");
  assert.equal(ok.srm.expire, null);
  assert.equal(ok.srm.start, "2020-01-01");
  assert.equal(compareRight(his, { funds: [fund({ mainInscl: { id: "WEL" } })] }).status, "ok");
  const both = compareRight(his, { funds: [fund({ mainInscl: { id: "OFC" }, hospMain: { hcode: "10676" } })] });
  assert.equal(both.status, "mismatch_right");
  assert.equal(both.hcode_ok, false);
  assert.equal(compareRight(his, { funds: [fund({ hospMain: { hcode: "10676" } })] }).status, "mismatch_hcode");
  const noHosp = compareRight({ ...his, fund: "OFC", hospmain: null }, { funds: [fund({ mainInscl: { id: "OFC" }, hospMain: null })] });
  assert.equal(noHosp.hcode_ok, null);
  assert.equal(noHosp.status, "ok");
  assert.equal(compareRight(his, { funds: [] }).status, "not_found");
});

test("response: 401 and 429 stop the batch, 404 not found, others error without the pid", () => {
  assert.equal(readResponse(200, JSON.stringify({ funds: [] }), null).kind, "ok");
  assert.equal(readResponse(404, "", null).kind, "not_found");
  assert.equal(readResponse(401, "{}", null).stop.kind, "token");
  assert.equal(readResponse(429, JSON.stringify({ retryAfterSeconds: 30 }), null).stop.retryAfter, 30);
  assert.equal(readResponse(429, "", "12").stop.retryAfter, 12);
  assert.equal(readResponse(429, "", null).stop.retryAfter, undefined);
  const e = readResponse(500, JSON.stringify({ message: "bad pid 1234567890123" }), null);
  assert.equal(e.kind, "error");
  assert.doesNotMatch(e.message, /1234567890123/);
});

test("fetch: bearer header, timeout = error row", async () => {
  let seen;
  const ok = await fetchRight(async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ funds: [fund()] }), { status: 200 });
  }, "https://srm.example/api/ucws/v1/right-search?pid=1", "tok");
  assert.equal(ok.kind, "ok");
  assert.equal(seen.init.headers.Authorization, "Bearer tok");
  const slow = await fetchRight((_u, init) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))), "https://x", "t", 20);
  assert.equal(slow.kind, "error");
  assert.match(slow.message, /ไม่ตอบภายใน/);
});

test("pacing: wait SRM_DELAY_MS after every NHSO call (incl. last), skip rows don't wait, stop ends at once", async () => {
  const v = (vn, cid) => [vn, { ...his, vn, hn: `hn${vn}`, cid }];
  const visits = new Map([v("1", "1234567890123"), v("2", "bad"), v("3", "1234567890124"), v("4", "1234567890125")]);
  const log = [];
  const sleep = async (ms) => void log.push(`sleep ${ms}`);
  const ok = async (pid) => (log.push(`fetch ${pid}`), { kind: "ok", data: { funds: [fund()] } });
  const page = await checkVisits(["1", "2", "missing", "3"], visits, ok, new AbortController().signal, sleep);
  assert.equal(SRM_DELAY_MS, 150);
  assert.deepEqual(log, ["fetch 1234567890123", "sleep 150", "fetch 1234567890124", "sleep 150"]);
  assert.deepEqual(page.rows.map((r) => r.status), ["ok", "error", "error", "ok"]);
  assert.equal(page.rows[0].cid, undefined);

  log.length = 0;
  let n = 0;
  const stopSecond = async (pid) => (log.push(`fetch ${pid}`), ++n === 2 ? { kind: "stop", stop: { kind: "token", message: "t" } } : { kind: "ok", data: { funds: [fund()] } });
  const stopped = await checkVisits(["1", "3", "4"], visits, stopSecond, new AbortController().signal, sleep);
  assert.equal(stopped.stop.kind, "token");
  assert.equal(stopped.rows.length, 1);
  assert.deepEqual(log, ["fetch 1234567890123", "sleep 150", "fetch 1234567890124"]);
});

test("pacing: abort during the wait stops promptly without the next call", async () => {
  const visits = new Map([["1", { ...his, vn: "1", cid: "1234567890123" }], ["3", { ...his, vn: "3", cid: "1234567890124" }]]);
  const ctrl = new AbortController();
  let calls = 0;
  const t0 = Date.now();
  const p = checkVisits(["1", "3"], visits, async () => (calls++, setTimeout(() => ctrl.abort(), 10), { kind: "ok", data: { funds: [fund()] } }), ctrl.signal);
  const page = await p;
  assert.equal(calls, 1);
  assert.equal(page.rows.length, 1);
  assert.ok(Date.now() - t0 < SRM_DELAY_MS, "real wait ended on abort, not after the full delay");
  const done = new AbortController();
  done.abort();
  await wait(60_000, done.signal); // already aborted = resolves now
});

test("cache: cached HN skips NHSO (no call, no wait) and is re-compared per visit ; same HN in a batch is fetched once", async () => {
  const srm = { fund: "UCS", fund_name: null, sub_name: null, hospmain: "11252", hospmain_name: null, hospsub: null, hospsub_name: null, start: null, expire: null };
  const cache = cacheMap([
    { hn: "A", found: true, ...srm, checked_at: "2026-11-19 10:00:00+07", checked_by: "ผู้ตรวจ" },
    { hn: "B", found: false, ...srm, checked_at: "2026-11-19 10:00:00+07", checked_by: "ผู้ตรวจ" },
  ]);
  assert.equal(cache.get("B").srm, null);
  const visits = new Map([
    ["1", { ...his, vn: "1", hn: "A", cid: "x" }],
    ["2", { ...his, vn: "2", hn: "A", hospmain: "10676", cid: "x" }],
    ["3", { ...his, vn: "3", hn: "B", cid: "x" }],
    ["4", { ...his, vn: "4", hn: "C", cid: "1234567890123" }],
    ["5", { ...his, vn: "5", hn: "C", cid: "1234567890123" }],
  ]);
  const log = [];
  const page = await checkVisits(["1", "2", "3", "4", "5"], visits, async (pid) => (log.push(`fetch ${pid}`), { kind: "ok", data: { funds: [fund()] } }),
    new AbortController().signal, async (ms) => void log.push(`sleep ${ms}`), cache);
  assert.deepEqual(log, ["fetch 1234567890123", `sleep ${SRM_DELAY_MS}`]);
  assert.deepEqual(page.rows.map((r) => [r.status, !!r.cached]), [["ok", true], ["mismatch_hcode", true], ["not_found", true], ["ok", false], ["ok", false]]);
  assert.equal(page.rows[0].checked_by, "ผู้ตรวจ");
  // บันทึกเฉพาะผลใหม่ HN ละแถว
  assert.deepEqual(freshResults(page.rows).map((r) => r.hn), ["C"]);
});

test("fresh results: 404 not found is saved, errors are not", async () => {
  const visits = new Map([["1", { ...his, vn: "1", hn: "A", cid: "1234567890123" }], ["2", { ...his, vn: "2", hn: "B", cid: "1234567890124" }], ["3", { ...his, vn: "3", hn: "C", cid: "bad" }]]);
  const out = { "1234567890123": { kind: "not_found", message: "x" }, "1234567890124": { kind: "error", message: "timeout" } };
  const page = await checkVisits(["1", "2", "3"], visits, async (pid) => out[pid], new AbortController().signal, async () => {});
  assert.deepEqual(freshResults(page.rows), [{ hn: "A", srm: null }]);
});

test("excel text", () => {
  const r = compareRight(his, { funds: [fund()] });
  assert.deepEqual(srmText(r), { srm_right: "UCS ช่วงอายุ 12-59 ปี", srm_hcode: "11252,07535", srm_status: "ตรงกัน" });
  assert.deepEqual(srmText(undefined), { srm_right: "", srm_hcode: "", srm_status: "" });
});
