// รัน: node --test src/app/api/fdh/c-check/fdh.test.mjs (node >= 23.6 อ่าน .ts ได้เอง)
import assert from "node:assert/strict";
import test from "node:test";
import { FDH_TYPES, FILE_ORDER, RULE_CODE_COUNT, cLabel, isFile, parseType } from "./files.ts";
import { CASE_LIMIT, RULES, casesSql, countDef, maskCid, maskFound, ruleCodes, ruleSummarySql } from "./checks.ts";

const H = "WITH p AS (SELECT CAST(? AS DATE) AS s, CAST(? AS DATE) AS e)";
// mysql2 แทน `?` ตามลำดับ: สองตัวแรกต้องเป็นวันที่ใน H ส่วน `?` อื่น (ใน regex) ต้องอยู่หลัง H
const assertParams = (sql) => {
  assert.ok(sql.startsWith(H), sql.slice(0, 80));
  assert.ok(!sql.includes("${"), "template literal ไม่ถูกแทน");
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
});

test("every file has one count statement starting with the date params", () => {
  for (const t of FDH_TYPES) {
    for (const f of FILE_ORDER[t]) {
      const { sql, col } = countDef(t, f);
      assertParams(sql);
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

test("ruleCodes match the codes written in each block, C160/C161 are off", () => {
  const all = new Set();
  for (const t of FDH_TYPES) {
    for (const [file, rule] of Object.entries(RULES[t])) {
      assert.ok(FILE_ORDER[t].includes(file), `${t}/${file}`);
      const inSql = [...rule.sql.matchAll(/SELECT '(\d+)'(?: AS c_code)?, '([A-Z]+)'/g)];
      assert.deepEqual(inSql.map((m) => m[1]), rule.codes, `${t}/${file}`);
      assert.ok(inSql.every((m) => m[2] === file), `${t}/${file} fdh_file`);
      rule.codes.forEach((c) => all.add(c));
    }
  }
  assert.equal(all.size, RULE_CODE_COUNT);
  assert.ok(!all.has("160") && !all.has("161"));
  assert.deepEqual(ruleCodes("op", "INS"), ["127"]);
  assert.deepEqual(ruleCodes("ip", "INS"), ["125"]);
  assert.deepEqual(ruleCodes("op", "CHA"), []);
  assert.ok(!ruleSummarySql("ip").includes("SVCTYPE"));
});

test("rule SQL assembly", () => {
  for (const t of FDH_TYPES) {
    const all = ruleSummarySql(t);
    assertParams(all);
    assert.ok(all.endsWith(") r GROUP BY c_code, fdh_file"));
    for (const file of Object.keys(RULES[t])) {
      assert.ok(all.includes(`'${file}' AS fdh_file`));
      const cases = casesSql(t, file);
      assertParams(cases);
      assert.ok(cases.endsWith(`ORDER BY c_code, hn, an, seq LIMIT ${CASE_LIMIT}`));
      // เฉพาะ block ของแฟ้มนั้น
      for (const other of Object.keys(RULES[t])) if (other !== file) assert.ok(!cases.includes(`'${other}' AS fdh_file`));
    }
  }
  assert.ok(ruleSummarySql("ip", "IPD").includes("NOT REGEXP '^0?[1-9]$'"));
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
