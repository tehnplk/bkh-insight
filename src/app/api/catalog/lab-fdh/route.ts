import { createHash } from "node:crypto";
import { read, utils } from "xlsx";
import { auth } from "@/auth";
import { escapeLike, hisQuery, insightQuery, insightTransaction } from "@/lib/db";
import { parseColumnFilters, parseGridQuery, type GridPage } from "@/lib/grid-query";
import { columnFilterWhere, loadFacet, type ColumnFilterDefs, type SqlValue } from "@/lib/column-filter-sql";
import { xlsxResponse } from "@/lib/xlsx";
import type { CatalogFileInfo, DrugNhsoImportResult } from "../drug-nhso/drug-nhso";
import { MAX_LAB_FDH_BYTES, parseLabFdh, type LabFdhItem } from "./parse";

const COLS = [
  "line_no", "benefit_plan", "cgd_code", "name", "unit", "price", "gyear", "start_at", "end_at",
  "flag", "tmlt_code", "tmlt_name", "lab_code", "loinc", "exception",
] as const;
const COL_TYPES: Record<string, string> = { line_no: "integer", price: "numeric", gyear: "smallint", start_at: "timestamp", end_at: "timestamp" };
// ส่งแถวเป็น JSON ก้อนเดียว (564 แถวต่อไฟล์) ชื่อคอลัมน์มาจากรายการคงที่ข้างบน ไม่ได้มาจากผู้ใช้
const INSERT_ROWS = `INSERT INTO lab_catalog_fdh (file_id, ${COLS.join(", ")})
SELECT $2, ${COLS.join(", ")} FROM jsonb_to_recordset($1::jsonb) AS x(${COLS.map((c) => `${c} ${COL_TYPES[c] ?? "text"}`).join(", ")})`;

const result = (r: DrugNhsoImportResult, status = 200) => Response.json(r, { status });

