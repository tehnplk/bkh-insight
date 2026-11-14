// ส่วนที่ route ของ Service catalog ใช้ร่วมกัน: เช็คสิทธิ์ admin, รับไฟล์อัปโหลด, บันทึกชุดข้อมูลแทนที่ชุดเดิม และ GET รายการแบบ DataGrid
import "server-only";
import { auth } from "@/auth";
import { escapeLike, insightQuery, insightTransaction } from "@/lib/db";
import { parseColumnFilters, parseGridQuery, type GridPage } from "@/lib/grid-query";
import { columnFilterWhere, loadFacet, type ColumnFilterDefs, type SqlValue } from "@/lib/column-filter-sql";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import { MAX_FILE_BYTES } from "./parse";

export type CatalogKind = "service_uc" | "service_ofc" | "claim_stp";
/** ชุดข้อมูลล่าสุดที่นำเข้า (null = ยังไม่เคยนำเข้า) */
export type DatasetInfo = { file_name: string; row_count: number; imported_by: string | null; imported_at: string } | null;
export type ImportResult = { status: "imported" | "duplicate" | "error"; file: string; rows?: number; errors?: string[] };

export const importResult = (r: ImportResult, status = 200) => Response.json(r, { status });

// ดู (GET) ได้ทุกคนที่ login ; นำเข้า (POST) เฉพาะ admin เช็คที่นี่ เพราะ path นี้ไม่อยู่ใต้ /api/admin ที่ proxy กันให้
export async function adminSession(): Promise<{ error: Response; name?: undefined } | { error?: undefined; name: string }> {
  const session = await auth();
  if (!session) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (session.user.role !== "admin") return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { name: session.user.name ?? "admin" };
}

/** ไฟล์ Excel จาก multipart field "file" (ตรวจนามสกุลและขนาดก่อนอ่าน) */
export async function readUpload(request: Request): Promise<{ error: Response } | { error?: undefined; name: string; buf: Uint8Array }> {
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return { error: importResult({ status: "error", file: "", errors: ["อ่านไฟล์ที่ส่งมาไม่ได้"] }, 400) };
  }
  if (!(file instanceof File)) return { error: importResult({ status: "error", file: "", errors: ["ไม่พบไฟล์"] }, 400) };
  if (!/\.xlsx?$/i.test(file.name)) return { error: importResult({ status: "error", file: file.name, errors: ["ต้องเป็นไฟล์ .xls หรือ .xlsx"] }, 400) };
  if (file.size > MAX_FILE_BYTES) return { error: importResult({ status: "error", file: file.name, errors: ["ไฟล์ใหญ่เกิน 10 MB"] }, 400) };
  return { name: file.name, buf: new Uint8Array(await file.arrayBuffer()) };
}

const CHUNK = 1000;

/**
 * บันทึกชุดข้อมูลใหม่ใน transaction เดียว: แถว catalog_file (ซ้ำ sha256 = duplicate) แล้วแทนที่แถวเดิมของตารางทั้งหมด
 * table/cols มาจากค่าคงที่ใน route ไม่ได้มาจากผู้ใช้ ; แถวส่งเป็น JSON ก้อนละ CHUNK แถว (parameter ไม่ใหญ่เกิน)
 */
