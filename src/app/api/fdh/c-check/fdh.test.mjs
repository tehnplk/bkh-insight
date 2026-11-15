// รัน: node --test src/app/api/fdh/c-check/fdh.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { FDH_TYPES, FILE_ORDER, RULE_CODE_COUNT, STP_RULES, cLabel, codeLevel, compareCode, isFile, parseType } from "./files.ts";
import { CASE_LIMIT, RULES, casesSql, countDef, itemFiles, maskCid, maskFound, ruleCodes, ruleParams, ruleSummarySql } from "./checks.ts";

const H = "WITH p AS (SELECT CAST(? AS DATE) AS s, CAST(? AS DATE) AS e)";
const H4 = `${H},
sel AS (SELECT j.k FROM JSON_TABLE(?, '$[*]' COLUMNS (k BIGINT PATH '$')) j),
cl AS (SELECT j.k FROM JSON_TABLE(?, '$[*]' COLUMNS (k BIGINT PATH '$')) j)`;
const qCount = (sql) => sql.split("?").length - 1;
// mysql2 แทน `?` ตามลำดับโดยไม่สนเครื่องหมายคำพูด: นับแถว = [start, end] ; กฎ = [start, end, selJson, closedJson] และห้ามมี `?` อื่น
const assertCount = (sql) => {
  assert.ok(sql.startsWith(H), sql.slice(0, 80));
  assert.ok(!sql.includes("${"), "template literal ไม่ถูกแทน");
};
const assertRule = (sql, label) => {
  assert.ok(sql.startsWith(H4), `${label}: ${sql.slice(0, 80)}`);
  assert.ok(!sql.includes("${"), `${label}: template literal ไม่ถูกแทน`);
  assert.equal(qCount(sql), 4, `${label}: ? ต้องมี 4 ตัวพอดี`);
  assert.ok(!/CAST\(\? AS JSON\)/.test(sql), `${label}: MariaDB ไม่รองรับ CAST AS JSON`);
};

test("type and file whitelist", () => {
  assert.equal(parseType("op"), "op");
  assert.equal(parseType("ip"), "ip");
  for (const bad of [null, "", "OP", "ipd", "op;"]) assert.equal(parseType(bad), null);
  assert.ok(isFile("op", "OPD"));
  assert.ok(!isFile("ip", "OPD"), "OPD เป็นแฟ้มของ OP/PP เท่านั้น");
  assert.ok(!isFile("op", "IPD"));
  assert.ok(isFile("ip", "LVD"));
  for (const bad of [null, "", "ins", "INS'", "fdh_ins"]) assert.ok(!isFile("op", bad));
  assert.equal(cLabel("116"), "C116");
  assert.equal(cLabel("STP-R175"), "STP-R175");
  assert.deepEqual(["STP-R111", "STP-AUTH", "116", "STP-R108", "105"].sort(compareCode), ["105", "116", "STP-AUTH", "STP-R108", "STP-R111"]);
  assert.equal(codeLevel("116"), "error");
  assert.equal(codeLevel("514"), "error");
  assert.equal(codeLevel("555"), "warn");
  assert.equal(codeLevel("305"), "warn");
  assert.equal(codeLevel("349"), "info");
  assert.equal(codeLevel("STP-R175"), "error");
  assert.equal(codeLevel("STP-R112"), "warn");
  assert.equal(codeLevel("STP-AUTH"), "info");
});

test("every file has one count statement starting with the date params", () => {
  for (const t of FDH_TYPES) {
    for (const f of FILE_ORDER[t]) {
      const { sql, col } = countDef(t, f);
      assertCount(sql);
      assert.equal(qCount(sql), 2, `${t}/${f}`);
      assert.ok(sql.includes(` AS ${col}`), `${t}/${f}`);
    }
  }
  // ADP/PHDB/DRU นับใน statement เดียว
  for (const t of FDH_TYPES) {
    assert.equal(countDef(t, "ADP").sql, countDef(t, "DRU").sql);
    assert.equal(countDef(t, "ADP").sql, countDef(t, "PHDB").sql);
  }
  assert.ok(countDef("op", "CHA").sql.includes("FORCE INDEX (ix_vstdate)"));
  assert.ok(countDef("ip", "ADP").sql.includes("FORCE INDEX (ix_an)"));
});