/** POST multipart file: นำเข้าไฟล์ Lab Catalog จาก FDH แทนที่ชุดเดิมทั้งหมด (เก็บประวัติไฟล์ใน catalog_file) เฉพาะ admin */
export async function POST(request: Request) {
  // path นี้ไม่อยู่ใต้ /api/admin ที่ proxy กันให้ จึงเช็ค role เอง
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return result({ status: "error", file: "", errors: ["อ่านไฟล์ที่ส่งมาไม่ได้"] }, 400);
  }
  if (!(file instanceof File)) return result({ status: "error", file: "", errors: ["ไม่พบไฟล์"] }, 400);
  if (!/\.xlsx?$/i.test(file.name)) return result({ status: "error", file: file.name, errors: ["ต้องเป็นไฟล์ .xlsx"] }, 400);
  if (file.size > MAX_LAB_FDH_BYTES) return result({ status: "error", file: file.name, errors: ["ไฟล์ใหญ่เกิน 10 MB"] }, 400);

  // รหัสหน่วยบริการของโรงพยาบาลจาก HOSxP (เหมือน /api/fund/close-privilege) กันนำเข้าไฟล์ของหน่วยบริการอื่น
  const [cfg] = await hisQuery<{ hospitalcode: string | null }>("SELECT hospitalcode FROM opdconfig LIMIT 1");
  const hcode = String(cfg?.hospitalcode ?? "").trim();
  if (!hcode) return result({ status: "error", file: file.name, errors: ["ไม่พบรหัสหน่วยบริการใน HOSxP (opdconfig)"] }, 500);

  const buf = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    const wb = read(buf, { type: "buffer" });
    parsed = parseLabFdh(utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true }), hcode);
  } catch (e) {
    return result({ status: "error", file: file.name, errors: [`อ่านไฟล์ Excel ไม่ได้: ${(e as Error).message}`] }, 400);
  }
  if (parsed.errors.length) return result({ status: "error", file: file.name, errors: parsed.errors }, 400);
  const sha = createHash("sha256").update(buf).digest("hex");

  try {
    const imported = await insightTransaction(async (tx) => {
      const [row] = await tx<{ id: string }>(
        `INSERT INTO catalog_file (kind, file_name, file_sha256, row_count, item_count, imported_by)
VALUES ('lab_fdh', $1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
        [file.name, sha, parsed.rows.length, parsed.itemCount, session.user.name ?? "admin"],
      );
      if (!row) return false;
      // เก็บเฉพาะชุดล่าสุด: ไฟล์จาก FDH เป็นรายการทั้งหมดของหน่วยบริการ ณ วันที่ออกรายงาน
      await tx("DELETE FROM lab_catalog_fdh WHERE file_id <> $1", [row.id]);
      await tx(INSERT_ROWS, [JSON.stringify(parsed.rows), row.id]);
      return true;
    });
    if (!imported) return result({ status: "duplicate", file: file.name, errors: ["ไฟล์นี้นำเข้าแล้ว"] });
    return result({ status: "imported", file: file.name, rows: parsed.rows.length, items: parsed.itemCount });
  } catch (e) {
    console.error("catalog/lab-fdh import", file.name, (e as Error).message);
    return result({ status: "error", file: file.name, errors: ["บันทึกลงฐานข้อมูลไม่สำเร็จ"] }, 500);
  }
}

const SORT_SQL = {
  benefit_plan: "benefit_plan", lab_code: "lab_code", name: "name", cgd_code: "cgd_code", unit: "unit", price: "price", gyear: "gyear",
  start_at: "start_at", end_at: "end_at", flag: "flag", tmlt_code: "tmlt_code", tmlt_name: "tmlt_name", loinc: "loinc",
} as const;
type SortKey = keyof typeof SORT_SQL;
const SORTABLE = Object.keys(SORT_SQL) as SortKey[];

// ตารางเก็บเฉพาะไฟล์ล่าสุด จึงอ่านทั้งตาราง ; $1 = คำค้น (null หรือ LIKE pattern)
const FROM = "FROM lab_catalog_fdh v";
const SEARCH_WHERE = "WHERE ($1::text IS NULL OR v.lab_code ILIKE $1 OR v.cgd_code ILIKE $1 OR v.name ILIKE $1 OR v.tmlt_code ILIKE $1 OR v.tmlt_name ILIKE $1 OR v.loinc ILIKE $1)";
// ตัวกรองหัวคอลัมน์ (allowlist) ยกเว้นราคา
const FILTER_DEFS: ColumnFilterDefs = Object.fromEntries(
  ["benefit_plan", "cgd_code", "unit", "flag", "exception"].map((c) => [c, { expr: `v.${c}` }]),
);
FILTER_DEFS.gyear = { expr: "v.gyear::text" };
FILTER_DEFS.start_at = { expr: "to_char(v.start_at, 'YYYY-MM-DD')" };
FILTER_DEFS.end_at = { expr: "to_char(v.end_at, 'YYYY-MM-DD')" };
const FILTERABLE = Object.keys(FILTER_DEFS);
const SELECT = `SELECT ${COLS.map((c) => `v.${c}`).join(", ")} ${FROM}`;

/** GET + พารามิเตอร์ DataGrid: รายการ Lab จากไฟล์ล่าสุด และข้อมูลไฟล์ที่นำเข้า (ทุกคนที่ login) */
export async function GET(request: Request) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const searchParams = new URL(request.url).searchParams;
  const grid = parseGridQuery<SortKey>(searchParams, SORTABLE);
  if (!grid.ok) return Response.json({ error: grid.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters(searchParams, FILTERABLE);
  if (!cf.ok) return Response.json({ error: cf.error }, { status: 400 });
  const like = q ? `%${escapeLike(q)}%` : null;
  const cfw = columnFilterWhere(FILTER_DEFS, cf.query.filters, cf.query.facet, "pg", 2);
  const where = `${SEARCH_WHERE}${cfw.parts.map((p) => ` AND ${p}`).join("")}`;
  const args = [like, ...cfw.params] as SqlValue[];
  if (cf.query.facet) return Response.json(await loadFacet(insightQuery, FILTER_DEFS, cf.query.facet, cf.query.facetQ, FROM, { sql: where, params: args }, "pg"));
  const order = `ORDER BY ${SORT_SQL[sort ?? "lab_code"]} ${dir === "desc" ? "DESC" : "ASC"} NULLS LAST, line_no`;

  if (format === "xlsx") {
    const rows = await insightQuery<LabFdhItem>(`${SELECT}\n${where}\n${order}`, args);
    return xlsxResponse<LabFdhItem>("lab-catalog-fdh.xlsx", [
      { key: "benefit_plan", header: "สิทธิประโยชน์", width: 8 },
      { key: "lab_code", header: "Lab Code", width: 10 },
      { key: "name", header: "ชื่อ", width: 30 },
      { key: "cgd_code", header: "รหัสกรมบัญชีกลาง", width: 10 },
      { key: "unit", header: "หน่วย", width: 12 },
      { key: "price", header: "ราคากลาง (บาท)", width: 12, type: "money" },
      { key: "gyear", header: "gyear", width: 6 },
      { key: "start_at", header: "วันที่เริ่มต้น", width: 18 },
      { key: "end_at", header: "วันที่สิ้นสุด", width: 18 },
      { key: "flag", header: "flag", width: 6 },
      { key: "tmlt_code", header: "TMLT Code", width: 10 },
      { key: "tmlt_name", header: "TMLT Name", width: 40 },
      { key: "loinc", header: "LOINC", width: 10 },
      { key: "exception", header: "Exception", width: 12 },
    ], rows);
  }

  const [rows, [{ total }], [info]] = await Promise.all([
    insightQuery<LabFdhItem>(`${SELECT}\n${where}\n${order}\nLIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, pageSize, (page - 1) * pageSize]),
    insightQuery<{ total: number }>(`SELECT COUNT(*)::int AS total ${FROM}\n${where}`, args),
    insightQuery<NonNullable<CatalogFileInfo>>(
      "SELECT file_name, row_count, item_count, imported_by, imported_at FROM catalog_file WHERE kind = 'lab_fdh' ORDER BY imported_at DESC, id DESC LIMIT 1",
    ),
  ]);
  const body: GridPage<LabFdhItem> & { file: CatalogFileInfo } = { rows, total, file: info ?? null };
  return Response.json(body);
}
