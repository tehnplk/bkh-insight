import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { escapeLike, insightQuery } from "@/lib/db";
import { parseColumnFilters, parseGridQuery, type GridPage } from "@/lib/grid-query";
import { columnFilterWhere, loadFacet, type ColumnFilterDefs, type SqlValue } from "@/lib/column-filter-sql";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { LEDGER_START } from "../ar-sync/ledger";
import { locked } from "../ar-sync/sync";
import { parseSettleBody, planSettle, shouldClose, type SettleCounts, type SettleFileRow, type SettleResult } from "./settle";
import { BATCH_COUNTS_SQL, BATCH_INSERT_SQL, SETTLE_INSERT_SQL, loadFile } from "./sql";

// ตัดลูกหนี้ด้วย STM แบบ manual ทีละไฟล์ STM: GET รายการไฟล์ + สถานะการตัด (สัญญา DataGrid), POST ตัดหนี้ของไฟล์หนึ่งไฟล์
// ผู้ที่ login ทุกคนตัดได้ (รวม super user) บันทึกชื่อผู้ตัดใน ar_settle_batch ; ตัดผิดแก้ด้วยคำขอปรับปรุงลูกหนี้ (ไม่มียกเลิกชุด)

const SORTABLE = ["period_month", "scheme", "patient_type", "doc_no", "transfer_date", "row_count", "net_total", "settled_rows", "settled_amount"] as const;
// S1: settled_rows นับบรรทัดที่มีแถว settle หรือ diff แล้ว ; settled_amount = ยอดรับชำระที่ตัดแล้ว (บวก) ; $1 = คำค้น (null หรือ LIKE pattern)
const WHERE = "WHERE ($1::text IS NULL OR f.doc_no ILIKE $1 OR f.scheme ILIKE $1)";
const LIST_SQL = `SELECT f.id::text AS id, f.period_month::text AS period_month, f.run_no, f.scheme, f.patient_type, f.doc_no,
  f.transfer_date::text AS transfer_date, f.row_count, f.net_total, s.paid_rows, s.settled_rows, s.settled_amount,
  b.receipt_no AS last_receipt_no, b.receipt_date::text AS last_receipt_date
FROM stm_file f
CROSS JOIN LATERAL (
  SELECT count(*) FILTER (WHERE r.paid_total <> 0)::int AS paid_rows,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ar_ledger l WHERE l.stm_row_id = r.id))::int AS settled_rows,
         COALESCE((SELECT -SUM(l.amount) FROM ar_ledger l JOIN stm_row r2 ON r2.id = l.stm_row_id
                   WHERE r2.stm_file_id = f.id AND l.kind = 'settle'), 0) AS settled_amount
  FROM stm_row r WHERE r.stm_file_id = f.id) s
LEFT JOIN LATERAL (SELECT receipt_no, receipt_date FROM ar_settle_batch WHERE stm_file_id = f.id ORDER BY id DESC LIMIT 1) b ON true`;
const FILTER_DEFS: ColumnFilterDefs = { scheme: { expr: "f.scheme" }, patient_type: { expr: "f.patient_type" } };
const FILTERABLE = Object.keys(FILTER_DEFS);

