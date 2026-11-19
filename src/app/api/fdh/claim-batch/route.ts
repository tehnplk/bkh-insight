import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { escapeLike, insightQuery } from "@/lib/db";
import { parseColumnFilters, parseGridQuery } from "@/lib/grid-query";
import { columnFilterWhere, loadFacet, type ColumnFilterDefs, type SqlValue } from "@/lib/column-filter-sql";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import { parseRange } from "@/app/api/fund/_lib/fund";
import { BATCH_STATUS_LABEL, CHANNEL_SHORT, parseBatch, parseBatchAction, type BatchPage, type BatchRow, type BatchStatus } from "./claim";

/** ประวัติส่งออกไม่อ่าน opitemrece จึงยอมช่วงยาว (ต้องตรงกับ MAX_DAYS ของหน้า /fdh/claim-batch) */
const MAX_DAYS = 366;
const STATUS_SQL = "CASE WHEN b.cancelled_at IS NOT NULL THEN 'cancelled' WHEN b.confirmed_at IS NOT NULL THEN 'confirmed' ELSE 'pending' END";
const SORTABLE = ["created_at", "item_count", "total_amount", "created_by", "submitted_on"] as const;
const FILTER_DEFS: ColumnFilterDefs = {
  channel: { expr: "b.channel", labels: CHANNEL_SHORT },
  patient_type: { expr: "b.patient_type" },
  status: { expr: STATUS_SQL, labels: BATCH_STATUS_LABEL },
  created_by: { expr: "b.created_by" },
};
const FILTERABLE = Object.keys(FILTER_DEFS);
const ts = (col: string) => `to_char(b.${col}, 'YYYY-MM-DD HH24:MI') AS ${col}`;
const SELECT = `SELECT b.id::text AS id, ${ts("created_at")}, b.channel, b.patient_type, b.item_count, b.total_amount::float8 AS total_amount, b.created_by,
  ${STATUS_SQL} AS status, ${ts("confirmed_at")}, b.confirmed_by, b.submitted_on::text AS submitted_on, b.note, ${ts("cancelled_at")}, b.cancelled_by
FROM claim_batch b`;

type XlsxRow = Omit<BatchRow, "channel" | "status"> & { channel: string; status: string };
const XLSX_COLUMNS: XlsxColumn<XlsxRow>[] = [
  { key: "id", header: "ชุด", width: 8 },
  { key: "created_at", header: "วันที่ส่งออก", width: 18 },
  { key: "channel", header: "ช่องทาง", width: 12 },
  { key: "patient_type", header: "OP/IP", width: 6 },
  { key: "item_count", header: "จำนวนราย", width: 10, type: "count" },
  { key: "total_amount", header: "ยอดรวม (บาท)", width: 14, type: "money" },
  { key: "created_by", header: "ผู้ส่งออก", width: 24 },
  { key: "status", header: "สถานะ", width: 10 },
  { key: "submitted_on", header: "วันที่อัปโหลด", width: 12 },
  { key: "confirmed_by", header: "ผู้ยืนยัน", width: 24 },
  { key: "confirmed_at", header: "เวลายืนยัน", width: 18 },
  { key: "cancelled_by", header: "ผู้ยกเลิก", width: 24 },
  { key: "cancelled_at", header: "เวลายกเลิก", width: 18 },
  { key: "note", header: "หมายเหตุ", width: 40 },
];

