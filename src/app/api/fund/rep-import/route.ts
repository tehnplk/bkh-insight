import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { auth } from "@/auth";
import { escapeLike, insightQuery, insightTransaction } from "@/lib/db";
import { parseColumnFilters, parseGridQuery, type GridPage } from "@/lib/grid-query";
import { columnFilterWhere, loadFacet, type ColumnFilterDefs, type SqlValue } from "@/lib/column-filter-sql";
import { xlsxResponse } from "@/lib/xlsx";
import { MAX_FILE_BYTES, parseFileName, parseRep, type RepRow } from "./rep";
import { UC_DASHBOARD_TAG } from "../uc-dashboard/dashboard";

/** แถวของรายการไฟล์ (GET) */
export type RepFileRow = {
  id: string; // bigint มาเป็น string
  file_date: string | null;
  file_name: string;
  rep_type: string;
  row_count: number;
  passed: number | null;
  failed: number | null;
  paid_total: string | null; // numeric มาเป็น string
  imported_at: string;
  imported_by: string | null;
};

/** ผลการนำเข้าหนึ่งไฟล์ (POST) */
export type RepImportResult = {
  file: string;
  type: string | null;
  status: "imported" | "duplicate" | "unsupported" | "error";
  rows: number;
  reps: string[];
  error?: string;
};

const SORTABLE = ["file_date", "file_name", "rep_type", "row_count", "passed", "failed", "paid_total", "imported_at", "imported_by"] as const;

// ยอดผ่าน/ไม่ผ่าน/ชดเชย จากชีต Summary ของไฟล์ $1 = คำค้น (null หรือ LIKE pattern)
const LIST_FROM = `FROM rep_file f
LEFT JOIN LATERAL (
  SELECT sum(passed)::int AS passed, sum(failed)::int AS failed, sum(paid_total) AS paid_total
  FROM rep_summary WHERE rep_file_id = f.id
) s ON true`;
const LIST_WHERE = "WHERE ($1::text IS NULL OR f.file_name ILIKE $1 OR f.rep_type ILIKE $1)";
// ตัวกรองหัวคอลัมน์ (allowlist) ยกเว้นยอดเงิน
const FILTER_DEFS: ColumnFilterDefs = {
  file_date: { expr: "to_char(f.file_date, 'YYYY-MM-DD')" },
  file_name: { expr: "f.file_name" },
  rep_type: { expr: "f.rep_type" },
  row_count: { expr: "f.row_count" },
  passed: { expr: "s.passed" },
  failed: { expr: "s.failed" },
  imported_at: { expr: "to_char(f.imported_at, 'YYYY-MM-DD')" },
  imported_by: { expr: "f.imported_by" },
};
const FILTERABLE = Object.keys(FILTER_DEFS);

