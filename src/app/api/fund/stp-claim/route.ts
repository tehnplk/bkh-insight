import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hisQuery, insightExecute, insightQuery } from "@/lib/db";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type RowGetters } from "@/lib/grid-query";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import { badRequest, inList, loadLookups, parseRange, pttypeName, unauthorized } from "../_lib/fund";
import {
  SORTABLE, STATUS_LABEL, buildRows, isPending, matches, parseSave, sortRows, summarize,
  type ClaimStatus, type HisCase, type PatientType, type StatusLog, type StpClaimPage, type StpClaimRow,
} from "./claim";

// ติดตามเคลมกองทุน STP (ต้องกดส่งเคลมเองในเมนูกองทุน STP ของ FDH) สถานะที่เจ้าหน้าที่บันทึกอยู่ insight จึงดึง HOSxP ทั้งช่วงแล้วรวมในหน่วยความจำ
// (STP ราว 50 visit ต่อปี) ; fdh_claim_status ของ HOSxP เป็นผล API ของ UC ไม่ครอบคลุม STP แสดงประกอบเท่านั้น
const MAX_DAYS = 366;
const FILTER_GET = { status: (r) => r.status } satisfies RowGetters<StpClaimRow, string>;
type FilterKey = keyof typeof FILTER_GET;
const FILTERABLE = Object.keys(FILTER_GET) as FilterKey[];

// SQL ผ่าน prove-query (his, 14 พ.ย. 2569) ห้ามเปลี่ยน logic โดยไม่ prove ใหม่ ; params: start, end, pttype…
const OP_SQL = (n: number) => `SELECT v.vn, v.hn, v.vstdate, v.pttype, NULLIF(vp.auth_code, '') AS authen_code,
       f.fdh_claim_status_message, f.fdh_claim_status_datetime,
       ROUND(COALESCE(SUM(op.sum_price), 0), 2) AS claim_amount,
       EXISTS (SELECT 1 FROM ovstdiag od WHERE od.vn = v.vn AND od.diagtype = '1') AS has_pdx
FROM ovst v
LEFT JOIN visit_pttype vp ON vp.vn = v.vn AND vp.pttype = v.pttype
LEFT JOIN fdh_claim_status f ON f.vn = v.vn
LEFT JOIN opitemrece op ON op.vn = v.vn AND op.paidst = '02'
WHERE v.vstdate BETWEEN ? AND ? AND ${inList("v.pttype", n)} AND (v.an IS NULL OR v.an = '')
GROUP BY v.vn, v.hn, v.vstdate, v.pttype, vp.auth_code, f.fdh_claim_status_message, f.fdh_claim_status_datetime
ORDER BY v.vstdate, v.vn`;
const IP_SQL = (n: number) => `SELECT a.an, a.hn, a.dchdate, a.pttype, NULLIF(ap.auth_code, '') AS authen_code,
       f.fdh_claim_status_message, f.fdh_claim_status_datetime,
       ROUND(COALESCE(SUM(op.sum_price), 0), 2) AS claim_amount,
       EXISTS (SELECT 1 FROM iptdiag id WHERE id.an = a.an AND id.diagtype = '1') AS has_pdx
FROM ipt a
LEFT JOIN ipt_pttype ap ON ap.an = a.an AND ap.pttype = a.pttype
LEFT JOIN fdh_claim_status f ON f.vn = a.vn
LEFT JOIN opitemrece op ON op.an = a.an AND op.paidst = '02'
WHERE a.dchdate BETWEEN ? AND ? AND ${inList("a.pttype", n)}
GROUP BY a.an, a.hn, a.dchdate, a.pttype, ap.auth_code, f.fdh_claim_status_message, f.fdh_claim_status_datetime
ORDER BY a.dchdate, a.an`;

type HisRow = Omit<HisCase, "ref" | "date"> & { vn?: string; an?: string; vstdate?: string; dchdate?: string };

/** visit (OP) หรือ admission (IP) สิทธิ STP ในช่วง ; ไม่มี pttype ของ STP = ไม่มีราย (และกัน IN ว่าง) */
async function loadCases(type: PatientType, start: string, end: string): Promise<HisCase[]> {
  const pttypes = (await hisQuery<{ pttype: string }>("SELECT pttype, hipdata_code FROM pttype WHERE hipdata_code = ?", ["STP"])).map((r) => r.pttype);
  if (!pttypes.length) return [];
  const rows = await hisQuery<HisRow>((type === "OP" ? OP_SQL : IP_SQL)(pttypes.length), [start, end, ...pttypes]);
  return rows.map(({ vn, an, vstdate, dchdate, ...r }) => ({ ...r, ref: String(type === "OP" ? vn : an), date: String(type === "OP" ? vstdate : dchdate) }));
}

const parseType = (raw: string | null): PatientType | null => (raw === "ip" ? "IP" : raw === "op" || !raw ? "OP" : null);

