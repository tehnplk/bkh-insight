import type { NextRequest } from "next/server";
import { cacheLife } from "next/cache";
import { hisQuery } from "@/lib/db";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type RowGetters } from "@/lib/grid-query";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import { CLAIM_LABEL, CLAIM_STATUSES, claimText, type FdhStatus } from "@/app/api/fdh/claim-batch/claim";
import { loadClaims } from "@/app/api/fdh/claim-batch/load";
import { FULL_NAME_SQL, badRequest, fundOf, isAuthed, loadLookups, parseRange, pttypeName, unauthorized } from "../_lib/fund";
import { CLAIM_JOINS, FDH_COLS, FDH_JOIN, OP_CLOSED_SQL } from "../_lib/claim";
import { latestRepSql } from "../_lib/rep";
import { loadCup } from "../_lib/cup";
import { CATEGORY_KEYS, MAX_DAYS, categoryOf, summarize, type CategoryKey, type ClaimTypePage, type ClaimTypeRow, type ClaimTypeSummary } from "./claim-type";

// visit ที่ admit ไม่นับ (HOSxP ย้ายรายการไป AN) ; ไม่ตรวจรายการค้างฝั่ง OPD เพื่อไม่แตะ opitemrece (ดูได้ที่ /opd/admissions)
// hospcode/er_regist/er_pt_type ด้วย PK ; ucae = ช่อง UCAE ของแฟ้ม AER ผู้ป่วยนอก (fdh/files/sql.ts)
const VISITS_SQL = `SELECT o.vn, o.hn, ${FULL_NAME_SQL} AS patient_name, o.vstdate, o.pttype,
  NULLIF(TRIM(vp.hospmain), '') AS hospmain, h.name AS hosp_name, h.chwpart AS hosp_chw, ept.ucae, vs.uc_money,
  ${OP_CLOSED_SQL} AS closed, ${FDH_COLS}
FROM ovst o
LEFT JOIN patient p ON p.hn = o.hn
LEFT JOIN vn_stat vs ON vs.vn = o.vn
LEFT JOIN pttype t ON t.pttype = o.pttype
LEFT JOIN ovst_seq sq ON sq.vn = o.vn
${CLAIM_JOINS}
LEFT JOIN hospcode h ON h.hospcode = vp.hospmain
LEFT JOIN er_regist er ON er.vn = o.vn
LEFT JOIN er_pt_type ept ON ept.er_pt_type = er.er_pt_type
${FDH_JOIN}
WHERE o.vstdate BETWEEN ? AND ? AND (o.an IS NULL OR o.an = '')`;
const REP_SQL = latestRepSql("seq_no", "vn", "OP");

type RawVisit = Record<`fdh_${keyof FdhStatus}`, string | null> & {
  vn: string; hn: string; patient_name: string | null; vstdate: string; pttype: string | null;
  hospmain: string | null; hosp_name: string | null; hosp_chw: string | null; ucae: string | null; uc_money: string | number | null; closed: number | null;
};
type Loaded = { rows: ClaimTypeRow[]; claim_error: boolean };

// HOSxP เปลี่ยนตลอดวัน จึง cache สั้น (cacheLife "minutes") แค่กันโหลดซ้ำตอนเปิด modal/เปลี่ยนหน้า/เรียง ; cup อยู่ใน key (admin แก้แล้วได้ค่าใหม่)
async function loadRows(start: string, end: string, today: string, cup: string[], chw: string): Promise<Loaded> {
  "use cache";
  cacheLife("minutes");
  const [lk, raws] = await Promise.all([loadLookups(), hisQuery<RawVisit>(VISITS_SQL, [start, end])]);
  const ctx = { cup: new Set(cup), chw };
  const rows: ClaimTypeRow[] = raws.map((r) => {
    const fund = fundOf(lk, r.pttype);
    return {
      vn: r.vn, hn: r.hn, patient_name: (r.patient_name ?? "").trim(), vstdate: String(r.vstdate).slice(0, 10),
      pttype: r.pttype, pttype_name: pttypeName(lk, r.pttype), fund, hospmain: r.hospmain, hosp_name: r.hosp_name,
      amount: Number(r.uc_money ?? 0), cat: categoryOf({ fund, hospmain: r.hospmain, hosp_chw: r.hosp_chw, ucae: r.ucae }, ctx),
    };
  });
  // สถานะเคลม: อ่าน insight ไม่ได้ = การ์ดไม่มีสถานะ แต่จำนวนและยอดยังแสดง
  const claims = await loadClaims(
    "OP",
    raws.map((r, i) => ({
      k: r.vn, fund: rows[i].fund, date: rows[i].vstdate, amount: rows[i].amount, closed: Boolean(Number(r.closed)),
      fdh: { resv: r.fdh_resv, resv_at: r.fdh_resv_at, msg: r.fdh_msg, msg_at: r.fdh_msg_at },
    })),
    REP_SQL,
    "vn",
  ).catch((e) => {
    console.error("fund/claim-type claim", e);
    return undefined;
  });
  if (claims) for (const r of rows) r.claim = claims.get(r.vn);
  return { rows, claim_error: !claims };
}

