// รัน: node --test src/app/api/fdh/files/files.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { FDH_TYPES, FILE_ORDER } from "../c-check/files.ts";
import { exportSql, fileColumns, pageSql } from "./sql.ts";
import { toTxt } from "./txt.ts";

const H = "WITH p AS (SELECT CAST(? AS DATE) AS s, CAST(? AS DATE) AS e)";
const PAGE = " LIMIT ? OFFSET ?";

test("every file has one page SQL: date params first, LIMIT/OFFSET last", () => {
  for (const t of FDH_TYPES) {
    for (const f of FILE_ORDER[t]) {
      const sql = pageSql(t, f);
      assert.ok(sql, `${t}/${f}`);
      assert.ok(sql.startsWith(H), `${t}/${f}`);
      assert.ok(sql.endsWith(PAGE), `${t}/${f}`);
      assert.ok(!sql.includes(";"), `${t}/${f}`);
      assert.ok(!sql.includes("${"), `${t}/${f} template literal ไม่ถูกแทน`);
      // mysql2 แทน ? ตามลำดับ: ก่อน LIMIT ต้องมีแค่ start/end
      assert.equal(sql.slice(0, -PAGE.length).split("?").length - 1, 2, `${t}/${f}`);
      assert.equal(exportSql(t, f), sql.slice(0, -PAGE.length));
      const cols = fileColumns(t, f);
      assert.ok(cols.length > 0 && new Set(cols).size === cols.length, `${t}/${f} columns`);
    }
  }
  assert.equal(pageSql("op", "IPD"), undefined, "IPD เป็นแฟ้มของ IP เท่านั้น");
  assert.deepEqual(fileColumns("ip", "IRF"), ["AN", "REFER", "REFERTYPE"]);
  assert.equal(fileColumns("op", "ADP").length, 27);
  assert.ok(fileColumns("op", "ADP").includes("DCIP/E_screen"));
  assert.equal(fileColumns("op", "INS")[0], "HN");
  // MySQL ต้องได้ '\r' '\n' (backslash จริง) ไม่ใช่ CR/LF ใน SQL
  assert.ok(pageSql("op", "OPD").includes(String.raw`'\r', ' '), '\n', ' '`));
  assert.ok(pageSql("ip", "IPD").includes("ROUND(COALESCE(i.bw, 0) / 1000, 3) AS `ADM_W`"));
});

test("ADP.TMLTCODE: filled in code from icode helper column (not a file column)", async () => {
  const { pickTmlt, applyLabTmlt } = await import("./sql.ts");
  for (const t of FDH_TYPES) {
    assert.ok(exportSql(t, "ADP").includes("'' AS `TMLTCODE`, ") && exportSql(t, "ADP").includes("op.icode AS icode\n"), t);
    assert.ok(!fileColumns(t, "ADP").includes("icode"), t);
  }
  assert.equal(fileColumns("op", "ADP")[16], "TMLTCODE");

  assert.equal(pickTmlt(["A"], ["B"]), "A", "catalog ก่อน");
  assert.equal(pickTmlt(["A", "B"], ["B"]), "B", "catalog หลายค่า: lab_items ยืนยัน");
  assert.equal(pickTmlt(["A", "B"], ["C"]), "", "catalog หลายค่า: lab_items ไม่อยู่ในตัวเลือก");
  assert.equal(pickTmlt(["A", "B"], undefined), "");
  assert.equal(pickTmlt(undefined, ["C"]), "C", "ไม่อยู่ใน catalog → lab_items");
  assert.equal(pickTmlt(undefined, ["C", "D"]), "", "lab_items ขัดกัน → ว่าง");
  assert.equal(pickTmlt(undefined, undefined), "");

  const rows = [
    { CODE: "x", TMLTCODE: "", icode: "3000408" },
    { CODE: "y", TMLTCODE: "", icode: "3003344" },
    { CODE: "z", TMLTCODE: "", icode: "3009999" },
    { CODE: "w", TMLTCODE: "", icode: null },
  ];
  applyLabTmlt(
    rows,
    [{ lab_code: "3000408", tmlt_code: "320151" }],
    [{ icode: "3000408", tmlt_code: "999999" }, { icode: "3003344", tmlt_code: "350001" }, { icode: "3009999", tmlt_code: "1" }, { icode: "3009999", tmlt_code: "2" }],
  );
  assert.deepEqual(rows.map((r) => r.TMLTCODE), ["320151", "350001", "", ""]);
  assert.ok(rows.every((r) => !("icode" in r)), "ลบคอลัมน์ช่วย icode");

  // C914 ใช้ตัดสินเดียวกับ applyLabTmlt: icode ที่ได้ TMLT ไม่ว่าง
  const { resolvedLabIcodes } = await import("./sql.ts");
  const ok = resolvedLabIcodes(
    [{ lab_code: "3000408", tmlt_code: "320151" }, { lab_code: "3000500", tmlt_code: "A" }, { lab_code: "3000500", tmlt_code: "B" }],
    [{ icode: "3003344", tmlt_code: "350001" }, { icode: "3009999", tmlt_code: "1" }, { icode: "3009999", tmlt_code: "2" }],
  );
  assert.deepEqual(ok.sort(), ["3000408", "3003344"], "catalog หลายค่าไม่ยืนยัน และ lab_items ขัดกัน ไม่นับ");
  assert.deepEqual(resolvedLabIcodes([], []), []);
});