type XlsxRow = StpClaimRow & { status_label: string; has_pdx_label: string };
const XLSX_COLUMNS = (type: PatientType): XlsxColumn<XlsxRow>[] => [
  { key: "date", header: type === "OP" ? "วันที่รับบริการ" : "วันที่จำหน่าย", width: 12 },
  { key: "hn", header: "HN", width: 10 },
  { key: "ref", header: type === "OP" ? "VN" : "AN", width: 14 },
  { key: "pttype_name", header: "สิทธิ", width: 28 },
  { key: "authen_code", header: "Authen Code", width: 16 },
  { key: "claim_amount", header: "มูลค่าเบิก (บาท)", width: 14, type: "money" },
  { key: "has_pdx_label", header: "มี PDX", width: 8 },
  { key: "status_label", header: "สถานะ", width: 18 },
  { key: "status_at", header: "บันทึกล่าสุดเมื่อ", width: 20 },
  { key: "status_by", header: "บันทึกโดย", width: 20 },
  { key: "note", header: "หมายเหตุ", width: 36 },
  { key: "his_status", header: "สถานะจาก HOSxP (API UC)", width: 30 },
];

export async function GET(request: NextRequest) {
  if (!(await auth())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const type = parseType(params.get("type"));
  if (!type) return badRequest("type ต้องเป็น op หรือ ip");
  const range = parseRange(params, MAX_DAYS);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const show = params.get("show") || "pending";
  if (show !== "pending" && show !== "all") return badRequest("show ต้องเป็น pending หรือ all");
  const grid = parseGridQuery<(typeof SORTABLE)[number]>(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters<FilterKey>(params, FILTERABLE);
  if (!cf.ok) return badRequest(cf.error);
  const { filters, facet, facetQ } = cf.query;

  const [cases, lk] = await Promise.all([loadCases(type, start, end), loadLookups()]);
  const logs = cases.length
    ? await insightQuery<StatusLog>(
        `SELECT ref, status, note, recorded_by, created_at FROM stp_claim_status_log
         WHERE patient_type = $1 AND ref = ANY($2::text[]) ORDER BY ref, created_at DESC, id DESC`,
        [type, cases.map((c) => c.ref)],
      )
    : [];
  const all = buildRows(cases, logs, (p) => pttypeName(lk, p));

  const searched = q ? all.filter((r) => matches(r, q)) : all;
  const shown = (rows: StpClaimRow[]) => (show === "all" ? rows : rows.filter((r) => isPending(r.status)));
  if (facet) return Response.json(facetRows(shown(searched), FILTER_GET[facet], facetQ, (v) => STATUS_LABEL[v as ClaimStatus] ?? v));
  // แถบสรุปนับทุกสถานะ (ไม่สนตัวเลือก "แสดง") ให้เห็นภาพรวมของช่วง
  const filtered = filterRows(searched, filters, FILTER_GET);
  const rows = sortRows(shown(filtered), sort ?? "date", dir);

  if (format === "xlsx") {
    return xlsxResponse(
      `stp-claim-${type.toLowerCase()}-${start}_${end}.xlsx`,
      XLSX_COLUMNS(type),
      rows.map((r) => ({ ...r, status_label: STATUS_LABEL[r.status], has_pdx_label: r.has_pdx ? "มี" : "ไม่มี" })),
    );
  }
  const body: StpClaimPage = { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, summary: summarize(filtered) };
  return Response.json(body);
}

/** บันทึกสถานะ { type, start, end, refs, status, note? } ทุกรายต้องเป็นสิทธิ STP ในช่วงที่ HOSxP ยืนยัน */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  // super user ไม่มีแถวใน users จึงระบุผู้บันทึกไม่ได้ (user_id ต้องอ้าง users)
  if (!session.user.userId) return Response.json({ error: "super user บันทึกสถานะไม่ได้ ให้เข้าระบบด้วย Provider ID" }, { status: 403 });
  const parsed = parseSave(await request.json().catch(() => null));
  if (!parsed.ok) return badRequest(parsed.error);
  const { type, refs, status, note, start, end } = parsed.value;
  const range = parseRange(new URLSearchParams({ start, end }), MAX_DAYS);
  if (!range.ok) return badRequest(range.error);

  const known = new Set((await loadCases(type, range.range.start, range.range.end)).map((c) => c.ref));
  const unknown = refs.filter((r) => !known.has(r));
  if (unknown.length) return badRequest(`${unknown.length} รายไม่ใช่สิทธิ STP ในช่วงวันที่นี้: ${unknown.slice(0, 5).join(", ")}`);

  // คำสั่งเดียว = ลงครบทุกรายหรือไม่ลงเลย
  const { rowCount } = await insightExecute(
    `INSERT INTO stp_claim_status_log (patient_type, ref, status, note, recorded_by, user_id)
     SELECT $1, r, $2, $3, $4, $5 FROM unnest($6::text[]) AS r`,
    [type, status, note, session.user.name ?? "ไม่ทราบชื่อ", session.user.userId, refs],
  );
  return Response.json({ saved: rowCount });
}
