// สัญญา API ของ DataGrid (ใช้ร่วมกันทุก module)
// GET {endpoint}?page=1&pageSize=20&sort=<column>&dir=asc|desc&q=<text>[&format=xlsx]
//   json -> { rows: T[], total: number }   (total = จำนวนแถวทั้งหมดหลัง filter)
//   xlsx -> ไฟล์ Excel ทุกแถวตาม sort/q ปัจจุบัน (ไม่สน page/pageSize)
//   ค่าไม่ถูกต้อง -> 400 { error: string }

export const MAX_PAGE_SIZE = 100;
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE = 100_000;
const MAX_Q_LENGTH = 100;

export type SortDir = "asc" | "desc";
export type GridPage<T> = { rows: T[]; total: number };
export type GridQuery<C extends string> = {
  page: number;
  pageSize: number;
  /** อยู่ใน allowlist เสมอ จึงต่อเป็นชื่อคอลัมน์ใน SQL ได้ ส่วน q ต้องส่งเป็น bind parameter */
  sort: C | null;
  dir: SortDir;
  /** ข้อความค้นหา (global search) server เป็นคนเลือกว่าค้นคอลัมน์ไหน */
  q: string;
  format: "json" | "xlsx";
};

function int(raw: string | null, name: string, min: number, max: number, fallback: number) {
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} ต้องเป็นจำนวนเต็ม`);
  const n = Number(raw);
  if (n < min || n > max) throw new Error(`${name} ต้องอยู่ระหว่าง ${min}-${max}`);
  return n;
}

export function parseGridQuery<C extends string>(
  params: URLSearchParams,
  sortable: readonly C[],
): { ok: true; query: GridQuery<C> } | { ok: false; error: string } {
  try {
    const sort = params.get("sort") || null;
    if (sort !== null && !(sortable as readonly string[]).includes(sort)) {
      throw new Error(`sort ได้เฉพาะ: ${sortable.join(", ")}`);
    }
    const dir = params.get("dir") || "asc";
    if (dir !== "asc" && dir !== "desc") throw new Error("dir ต้องเป็น asc หรือ desc");
    const format = params.get("format") || "json";
    if (format !== "json" && format !== "xlsx") throw new Error("format ต้องเป็น json หรือ xlsx");
    const q = (params.get("q") ?? "").trim();
    if (q.length > MAX_Q_LENGTH) throw new Error(`q ยาวได้ไม่เกิน ${MAX_Q_LENGTH} ตัวอักษร`);
    return {
      ok: true,
      query: {
        page: int(params.get("page"), "page", 1, MAX_PAGE, 1),
        pageSize: int(params.get("pageSize"), "pageSize", 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
        sort: sort as C | null,
        dir,
        q,
        format,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ตัวกรองหัวคอลัมน์ (แบบ Excel) ของ DataGrid
//   cf={"col":["v1","v2"]}  เก็บแถวที่ค่าของ col อยู่ในรายการ ("" = ช่องว่าง) หลายคอลัมน์ = AND
//   facet=<col>[&facetQ=<text>]  -> FacetPage ค่าที่ไม่ซ้ำของ col ตามตัวกรองอื่นทั้งหมด (ไม่รวม cf ของ col เอง)
// col ต้องอยู่ใน allowlist ของ route ; ค่าส่งเป็น bind parameter เสมอ
export const MAX_FILTER_VALUES = 500;
const MAX_FILTER_VALUE_LENGTH = 200;

export type FacetValue = { value: string; label: string; count: number };
export type FacetPage = { values: FacetValue[]; truncated: boolean };
export type ColumnFilters<C extends string> = Partial<Record<C, string[]>>;
export type ColumnFilterQuery<C extends string> = { filters: ColumnFilters<C>; facet: C | null; facetQ: string };

export function parseColumnFilters<C extends string>(
  params: URLSearchParams,
  filterable: readonly C[],
): { ok: true; query: ColumnFilterQuery<C> } | { ok: false; error: string } {
  const allowed = new Set<string>(filterable);
  const facet = params.get("facet") || null;
  if (facet !== null && !allowed.has(facet)) return { ok: false, error: `facet ได้เฉพาะ: ${filterable.join(", ")}` };
  const facetQ = (params.get("facetQ") ?? "").trim();
  if (facetQ.length > MAX_Q_LENGTH) return { ok: false, error: `facetQ ยาวได้ไม่เกิน ${MAX_Q_LENGTH} ตัวอักษร` };
  const raw = params.get("cf");
  const filters: ColumnFilters<C> = {};
  if (raw) {
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ok: false, error: "cf ต้องเป็น JSON" };
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, error: "cf ต้องเป็น object" };
    for (const [k, v] of Object.entries(obj)) {
      if (!allowed.has(k)) return { ok: false, error: `cf กรองได้เฉพาะ: ${filterable.join(", ")}` };
      if (!Array.isArray(v) || v.length > MAX_FILTER_VALUES || !v.every((x) => typeof x === "string" && x.length <= MAX_FILTER_VALUE_LENGTH)) {
        return { ok: false, error: `cf.${k} ต้องเป็นรายการข้อความไม่เกิน ${MAX_FILTER_VALUES} ค่า` };
      }
      if (v.length) filters[k as C] = [...new Set(v as string[])];
    }
  }
  return { ok: true, query: { filters, facet: facet as C | null, facetQ } };
}

/** ค่าของคอลัมน์ในแถว (route ที่กรองในหน่วยความจำ) null/"" = ว่าง */
export type RowGetters<T, C extends string> = Record<C, (row: T) => string | number | null | undefined>;
const cell = (v: string | number | null | undefined) => (v == null ? "" : String(v));

/** กรองแถวในหน่วยความจำตาม cf (ยกเว้นคอลัมน์ except) ใช้กับ route ที่รวมข้อมูลหลายฐานในโค้ด */
export function filterRows<T, C extends string>(rows: T[], filters: ColumnFilters<C>, get: RowGetters<T, C>, except: C | null = null): T[] {
  const active = (Object.entries(filters) as [C, string[]][]).filter(([k, v]) => k !== except && v?.length).map(([k, v]) => [get[k], new Set(v)] as const);
  return active.length ? rows.filter((r) => active.every(([g, set]) => set.has(cell(g(r))))) : rows;
}

/** facet จากแถวในหน่วยความจำ: ค่าที่ไม่ซ้ำ + จำนวน เรียงมากไปน้อย labelOf แปลงชื่อที่แสดง (ค้นหาในค่าและชื่อ) */
export function facetRows<T>(rows: T[], get: (row: T) => string | number | null | undefined, facetQ: string, labelOf?: (v: string) => string): FacetPage {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = cell(get(r));
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const needle = facetQ.toLowerCase();
  const values = [...counts]
    .map(([value, count]) => ({ value, label: labelOf?.(value) ?? value, count }))
    .filter((v) => !needle || `${v.value} ${v.label}`.toLowerCase().includes(needle))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th"));
  return { values: values.slice(0, MAX_FILTER_VALUES), truncated: values.length > MAX_FILTER_VALUES };
}

/** SQL ของตัวกรองหนึ่งคอลัมน์ ("" ในรายการ = ค่าว่าง/NULL) ph(n) = placeholder ตัวที่ n (his "?", insight `$${n}`) */
export function inFilterSql(expr: string, values: string[], ph: (n: number) => string, start = 1): { sql: string; params: string[] } {
  const real = values.filter((v) => v !== "");
  const parts: string[] = [];
  if (real.length) parts.push(`${expr} IN (${real.map((_, i) => ph(start + i)).join(", ")})`);
  if (real.length < values.length) parts.push(`${expr} IS NULL OR ${expr} = ''`);
  return { sql: parts.length ? `(${parts.join(" OR ")})` : "1 = 0", params: real };
}
