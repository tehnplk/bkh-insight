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
// mysql2 แทน `?` ตามลำดับโดยไม่สนเครื่องหมายคำพูด: นับแถว = [start, end] ; กฎ = [start, end, selJson, closedJson, labCsv, catCsv]
// ? ของ labCsv/catCsv มีเฉพาะใน FIND_IN_SET ของ LAB_CAT (หลัง H4) และห้ามมี `?` อื่น
const assertCount = (sql) => {
  assert.ok(sql.startsWith(H), sql.slice(0, 80));
  assert.ok(!sql.includes("${"), "template literal ไม่ถูกแทน");
};
const assertRule = (sql, label) => {
  assert.ok(sql.startsWith(H4), `${label}: ${sql.slice(0, 80)}`);
  assert.ok(!sql.includes("${"), `${label}: template literal ไม่ถูกแทน`);
  const lab = sql.split("FIND_IN_SET(ICODE, ?)").length - 1;
  assert.ok(lab === 0 || lab === 2, `${label}: ? ของ lab ต้องมี 0 หรือ 2 ตัว`);
  assert.equal(qCount(sql) - lab, 4, `${label}: ? นอก lab ต้องมี 4 ตัวพอดี`);
  if (lab) assert.ok(sql.indexOf(" AS LAB") < sql.indexOf(" AS CAT"), `${label}: labCsv ก่อน catCsv`);
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
  for (const c of ["160", "161", "106", "108", "115", "117", "438"]) assert.ok(!all.has(c), c);
  assert.deepEqual(ruleCodes("op", "INS"), ["127", "305", "349", "STP-R175", "STP-AUTH"]);
  assert.deepEqual(ruleCodes("ip", "INS"), ["125", "STP-R175", "STP-AUTH"]);
  assert.deepEqual(ruleCodes("op", "CHA"), ["302", "555"]);
  assert.deepEqual(ruleCodes("op", "ADP"), ["171", "514", "301", "234", "357", "634", "756", "190", "309", "914", "STP-R108", "STP-R188", "STP-R292", "STP-R180", "STP-R194"]);
  assert.deepEqual(ruleCodes("op", "ORF"), ["515", "STP-R113"]);
  assert.deepEqual(ruleCodes("ip", "IRF"), ["515", "STP-R113"]);
  assert.equal(codeLevel("515"), "error");
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
  assert.deepEqual(ruleParams("2026-09-01", "2026-09-30"), ["2026-09-01", "2026-09-30", "[]", "[]", "", ""]);
  assert.deepEqual(ruleParams("2026-09-01", "2026-09-30", ["690915083012", "690915090144"], ["690915083012"], "3000001,3000002", "3000001"), [
    "2026-09-01",
    "2026-09-30",
    "[690915083012,690915090144]",
    "[690915083012]",
    "3000001,3000002",
    "3000001",
  ]);
  // แล็บ (C190/C309/C914) อยู่ในแฟ้ม ADP ทั้งสองหมวด ; IP มี ? ของ lab เฉพาะแฟ้ม ADP
  for (const t of FDH_TYPES) for (const c of ["190", "309", "914"]) {
    assert.ok(ruleCodes(t, "ADP").includes(c), `${t} ${c}`);
    assert.equal(codeLevel(c), "info");
  }
  assert.ok(casesSql("ip", "ADP").includes("FIND_IN_SET") && !casesSql("ip", "DRU").includes("FIND_IN_SET"));
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

test("C555: CHA.CHRGITEM and home drug match between export, count and rules; 16–18 → 19; items grouped by ADP TYPE category", async () => {
  const { exportSql, CHRGITEM, HOME_DRUG } = await import("../files/sql.ts");
  assert.ok(CHRGITEM.includes("WHEN inc.drg_chrgitem_id IN (16, 17, 18) THEN '19'") && CHRGITEM.includes(`IF(${HOME_DRUG}, '04', '03')`));
  const lpad = (s) => s.split(CHRGITEM).join("").includes("LPAD(COALESCE(inc.drg_chrgitem_id");
  for (const t of FDH_TYPES) {
    const cha = exportSql(t, "CHA");
    assert.ok(cha.includes(`${CHRGITEM} AS \`CHRGITEM\``) && cha.includes(`COALESCE(op.rxdate, op.vstdate), ${CHRGITEM}, pt.cid`), `${t} export CHA`);
    assert.ok(countDef(t, "CHA").sql.includes(`COALESCE(op.rxdate, op.vstdate), ${CHRGITEM}, pt.cid`), `${t} count CHA`);
    assert.ok(exportSql(t, "DRU").includes(`CASE WHEN ${HOME_DRUG} THEN '2' ELSE '1' END AS \`USE_STATUS\``), `${t} export DRU`);
    for (const f of ["ADP", "DRU", "CHA", "CHT"]) {
      const sql = ruleSummarySql(t, f);
      assert.ok(sql.includes(`${CHRGITEM} AS CHRGITEM`) && !lpad(sql), `${t} ${f} rule`);
      assert.ok(sql.includes(`CASE WHEN ${HOME_DRUG} THEN '2' ELSE '1' END AS USE_STATUS`), `${t} ${f} dru_s`);
    }
    assert.ok(!lpad(cha) && !lpad(countDef(t, "CHA").sql), t);
    assert.ok(ruleSummarySql(t, "CHA").includes("WHEN 8 THEN CHRGITEM ELSE '19' END") && ruleSummarySql(t, "CHA").includes("ABS(COALESCE(A, 0) - T)"), `${t} C555 ITEM_CAT`);
  }
});

test("INS: OWNRPID/OWNNAME from the right holder of this pttype (same as e-Claim), RELINSCL empty, no parent CID", async () => {
  const { exportSql } = await import("../files/sql.ts");
  for (const t of FDH_TYPES) {
    const ins = exportSql(t, "INS");
    assert.ok(ins.includes("COALESCE(ap.nhso_ownright_pid, '') AS `OWNRPID`, COALESCE(ap.nhso_ownright_name, '') AS `OWNNAME`"), t);
    assert.ok(ins.includes("'' AS `RELINSCL`") && !/father|mother/.test(ins), t);
  }
});

test("C555: every file and rule uses the same line amount/rate; no raw sum_price total left", async () => {
  const { exportSql, ITEM_LINE, ITEM_RATE } = await import("../files/sql.ts");
  const raw = /SUM\(op\.sum_price\)|ROUND\(op\.sum_price, 2\) AS|THEN op\.sum_price ELSE/;
  for (const t of FDH_TYPES) {
    for (const f of ["ADP", "DRU", "CHA", "CHT"]) {
      const sql = exportSql(t, f);
      assert.ok(sql.includes(ITEM_LINE), `${t} ${f} export`);
      assert.ok(!raw.test(sql.split(ITEM_LINE).join("")), `${t} ${f} export ยังใช้ sum_price ตรง`);
    }
    assert.ok(exportSql(t, "ADP").includes(`${ITEM_RATE} AS \`RATE\``) && exportSql(t, "DRU").includes(`${ITEM_RATE} AS \`DRUGPRICE\``), t);
    for (const f of ["ADP", "DRU", "CHA", "CHT"]) {
      const sql = ruleSummarySql(t, f);
      assert.ok(sql.includes(`${ITEM_LINE} AS SP`) && sql.includes(`ROUND(COALESCE(CASE WHEN inc.drg_chrgitem_id IN (3, 4) THEN ROUND(op.qty, 0) ELSE ROUND(op.qty, 2) END, 0) * ${ITEM_RATE}, 2) AS QXP`), `${t} ${f} it`);
      assert.ok(!raw.test(sql.split(ITEM_LINE).join("")), `${t} ${f} rule ยังใช้ sum_price ตรง`);
    }
    assert.ok(ruleSummarySql(t, "DRU").includes(`${ITEM_RATE} AS DRUGPRICE, ${ITEM_LINE} AS TOTAL`), `${t} dru_s`);
    assert.ok(ruleSummarySql(t, "ADP").includes(`${ITEM_RATE} AS RATE, ${ITEM_LINE} AS TOTAL`), `${t} adp_s`);
    assert.ok(countDef(t, "CHA").sql.includes(`HAVING ROUND(SUM(${ITEM_LINE}), 2) > 0`), `${t} count CHA`);
  }
});

test("ODX keeps only ICD-10 rows of ovstdiag; OOP adds ICD-9-CM rows not in doctor_operation (export, count, rules agree)", async () => {
  const { exportSql, fileColumns } = await import("../files/sql.ts");
  const icd10 = "od.icd10 REGEXP '^[A-Za-z]'";
  const icd9 = "od.icd10 REGEXP '^[0-9]' AND NOT EXISTS (SELECT 1 FROM doctor_operation d WHERE d.vn = od.vn AND (d.icd9 = od.icd10 OR d.ovst_diag_id = od.ovst_diag_id))";
  assert.ok(exportSql("op", "ODX").includes(`WHERE ${icd10}`) && countDef("op", "ODX").sql.includes(`WHERE ${icd10}`));
  assert.ok(ruleSummarySql("op", "ODX").includes(`WHERE ${icd10}`));
  assert.ok(exportSql("op", "OOP").includes(`WHERE ${icd9}`) && countDef("op", "OOP").sql.includes(`WHERE ${icd9}`));
  assert.deepEqual(fileColumns("op", "OOP"), ["HN", "DATEOPD", "CLINIC", "OPER", "DROPID", "PERSON_ID", "SEQ", "SERVPRICE"]);
});

test("ODX/IDX: FDH DIAG unchanged; e-Claim ec_diag mapped via icd10_nhso with LEFT JOIN on PK", async () => {
  const { exportSql, fileColumns } = await import("../files/sql.ts");
  for (const [t, f, a] of [["op", "ODX", "od"], ["ip", "IDX", "id"]]) {
    const sql = exportSql(t, f);
    const c = `REPLACE(${a}.icd10, '.', '')`;
    assert.ok(sql.includes(`${c} AS \`DIAG\``), f);
    assert.ok(sql.includes(`CASE WHEN n5.code IS NULL AND n4.code IS NOT NULL THEN n4.code ELSE ${c} END AS ec_diag`), f);
    assert.ok(sql.includes(`LEFT JOIN icd10_nhso n5 ON n5.code = ${c} LEFT JOIN icd10_nhso n4 ON n4.code = LEFT(${c}, 4)`), f);
    assert.ok(!fileColumns(t, f).includes("ec_diag"), f);
  }
});

test("C515: ORF/IRF drop rows without a destination, AER has one row per visit/AN from ER or refer, rule/count/export share the refer formulas", async () => {
  const { exportSql, ipAnExportSql } = await import("../files/sql.ts");
  const refOk = (x) => `TRIM(COALESCE(${x}.refer_hospcode, ${x}.hospcode, '')) NOT IN ('', (SELECT hospitalcode FROM opdconfig LIMIT 1))`;
  const refOut = (k) => `(SELECT MAX(r.referout_id) FROM referout r WHERE r.vn = ${k} AND ${refOk("r")})`;
  const orfFrom = `p JOIN ovst v FORCE INDEX (ix_vstdate) ON v.vstdate BETWEEN p.s AND p.e INNER JOIN referout ro ON ro.vn = v.vn`;
  // ORF ยึดวันรับบริการ (SEQ ชุดเดียวกับ OPD/AER) ไม่ใช่ refer_date
  const orf = exportSql("op", "ORF");
  assert.ok(orf.includes(`FROM ${orfFrom}`) && orf.includes(`AND ${refOk("ro")}`) && !orf.includes("ro.refer_date BETWEEN"));
  assert.ok(countDef("op", "ORF").sql.includes(`${orfFrom} WHERE (v.an IS NULL OR v.an = '') AND ${refOk("ro")}`));
  assert.ok(ruleSummarySql("op", "ORF").includes(`${orfFrom} WHERE (v.an IS NULL OR v.an = '') AND ${refOk("ro")}`));
  for (const s of [exportSql("ip", "IRF"), countDef("ip", "IRF").sql, ruleSummarySql("ip", "IRF")]) assert.ok(s.includes(refOk("ro")), s.slice(0, 80));
  // AER: referout ล่าสุดที่มีปลายทาง (OP ด้วย VN, IP ด้วย AN) และ referin ของ visit ; ไม่ผูกกับ er_regist อย่างเดียว
  for (const [t, k] of [["op", "v.vn"], ["ip", "a.an"]]) {
    const aer = exportSql(t, "AER");
    assert.ok(aer.includes(`LEFT JOIN referout rout ON rout.referout_id = ${refOut(k)}`), t);
    assert.ok(aer.includes("LEFT JOIN er_regist er ON er.vn = v.vn") && aer.includes(`LEFT JOIN referin rin ON rin.vn = v.vn AND ${refOk("rin")}`), t);
    assert.ok(aer.includes("(er.vn IS NOT NULL OR rin.vn IS NOT NULL OR rout.referout_id IS NOT NULL)") && !aer.includes("JOIN er_regist er ON er.vstdate"), t);
    assert.ok(countDef(t, "AER").sql.includes(`EXISTS (SELECT 1 FROM referout r WHERE r.vn = ${k} AND ${refOk("r")})`), t);
    assert.ok(ruleSummarySql(t, t === "op" ? "ORF" : "IRF").includes(refOut(`o.${t === "op" ? "SEQ" : "AN"}`)), t);
  }
  // NOT_OPD ต้องอยู่ในวงเล็บเมื่อมี AND ต่อ
  assert.ok(exportSql("op", "AER").includes("WHERE (v.an IS NULL OR v.an = '') AND"));
  assert.ok(ipAnExportSql("AER", 2).includes("a.an IN (?, ?)"));
  // C514 ไม่มี arm noAER แล้ว (AER มีทุก visit ที่ส่งต่อ)
  assert.ok(!ruleSummarySql("op", "ADP").includes("noAER") && !ruleSummarySql("op", "ADP").includes("er.vn IS NULL"));
});
