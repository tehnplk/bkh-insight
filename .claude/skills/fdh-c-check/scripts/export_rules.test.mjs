// รัน: node --test .claude/skills/fdh-c-check/scripts/export_rules.test.mjs
// ล้มเมื่อไฟล์ใน skill ไม่ตรงกับกฎปัจจุบันของ checks.ts (แก้ด้วย node .claude/skills/fdh-c-check/scripts/export_rules.mjs)
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { render } from "./export_rules.mjs";
import { fillParams } from "./fill_params.mjs";

const SKILL = fileURLToPath(new URL("..", import.meta.url));
const out = render();

test("skill files equal the SQL generated from checks.ts (no drift, no stale files)", () => {
  for (const [path, body] of out) assert.equal(readFileSync(join(SKILL, path), "utf8"), body, `${path} ไม่ตรง: รัน export_rules.mjs ใหม่`);
  for (const t of ["op", "ip"]) {
    const onDisk = readdirSync(join(SKILL, "sql", t)).map((f) => `sql/${t}/${f}`).sort();
    assert.deepEqual(onDisk, [...out.keys()].filter((p) => p.startsWith(`sql/${t}/`)).sort(), `sql/${t} มีไฟล์ค้าง`);
  }
});

test("every statement file: header has no placeholder, ? count matches the documented params", () => {
  const m = JSON.parse(out.get("sql/manifest.json"));
  const stmts = Object.values(m.types).flatMap((t) => [...t.summary, ...Object.values(t.files).flatMap((f) => [f.rows, f.cases].filter(Boolean))]);
  assert.equal(new Set(stmts.map((s) => s.sql)).size, out.size - 4); // ทุกไฟล์ .sql ยกเว้น preflight + json 3 ไฟล์
  for (const s of stmts) {
    const sql = out.get(s.sql);
    assert.equal(sql.split("?").length - 1, s.params.length, s.sql);
    assert.ok(!sql.includes("%%"), s.sql);
  }
  // ไม่มีค่าเฉพาะโรงพยาบาล
  for (const [path, body] of out) assert.ok(!/11252|nhso_save_endpoint_log|rep_error_code|lab_catalog_fdh/.test(path.endsWith(".sql") ? body : ""), path);
});

test("SKILL.md lists every code that has a rule", () => {
  const md = readFileSync(join(SKILL, "SKILL.md"), "utf8");
  const { levels } = JSON.parse(out.get("references/levels.json"));
  for (const c of Object.keys(levels)) assert.ok(md.includes(`| ${/^\d+$/.test(c) ? `C${c}` : c} |`), `SKILL.md ไม่มีแถวของ ${c}`);
});

test("fillParams: validated literals in order, defaults, rejects bad input", () => {
  const sql = "-- h\n-- params\n\nSELECT ?, ?, ?, ?, ?, ?";
  assert.equal(fillParams(sql, ["2026-11-16", "2026-11-16"]), "SELECT '2026-11-16', '2026-11-16', '[]', '[]', '', ''");
  assert.equal(fillParams("SELECT ?, ?, ?", ["2026-11-01", "2026-11-30", "[1, 2]"]), "SELECT '2026-11-01', '2026-11-30', '[1,2]'");
  assert.equal(fillParams("SELECT ?, ?, ?, ?, ?, ?", ["2026-11-01", "2026-11-30", "[]", "[]", "3000001,3000002", "L1.2"]).endsWith("'[]', '3000001,3000002', 'L1.2'"), true);
  for (const bad of [["2026-11-1", "2026-11-30"], ["2026-11-01"], ["2026-11-01", "2026-11-30", "[1,'x']"], ["2026-11-01", "2026-11-30", "[]", "[]", "1');DROP"]])
    assert.throws(() => fillParams("SELECT ?, ?, ?, ?, ?", bad), String(bad));
  assert.throws(() => fillParams("SELECT ?, ?, ?, ?, ?, ?, ?", ["2026-11-01", "2026-11-30"]));
  // db-cli read-only ปฏิเสธคำ REPLACE
  assert.equal(fillParams("SELECT REPLACE(od.icd10, '.', '') AS DIAG", ["2026-11-16", "2026-11-16"]), "SELECT REGEXP_REPLACE(od.icd10, '[.]', '') AS DIAG");
  for (const [path, body] of out) if (path.endsWith(".sql")) assert.ok(!/\bREPLACE\b/.test(fillParams(body, ["2026-11-16", "2026-11-16"])), path);
});