test("ruleCodes match the codes written in each block, C160/C161 and dropped codes are off", () => {
  const all = new Set();
  for (const t of FDH_TYPES) {
    for (const [file, rule] of Object.entries(RULES[t])) {
      assert.ok(FILE_ORDER[t].includes(file), `${t}/${file}`);
      // arm แบบ SELECT '<code>', '<FILE>' ต้องอยู่ใน codes ; ADP op และ CHA เป็น arm เดียวหลายรหัส จึงเช็คว่าทุกรหัสอยู่ใน SQL
      const inSql = [...rule.sql.matchAll(/SELECT '([\w-]+)'(?: AS c_code)?, '([A-Z]+)'/g)];
      assert.ok(inSql.every((m) => rule.codes.includes(m[1])), `${t}/${file} รหัสใน SQL ไม่อยู่ใน codes`);
      assert.ok(inSql.every((m) => m[2] === file), `${t}/${file} fdh_file`);
      for (const c of rule.codes) assert.ok(rule.sql.includes(`'${c}'`), `${t}/${file} ไม่มี ${c} ใน SQL`);
      assert.equal(new Set(rule.codes).size, rule.codes.length, `${t}/${file} codes ซ้ำ`);
      rule.codes.forEach((c) => all.add(c));
    }
  }
  const stp = [...all].filter((c) => c.startsWith("STP-"));
  assert.equal(all.size - stp.length, RULE_CODE_COUNT);
  // กฎ STP ทุกตัวมีคำอธิบาย/วิธีแก้ และทุกคำอธิบายมีกฎ
  assert.deepEqual(stp.sort(), Object.keys(STP_RULES).sort());
  assert.ok(!ruleSummarySql("ip").includes("STP-R112"), "R112 เป็นกฎ OP เท่านั้น");
  for (const c of ["160", "161", "106", "108", "115", "117", "438", "515"]) assert.ok(!all.has(c), c);
  assert.deepEqual(ruleCodes("op", "INS"), ["127", "305", "349", "STP-R175", "STP-AUTH"]);
  assert.deepEqual(ruleCodes("ip", "INS"), ["125", "STP-R175", "STP-AUTH"]);
  assert.deepEqual(ruleCodes("op", "CHA"), ["302", "555"]);
  assert.deepEqual(ruleCodes("op", "ADP"), ["171", "514", "301", "234", "357", "634", "756", "STP-R108", "STP-R188", "STP-R292", "STP-R180", "STP-R194"]);
  assert.deepEqual(ruleCodes("op", "ORF"), ["STP-R113"]);
  assert.deepEqual(ruleCodes("op", "DRU"), ["301", "303", "565", "STP-R108"]);
  assert.ok(!ruleCodes("ip", "DRU").includes("565"), "C565 เป็นกฎ OP เท่านั้น");
  assert.equal(codeLevel("565"), "warn");
  assert.ok(countDef("ip", "IRF").sql.includes("ro.vn = a.an"));
  assert.ok(!ruleSummarySql("ip").includes("SVCTYPE"));
});

test("rule SQL assembly: 4 params, base without opitemrece, items one statement per file, sel filter before LIMIT", () => {
  for (const t of FDH_TYPES) {
    const items = itemFiles(t);
    assert.deepEqual(items, ["ADP", "DRU", "CHA", "CHT"], t);
    const base = ruleSummarySql(t);
    assertRule(base, `${t} base`);
    assert.ok(base.endsWith(") r GROUP BY c_code, fdh_file"));
    assert.ok(!base.includes("opitemrece"), `${t} base แตะ opitemrece`);
    for (const file of Object.keys(RULES[t])) {
      const isItems = items.includes(file);
      assert.equal(base.includes(`'${file}' AS fdh_file`), !isItems, `${t}/${file} in base`);
      assertRule(ruleSummarySql(t, file), `${t}/${file} summary`);
      const cases = casesSql(t, file);
      assertRule(cases, `${t}/${file} cases`);
      assert.ok(cases.endsWith(`ORDER BY c_code, hn, an, seq LIMIT ${CASE_LIMIT}`));
      assert.ok(cases.includes(") r\nWHERE NOT EXISTS (SELECT 1 FROM sel) OR "), `${t}/${file} sel`);
      assert.ok(cases.includes(file === "PAT" ? "r.hn IN (SELECT" : `CAST(r.${t === "op" ? "seq" : "an"} AS UNSIGNED) IN (SELECT k FROM sel)`));
      if (isItems) assert.ok(cases.includes(t === "op" ? "opitemrece op FORCE INDEX (ix_vstdate)" : "opitemrece op FORCE INDEX (ix_an)"), `${t}/${file}`);
      else assert.ok(!cases.includes("opitemrece"), `${t}/${file} base แตะ opitemrece`);
      // เฉพาะ block ของแฟ้มนั้น
      for (const other of Object.keys(RULES[t])) if (other !== file) assert.ok(!cases.includes(`'${other}' AS fdh_file`));
    }
  }
  assert.ok(ruleSummarySql("ip", "IPD").includes("NOT REGEXP '^0{0,1}[1-9]$'"));
  // C305/C349 อ่าน ovst ตามวันที่ด้วย index เสมอ และเทียบ VN เป็นตัวเลข (ไม่ CAST AS CHAR)
  // modal ขอ CASE_LIMIT + 1 แถวเพื่อรู้ว่าถูกตัดจริง ; หน้า /fdh/c-check ใช้ค่าเริ่มต้น
  assert.ok(casesSql("ip", "IDX", CASE_LIMIT + 1).endsWith(`LIMIT ${CASE_LIMIT + 1}`));
  const ins = casesSql("op", "INS");
  assert.equal(ins.split("ovst o FORCE INDEX (ix_vstdate)").length - 1, 2);
  assert.ok(ins.includes("CAST(o.vn AS UNSIGNED) NOT IN (SELECT k FROM cl)") && !/CAST\([^)]* AS CHAR\)/.test(ins));
});

