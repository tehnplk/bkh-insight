import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hisQuery, insightQuery } from "@/lib/db";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type RowGetters } from "@/lib/grid-query";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import { inList } from "@/app/api/fund/_lib/fund";
import { latestRepSql } from "@/app/api/fund/_lib/rep";
import { CLAIM_LABEL, CLAIM_STATUSES, claimText, type BatchItem, type BatchItemRow, type BatchItemsPage, type FdhStatus, type PatientType } from "../claim";
import { loadClaims, type ClaimCand } from "../load";

// รายในชุด (ไม่เกิน MAX_BATCH_ITEMS 5,000) พร้อมสถานะเคลมปัจจุบันของทุกราย แล้วกรอง/เรียง/แบ่งหน้าในหน่วยความจำ (สถานะมาจากหลายฐาน)
const REP_SQL = { OP: latestRepSql("seq_no", "vn", "OP"), IP: latestRepSql("an", "an", "IP") } as const;
const ITEMS_SQL = `SELECT i.patient_type, i.ref, i.hn, i.service_date::text AS service_date, i.scheme, i.subtype, i.hospmain,
  i.cht_total::float8 AS cht_total, i.pdx
FROM claim_batch_item i WHERE i.batch_id = $1::bigint ORDER BY i.ref`;
// ผลส่ง FDH ของ HOSxP (OP เท่านั้น, vn UNIQUE)
const fdhSql = (n: number) => `SELECT vn AS k, fdh_reservation_status AS resv, fdh_reservation_datetime AS resv_at,
  fdh_claim_status_message AS msg, fdh_claim_status_datetime AS msg_at
FROM fdh_claim_status WHERE ${inList("vn", n)}`;

const SORTABLE = ["ref", "hn", "service_date", "scheme", "hospmain", "cht_total", "claim"] as const;
const FILTER_GET = {
  scheme: (r) => r.scheme,
  hospmain: (r) => r.hospmain,
  claim: (r) => r.claim?.status,
} satisfies RowGetters<BatchItemRow, string>;
const FILTERABLE = Object.keys(FILTER_GET) as (keyof typeof FILTER_GET)[];
const rank = (r: BatchItemRow) => (r.claim ? CLAIM_STATUSES.indexOf(r.claim.status) : CLAIM_STATUSES.length);

type XlsxRow = BatchItem & { claim_label: string };
const xlsxColumns = (type: PatientType): XlsxColumn<XlsxRow>[] => [
  { key: "ref", header: type === "OP" ? "VN" : "AN", width: 14 },
  { key: "hn", header: "HN", width: 10 },
  { key: "service_date", header: type === "OP" ? "วันที่รับบริการ" : "วันที่จำหน่าย", width: 12 },
  { key: "scheme", header: "สิทธิ (INSCL)", width: 8 },
  { key: "subtype", header: "SUBTYPE", width: 8 },
  { key: "hospmain", header: "HCODE", width: 8 },
  { key: "pdx", header: "PDx", width: 8 },
  { key: "cht_total", header: "CHT (บาท)", width: 14, type: "money" },
  { key: "claim_label", header: "สถานะเคลม", width: 36 },
];

/** GET ?id=<ชุด> + สัญญา DataGrid (sort/q/cf ของ scheme/hospmain/claim) ; summary.counts = จำนวนรายต่อสถานะเคลมของทั้งชุด */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const id = params.get("id") ?? "";
  if (!/^\d{1,15}$/.test(id)) return Response.json({ error: "id ของชุดไม่ถูกต้อง" }, { status: 400 });
  const parsed = parseGridQuery(params, SORTABLE);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const cf = parseColumnFilters(params, FILTERABLE);
  if (!cf.ok) return Response.json({ error: cf.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = parsed.query;

  const items = await insightQuery<BatchItem & { patient_type: PatientType }>(ITEMS_SQL, [id]);
  if (!items.length) return Response.json({ error: "ไม่พบชุดส่งออกนี้" }, { status: 404 });
  // ทุกรายในชุดมี patient_type เดียวกัน (ติดไปกับแถวใน response ด้วย)
  const type = items[0].patient_type;
  let error: string | undefined;
  let rows: BatchItemRow[];
  try {
    const refs = items.map((i) => i.ref);
    const fdh = type === "OP" ? await hisQuery<FdhStatus & { k: string }>(fdhSql(refs.length), refs) : [];
    const fdhBy = new Map(fdh.map((f) => [String(f.k), f]));
    // ทุกรายอยู่ในชุดส่งออก: กองทุน/ยอด/ปิดสิทธิมีผลเฉพาะรายที่ชุดถูกยกเลิกและไม่มีหลักฐานอื่น (ใช้ INSCL และ CHT ของแฟ้มแทนข้อมูล HOSxP)
    const cands: ClaimCand[] = items.map((i) => ({
      k: i.ref, fund: i.scheme ?? "", date: i.service_date, amount: i.cht_total ?? 0, closed: true, fdh: fdhBy.get(i.ref) ?? null,
    }));
    const claims = await loadClaims(type, cands, REP_SQL[type], type === "OP" ? "vn" : "an");
    rows = items.map((i) => ({ ...i, claim: claims.get(i.ref) }));
  } catch (e) {
    console.error("fdh/claim-batch/items claim", e);
    error = `โหลดสถานะเคลมไม่สำเร็จ: ${(e as Error).message}`;
    rows = items;
  }

  const counts: BatchItemsPage["summary"]["counts"] = {};
  for (const r of rows) if (r.claim) counts[r.claim.status] = (counts[r.claim.status] ?? 0) + 1;
  const needle = q.toLowerCase();
  const searched = needle ? rows.filter((r) => [r.ref, r.hn, r.pdx].some((v) => v?.toLowerCase().includes(needle))) : rows;
  if (cf.query.facet) {
    const get = FILTER_GET[cf.query.facet];
    const label = cf.query.facet === "claim" ? (v: string) => CLAIM_LABEL[v as keyof typeof CLAIM_LABEL] ?? v : undefined;
    return Response.json(facetRows(filterRows(searched, cf.query.filters, FILTER_GET, cf.query.facet), get, cf.query.facetQ, label));
  }
  const filtered = filterRows(searched, cf.query.filters, FILTER_GET);
  if (sort) {
    const val = (r: BatchItemRow) => (sort === "claim" ? rank(r) : r[sort]);
    const sign = dir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // ว่างไว้ท้ายเสมอ
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "th")) * sign;
    });
  }
  if (format === "xlsx")
    return xlsxResponse<XlsxRow>(`claim-batch-${id}.xlsx`, xlsxColumns(type), filtered.map(({ claim, ...r }) => ({ ...r, claim_label: claimText(claim) })));
  const body: BatchItemsPage = {
    rows: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    summary: { counts, ...(error && { error }) },
  };
  return Response.json(body);
}