export async function GET(request: NextRequest) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = parseGridQuery(request.nextUrl.searchParams, SORTABLE);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = parsed.query;
  const cf = parseColumnFilters(request.nextUrl.searchParams, FILTERABLE);
  if (!cf.ok) return Response.json({ error: cf.error }, { status: 400 });
  const like = q ? `%${escapeLike(q)}%` : null;
  const cfw = columnFilterWhere(FILTER_DEFS, cf.query.filters, cf.query.facet, "pg", 2);
  const where = `${LIST_WHERE}${cfw.parts.map((p) => ` AND ${p}`).join("")}`;
  const args: (SqlValue | null)[] = [like, ...cfw.params];
  if (cf.query.facet) {
    return Response.json(await loadFacet(insightQuery, FILTER_DEFS, cf.query.facet, cf.query.facetQ, LIST_FROM, { sql: where, params: args as SqlValue[] }, "pg"));
  }
  // sort มาจาก allowlist จึงใช้เป็นชื่อคอลัมน์ได้
  const select = `SELECT f.id, f.file_date, f.file_name, f.rep_type, f.row_count, s.passed, s.failed, s.paid_total, f.imported_at, f.imported_by
${LIST_FROM}
${where}
ORDER BY ${sort ?? "imported_at"} ${dir === "desc" || !sort ? "DESC" : "ASC"} NULLS LAST, f.id DESC`;

  if (format === "xlsx") {
    const rows = await insightQuery<RepFileRow>(select, args);
    return xlsxResponse<RepFileRow>("rep-files.xlsx", [
      { key: "file_date", header: "วันที่ไฟล์", width: 12 },
      { key: "file_name", header: "ชื่อไฟล์", width: 44 },
      { key: "rep_type", header: "ประเภท", width: 16 },
      { key: "row_count", header: "จำนวนแถว", width: 12, type: "count" },
      { key: "passed", header: "ผ่าน", width: 10, type: "count" },
      { key: "failed", header: "ไม่ผ่าน", width: 10, type: "count" },
      { key: "paid_total", header: "ชดเชยรวม (บาท)", width: 16, type: "money" },
      { key: "imported_at", header: "นำเข้าเมื่อ", width: 20 },
      { key: "imported_by", header: "ผู้นำเข้า", width: 24 },
    ], rows);
  }

  const [rows, [{ total }]] = await Promise.all([
    insightQuery<RepFileRow>(`${select}
LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, pageSize, (page - 1) * pageSize]),
    insightQuery<{ total: number }>(`SELECT count(*)::int AS total ${LIST_FROM}
${where}`, args),
  ]);
  const body: GridPage<RepFileRow> = { rows, total };
  return Response.json(body);
}

// ชื่อและชนิดคอลัมน์ของ rep_row ที่รับจาก jsonb_to_recordset (ค่าคงที่ในโค้ด ไม่ใช่ค่าจากผู้ใช้)
const ROW_COLS: [keyof RepRow, string][] = [
  ["tran_id", "varchar"], ["rep_no", "varchar"], ["sheet", "text"], ["patient_type", "varchar"], ["hn", "varchar"],
  ["an", "varchar"], ["pid", "varchar"], ["seq_no", "varchar"], ["admit_at", "timestamp"], ["discharge_at", "timestamp"],
  ["net_nhso", "numeric"], ["net_affiliation", "numeric"], ["claim_total", "numeric"], ["central_reimburse", "numeric"],
  ["self_pay", "numeric"], ["paid", "numeric"], ["error_codes", "text[]"], ["main_fund", "text[]"], ["sub_fund", "text[]"],
  ["main_inscl", "varchar"], ["sub_inscl", "varchar"], ["hmain", "varchar"], ["proj", "text"], ["drg", "varchar"],
  ["rw", "numeric"], ["adjrw", "numeric"], ["fund_amounts", "jsonb"], ["deny", "jsonb"], ["remark", "text"], ["pay_mode", "text"],
];
const names = ROW_COLS.map(([n]) => n).join(", ");
// TRAN_ID เดิม (ไฟล์อุทธรณ์ส่งแถวเดิมซ้ำ) เขียนทับด้วยไฟล์ที่นำเข้าล่าสุด
const UPSERT_ROWS = `INSERT INTO rep_row (rep_file_id, ${names})
SELECT $2, ${names} FROM jsonb_to_recordset($1::jsonb) AS x(${ROW_COLS.map(([n, t]) => `${n} ${t}`).join(", ")})
ON CONFLICT (tran_id) DO UPDATE SET rep_file_id = EXCLUDED.rep_file_id, ${ROW_COLS.filter(([n]) => n !== "tran_id")
  .map(([n]) => `${n} = EXCLUDED.${n}`)
  .join(", ")}, updated_at = now()`;
const INSERT_SUMMARY = `INSERT INTO rep_summary (rep_file_id, rep_no, sheet, period, total_cases, passed, failed, amounts, paid_affiliation, paid_total)
SELECT $2, rep_no, sheet, period, total_cases, passed, failed, amounts, paid_affiliation, paid_total
FROM jsonb_to_recordset($1::jsonb) AS x(rep_no varchar, sheet text, period text, total_cases int, passed int, failed int,
  amounts jsonb, paid_affiliation numeric, paid_total numeric)`;
// ส่งเป็น JSON ทีละก้อน ให้ parameter ไม่ใหญ่เกินไป
const CHUNK = 2000;

const result = (r: RepImportResult, status = 200) => Response.json(r, { status });

// หนึ่งไฟล์ต่อ request (หน้าเว็บส่งทีละไฟล์) ใครที่ login แล้วนำเข้าได้
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    // proxy ตัด body ที่เกิน proxyClientMaxBodySize (next.config.ts) ทำให้อ่าน form ไม่ได้
    return result({ file: "", type: null, status: "error", rows: 0, reps: [], error: "อ่านไฟล์ที่ส่งมาไม่ได้" }, 400);
  }
  if (!(file instanceof File)) return result({ file: "", type: null, status: "error", rows: 0, reps: [], error: "ไม่พบไฟล์" }, 400);
  const base = { file: file.name, type: null, rows: 0, reps: [] };
  const info = parseFileName(file.name);
  if (!info) return result({ ...base, status: "error", error: "ชื่อไฟล์ไม่ใช่ไฟล์ REP ของ e-Claim (eclaim_*.xls)" }, 400);
  const typed = { ...base, type: info.type };
  if (file.size > MAX_FILE_BYTES) return result({ ...typed, status: "error", error: "ไฟล์ใหญ่เกิน 30 MB" }, 400);
  // shortcut: ORF มีรูปแบบต่างกัน (1 แถวต่อไฟล์) ยังไม่ได้เขียนตัวอ่าน ทำเมื่อต้องใช้ข้อมูล ORF
  if (info.type === "ORF") return result({ ...typed, status: "unsupported", error: "ยังไม่รองรับ ORF" });

  const buf = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    parsed = parseRep(buf);
  } catch (e) {
    return result({ ...typed, status: "error", error: (e as Error).message }, 400);
  }
  const reps = [...new Set(parsed.rows.map((r) => r.rep_no))].sort();
  const sha = createHash("sha256").update(buf).digest("hex");

  try {
    const imported = await insightTransaction(async (tx) => {
      // ชื่อไฟล์หรือเนื้อไฟล์ซ้ำ = นำเข้าแล้ว
      const [row] = await tx<{ id: string }>(
        `INSERT INTO rep_file (file_name, file_sha256, hcode, rep_type, file_date, printed_at, row_count, imported_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING RETURNING id`,
        [file.name, sha, info.hcode, info.type, info.fileDate, parsed.printedAt, parsed.rows.length, session.user.name ?? null],
      );
      if (!row) return false;
      if (parsed.summaries.length) await tx(INSERT_SUMMARY, [JSON.stringify(parsed.summaries), row.id]);
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        await tx(UPSERT_ROWS, [JSON.stringify(parsed.rows.slice(i, i + CHUNK)), row.id]);
      }
      return true;
    });
    if (!imported) return result({ ...typed, status: "duplicate", reps, error: "นำเข้าแล้ว" });
    revalidateTag(UC_DASHBOARD_TAG, { expire: 0 }); // ภาพรวมลูกหนี้ UC คำนวณใหม่ในคำขอถัดไป
    return result({ ...typed, status: "imported", rows: parsed.rows.length, reps });
  } catch (e) {
    console.error("rep-import", file.name, (e as Error).message);
    return result({ ...typed, status: "error", reps, error: "บันทึกลงฐานข้อมูลไม่สำเร็จ" }, 500);
  }
}