test("toTxt: header, | separator, CRLF, null empty, cleans | CR LF and quotes", () => {
  assert.equal(toTxt(["HN", "SEQ"], []), "HN|SEQ\r\n");
  assert.equal(
    toTxt(["HN", "AMOUNT", "AN", "DETAIL"], [
      { HN: "0001", AMOUNT: 12.5, AN: null, DETAIL: 'a|b\r\nc "x"' },
      { HN: "0002", AMOUNT: "0.00", AN: undefined, DETAIL: "" },
    ]),
    'HN|AMOUNT|AN|DETAIL\r\n0001|12.5||a b  c x\r\n0002|0.00||\r\n',
  );
  // คอลัมน์ตามลำดับที่ส่ง ไม่ใช่ลำดับ key ของแถว
  assert.equal(toTxt(["B", "A"], [{ A: 1, B: 2 }]), "B|A\r\n2|1\r\n");
});

test("ipAnExportSql: every IP file filters admissions by AN once, no date range left, placeholders = 2 + n", async () => {
  const { ipAnExportSql } = await import("./sql.ts");
  const { FILE_ORDER } = await import("../c-check/files.ts");
  for (const f of FILE_ORDER.ip) {
    const s = ipAnExportSql(f, 3);
    assert.equal((s.match(/\b(a|i)\.an IN \(\?, \?, \?\)/g) ?? []).length, 1, f);
    assert.equal(/\b(a|i)\.dchdate BETWEEN p\.s AND p\.e/.test(s), false, f);
    assert.equal((s.match(/\?/g) ?? []).length, 5, f);
    assert.equal(/LIMIT \? OFFSET \?/.test(s), false, f);
  }
});

test("INS.PERMITNO per fund and OPD.UUC fixed '1'", () => {
  const op = exportSql("op", "INS"), ip = exportSql("ip", "INS");
  assert.ok(op.includes("LEFT JOIN ovst_seq sq ON sq.vn = v.vn"));
  assert.ok(op.includes("SUBSTRING_INDEX(sq.edc_approve_list_text, ',', -1)"), "OFC OP = Approve Code");
  assert.ok(op.includes("n.vn = v.vn") && ip.includes("n.vn = a.vn"), "UCS = Authen จาก nhso_confirm_privilege ของ visit/visit ที่ admit");
  assert.ok(ip.includes("NULLIF(ap.claim_code, '')") && !ip.includes("sq."), "OFC/LGO IP = claim_code");
  for (const s of [op, ip]) {
    assert.ok(s.includes("WHEN t.hipdata_code = 'STP' THEN COALESCE(NULLIF(ap.auth_code, ''), '')"), "STP = Authen Code");
    assert.ok(s.includes("ELSE COALESCE(v.pttypeno, '') END AS `PERMITNO`"));
  }
  assert.ok(exportSql("op", "OPD").includes("'1' AS `UUC`") && !exportSql("op", "OPD").includes("ovstost IN ('03', '04') THEN '3'"));
});

test("e-Claim 2564: drug split by chrgitem 3/4, DID = icode, IRF by AN, IP LABFU empty, DRUGREMARK one line", async () => {
  const { opDruCheckSql } = await import("./sql.ts");
  for (const t of FDH_TYPES) {
    const dru = exportSql(t, "DRU");
    assert.ok(dru.includes("inc.drg_chrgitem_id IN (3, 4)") && !dru.includes("op.income IN (3, 4)"), `${t} DRU`);
    assert.ok(dru.includes("op.icode AS `DID`") && dru.includes("COALESCE(d.did, '') AS `DIDSTD`"), `${t} DID`);
    for (const f of ["ADP", "PHDB"]) assert.ok(exportSql(t, f).includes("COALESCE(inc.drg_chrgitem_id, 0) NOT IN (3, 4)"), `${t} ${f}`);
  }
  assert.ok(exportSql("ip", "IRF").includes("ro.vn = a.an"));
  assert.ok(exportSql("ip", "LABFU").includes("\nWHERE 1 = 0\n"));
  // DRUGREMARK อยู่ใน SELECT บรรทัดเดียว: opDruCheckSql ตัด SELECT list ทิ้งได้ครบ
  const opDru = exportSql("op", "DRU");
  assert.equal(opDru.split("\n").filter((l) => l.includes("ovst_presc_ned")).length, 1);
  assert.ok(opDru.split("\n").find((l) => l.includes("ovst_presc_ned")).includes("AS `DRUGREMARK`"));
  assert.ok(!opDruCheckSql().includes("ovst_presc_ned") && !opDruCheckSql().includes("DRUGREMARK"));
  assert.ok(exportSql("ip", "DRU").includes("'' AS `DRUGREMARK`"));
});
