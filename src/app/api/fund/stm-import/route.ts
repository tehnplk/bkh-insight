import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { escapeLike, insightExecute, insightQuery, insightTransaction } from "@/lib/db";
import { parseColumnFilters, parseGridQuery, type GridPage } from "@/lib/grid-query";
import { columnFilterWhere, loadFacet, type ColumnFilterDefs, type SqlValue } from "@/lib/column-filter-sql";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { MAX_FILE_BYTES, parseStm, StmUnsupportedError, type ParsedStm, type StmRow } from "./stm";

/** แถวของรายการไฟล์ (GET) */
export type StmFileRow = {
  id: string; // bigint มาเป็น string
  period_month: string;
  run_no: number;
  scheme: string;
  patient_type: string;
  doc_no: string;
  file_name: string;
  transfer_date: string;
  row_count: number;
  paid_total: string; // numeric มาเป็น string
  deduction: string;
  net_total: string;
  imported_by: string | null;
  imported_at: string;
};

/** ผลการนำเข้าหนึ่งไฟล์ (POST) */
export type StmImportResult = {
  file: string;
  docNo: string | null;
  status: "imported" | "duplicate" | "unsupported" | "error";
  rows: number;
  netTotal: number | null;
  error?: string;
};

const SORTABLE = [
  "period_month", "scheme", "patient_type", "doc_no", "transfer_date", "row_count", "paid_total", "deduction", "net_total", "imported_by", "imported_at",
] as const;

