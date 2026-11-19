// รัน: node --test extension/eclaim-sync/lib/ ; HTML สังเคราะห์ ไม่มีข้อมูลจริง
import assert from "node:assert/strict";
import test from "node:test";
import * as lib from "./sync.js";

test("fiscal year range and months", () => {
  assert.deepEqual(lib.fiscalRange("2026-11"), { from: "2026-10", to: "2026-11" });
  assert.deepEqual(lib.fiscalRange("2027-03"), { from: "2026-10", to: "2027-03" });
  assert.equal(lib.fiscalYear("2026-10"), 2027);
  assert.equal(lib.fiscalYear("2026-09"), 2026);
  assert.deepEqual(lib.months("2026-11", "2027-01"), [{ y: 2026, m: 11 }, { y: 2026, m: 12 }, { y: 2027, m: 1 }]);
  assert.equal(lib.thaiMonthNow(new Date("2026-10-31T18:00:00Z")), "2026-11"); // 01:00 เวลาไทย
});

test("parseArgs", () => {
  const o = lib.parseArgs(["--dry-run"], { ECLAIM_SYNC_HCODE: "11252" }, "2026-11");
  assert.equal(o.from, "2026-10");
  assert.equal(o.to, "2026-11");
  assert.equal(o.dryRun, true);
  assert.equal(o.hcode, "11252");
  assert.equal(o.app, "http://localhost:3000");
  assert.equal(lib.parseArgs(["--from=2026-01", "--hcode=12345"], {}, "2026-11").to, "2026-11");
  assert.equal(lib.parseArgs(["--hcode=12345"], { ECLAIM_SYNC_HCODE: "11252" }, "2026-11").hcode, "12345");
  assert.ok(lib.parseArgs(["--from=2026-13"], {}, "2026-11").error);
  assert.ok(lib.parseArgs(["--from=2026-11", "--to=2026-10"], {}, "2026-11").error);
  assert.ok(lib.parseArgs(["--to=2026-12"], {}, "2026-11").error);
  assert.ok(lib.parseArgs(["--dryrun"], {}, "2026-11").error);
});

test("beToIso", () => {
  assert.equal(lib.beToIso("06/11/2569"), "2026-11-06");
  assert.equal(lib.beToIso(" ออก 29/02/2567 "), "2024-02-29");
  assert.equal(lib.beToIso("31/02/2569"), null);
  assert.equal(lib.beToIso(null), null);
});

test("REP file name, type and support", () => {
  const fn = "eclaim_12345_OP_APPEAL_HC_25691105_143000123.ecd";
  assert.equal(lib.repTypeOf(fn), "OP_APPEAL_HC");
  assert.equal(lib.xlsName(fn), "eclaim_12345_OP_APPEAL_HC_25691105_143000123.xls");
  assert.match(lib.xlsName(fn), /^eclaim_(\d+)_(.+)_(\d{8})_(\d+)(?: \(\d+\))?\.xls$/); // FILE_RE ของ rep.ts
  for (const t of ["IP", "OP", "OP_APPEAL_HC", "IPCS", "OPCS", "IPLGO", "OPLGO", "OPBKK", "OPBMT"]) assert.equal(lib.repSkip(t), null, t);
  for (const t of ["ORF", "IPSSS", "IPBKK"]) assert.equal(lib.repSkip(t), `ยังไม่รองรับ ${t}`);
  assert.ok(lib.repSkip(null));
  assert.equal(lib.repTypeOf("eclaim_12345_OPCS_25691105_143000123.ecd"), "OPCS");
});

test("callArgs", () => {
  const html = `<script>function downloadBill(a, b) {}</script>
<a onclick="downloadBill('X_1', &#39;2&#39;, 12, 'โรง\\'พยาบาล', &quot;จังหวัด&quot;)">x</a><a onclick="downloadBill()">y</a>`;
  assert.deepEqual(lib.callArgs(html, "downloadBill"), [["X_1", "2", "12", "โรง'พยาบาล", "จังหวัด"], []]);
});

test("parseRepList keeps only file name, REP no and date", () => {
  const html = `<table><tr><th>REP</th><th>ไฟล์</th><th>ผู้ดาวน์โหลด</th></tr>
<tr><td>690100001</td><td><a href="#" onclick="dl('eclaim_12345_IP_25691105_143000123.ecd')">eclaim_12345_IP_25691105_143000123.ecd</a></td><td>05/11/2569</td><td>นาย ทดสอบ</td></tr>
<tr><td>690100002</td><td>eclaim_12345_ORF_25691106_090000001.ecd</td></tr>
<tr><td>dup</td><td>eclaim_12345_IP_25691105_143000123.ecd</td></tr></table>`;
  assert.deepEqual(lib.parseRepList(html), [
    { fn: "eclaim_12345_IP_25691105_143000123.ecd", repNo: "690100001", date: "05/11/2569" },
    { fn: "eclaim_12345_ORF_25691106_090000001.ecd", repNo: "690100002", date: null },
  ]);
});