export async function saveDataset(
  kind: CatalogKind,
  meta: { fileName: string; sha256: string; by: string },
  table: string,
  cols: Record<string, string>,
  rows: object[],
): Promise<ImportResult> {
  const names = Object.keys(cols);
  const insert = `INSERT INTO ${table} (file_id, ${names.join(", ")})
SELECT $2, ${names.join(", ")} FROM jsonb_to_recordset($1::jsonb) AS x(${names.map((c) => `${c} ${cols[c]}`).join(", ")})`;
  try {
    const imported = await insightTransaction(async (tx) => {
      const [row] = await tx<{ id: string }>(
        `INSERT INTO catalog_file (kind, file_name, file_sha256, row_count, item_count, imported_by)
VALUES ($1, $2, $3, $4, $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
        [kind, meta.fileName, meta.sha256, rows.length, meta.by],
      );
      if (!row) return false;
      await tx(`DELETE FROM ${table} WHERE file_id <> $1`, [row.id]);
      for (let i = 0; i < rows.length; i += CHUNK) await tx(insert, [JSON.stringify(rows.slice(i, i + CHUNK)), row.id]);
      return true;
    });
    if (!imported) return { status: "duplicate", file: meta.fileName, errors: ["ข้อมูลชุดนี้นำเข้าแล้ว"] };
    return { status: "imported", file: meta.fileName, rows: rows.length };
  } catch (e) {
    console.error("service-catalog import", kind, (e as Error).message);
    return { status: "error", file: meta.fileName, errors: ["บันทึกลงฐานข้อมูลไม่สำเร็จ"] };
  }
}

export async function datasetInfo(kind: CatalogKind): Promise<DatasetInfo> {
  const [info] = await insightQuery<NonNullable<DatasetInfo>>(
    "SELECT file_name, row_count, imported_by, imported_at FROM catalog_file WHERE kind = $1 ORDER BY imported_at DESC, id DESC LIMIT 1",
    [kind],
  );
  return info ?? null;
}

export type ListConfig<T> = {
  kind: CatalogKind;
  /** FROM ... (ค่าคงที่) */
  from: string;
  select: string;
  /** key ที่ DataGrid ส่งมา -> expr (allowlist) */
  sort: Record<string, string>;
  defaultOrder: string;
  /** expr ที่ค้นด้วย q (ILIKE) */
  search: string[];
  filters: ColumnFilterDefs;
  /** คอลัมน์ numeric ของ pg (คืนเป็น string) แปลงเป็น number ก่อนส่ง */
  numeric: (keyof T & string)[];
  xlsx: { file: string; columns: XlsxColumn<T>[] };
};

/** GET + พารามิเตอร์ DataGrid (page, sort, q, cf, facet, format=xlsx) ของตารางรายการอ้างอิง พร้อมข้อมูลชุดที่นำเข้า */
export async function listGet<T extends object>(request: Request, cfg: ListConfig<T>) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const grid = parseGridQuery(params, Object.keys(cfg.sort));
  if (!grid.ok) return Response.json({ error: grid.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters(params, Object.keys(cfg.filters));
  if (!cf.ok) return Response.json({ error: cf.error }, { status: 400 });

  const cfw = columnFilterWhere(cfg.filters, cf.query.filters, cf.query.facet, "pg", 2);
  const where = `WHERE ($1::text IS NULL OR ${cfg.search.map((e) => `${e} ILIKE $1`).join(" OR ")})${cfw.parts.map((p) => ` AND ${p}`).join("")}`;
  const args = [q ? `%${escapeLike(q)}%` : null, ...cfw.params] as SqlValue[];
  if (cf.query.facet) return Response.json(await loadFacet(insightQuery, cfg.filters, cf.query.facet, cf.query.facetQ, cfg.from, { sql: where, params: args }, "pg"));

  const order = `ORDER BY ${sort ? `${cfg.sort[sort]} ${dir === "desc" ? "DESC" : "ASC"} NULLS LAST, ` : ""}${cfg.defaultOrder}`;
  const toNum = (r: T) => {
    const o = { ...r } as Record<string, unknown>;
    for (const k of cfg.numeric) if (o[k] != null) o[k] = Number(o[k]);
    return o as T;
  };
  const sql = `SELECT ${cfg.select} ${cfg.from}\n${where}\n${order}`;
  if (format === "xlsx") return xlsxResponse<T>(cfg.xlsx.file, cfg.xlsx.columns, (await insightQuery<T>(sql, args)).map(toNum));

  const [rows, [{ total }], file] = await Promise.all([
    insightQuery<T>(`${sql}\nLIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, pageSize, (page - 1) * pageSize]),
    insightQuery<{ total: number }>(`SELECT COUNT(*)::int AS total ${cfg.from}\n${where}`, args),
    datasetInfo(cfg.kind),
  ]);
  const body: GridPage<T> & { file: DatasetInfo } = { rows: rows.map(toNum), total, file };
  return Response.json(body);
}
