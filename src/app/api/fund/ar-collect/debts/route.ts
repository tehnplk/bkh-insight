import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { ALL_PAGE_SIZE, parseGridQuery } from "@/lib/grid-query";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import { attachPatients, loadNames } from "../../fwf-card/data";
import { badRequest, isAuthed, loadLookups, parseRange, pttypeName, unauthorized } from "../../_lib/fund";
import { MAX_DAYS, SOURCE_LABEL, amountsOf, type DebtPage, type DebtRow, type Num, type PatientType } from "../collect";

// Q3 ผ่าน prove-query แล้ว (insight, 25 พ.ย. 2569) ห้ามเปลี่ยน logic ถ้าไม่ได้ prove ใหม่ ; เรียงคงที่ (ref_date, ref)
// $1 start, $2 end, $3 patient_type, $4 กลุ่ม, $5 hospmain (null = ไม่ระบุ), $6 กองทุน (null = ไม่ระบุ), $7 limit, $8 offset
const DEBTS_SQL = `WITH s AS (
  SELECT l.patient_type, l.ref, l.vn, l.an, l.ref_date, l.pttype, COUNT(*) OVER () AS total
  FROM ar_ledger l
  JOIN ar_account a ON a.code = l.account_code
  WHERE l.kind = 'set' AND l.source IN ('rcpt_debt', 'ipt')
    AND l.ref_date BETWEEN $1::date AND $2::date
    AND l.patient_type = $3 AND a.collect_group = $4
    AND l.hospmain IS NOT DISTINCT FROM $5::text AND l.hipdata_code IS NOT DISTINCT FROM $6::text
  ORDER BY l.ref_date, l.ref
  LIMIT $7 OFFSET $8
)
SELECT s.total, s.ref, s.vn, s.an, s.ref_date, s.pttype,
  COALESCE(SUM(l.amount) FILTER (WHERE l.source IN ('rcpt_debt', 'ipt') AND l.kind IN ('set', 'adjust', 'cancel', 'reverse')), 0) AS cost,
  COALESCE(SUM(l.amount) FILTER (WHERE l.source IN ('rcpt_debt', 'ipt') AND l.kind = 'diff'), 0) AS diff,
  COALESCE(-SUM(l.amount) FILTER (WHERE l.kind = 'settle'), 0) AS received,
  SUM(l.amount) AS balance,
  ls.entry_date AS settle_date, ls.source AS settle_source, ls.settle_batch_id, ls.stm_row_id, ls.note AS settle_note, ls.receipt_no
FROM s
JOIN ar_ledger l ON l.patient_type = s.patient_type AND l.ref = s.ref
LEFT JOIN LATERAL (
  SELECT x.entry_date, x.source, x.settle_batch_id, x.stm_row_id, x.note, b.receipt_no
  FROM ar_ledger x LEFT JOIN ar_settle_batch b ON b.id = x.settle_batch_id
  WHERE x.patient_type = s.patient_type AND x.ref = s.ref AND x.kind = 'settle'
  ORDER BY x.entry_date DESC, x.id DESC LIMIT 1
) ls ON true
GROUP BY s.total, s.patient_type, s.ref, s.vn, s.an, s.ref_date, s.pttype, ls.entry_date, ls.source, ls.settle_batch_id, ls.stm_row_id, ls.note, ls.receipt_no
ORDER BY s.ref_date, s.ref`;

type SqlRow = Record<"cost" | "diff" | "received" | "balance", Num> & {
  total: Num; ref: string; vn: string | null; an: string | null; ref_date: string; pttype: string | null;
  settle_date: string | null; settle_source: string | null; settle_note: string | null; receipt_no: string | null;
};
const CODE = /^[0-9A-Za-z_]{1,20}$/;

type XlsxRow = DebtRow & { key: string; source_label: string };
const xlsxColumns = (type: PatientType): XlsxColumn<XlsxRow>[] => [
  { key: "ref_date", header: type === "OP" ? "วันที่รับบริการ" : "วันที่จำหน่าย", width: 12 },
  { key: "key", header: type === "OP" ? "VN" : "AN", width: 14 },
  { key: "hn", header: "HN", width: 10 },
  { key: "patient_name", header: "ชื่อ-สกุล", width: 28 },
  { key: "pttype", header: "สิทธิ", width: 8 },
  { key: "pttype_name", header: "ชื่อสิทธิ", width: 28 },
  { key: "cost", header: "ค่ารักษา (บาท)", width: 14, type: "money" },
  { key: "diff", header: "ส่วนต่าง (บาท)", width: 14, type: "money" },
  { key: "debt", header: "ลูกหนี้สุทธิ (บาท)", width: 14, type: "money" },
  { key: "received", header: "รับแล้ว (บาท)", width: 14, type: "money" },
  { key: "balance", header: "คงเหลือ (บาท)", width: 14, type: "money" },
  { key: "settle_date", header: "วันที่รับล่าสุด", width: 12 },
  { key: "source_label", header: "ที่มา", width: 14 },
  { key: "settle_ref", header: "เลขใบเสร็จ/หมายเหตุ", width: 30 },
];