test("parseUcStmList reads issue date column", () => {
  const html = `<table><tr><th>เลขที่เอกสาร</th><th>งวด</th><th>วันที่ออก Statement</th><th></th></tr>
<tr><td>12345_OPUCS256910_01</td><td>01/10/2569</td><td>15/10/2569</td>
<td><input type="button" onclick="downloadBill('12345_OPUCS256910_01','1','12345','โรงพยาบาลทดสอบ','จังหวัดทดสอบ')"></td></tr>
<tr><td>12345_IPUCS256910_01</td><td></td><td>16/10/2569</td>
<td><a onclick="downloadBill('12345_IPUCS256910_01','2','12345','โรงพยาบาลทดสอบ','จังหวัดทดสอบ')">x</a></td></tr></table>`;
  const items = lib.parseUcStmList(html);
  assert.deepEqual(items.map((i) => [i.doc, i.personType, i.issued, i.argc]), [
    ["12345_OPUCS256910_01", "1", "15/10/2569", 5],
    ["12345_IPUCS256910_01", "2", "16/10/2569", 5],
  ]);
  assert.equal(items[0].hname, "โรงพยาบาลทดสอบ");
  assert.match(items[0].doc, lib.UC_DOC);
});

// โครงตามหน้าจริง (พ.ย. 2569): <thead> ไม่มี <tr>, 12 คอลัมน์, <td> ที่ comment ไว้กลางแถว, downloadBill 7 ค่า, ช่องสุดท้าย "ผู้ดาวน์โหลด + วันเวลา"
const realRow = (doc, pt) => `<tr><td class="c">2569</td><td class="c">15/10/2569</td><td class="c">ต.ค.69</td><td class="c">ผู้ป่วยนอก</td><td>งวด 1/2569</td>
<!--<td>1</td>--><td></td><td>${doc}</td><td class="c">12345</td>
<td class="c"><a href="#" onclick="javascript:downloadBill('${doc}','${pt}','12345','โรงพยาบาลทดสอบ','6500 จังหวัดทดสอบ','','')">Download</a></td>
<td></td><td></td><td>นาย ทดสอบ 16/10/2569 10:00</td></tr>`;

test("parseUcStmList: real layout (thead without tr, commented cell)", () => {
  const ths = ["เลขงวด", "วันที่ออก Statement", "เดือนที่ให้บริการ", "ประเภท", "Stmt period", "วันที่ส่ง", "เลขที่ Statement", "รหัสหน่วยบริการ",
    "Download Statement", "Download โดย สปสช.ส่วนกลาง", "Download โดย สปสช.เขต", "Download โดย หน่วยบริการ"].map((t) => `<th>${t}</th>`).join("");
  const html = `<table class="t" id="x"><thead>${ths}</thead><tbody>${realRow("12345_OPUCS256910_01", "1")}${realRow("12345_IPUCS256910_01", "2")}</tbody></table>
<script>function downloadBill(a,b,c,d,e,f,g){}</script>`;
  const items = lib.parseUcStmList(html);
  assert.deepEqual(items.map((i) => [i.doc, i.personType, i.issued, i.argc, i.province]), [
    ["12345_OPUCS256910_01", "1", "15/10/2569", 7, "6500 จังหวัดทดสอบ"],
    ["12345_IPUCS256910_01", "2", "15/10/2569", 7, "6500 จังหวัดทดสอบ"],
  ]);
  assert.equal(items[0].head, undefined);
});

test("parseUcStmList: unknown header falls back to the single date-only cell, else reports header", () => {
  const one = `<table><tr><th>เลขงวด</th><th>วันออก</th></tr><tr><td>2569</td><td>15/10/2569</td><td>นาย ทดสอบ 16/10/2569 10:00</td>
<td><a onclick="downloadBill('12345_OPUCS256910_01','1','12345','ร','จ')">x</a></td></tr></table>`;
  assert.equal(lib.parseUcStmList(one)[0].issued, "15/10/2569");
  const [it] = lib.parseUcStmList(one.replace("<td>15/10/2569</td>", "<td></td>"));
  assert.equal(it.issued, null);
  assert.equal(it.head, "เลขงวด | วันออก");
});

test("parseOfcStmList dedups by document", () => {
  const html = `<tr><td><a onclick="getReportNCHReportRepOFC('12345','OFC','1','2026','10','1','12345_OP202610_01')">OP</a>
<a onclick="getReportNCHReportRepOFC('12345','OFC','1','2026','10','1','12345_OP202610_01')">OP</a></td></tr>`;
  const items = lib.parseOfcStmList(html);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { hcode: "12345", maininscl: "OFC", personType: "1", gyear: "2026", gmonth: "10", revision: "1", doc: "12345_OP202610_01", argc: 7 });
  assert.match(items[0].doc, lib.OFC_DOC);
});
