import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { escapeLike, insightQuery } from "@/lib/db";
import { parseGridQuery, type GridPage } from "@/lib/grid-query";
import { xlsxResponse } from "@/lib/xlsx";
import { REP_ACCOUNTS, REP_DISABLED_MSG, REP_GATE_LABEL, REP_SETTLE_ENABLED, repGate, type RepTransferAgg, type SettleRepRow } from "../settle";
import { REP_SCHEMES, repNotMigrated, transferAggSql } from "../sql";

// รายการเลขที่ REP ที่ใช้ตัดหนี้รายตัวได้ (scheme ที่ไม่มี STM เช่น LGO) สัญญา DataGrid ; หนึ่งแถวต่อ (rep_no, scheme)
// settled_rows = บรรทัดที่ลง ar_ledger แล้ว (rep_tran_id) ; settled_amount = รับชำระที่ตัดแล้วของบรรทัดใน REP นี้ ; $1 = scheme, $2 = คำค้น (null หรือ LIKE pattern)
// $3 = บัญชีที่ตัดได้ ; transfer_status จาก repGate (เงินโอน SMT ของ REP) หรือ done เมื่อตัดครบทุกบรรทัดที่จ่าย
// shortcut: $3 รวมบัญชีของทุก scheme (ตอนนี้มีแค่ LGO) ถ้าเพิ่ม scheme ให้ตรวจบัญชีต่อ scheme

const SORTABLE = ["rep_no", "patient_type", "printed_on", "row_count", "net_total", "settled_rows", "settled_amount"] as const;
const PAY = "COALESCE(r.net_nhso, 0) + COALESCE(r.net_affiliation, 0)";
const WHERE = "WHERE r.scheme = ANY($1::text[]) AND ($2::text IS NULL OR r.rep_no LIKE $2)";
const LIST_SQL = `SELECT r.rep_no AS id, r.rep_no, r.scheme, max(f.rep_type) AS rep_type, max(r.patient_type) AS patient_type, max(f.printed_at)::date::text AS printed_on,
  count(*)::int AS row_count, SUM(${PAY}) AS net_total, count(*) FILTER (WHERE ${PAY} <> 0)::int AS paid_rows,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ar_ledger l WHERE l.rep_tran_id = r.tran_id))::int AS settled_rows,
  COALESCE((SELECT -SUM(l.amount) FROM ar_ledger l JOIN rep_row r2 ON r2.tran_id = l.rep_tran_id
            WHERE r2.rep_no = r.rep_no AND r2.scheme = r.scheme AND l.kind = 'settle'), 0) AS settled_amount,
  (SELECT b.receipt_no FROM ar_settle_batch b WHERE b.rep_no = r.rep_no AND b.rep_scheme = r.scheme ORDER BY b.id DESC LIMIT 1) AS last_receipt_no,
  (SELECT b.receipt_date::text FROM ar_settle_batch b WHERE b.rep_no = r.rep_no AND b.rep_scheme = r.scheme ORDER BY b.id DESC LIMIT 1) AS last_receipt_date
FROM rep_row r JOIN rep_file f ON f.id = r.rep_file_id`;

type DbRow = Omit<SettleRepRow, "transfer_status" | "transfer_total"> & RepTransferAgg;
const ACCOUNTS = Object.values(REP_ACCOUNTS).flat();
const STATUS_LABEL = { ...REP_GATE_LABEL, done: "ตัดแล้ว" };

export async function GET(request: NextRequest) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!REP_SETTLE_ENABLED) return Response.json({ error: REP_DISABLED_MSG }, { status: 404 });
  const parsed = parseGridQuery(request.nextUrl.searchParams, SORTABLE);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = parsed.query;
  const args = [REP_SCHEMES, q ? `%${escapeLike(q)}%` : null, ACCOUNTS];
  // sort มาจาก allowlist (ชื่อคอลัมน์ผลลัพธ์) ค่าเริ่มต้น REP ล่าสุดก่อน
  const select = `SELECT g.*, tr.* FROM (${LIST_SQL} ${WHERE} GROUP BY r.rep_no, r.scheme) g
LEFT JOIN LATERAL (${transferAggSql("g.rep_no", "g.scheme", "$3::text[]")}) tr ON true
ORDER BY ${sort ?? "rep_no"} ${dir === "desc" || !sort ? "DESC" : "ASC"} NULLS LAST, rep_no DESC`;
  const withStatus = (rows: DbRow[]): SettleRepRow[] =>
    rows.map(({ n, pending_n, other_n, total, receipt_no, receipt_date, receipts, ...r }) => {
      const g = repGate(r.net_total, { n, pending_n, other_n, total, receipt_no, receipt_date, receipts });
      const done = r.paid_rows > 0 && r.settled_rows >= r.paid_rows;
      return { ...r, transfer_status: done ? "done" : g.status, transfer_total: n ? g.transfer_total : null };
    });
  try {
    if (format === "xlsx") {
      const rows = withStatus(await insightQuery<DbRow>(select, args)).map((r) => ({ ...r, transfer_label: STATUS_LABEL[r.transfer_status] }));
      return xlsxResponse("ar-settle-rep.xlsx", [
        { key: "rep_no", header: "เลขที่ REP", width: 14 },
        { key: "scheme", header: "สิทธิ", width: 8 },
        { key: "rep_type", header: "ชนิด REP", width: 14 },
        { key: "patient_type", header: "OP/IP", width: 8 },
        { key: "printed_on", header: "วันที่ออกรายงาน", width: 14 },
        { key: "row_count", header: "รายการ", width: 10, type: "count" },
        { key: "net_total", header: "ชดเชยสุทธิ (บาท)", width: 16, type: "money" },
        { key: "transfer_label", header: "เงินโอน SMT", width: 14 },
        { key: "transfer_total", header: "ยอดโอน SMT (บาท)", width: 16, type: "money" },
        { key: "paid_rows", header: "รายการที่จ่าย", width: 12, type: "count" },
        { key: "settled_rows", header: "ตัดแล้ว (รายการ)", width: 12, type: "count" },
        { key: "settled_amount", header: "รับชำระแล้ว (บาท)", width: 16, type: "money" },
        { key: "last_receipt_no", header: "ใบเสร็จล่าสุด", width: 16 },
        { key: "last_receipt_date", header: "วันที่ใบเสร็จล่าสุด", width: 14 },
      ], rows);
    }
    const [rows, [{ total }]] = await Promise.all([
      insightQuery<DbRow>(`${select}
LIMIT $4 OFFSET $5`, [...args, pageSize, (page - 1) * pageSize]),
      insightQuery<{ total: number }>(`SELECT count(DISTINCT (r.rep_no, r.scheme))::int AS total FROM rep_row r ${WHERE}`, args.slice(0, 2)),
    ]);
    const body: GridPage<SettleRepRow> = { rows: withStatus(rows), total };
    return Response.json(body);
  } catch (e) {
    return repNotMigrated(e);
  }
}