const SORTABLE = ["vstdate", "vn", "hn", "patient_name", "pttype_name", "hospmain", "amount", "claim"] as const;
const FILTER_GET = {
  pttype_name: (r) => r.pttype_name,
  hospmain: (r) => r.hospmain,
  claim: (r) => r.claim?.status,
} satisfies RowGetters<ClaimTypeRow, string>;
const FILTERABLE = Object.keys(FILTER_GET) as (keyof typeof FILTER_GET)[];
const rank = (r: ClaimTypeRow) => (r.claim ? CLAIM_STATUSES.indexOf(r.claim.status) : CLAIM_STATUSES.length);

type XlsxRow = ClaimTypeRow & { claim_label: string };
const XLSX_COLUMNS: XlsxColumn<XlsxRow>[] = [
  { key: "vstdate", header: "วันที่รับบริการ", width: 12 },
  { key: "vn", header: "VN", width: 14 },
  { key: "hn", header: "HN", width: 10 },
  { key: "patient_name", header: "ชื่อ-สกุล", width: 28 },
  { key: "fund", header: "กองทุน", width: 8 },
  { key: "pttype_name", header: "สิทธิ", width: 28 },
  { key: "hospmain", header: "HCODE หลัก", width: 10 },
  { key: "hosp_name", header: "หน่วยบริการหลัก", width: 32 },
  { key: "amount", header: "ลูกหนี้สิทธิ (บาท)", width: 14, type: "money" },
  { key: "claim_label", header: "สถานะเคลม", width: 36 },
];

/**
 * GET ?start&end -> ClaimTypeSummary (ยอดต่อการ์ด)
 * GET ?start&end&cat=<ประเภท> + สัญญา DataGrid (sort/q/cf ของ pttype_name/hospmain/claim, format=xlsx) -> ClaimTypePage
 */
export async function GET(request: NextRequest) {
  // auth อ่าน cookie จึงเช็คนอกฟังก์ชันที่ cache
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params, MAX_DAYS);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const cat = params.get("cat");
  if (cat !== null && !CATEGORY_KEYS.includes(cat as CategoryKey)) return badRequest("cat ไม่ถูกต้อง");

  try {
    const cup = await loadCup();
    const { rows: all, claim_error } = await loadRows(start, end, todayIso(), cup.cup, cup.own.chw);
    if (cat === null) return Response.json({ cats: summarize(all), cup_size: cup.cup.length, claim_error } satisfies ClaimTypeSummary);

    const grid = parseGridQuery(params, SORTABLE);
    if (!grid.ok) return badRequest(grid.error);
    const cf = parseColumnFilters(params, FILTERABLE);
    if (!cf.ok) return badRequest(cf.error);
    const { page, pageSize, sort, dir, q, format } = grid.query;
    const { filters, facet, facetQ } = cf.query;
    const needle = q.toLowerCase();
    const pool = all.filter((r) => r.cat === cat && (!needle || [r.vn, r.hn, r.patient_name].some((v) => v.toLowerCase().includes(needle))));
    if (facet) {
      const label = facet === "claim" ? (v: string) => CLAIM_LABEL[v as keyof typeof CLAIM_LABEL] ?? v : undefined;
      return Response.json(facetRows(filterRows(pool, filters, FILTER_GET, facet), FILTER_GET[facet], facetQ, label));
    }
    // pool เป็น array ใหม่จาก filter() จึงเรียงในที่ได้โดยไม่แตะลำดับใน cache
    const rows = filterRows(pool, filters, FILTER_GET);
    const key = sort ?? "vstdate";
    const val = (r: ClaimTypeRow) => (key === "claim" ? rank(r) : r[key]);
    const sign = (sort ? dir : "desc") === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // ว่างไว้ท้ายเสมอ
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "th", { numeric: true })) * sign || a.vn.localeCompare(b.vn);
    });
    if (format === "xlsx")
      return xlsxResponse<XlsxRow>(`claim-type-${cat}-${start}_${end}.xlsx`, XLSX_COLUMNS, rows.map((r) => ({ ...r, claim_label: claimText(r.claim) })));
    return Response.json({ rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length } satisfies ClaimTypePage);
  } catch (e) {
    console.error("fund/claim-type", e);
    return Response.json({ error: `อ่านข้อมูลไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
