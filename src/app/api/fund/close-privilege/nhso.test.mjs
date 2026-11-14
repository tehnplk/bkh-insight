// รัน: node --test src/app/api/fund/close-privilege/nhso.test.mjs (mock fetch ไม่ยิง สปสช. จริง)
import assert from "node:assert/strict";
import test from "node:test";
import { TEST_URL, buildClaimBody, isClosableNow, msUntilMidnight, parseResponse, postClaim, readConfig, thaiDate } from "./nhso.ts";

const full = { NHSO_ENDPOINT_TOKEN: "t", NHSO_ENDPOINT_CLAIM_PATH: "/api/claim", NHSO_ENDPOINT_SOURCE_ID: "SRC" };

test("config: missing names, default test zone, prod only on the production host", () => {
  const empty = readConfig({});
  assert.deepEqual(empty.missing, ["NHSO_ENDPOINT_TOKEN", "NHSO_ENDPOINT_CLAIM_PATH", "NHSO_ENDPOINT_SOURCE_ID"]);
  assert.equal(empty.zone, "test");
  assert.equal(empty.endpoint, null);
  const t = readConfig(full);
  assert.deepEqual(t.missing, []);
  assert.equal(t.endpoint, `${TEST_URL}api/claim`);
  const p = readConfig({ ...full, NHSO_ENDPOINT_URL: "https://nhsoapi.nhso.go.th/nhsoendpoint" });
  assert.equal(p.zone, "prod");
  assert.equal(p.endpoint, "https://nhsoapi.nhso.go.th/nhsoendpoint/api/claim");
  assert.equal(readConfig({ ...full, NHSO_ENDPOINT_URL: "http://localhost:4999/" }).zone, "test");
  assert.match(readConfig({ ...full, NHSO_ENDPOINT_URL: "not a url" }).missing[0], /NHSO_ENDPOINT_URL/);
});

test("time: Thai date, today-only window, time left to midnight", () => {
  const at2330 = Date.parse("2026-11-14T23:30:00+07:00");
  assert.equal(thaiDate(at2330), "2026-11-14");
  assert.equal(thaiDate(Date.parse("2026-11-15T00:00:00+07:00")), "2026-11-15");
  assert.equal(msUntilMidnight(at2330), 30 * 60_000);
  assert.equal(isClosableNow("2026-11-14", at2330), true);
  assert.equal(isClosableNow("2026-11-13", at2330), false);
  assert.equal(isClosableNow("2026-11-14", Date.parse("2026-11-15T00:00:01+07:00")), false);
});

test("body: key order and values as HOSxP sends", () => {
  const nowMs = Date.parse("2026-11-14T15:00:00+07:00");
  const b = buildClaimBody({
    hcode: "11252", vn: "691114080000", pid: "1234567890123", vstdate: "2026-11-14", vsttime: "08:00:00",
    mainInscl: "UCS", total: "150.5", cash: 0, privilege: 150.5, sourceId: "SRC", recorderPid: "3210987654321", nowMs,
  });
  assert.deepEqual(Object.keys(b), [
    "hcode", "visitNumber", "pid", "transactionId", "serviceDateTime", "invoiceDateTime", "mainInsclCode",
    "totalAmount", "paidAmount", "privilegeAmount", "claimServiceCode", "sourceId", "recorderPid",
  ]);
  assert.equal(b.transactionId, "11252691114080000");
  assert.equal(b.serviceDateTime, Date.parse("2026-11-14T07:55:00+07:00"));
  assert.equal(b.invoiceDateTime, nowMs - 300_000);
  assert.equal(b.totalAmount, 150.5);
  assert.equal(b.claimServiceCode, "PG0060001");
});

test("response: success, dataError, text, HTTP error; 13-digit ids masked", () => {
  assert.deepEqual(parseResponse(200, '{"seq":12345678901,"authenCode":"EP1234567890"}'), { ok: true, seq: "12345678901", authenCode: "EP1234567890" });
  assert.deepEqual(parseResponse(200, '{"dataError":"visit ซ้ำ"}'), { ok: false, error: "ผลตอบกลับไม่มีรหัส authenCode: visit ซ้ำ" });
  assert.deepEqual(parseResponse(400, '{"dataError":{"pid":"1234567890123 ไม่ถูกต้อง"}}'), { ok: false, error: 'HTTP 400: {"pid":"************* ไม่ถูกต้อง"}' });
  assert.deepEqual(parseResponse(401, "Unauthorized"), { ok: false, error: "HTTP 401: Unauthorized" });
  assert.deepEqual(parseResponse(502, ""), { ok: false, error: "HTTP 502" });
});

test("postClaim: sends Bearer JSON, handles network error and timeout", async () => {
  let seen;
  const ok = await postClaim(async (url, init) => {
    seen = { url, init };
    return new Response('{"seq":1,"authenCode":"EP0000000001"}', { status: 200 });
  }, "http://mock/claim", "tok", { a: 1 });
  assert.deepEqual(ok, { ok: true, seq: "1", authenCode: "EP0000000001", httpStatus: 200 });
  assert.equal(seen.init.headers.Authorization, "Bearer tok");
  assert.equal(seen.init.body, '{"a":1}');

  const down = await postClaim(async () => { throw new TypeError("fetch failed"); }, "http://mock", "t", {});
  assert.deepEqual(down, { ok: false, error: "เชื่อมต่อ สปสช. ไม่สำเร็จ: fetch failed", httpStatus: null });

  const slow = await postClaim((_, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))), "http://mock", "t", {}, 20);
  assert.equal(slow.ok, false);
  assert.match(slow.error, /ไม่ได้รับผลภายใน/);
});