export async function GET(request: NextRequest) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = parseGridQuery(request.nextUrl.searchParams, SORTABLE);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = parsed.query;
  const cf = parseColumnFilters(request.nextUrl.searchParams, FILTERABLE);
  if (!cf.ok) return Response.json({ error: cf.error }, { status: 400 });
  const cfw = columnFilterWhere(FILTER_DEFS, cf.query.filters, cf.query.facet, "pg", 2);
  const where = `${WHERE}${cfw.parts.map((p) => ` AND ${p}`).join("")}`;
  const args = [q ? `%${escapeLike(q)}%` : null, ...cfw.params] as SqlValue[];
  if (cf.query.facet) return Response.json(await loadFacet(insightQuery, FILTER_DEFS, cf.query.facet, cf.query.facetQ, "FROM stm_file f", { sql: where, params: args }, "pg"));
  // sort มาจาก allowlist (ชื่อคอลัมน์ผลลัพธ์) ค่าเริ่มต้นงวดล่าสุดก่อน
  const select = `${LIST_SQL} ${where}
ORDER BY ${sort ?? "period_month"} ${dir === "desc" || !sort ? "DESC" : "ASC"} NULLS LAST, period_month DESC, scheme, patient_type, run_no DESC, f.id DESC`;

  if (format === "xlsx") {
    const rows = await insightQuery<SettleFileRow>(select, args);
    return xlsxResponse<SettleFileRow>("ar-settle-files.xlsx", [
      { key: "period_month", header: "งวด", width: 12 },
      { key: "run_no", header: "ครั้งที่", width: 8, type: "count" },
      { key: "scheme", header: "สิทธิ", width: 8 },
      { key: "patient_type", header: "OP/IP", width: 8 },
      { key: "doc_no", header: "เลขที่เอกสาร", width: 24 },
      { key: "transfer_date", header: "วันที่ออก STM", width: 12 },
      { key: "row_count", header: "รายการ", width: 10, type: "count" },
      { key: "net_total", header: "ยอดโอนสุทธิ (บาท)", width: 16, type: "money" },
      { key: "paid_rows", header: "รายการที่จ่าย", width: 12, type: "count" },
      { key: "settled_rows", header: "ตัดแล้ว (รายการ)", width: 12, type: "count" },
      { key: "settled_amount", header: "รับชำระแล้ว (บาท)", width: 16, type: "money" },
      { key: "last_receipt_no", header: "ใบเสร็จล่าสุด", width: 16 },
      { key: "last_receipt_date", header: "วันที่ใบเสร็จล่าสุด", width: 14 },
    ], rows);
  }
  const [rows, [{ total }]] = await Promise.all([
    insightQuery<SettleFileRow>(`${select}
LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, pageSize, (page - 1) * pageSize]),
    insightQuery<{ total: number }>(`SELECT count(*)::int AS total FROM stm_file f ${where}`, args),
  ]);
  const body: GridPage<SettleFileRow> = { rows, total };
  return Response.json(body);
}

class SettleError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
const cents = (v: string | number) => Math.round(Number(v) * 100);

/**
 * POST { stm_file_id, receipt_date, receipt_no, close?: key[], keep?: key[] } (key = "OP:<vn>" | "IP:<an>")
 * คำนวณแผนใหม่จากฐานภายใต้ lock ของ ar_ledger (ไม่เชื่อยอดจาก client) รับชำระทุกรายที่จับคู่ได้ของไฟล์
 * ปิดส่วนต่างตาม close (ติ๊กเพิ่ม) / keep (เอาค่าเริ่มต้นออก) ; กดซ้ำไม่ลงซ้ำ (unique ของ stm_row_id + ไม่มีบรรทัดที่ยังไม่ตัดแล้ว)
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = parseSettleBody(await request.json().catch(() => null), todayIso(), LEDGER_START);
  if ("error" in body) return Response.json({ error: body.error }, { status: 400 });
  const by = session.user.name ?? "";
  if (!by) return Response.json({ error: "ไม่พบชื่อผู้ใช้ใน session" }, { status: 400 });
  try {
    const result = await locked(async (tx): Promise<SettleResult> => {
      const data = await loadFile(tx, body.stm_file_id);
      if (!data) throw new SettleError("ไม่พบไฟล์ STM นี้", 404);
      const entries = planSettle(data.lines, data.debts, { entryDate: body.receipt_date, close: (r) => shouldClose(r, body.close, body.keep) });
      if (!entries.length) throw new SettleError("ไม่มีรายการที่ตัดหรือปิดส่วนต่างได้ (ตัดไปแล้ว หรือยังไม่พบหนี้)", 409);
      if (!body.receipt_no && entries.some((e) => e.kind === "settle")) throw new SettleError("กรอกเลขที่ใบเสร็จ", 400);
      const [{ id }] = await tx<{ id: string }>(BATCH_INSERT_SQL, [body.stm_file_id, body.receipt_date, body.receipt_no, by, session.user.userId ?? null]);
      const rows = await tx<{ kind: "settle" | "diff"; amount: string; shifted: boolean }>(SETTLE_INSERT_SQL, [JSON.stringify(entries), id]);
      // ถือ lock อยู่จึงไม่ควรชน ถ้าชนทั้งหมดให้ ROLLBACK ไม่ทิ้งชุดว่างไว้
      if (!rows.length) throw new SettleError("รายการถูกตัดไปแล้ว", 409);
      const sum = (k: "settle" | "diff") => rows.filter((r) => r.kind === k).reduce((s, r) => s + cents(r.amount), 0) / 100;
      const counts: SettleCounts = {
        settle: rows.filter((r) => r.kind === "settle").length, diff: rows.filter((r) => r.kind === "diff").length,
        settle_amount: -sum("settle"), diff_amount: sum("diff"), shifted: rows.filter((r) => r.shifted).length, skipped: entries.length - rows.length,
      };
      await tx(BATCH_COUNTS_SQL, [id, JSON.stringify(counts)]);
      return { batch_id: id, ...counts };
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof SettleError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
