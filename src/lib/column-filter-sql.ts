import "server-only";
import { escapeLike } from "@/lib/db";
import { MAX_FILTER_VALUES, inFilterSql, type ColumnFilters, type FacetPage, type FacetValue } from "@/lib/grid-query";

// ตัวกรองหัวคอลัมน์ของ DataGrid ฝั่ง route (ใช้กับ parseColumnFilters ใน @/lib/grid-query)
// แต่ละคอลัมน์ประกาศ SQL ของค่า (allowlist) ; route ส่ง FROM และ WHERE ของตัวเองมา
//   { expr, label? }   ค่า = expr (ส่งเป็นค่าใน cf) ชื่อที่แสดง = "ค่า label" เช่น "053 คลินิกพรีเมียม"
//   { expr, labels }   ค่าเป็นรหัสคงที่ ชื่อจาก map (เช่น Y/N -> ปิดแล้ว/ยังไม่ปิด) ค้นหาในชื่อ
//   { expr, display }  แปลงค่าที่แสดง (เช่น เลขใบเสร็จ 421:1 -> 421/1)
//   { expr, value, where }  ค่าที่คำนวณในโค้ดจากรหัสต้นทาง (เช่น pttype -> กองทุน) นับตาม expr แล้วรวมตาม value(raw)
//                           where(values) แปลงค่าที่เลือกกลับเป็นเงื่อนไขบนรหัสต้นทาง
export type Placeholder = (n: number) => string;
/** ค่าที่ส่งเป็น bind parameter (his/insight รับได้ทั้งคู่) */
export type SqlValue = string | number;
/** his = MySQL ("?"), insight = PostgreSQL ($n) */
export type Dialect = "mysql" | "pg";
export type ColumnFilterDef =
  | { expr: string; label?: string; labels?: Record<string, string>; display?: (v: string) => string }
  | {
      expr: string;
      value: (raw: string | null) => string;
      where: (values: string[], ph: Placeholder, start: number) => { sql: string; params: SqlValue[] };
      /** ชื่อที่แสดงของค่า (ไม่ใส่ = ค่าเอง) */
      labelOf?: (value: string) => string;
    };
export type ColumnFilterDefs = Record<string, ColumnFilterDef>;

const PH: Record<Dialect, Placeholder> = { mysql: () => "?", pg: (n) => `$${n}` };
const CAST_TEXT: Record<Dialect, string> = { mysql: "CHAR", pg: "TEXT" };

/**
 * เงื่อนไขของตัวกรองหัวคอลัมน์ทุกคอลัมน์ ยกเว้น except (ตอนหาค่า facet ของคอลัมน์นั้น)
 * start = เลข placeholder ตัวถัดไป (insight) คืน parts ไว้ต่อด้วย AND และ params ตามลำดับ
 */
export function columnFilterWhere(
  defs: ColumnFilterDefs,
  filters: ColumnFilters<string>,
  except: string | null,
  dialect: Dialect = "mysql",
  start = 1,
): { parts: string[]; params: SqlValue[] } {
  const ph = PH[dialect];
  const parts: string[] = [];
  const params: SqlValue[] = [];
  for (const [key, values] of Object.entries(filters)) {
    if (key === except || !values?.length) continue;
    const def = defs[key];
    const f = "where" in def ? def.where(values, ph, start + params.length) : inFilterSql(def.expr, values, ph, start + params.length);
    parts.push(f.sql);
    params.push(...f.params);
  }
  return { parts, params };
}

type Query = (sql: string, params: SqlValue[]) => Promise<{ v: string | number | null; l?: string | null; n: number | string }[]>;

/**
 * ค่าที่ไม่ซ้ำของคอลัมน์ key ตาม FROM + WHERE ของ route (ซึ่งรวมตัวกรองอื่นแล้ว) เรียงตามจำนวนมากไปน้อย ไม่เกิน MAX_FILTER_VALUES ค่า
 * facetQ ค้นใน SQL (ค่า/label) หรือในชื่อหลังแปลง (labels/display/value)
 */
export async function loadFacet(
  query: Query,
  defs: ColumnFilterDefs,
  key: string,
  facetQ: string,
  from: string,
  where: { sql: string; params: SqlValue[] },
  dialect: Dialect = "mysql",
): Promise<FacetPage> {
  const ph = PH[dialect];
  const def = defs[key];
  const needle = facetQ.toLowerCase();
  const pick = (values: FacetValue[]): FacetPage => {
    const hit = needle ? values.filter((v) => `${v.value} ${v.label}`.toLowerCase().includes(needle)) : values;
    hit.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th"));
    return { values: hit.slice(0, MAX_FILTER_VALUES), truncated: hit.length > MAX_FILTER_VALUES };
  };
  const str = (v: string | number | null) => (v == null ? "" : String(v));

  if ("where" in def) {
    const rows = await query(`SELECT ${def.expr} AS v, COUNT(*) AS n ${from}\n${where.sql}\nGROUP BY ${def.expr}`, where.params);
    const sum = new Map<string, number>();
    for (const r of rows) {
      const v = def.value(r.v == null ? null : String(r.v));
      sum.set(v, (sum.get(v) ?? 0) + Number(r.n));
    }
    return pick([...sum].map(([value, count]) => ({ value, label: def.labelOf?.(value) ?? value, count })));
  }

  // ค้นใน SQL ได้เมื่อค่าที่แสดงคือค่า/label ตรงๆ (ไม่มีการแปลงชื่อในโค้ด)
  const sqlSearch = needle && !def.labels && !def.display;
  const n0 = where.params.length + 1;
  const searchSql = sqlSearch ? ` AND (CAST(${def.expr} AS ${CAST_TEXT[dialect]}) LIKE ${ph(n0)}${def.label ? ` OR ${def.label} LIKE ${ph(n0 + 1)}` : ""})` : "";
  const like = `%${escapeLike(facetQ)}%`;
  const searchParams = sqlSearch ? (def.label ? [like, like] : [like]) : [];
  const limitPh = ph(n0 + searchParams.length);
  const rows = await query(
    `SELECT ${def.expr} AS v, ${def.label ? `MAX(${def.label})` : "NULL"} AS l, COUNT(*) AS n ${from}\n${where.sql}${searchSql}\nGROUP BY ${def.expr} ORDER BY n DESC LIMIT ${limitPh}`,
    [...where.params, ...searchParams, MAX_FILTER_VALUES + 1],
  );
  const values = rows.map((r) => {
    const value = str(r.v);
    const label = def.labels?.[value] ?? def.display?.(value) ?? (r.l ? `${value} ${r.l}` : value);
    return { value, label, count: Number(r.n) };
  });
  if (!sqlSearch && needle) return pick(values);
  return { values: values.slice(0, MAX_FILTER_VALUES), truncated: values.length > MAX_FILTER_VALUES };
}
