import type { NextRequest } from "next/server";
import { hisQuery, insightQuery } from "@/lib/db";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type RowGetters } from "@/lib/grid-query";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import { OPI_BY_DATE, badRequest, inList, isAuthed, parseRange, unauthorized } from "../_lib/fund";
import {
  RESULT_LABEL, checkItem, matches, needsFix, sortRows, summarize,
  type CheckResult, type HisItem, type StpCatalog, type StpCheckPage, type StpCheckRow, type StpEntry, type TmtMaps,
} from "./check";

// ดึงทั้งช่วงแล้วตรวจ/กรอง/เรียง/แบ่งหน้าในหน่วยความจำ (สิทธิ STP ราว 100 รายการต่อเดือน) เพราะรายการ STP อยู่ insight ซึ่ง JOIN ข้ามฐานไม่ได้
// OPD เท่านั้น: IPD เบิกตาม DRG ไม่ใช่รายรายการ
const SORTABLE = ["vstdate", "hn", "vn", "item_name", "code", "qty", "unitprice", "sum_price", "rate", "excess", "result"] as const;
const FILTER_GET = { result: (r) => r.result } satisfies RowGetters<StpCheckRow, string>;
type FilterKey = keyof typeof FILTER_GET;
const FILTERABLE = Object.keys(FILTER_GET) as FilterKey[];

async function loadItems(start: string, end: string, pttypes: string[]): Promise<HisItem[]> {
  return hisQuery<HisItem>(
    `SELECT o.hos_guid, o.vn, o.hn, o.vstdate, o.icode, s.name AS item_name,
            o.qty, o.unitprice, o.sum_price, o.paidst, o.income,
            n.nhso_adp_code, n.nhso_adp_type_id,
            d.tpu_code_list, d.tmt_tp_code
     FROM ${OPI_BY_DATE}
     LEFT JOIN s_drugitems s ON s.icode = o.icode
     LEFT JOIN nondrugitems n ON n.icode = o.icode
     LEFT JOIN drugitems d ON d.icode = o.icode
     WHERE o.vstdate BETWEEN ? AND ?
       AND o.vn IS NOT NULL
       AND ${inList("o.pttype", pttypes.length)}
     ORDER BY o.vstdate, o.vn, o.icode`,
    [start, end, ...pttypes],
  );
}

const group = (pairs: { k: string; v: string }[]) => {
  const m = new Map<string, string[]>();
  for (const { k, v } of pairs) m.set(k, [...(m.get(k) ?? []), v]);
  return m;
};

/** tp -> tpu สำหรับยาที่ไม่มี tpu_code_list แล้ว tpu -> gpu (แยกจาก query รายการ) list ว่างไม่ query */
async function loadTmt(items: HisItem[]): Promise<TmtMaps> {
  const drugs = items.filter((i) => i.icode.startsWith("1"));
  const tps = [...new Set(drugs.filter((i) => !i.tpu_code_list?.trim()).map((i) => i.tmt_tp_code?.trim()).filter((v): v is string => !!v))];
  const tpuOfTp = group(
    tps.length
      ? (await hisQuery<{ tp_code: string; tpu_code: string }>(`SELECT tp_code, tpu_code FROM tmt_tp_to_tpu WHERE ${inList("tp_code", tps.length)}`, tps))
          .map((r) => ({ k: String(r.tp_code), v: String(r.tpu_code) }))
      : [],
  );
  const tpus = [...new Set([
    ...drugs.map((i) => i.tpu_code_list?.trim()).filter((v): v is string => !!v),
    ...[...tpuOfTp.values()].flat(),
  ])];
  const gpuOfTpu = group(
    tpus.length
      ? (await hisQuery<{ tpu_code: string; gpu_code: string }>(`SELECT tpu_code, gpu_code FROM tmt_gpu_to_tpu WHERE ${inList("tpu_code", tpus.length)}`, tpus))
          .map((r) => ({ k: String(r.tpu_code), v: String(r.gpu_code) }))
      : [],
  );
  return { gpuOfTpu, tpuOfTp };
}