test("ruleParams: JSON arrays of numbers", () => {
  assert.deepEqual(ruleParams("2026-09-01", "2026-09-30"), ["2026-09-01", "2026-09-30", "[]", "[]"]);
  assert.deepEqual(ruleParams("2026-09-01", "2026-09-30", ["690915083012", "690915090144"], ["690915083012"]), [
    "2026-09-01",
    "2026-09-30",
    "[690915083012,690915090144]",
    "[690915083012]",
  ]);
});

test("CID is masked for C104/C116 only", () => {
  assert.equal(maskCid("1234567890123"), "1234xxxxx0123");
  assert.equal(maskCid("12345"), "xxxxx");
  assert.equal(maskCid(""), "");
  assert.equal(maskFound("116", "1234567890123"), "1234xxxxx0123");
  assert.equal(maskFound("104", " "), "x");
  assert.equal(maskFound("104", null), null);
  assert.equal(maskFound("101", "นายสมชาย "), "นายสมชาย ");
});

test("ins.PERMITNO of C127/C125 uses the same CASE as the exported INS.PERMITNO", async () => {
  const { exportSql } = await import("../files/sql.ts");
  const norm = (s) => s.replace(/\s+/g, " ").replace(/\ba\.VN\b/g, "a.vn");
  for (const t of FDH_TYPES) {
    const exported = exportSql(t, "INS").match(/CASE WHEN t\.hipdata_code = 'UCS'.*? END AS `PERMITNO`/s)[0].replace(" AS `PERMITNO`", "");
    const checked = ruleSummarySql(t, "INS").match(/CASE WHEN t\.hipdata_code = 'UCS'.*? END AS PERMITNO/s)[0].replace(" AS PERMITNO", "");
    assert.equal(norm(checked), norm(exported), t);
  }
  assert.ok(!ruleSummarySql("op").includes("ovstost"), "UUC = '1' เหมือนแฟ้มส่งออก");
});

test("ADP.TYPE and drug split in rules match the exported ADP/DRU", async () => {
  const { exportSql } = await import("../files/sql.ts");
  const adpType = exportSql("op", "ADP").match(/COALESCE\(CASE inc\.drg_chrgitem_id .*? END, nd\.nhso_adp_type_id, 3\)/)[0];
  for (const t of FDH_TYPES) {
    const adp = ruleSummarySql(t, "ADP");
    assert.equal(adp.split(`${adpType} AS ADPTYPE`).length - 1, 2, `${t} it + adp_s`);
    assert.ok(adp.includes("COALESCE(d.icode IS NOT NULL AND inc.drg_chrgitem_id IN (3, 4), 0) AS IS_DRU"), t);
    assert.ok(!/op\.income (NOT )?IN \(3, ?4\)/.test(adp + ruleSummarySql(t, "DRU") + countDef(t, "DRU").sql), `${t} ยังแยกยาด้วย income`);
    assert.ok(exportSql(t, "ADP").includes(`${adpType} AS \`TYPE\``));
  }
});