/** GET ?start&end&type=OP|IP&group=<id>[&hospmain][&fund] + page/pageSize[/format=xlsx] -> DebtPage (รายหนี้ เรียงตามวันที่) */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params, MAX_DAYS);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const type = params.get("type");
  if (type !== "OP" && type !== "IP") return badRequest("type ต้องเป็น OP หรือ IP");
  const groupRaw = params.get("group") ?? "";
  if (!/^\d{1,4}$/.test(groupRaw)) return badRequest("group ไม่ถูกต้อง");
  // ไม่ส่ง = NULL (ไม่ระบุหน่วยบริการ/กองทุน) เพราะ DataGrid ไม่ส่งค่าว่าง
  const hospmain = params.get("hospmain");
  const fund = params.get("fund");
  if ((hospmain !== null && !CODE.test(hospmain)) || (fund !== null && !CODE.test(fund))) return badRequest("hospmain หรือ fund ไม่ถูกต้อง");
  // เรียงคงที่ จึงไม่มีคอลัมน์ที่ sort ได้ ; ค้นหาไม่รองรับ (grid ซ่อนช่องค้นหา)
  const grid = parseGridQuery(params, []);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, format } = grid.query;
  // shortcut: Excel ได้ไม่เกิน ALL_PAGE_SIZE แถว (เหมือนตัวเลือก "ทั้งหมด") ถ้าแถวเดียวเกินบ่อยค่อยอ่านเป็นชุด
  const [limit, offset] = format === "xlsx" ? [ALL_PAGE_SIZE, 0] : [pageSize, (page - 1) * pageSize];

  try {
    const raw = await insightQuery<SqlRow>(DEBTS_SQL, [start, end, type, Number(groupRaw), hospmain, fund, limit, offset]);
    const [lk, withHn] = await Promise.all([
      loadLookups(),
      // HN จาก HOSxP ตาม vn/an (SQL ของ fwf-card ทีละ 500) แล้วชื่อตาม HN
      attachPatients(raw.map((r) => ({
        source: type === "OP" ? "rcpt_debt" : "ipt", ref: r.ref, vn: r.vn, an: r.an, patient_type: type, ref_date: r.ref_date, pttype: r.pttype,
        hipdata_code: fund, hospmain, hospmain_chwpart: null, account_code: null, balance: r.balance ?? 0,
      }))),
    ]);
    const names = await loadNames(withHn.flatMap((d) => (d.hn ? [d.hn] : [])));
    const rows: DebtRow[] = raw.map((r, i) => {
      const hn = withHn[i].hn;
      const a = amountsOf({ ...r, debt: Number(r.cost ?? 0) + Number(r.diff ?? 0) });
      return {
        ref: r.ref, vn: r.vn, an: r.an, hn, patient_name: hn ? (names.get(hn) ?? null) : null, ref_date: String(r.ref_date).slice(0, 10),
        pttype: r.pttype, pttype_name: pttypeName(lk, r.pttype) || null, ...a,
        settle_date: r.settle_date ? String(r.settle_date).slice(0, 10) : null, settle_source: r.settle_source,
        settle_ref: r.receipt_no || r.settle_note || null,
      };
    });
    if (format === "xlsx")
      return xlsxResponse<XlsxRow>(
        `ar-collect-${groupRaw}-${type}-${hospmain ?? "none"}-${fund ?? "none"}-${start}_${end}.xlsx`,
        xlsxColumns(type),
        rows.map((r) => ({ ...r, key: r.vn ?? r.an ?? r.ref, source_label: r.settle_source ? (SOURCE_LABEL[r.settle_source] ?? r.settle_source) : "" })),
      );
    const body: DebtPage = { rows, total: Number(raw[0]?.total ?? 0) };
    return Response.json(body);
  } catch (e) {
    console.error("fund/ar-collect/debts", e);
    return Response.json({ error: `อ่านข้อมูลไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
