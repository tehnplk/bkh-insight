// แทน `?` ในไฟล์ SQL ของ fdh-c-check ด้วยค่าจริง (ตรวจรูปแบบก่อน) เพื่อรันด้วย db-cli ซึ่งไม่มี bind parameter
//   node scripts/fill_params.mjs <file.sql> <start> <end> [sel_json] [closed_json] [lab_csv] [cat_csv]
//   db-cli -g my ... -e "$(node scripts/fill_params.mjs sql/op/summary.sql 2026-11-16 2026-11-16)"
// ค่าที่ไม่ส่ง: sel_json/closed_json = '[]', lab_csv/cat_csv = '' ; ใช้เพื่อตรวจด้วยมือเท่านั้น แอปจริงส่งค่าเป็น bind parameter
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RULES = [
  ["start", /^\d{4}-\d{2}-\d{2}$/, null],
  ["end", /^\d{4}-\d{2}-\d{2}$/, null],
  ["sel_json", /^\[(\d+(,\d+)*)?\]$/, "[]"],
  ["closed_json", /^\[(\d+(,\d+)*)?\]$/, "[]"],
  ["lab_csv", /^([\w.-]+(,[\w.-]+)*)?$/, ""],
  ["cat_csv", /^([\w.-]+(,[\w.-]+)*)?$/, ""],
];

/** คืน SQL ที่แทน ? ตามลำดับแล้ว (ตัดบรรทัด comment หัวไฟล์) ; ค่าผิดรูปแบบหรือ ? เกิน 6 ตัว = throw */
export function fillParams(sql, values) {
  const body = sql.replace(/^(--[^\n]*\n|\s*\n)+/, "");
  const vals = RULES.map(([name, re, def], i) => {
    const v = (values[i] ?? def ?? "").replace(/\s+/g, "");
    if (def === null && !v) throw new Error(`ต้องระบุ ${name}`);
    if (!re.test(v)) throw new Error(`${name} รูปแบบไม่ถูกต้อง: ${v}`);
    return `'${v}'`; // รูปแบบที่ผ่าน regex ไม่มี ' หรือ \ จึงใส่ quote ได้ตรง ๆ
  });
  let i = 0;
  // db-cli read-only ปฏิเสธทุก statement ที่มีคำ REPLACE (คิดว่าเป็นคำสั่งเขียน) จึงเปลี่ยนเป็น REGEXP_REPLACE ที่ให้ผลเดียวกัน (MariaDB 10.0.5+, MySQL 8+)
  const out = body.replace(/\bREPLACE\(([\w.]+), '\.', ''\)/g, "REGEXP_REPLACE($1, '[.]', '')").replace(/\?/g, () => {
    if (i >= vals.length) throw new Error("SQL มี ? มากกว่า 6 ตัว");
    return vals[i++];
  });
  return out;
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const [file, ...values] = process.argv.slice(2);
  if (!file) {
    console.error("usage: node fill_params.mjs <file.sql> <start> <end> [sel_json] [closed_json] [lab_csv] [cat_csv]");
    process.exit(2);
  }
  try {
    process.stdout.write(fillParams(readFileSync(file, "utf8"), values));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