/** รายการ STP ชุดที่นำเข้าล่าสุด (ยังไม่เคยนำเข้า = null) */
async function loadCatalog(): Promise<StpCatalog | null> {
  const rows = await insightQuery<StpEntry>(
    `SELECT upper(trim(code)) AS code,
            (tmt_id IS NOT NULL AND trim(tmt_id) <> '') AS is_tmt,
            max(rate) AS rate,
            bool_or(coalesce(opd, false)) AS opd,
            bool_or(coalesce(ipd, false)) AS ipd,
            min(adp_type) AS adp_type,
            min(chrgitem_group) AS chrgitem_group,
            count(*)::int AS dup_rows,
            count(DISTINCT rate)::int AS rate_variants
     FROM fund_claim_item
     WHERE fund = $1
       AND file_id = (SELECT max(id) FROM catalog_file WHERE kind = $2)
       AND code IS NOT NULL AND trim(code) <> ''
     GROUP BY 1, 2
     ORDER BY 1`,
    ["STP", "claim_stp"],
  );
  if (!rows.length) return null;
  return {
    drug: new Map(rows.filter((r) => r.is_tmt).map((r) => [r.code, r])),
    nondrug: new Map(rows.filter((r) => !r.is_tmt).map((r) => [r.code, r])),
  };
}

const XLSX_COLUMNS: XlsxColumn<StpCheckRow & { result_label: string }>[] = [
  { key: "vstdate", header: "วันที่รับบริการ", width: 12 },
  { key: "hn", header: "HN", width: 10 },
  { key: "vn", header: "VN", width: 14 },
  { key: "icode", header: "icode", width: 10 },
  { key: "item_name", header: "รายการ", width: 36 },
  { key: "code", header: "รหัสเบิก (ADP/GPU)", width: 14 },
  { key: "qty", header: "จำนวน", width: 8, type: "count" },
  { key: "unitprice", header: "ราคาต่อหน่วย (บาท)", width: 14, type: "money" },
  { key: "sum_price", header: "รวม (บาท)", width: 14, type: "money" },
  { key: "rate", header: "อัตรา STP (บาท)", width: 14, type: "money" },
  { key: "excess", header: "ส่วนเกิน (บาท)", width: 14, type: "money" },
  { key: "result_label", header: "ผลตรวจ", width: 22 },
  { key: "fix", header: "วิธีแก้", width: 44 },
];

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const show = params.get("show") || "fix";
  if (show !== "fix" && show !== "all") return badRequest("show ต้องเป็น fix หรือ all");
  const grid = parseGridQuery<(typeof SORTABLE)[number]>(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters<FilterKey>(params, FILTERABLE);
  if (!cf.ok) return badRequest(cf.error);
  const { filters, facet, facetQ } = cf.query;

  const pttypes = (await hisQuery<{ pttype: string }>("SELECT pttype, hipdata_code FROM pttype WHERE hipdata_code = ?", ["STP"])).map((r) => r.pttype);
  const catalog = pttypes.length ? await loadCatalog() : null;
  const notice = !pttypes.length ? "no_pttype" : !catalog ? "no_catalog" : null;
  let checked: StpCheckRow[] = [];
  if (catalog) {
    const items = await loadItems(start, end, pttypes);
    const tmt = await loadTmt(items);
    checked = items.map((i) => checkItem(i, catalog, tmt));
  }

  const searched = q ? checked.filter((r) => matches(r, q)) : checked;
  const shown = (rows: StpCheckRow[]) => (show === "all" ? rows : rows.filter((r) => needsFix(r.result)));
  if (facet) return Response.json(facetRows(shown(searched), FILTER_GET[facet], facetQ, (v) => RESULT_LABEL[v as CheckResult] ?? v));
  // แถบสรุปนับทุกผลตรวจ (ไม่สนตัวเลือก "ต้องแก้") ให้เห็นสัดส่วนที่ผ่าน
  const filtered = filterRows(searched, filters, FILTER_GET);
  const rows = sortRows(shown(filtered), sort ?? "vstdate", dir);

  if (format === "xlsx") {
    return xlsxResponse(`stp-check-${start}_${end}.xlsx`, XLSX_COLUMNS, rows.map((r) => ({ ...r, result_label: RESULT_LABEL[r.result] })));
  }
  const body: StpCheckPage = {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    summary: summarize(filtered),
    notice,
  };
  return Response.json(body);
}