/**
 * GET ประวัติส่งออก (สัญญา DataGrid + start/end ของวันที่ส่งออก + ตัวกรองหัวคอลัมน์ channel/patient_type/status/created_by)
 * q = ชื่อผู้ส่งออก/ผู้ยืนยัน/หมายเหตุ (บางส่วน) หรือเลขชุด/VN/AN/HN ที่อยู่ในชุด (ตรงตัว)
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const parsed = parseGridQuery(params, SORTABLE);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const range = parseRange(params, MAX_DAYS);
  if (!range.ok) return Response.json({ error: range.error }, { status: 400 });
  const cf = parseColumnFilters(params, FILTERABLE);
  if (!cf.ok) return Response.json({ error: cf.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = parsed.query;

  // $1-$2 ช่วงวันที่ส่งออก (เวลาไทย) ; $3 = คำค้นแบบ ILIKE, $4 = คำค้นตรงตัว (เลขชุด หรือ VN/AN/HN ที่อยู่ในชุด)
  // shortcut: ค้น VN/AN/HN สแกน claim_batch_item ทั้งตาราง (ไม่มี index ของ hn) ยอมได้ถึงราวแสนแถว ถ้าค้นช้าให้เพิ่ม index (ref) และ (hn)
  const cfw = columnFilterWhere(FILTER_DEFS, cf.query.filters, cf.query.facet, "pg", 5);
  const where = `WHERE b.created_at >= $1::date AND b.created_at < $2::date + 1
  AND ($3::text IS NULL OR b.created_by ILIKE $3 OR b.confirmed_by ILIKE $3 OR b.note ILIKE $3 OR b.id::text = $4
    OR EXISTS (SELECT 1 FROM claim_batch_item i WHERE i.batch_id = b.id AND (i.ref = $4 OR i.hn = $4)))${cfw.parts.map((p) => ` AND ${p}`).join("")}`;
  const args = [range.range.start, range.range.end, q ? `%${escapeLike(q)}%` : null, q || null, ...cfw.params] as SqlValue[];
  if (cf.query.facet)
    return Response.json(await loadFacet(insightQuery, FILTER_DEFS, cf.query.facet, cf.query.facetQ, "FROM claim_batch b", { sql: where, params: args }, "pg"));

  // sort มาจาก allowlist จึงใช้เป็นชื่อคอลัมน์ได้
  const select = `${SELECT} ${where}\nORDER BY b.${sort ?? "created_at"} ${sort && dir === "asc" ? "ASC" : "DESC"} NULLS LAST, b.id DESC`;
  if (format === "xlsx") {
    const rows = await insightQuery<BatchRow>(`${select} LIMIT 100000`, args);
    return xlsxResponse<XlsxRow>(
      "claim-batch.xlsx",
      XLSX_COLUMNS,
      rows.map((r) => ({ ...r, channel: CHANNEL_SHORT[r.channel], status: BATCH_STATUS_LABEL[r.status] })),
    );
  }
  const n = args.length;
  const [rows, [summary]] = await Promise.all([
    insightQuery<BatchRow>(`${select} LIMIT $${n + 1} OFFSET $${n + 2}`, [...args, pageSize, (page - 1) * pageSize]),
    insightQuery<Record<BatchStatus, number>>(
      `SELECT count(*) FILTER (WHERE b.cancelled_at IS NULL AND b.confirmed_at IS NULL)::int AS pending,
              count(*) FILTER (WHERE b.cancelled_at IS NULL AND b.confirmed_at IS NOT NULL)::int AS confirmed,
              count(*) FILTER (WHERE b.cancelled_at IS NOT NULL)::int AS cancelled
       FROM claim_batch b ${where}`,
      args,
    ),
  ]);
  const body: BatchPage = { rows, total: summary.pending + summary.confirmed + summary.cancelled, summary };
  return Response.json(body);
}

/**
 * POST { channel, patient_type, file_sha256, items } บันทึกชุดไฟล์ส่งเคลมที่ modal 16 แฟ้มเพิ่งสร้าง (หลักฐาน "ส่งออกแล้ว รอยืนยัน" ของสถานะเคลม)
 * คำสั่งเดียว = ลงหัวชุดและทุกรายพร้อมกันหรือไม่ลงเลย ; super user ไม่มี user_id จึงเก็บชื่อใน session ; คืน id ไว้ยืนยันส่งแล้ว
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = parseBatch(await request.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { channel, patient_type, file_sha256, items } = parsed.value;
  const total = items.reduce((s, i) => s + (i.cht_total ?? 0), 0);
  const col = <K extends keyof (typeof items)[number]>(k: K) => items.map((i) => i[k]);
  try {
    const [row] = await insightQuery<{ id: string }>(
      `WITH b AS (
         INSERT INTO claim_batch (channel, patient_type, created_by, user_id, item_count, total_amount, file_sha256)
         VALUES ($1, $2, $3, $4, $5, round($6::numeric, 2), $7) RETURNING id
       ), i AS (
         INSERT INTO claim_batch_item (batch_id, patient_type, ref, hn, service_date, scheme, subtype, hospmain, cht_total, pdx)
         SELECT b.id, $2, u.* FROM b,
           unnest($8::text[], $9::text[], $10::date[], $11::text[], $12::text[], $13::text[], $14::numeric[], $15::text[])
             AS u(ref, hn, service_date, scheme, subtype, hospmain, cht_total, pdx)
       )
       SELECT id::text FROM b`,
      [
        channel, patient_type, session.user.name ?? "ไม่ทราบชื่อ", session.user.userId ?? null, items.length, total, file_sha256,
        col("ref"), col("hn"), col("service_date"), col("scheme"), col("subtype"), col("hospmain"), col("cht_total"), col("pdx"),
      ],
    );
    return Response.json({ id: row.id, items: items.length });
  } catch (e) {
    console.error("fdh/claim-batch", e);
    return Response.json({ error: `บันทึกชุดส่งออกไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}

/**
 * PATCH { action: "confirm", ids, submitted_on?, note? } ยืนยันว่าอัปโหลดแล้ว (ข้ามชุดที่ยกเลิก ยืนยันแล้ว หรือส่งออกหลังวันที่อัปโหลด)
 * PATCH { action: "cancel", id, note } ยกเลิกชุดที่ส่งออกผิดหรือไม่ได้อัปโหลด ; ชุดที่ยืนยันแล้วยกเลิกได้เฉพาะผู้ยืนยันหรือผู้ดูแลระบบ
 */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = parseBatchAction(await request.json().catch(() => null), todayIso());
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const a = parsed.value;
  const name = session.user.name ?? "ไม่ทราบชื่อ";
  const userId = session.user.userId ?? null;
  try {
    if (a.action === "confirm") {
      const rows = await insightQuery<{ id: string }>(
        `UPDATE claim_batch SET confirmed_at = now(), confirmed_by = $2, confirmed_user_id = $3, submitted_on = $4::date, note = $5
         WHERE id = ANY($1::bigint[]) AND cancelled_at IS NULL AND confirmed_at IS NULL AND created_at::date <= $4::date
         RETURNING id::text`,
        [a.ids, name, userId, a.submitted_on, a.note],
      );
      const done = new Set(rows.map((r) => r.id));
      return Response.json({ confirmed: [...done], skipped: a.ids.filter((id) => !done.has(id)) });
    }
    const rows = await insightQuery<{ id: string }>(
      `UPDATE claim_batch SET cancelled_at = now(), cancelled_by = $2, note = concat_ws(E'\\n', note, $3::text)
       WHERE id = $1::bigint AND cancelled_at IS NULL AND (confirmed_at IS NULL OR $4::boolean OR confirmed_user_id = $5::bigint)
       RETURNING id::text`,
      [a.id, name, a.note, session.user.role === "admin", userId],
    );
    if (!rows.length)
      return Response.json({ error: "ยกเลิกไม่ได้: ชุดนี้ถูกยกเลิกแล้ว หรือยืนยันแล้วโดยผู้อื่น (ให้ผู้ยืนยันหรือผู้ดูแลระบบยกเลิก)" }, { status: 409 });
    return Response.json({ cancelled: rows[0].id });
  } catch (e) {
    console.error("fdh/claim-batch PATCH", e);
    return Response.json({ error: `บันทึกไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
