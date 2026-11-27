import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { escapeLike, insightQuery } from "@/lib/db";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type RowGetters } from "@/lib/grid-query";
import { xlsxResponse } from "@/lib/xlsx";
import { GROUP_LABEL, STATUS_LABEL, SETTLE_GROUPS, previewRows, summarize, type PreviewRow, type SettleGroup, type SettlePreviewPage, type SettleStatus, type SettleSummary } from "../settle";
import { periodKey, stmKey } from "../../smt-reconcile/reconcile";
import { loadBatches, loadFile, loadMissing, loadOpenFrom } from "../sql";

// ตัวอย่างการตัดของไฟล์ STM หนึ่งไฟล์ (GET ?id=) หนึ่งแถวต่อหนี้ของ VN/AN กรอง/เรียง/แบ่งหน้าในหน่วยความจำ (ไฟล์ละไม่กี่พันบรรทัด)
// summary คิดจากทั้งไฟล์ (ไม่ขึ้นกับตัวกรอง) ให้แถบกลุ่มและแผนตามค่าเริ่มต้นของ checkbox

const SORTABLE = ["group", "ref", "hn", "rep_no", "account_code", "balance", "paid", "remaining"] as const;
const FILTER_GET = {
  group: (r) => r.group,
  status: (r) => r.status,
  account_code: (r) => r.account_code,
} satisfies RowGetters<PreviewRow, string>;
const FILTERABLE = Object.keys(FILTER_GET) as (keyof typeof FILTER_GET)[];
const LABEL: Record<string, (v: string) => string> = {
  group: (v) => GROUP_LABEL[v as SettleGroup] ?? v,
  status: (v) => STATUS_LABEL[v as SettleStatus] ?? v,
};

// ใบเสร็จของเงินโอน SMT ที่ลงรับแล้ว ต้น ref_doc_no = งวดของ STM ("6910_IP_01", "6910_IP_01_อุทธรณ์") ; กรองตรงงวดด้วย periodKey อีกชั้น
const TRANSFER_RECEIPT_SQL = `SELECT DISTINCT ref_doc_no, receipt_no, receipt_date FROM ar_transfer
WHERE source = 'smt' AND cancelled_at IS NULL AND receipt_no IS NOT NULL AND ref_doc_no LIKE $1`;

/** ค่าเริ่มต้นใบเสร็จของ STM UC: ใช้เมื่อพบใบเดียวของงวด ; ก่อนรัน migration 202611271500 (ไม่มีคอลัมน์) = null */
async function transferReceipt(file: SettleSummary["file"]): Promise<SettleSummary["transfer_receipt"]> {
  if (file.scheme !== "UCS") return null;
  const period = stmKey(file);
  const rows = await insightQuery<{ ref_doc_no: string; receipt_no: string; receipt_date: string }>(TRANSFER_RECEIPT_SQL, [`${escapeLike(period)}%`]).catch((e) => {
    if ((e as { code?: string }).code === "42703") return [];
    throw e;
  });
  const receipts = new Map(rows.filter((r) => periodKey(r.ref_doc_no) === period).map((r) => [`${r.receipt_no}|${r.receipt_date}`, r]));
  const [only] = receipts.values();
  return receipts.size === 1 ? { period, receipt_no: only.receipt_no, receipt_date: only.receipt_date } : null;
}

export async function GET(request: NextRequest) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const id = params.get("id") ?? "";
  if (!/^\d{1,15}$/.test(id)) return Response.json({ error: "id ของไฟล์ไม่ถูกต้อง" }, { status: 400 });
  const parsed = parseGridQuery(params, SORTABLE);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const cf = parseColumnFilters(params, FILTERABLE);
  if (!cf.ok) return Response.json({ error: cf.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = parsed.query;

  const data = await loadFile(insightQuery, id);
  if (!data) return Response.json({ error: "ไม่พบไฟล์ STM นี้" }, { status: 404 });
  const [missing, batches, open_from, transfer_receipt] = await Promise.all([
    loadMissing(insightQuery, data.file), loadBatches(insightQuery, id), loadOpenFrom(insightQuery), transferReceipt(data.file),
  ]);
  const rows = previewRows(data.lines, data.debts, missing, data.file.patient_type);

  const needle = q.toLowerCase();
  const searched = needle ? rows.filter((r) => [r.ref, r.hn, r.rep_no, r.tran_id].some((v) => v?.toLowerCase().includes(needle))) : rows;
  if (cf.query.facet) {
    const f = cf.query.facet;
    return Response.json(facetRows(filterRows(searched, cf.query.filters, FILTER_GET, f), FILTER_GET[f], cf.query.facetQ, LABEL[f]));
  }
  const filtered = filterRows(searched, cf.query.filters, FILTER_GET);
  if (sort) {
    const val = (r: PreviewRow) => (sort === "group" ? SETTLE_GROUPS.indexOf(r.group) : r[sort]);
    const sign = dir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // ว่างไว้ท้ายเสมอ
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "th")) * sign;
    });
  }
  if (format === "xlsx") {
    const ref = data.file.patient_type === "OP" ? "VN" : "AN";
    return xlsxResponse(`ar-settle-${data.file.doc_no}.xlsx`, [
      { key: "group_label", header: "กลุ่ม", width: 22 },
      { key: "status_label", header: "สถานะ", width: 18 },
      { key: "ref", header: ref, width: 14 },
      { key: "hn", header: "HN", width: 10 },
      { key: "rep_no", header: "REP", width: 14 },
      { key: "tran_id", header: "TRAN_ID", width: 14 },
      { key: "account_code", header: "บัญชี", width: 16 },
      { key: "balance", header: "หนี้คงเหลือ (บาท)", width: 16, type: "money" },
      { key: "paid", header: "STM จ่าย (บาท)", width: 16, type: "money" },
      { key: "remaining", header: "คงเหลือหลังตัด (บาท)", width: 16, type: "money" },
    ], filtered.map((r) => ({ ...r, group_label: GROUP_LABEL[r.group], status_label: STATUS_LABEL[r.status] })));
  }
  const body: SettlePreviewPage = {
    rows: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    summary: { file: data.file, open_from, batches, transfer_receipt, ...summarize(rows) },
  };
  return Response.json(body);
}
