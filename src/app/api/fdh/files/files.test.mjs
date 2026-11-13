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
