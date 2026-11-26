// รัน: node --test extension/eclaim-sync/lib/ ; ecFetch กับ DOM/fetch ปลอม (ไม่ติดต่อ e-Claim)
import assert from "node:assert/strict";
import test from "node:test";
import { ecFetch } from "./tab.js";

const ORIGIN = "https://eclaim.nhso.go.th";

/** ตั้ง document/location/fetch ปลอม: fetch ตอบ body จาก url ที่ redirect ไป (ค่าเริ่มต้น = url เดิม) */
function fake(body, finalPath) {
  globalThis.location = new URL(`${ORIGIN}/webComponent/main/MainWebAction.do`);
  globalThis.document = { createElement: () => ({ set href(v) { this._h = new URL(v, ORIGIN).href; }, get href() { return this._h; } }) };
  globalThis.fetch = async (href) => {
    const res = new Response(body, { headers: { "content-type": "text/html;charset=UTF-8" } });
    Object.defineProperty(res, "url", { value: finalPath ? `${ORIGIN}${finalPath}` : href });
    return res;
  };
}

test("ecFetch: expired ThaiD session pages count as expired, not as an empty list", async () => {
  // รูปแบบที่พบจริงตอน session หมด (ตัดเหลือส่วนที่ใช้ตรวจ)
  fake(`\r\n\r\n<form name="frmErr" >\r\n    คุณไม่มีสิทธิ์เข้าใช้งานหน้าจอดังกล่าว\r\n</form>`);
  assert.deepEqual(await ecFetch("/webComponent/statement_hsub/viewPage.do", "GYEAR=2026", "text"), { expired: true });
  fake(`<html lang="th"><head><title>ประกาศใช้งานระบบ SSO (ThaiD)</title></head><body></body></html>`);
  assert.deepEqual(await ecFetch("/webComponent/statement_hsub/viewPage.do", "GYEAR=2026", "text"), { expired: true });
  fake("<html></html>", "/webComponent/");
  assert.deepEqual(await ecFetch("/webComponent/ucs/statementUCSViewAction.do?year=2026", null, "text"), { expired: true });
  fake(`<form name="frmErr">x</form>`);
  assert.deepEqual(await ecFetch("/webComponent/statement_hsub/DownloadExcelPage.do?x=1", null, "bin"), { expired: true });
});

test("ecFetch: normal list page returns text", async () => {
  fake(`<hr class="form-group"> <div class="text-right">พบข้อมูลทั้งหมด 0 รายการ</div>`);
  const r = await ecFetch("/webComponent/statement_hsub/viewPage.do", "GYEAR=2021", "text");
  assert.match(r.text, /พบข้อมูลทั้งหมด 0 รายการ/);
  assert.deepEqual(await ecFetch("https://evil.example/x", null, "text"), { error: "ปฏิเสธ URL นอก e-Claim" });
});