// $1 = คำค้น (null หรือ LIKE pattern)
const WHERE = `WHERE ($1::text IS NULL OR doc_no ILIKE $1 OR file_name ILIKE $1 OR scheme ILIKE $1)`;
const LIST_COLUMNS = `SELECT id, period_month, run_no, scheme, patient_type, doc_no, file_name, transfer_date, row_count,
  paid_total, deduction, net_total, imported_by, imported_at
FROM stm_file`;
// ตัวกรองหัวคอลัมน์ (allowlist) ยกเว้นยอดเงิน
const FILTER_DEFS: ColumnFilterDefs = {
  period_month: { expr: "to_char(period_month, 'YYYY-MM-DD')" },
  scheme: { expr: "scheme" },
  patient_type: { expr: "patient_type" },
  doc_no: { expr: "doc_no" },
  transfer_date: { expr: "to_char(transfer_date, 'YYYY-MM-DD')" },
  row_count: { expr: "row_count" },
  imported_by: { expr: "imported_by" },
  imported_at: { expr: "to_char(imported_at, 'YYYY-MM-DD')" },
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
  const where = `${WHERE}${cfw.parts.map((p) => ` AND ${p}`).join("")}`;
  const args = [like, ...cfw.params] as SqlValue[];
  if (cf.query.facet) return Response.json(await loadFacet(insightQuery, FILTER_DEFS, cf.query.facet, cf.query.facetQ, "FROM stm_file", { sql: where, params: args }, "pg"));
  // sort มาจาก allowlist จึงใช้เป็นชื่อคอลัมน์ได้ ค่าเริ่มต้นงวดล่าสุดก่อน
  const select = `${LIST_COLUMNS} ${where}
ORDER BY ${sort ?? "period_month"} ${dir === "desc" || !sort ? "DESC" : "ASC"} NULLS LAST, period_month DESC, scheme, patient_type, run_no DESC, id DESC`;

  if (format === "xlsx") {
    const rows = await insightQuery<StmFileRow>(select, args);
    return xlsxResponse<StmFileRow>("stm-files.xlsx", [
      { key: "period_month", header: "งวด", width: 12 },
      { key: "run_no", header: "ครั้งที่", width: 8, type: "count" },
      { key: "scheme", header: "สิทธิ", width: 8 },
      { key: "patient_type", header: "OP/IP", width: 8 },
      { key: "doc_no", header: "เลขที่เอกสาร", width: 24 },
      { key: "transfer_date", header: "วันที่โอน", width: 12 },
      { key: "row_count", header: "จำนวนรายการ", width: 12, type: "count" },
      { key: "paid_total", header: "ยอดชดเชย (บาท)", width: 16, type: "money" },
      { key: "deduction", header: "หัก (บาท)", width: 14, type: "money" },
      { key: "net_total", header: "ยอดโอนสุทธิ (บาท)", width: 16, type: "money" },
      { key: "file_name", header: "ชื่อไฟล์", width: 36 },
      { key: "imported_by", header: "ผู้นำเข้า", width: 24 },
      { key: "imported_at", header: "นำเข้าเมื่อ", width: 20 },
    ], rows);
  }

  const [rows, [{ total }]] = await Promise.all([
    insightQuery<StmFileRow>(`${select}
LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, pageSize, (page - 1) * pageSize]),
    insightQuery<{ total: number }>(`SELECT count(*)::int AS total FROM stm_file ${where}`, args),
  ]);
  const body: GridPage<StmFileRow> = { rows, total };
  return Response.json(body);
}

// ชื่อและชนิดคอลัมน์ที่รับจาก jsonb_to_recordset (ค่าคงที่ในโค้ด ไม่ใช่ค่าจากผู้ใช้)
const ROW_COLS: [keyof StmRow, string][] = [
  ["section", "text"], ["rep_no", "varchar"], ["line_no", "int"], ["tran_id", "varchar"], ["hn", "varchar"], ["an", "varchar"],
  ["pid", "varchar"], ["seq_no", "varchar"], ["admit_at", "timestamp"], ["discharge_at", "timestamp"], ["main_inscl", "varchar"],
  ["proj", "text"], ["source", "text"], ["adjrw", "numeric"], ["claim_total", "numeric"], ["paid_total", "numeric"], ["fund_amounts", "jsonb"],
];
const names = ROW_COLS.map(([n]) => n).join(", ");
const INSERT_ROWS = `INSERT INTO stm_row (stm_file_id, ${names})
SELECT $2, ${names} FROM jsonb_to_recordset($1::jsonb) AS x(${ROW_COLS.map(([n, t]) => `${n} ${t}`).join(", ")})`;
const INSERT_SUMMARY = `INSERT INTO stm_summary (stm_file_id, section, rep_no, period_label, cases, passed, failed, claim_total, amounts, paid_total, source)
SELECT $2, section, rep_no, period_label, cases, passed, failed, claim_total, amounts, paid_total, source
FROM jsonb_to_recordset($1::jsonb) AS x(section text, rep_no varchar, period_label text, cases int, passed int, failed int,
  claim_total numeric, amounts jsonb, paid_total numeric, source text)`;
// ส่งเป็น JSON ทีละก้อน ให้ parameter ไม่ใหญ่เกินไป
const CHUNK = 2000;

const result = (r: StmImportResult, status = 200) => Response.json(r, { status });

/** YYYY-MM-DD ที่เป็นวันจริง และไม่เกินวันนี้ (เวลาไทย) */
function validTransferDate(v: FormDataEntryValue | null): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= "2000-01-01" && v <= todayIso();
}

// หนึ่งไฟล์ต่อ request (หน้าเว็บส่งทีละไฟล์) ใครที่ login แล้วนำเข้าได้
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // proxy ตัด body ที่เกิน proxyClientMaxBodySize (next.config.ts) ทำให้อ่าน form ไม่ได้
    return result({ file: "", docNo: null, status: "error", rows: 0, netTotal: null, error: "อ่านไฟล์ที่ส่งมาไม่ได้" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return result({ file: "", docNo: null, status: "error", rows: 0, netTotal: null, error: "ไม่พบไฟล์" }, 400);
  const base = { file: file.name, docNo: null, rows: 0, netTotal: null };
  const transferDate = form.get("transfer_date");
  if (!validTransferDate(transferDate)) return result({ ...base, status: "error", error: "วันที่โอนไม่ถูกต้อง" }, 400);
  if (!/\.xls$/i.test(file.name)) return result({ ...base, status: "unsupported", error: "ไม่ใช่ไฟล์ .xls" });
  if (file.size > MAX_FILE_BYTES) return result({ ...base, status: "error", error: "ไฟล์ใหญ่เกิน 30 MB" }, 400);

  const buf = new Uint8Array(await file.arrayBuffer());
  let p: ParsedStm;
  try {
    p = parseStm(buf);
  } catch (e) {
    if (e instanceof StmUnsupportedError) return result({ ...base, status: "unsupported", error: e.message });
    return result({ ...base, status: "error", error: (e as Error).message }, 400);
  }
  const done = { ...base, docNo: p.docNo, netTotal: p.netTotal };
  const sha = createHash("sha256").update(buf).digest("hex");

  try {
    const imported = await insightTransaction(async (tx) => {
      // เลขที่เอกสารหรือเนื้อไฟล์ซ้ำ = นำเข้าแล้ว
      const [row] = await tx<{ id: string }>(
        `INSERT INTO stm_file (file_name, file_sha256, doc_no, hcode, scheme, layout, patient_type, period_month, run_no, printed_at,
  transfer_date, paid_total, deduction, net_total, row_count, imported_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) ON CONFLICT DO NOTHING RETURNING id`,
        [file.name, sha, p.docNo, p.hcode, p.scheme, p.layout, p.patientType, p.periodMonth, p.runNo, p.printedAt,
          transferDate, p.paidTotal, p.deduction, p.netTotal, p.rows.length, session.user.name ?? null],
      );
      if (!row) return false;
      await tx(INSERT_SUMMARY, [JSON.stringify(p.summaries), row.id]);
      for (let i = 0; i < p.rows.length; i += CHUNK) await tx(INSERT_ROWS, [JSON.stringify(p.rows.slice(i, i + CHUNK)), row.id]);
      return true;
    });
    if (!imported) return result({ ...done, status: "duplicate", error: "เลขที่เอกสารนี้นำเข้าไว้แล้ว" });
    return result({ ...done, status: "imported", rows: p.rows.length });
  } catch (e) {
    console.error("stm-import", file.name, (e as Error).message);
    return result({ ...done, status: "error", error: "บันทึกลงฐานข้อมูลไม่สำเร็จ" }, 500);
  }
}

// ลบไฟล์ที่นำเข้าผิด (admin เท่านั้น) cascade ลง stm_summary/stm_row ไฟล์ที่ใช้ตัดหนี้ใน ar_ledger แล้วลบไม่ได้
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[1-9]\d{0,17}$/.test(id)) return Response.json({ error: "id ต้องเป็นจำนวนเต็มบวก" }, { status: 400 });

  const used = "ไฟล์นี้ใช้ตัดหนี้แล้ว ลบไม่ได้";
  const [{ settled }] = await insightQuery<{ settled: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ar_ledger l JOIN stm_row r ON r.id = l.stm_row_id WHERE r.stm_file_id = $1) AS settled`,
    [id],
  );
  if (settled) return Response.json({ error: used }, { status: 409 });
  try {
    const { rowCount } = await insightExecute(`DELETE FROM stm_file WHERE id = $1`, [id]);
    if (!rowCount) return Response.json({ error: "ไม่พบไฟล์" }, { status: 404 });
  } catch (e) {
    // ตัดหนี้เกิดขึ้นระหว่างตรวจกับลบ: FK ของ ar_ledger.stm_row_id กันไว้
    if ((e as { code?: string }).code === "23503") return Response.json({ error: used }, { status: 409 });
    throw e;
  }
  return new Response(null, { status: 204 });
}
