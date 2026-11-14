import { auth } from "@/auth";
import { hisQuery, insightQuery } from "@/lib/db";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type GridPage, type RowGetters } from "@/lib/grid-query";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { PROBLEMS, compareItems, type CompareRow, type HisItem, type OfcRef, type Problem, type UcRef } from "./_lib/compare";
import { datasetInfo, type DatasetInfo } from "./_lib/server";

export type CompareSummary = {
  /** รายการ active ใน HOSxP ที่ตรวจ */
  items: number;
  /** จำนวนรายการ (ไม่ซ้ำ icode) ที่มีปัญหาอย่างน้อยหนึ่งข้อ ตามคำค้นและตัวกรองอื่นนอกจากปัญหา */
  affected: number;
  counts: Record<Problem, number>;
  uc: DatasetInfo;
  ofc: DatasetInfo;
};
export type ComparePage = GridPage<CompareRow> & { summary: CompareSummary };

// พิสูจน์แล้วด้วย db-cli (1,694 แถว ~0.6 วินาที) ; group 1 = ข้าราชการ, 2 = UC ; department 1 = OPD, 2 = IPD ; items_table_name เป็น 'drugitems' ทุกแถว ห้ามกรอง
const HIS_SQL = `SELECT n.icode, n.name, n.unit, n.price, n.ipd_price, n.istatus, n.income, n.billcode, n.nhso_adp_type_id, n.nhso_adp_code, n.tmlt_code,
       g.g1_opd, g.g1_ipd, g.g2_opd, g.g2_ipd
FROM nondrugitems n
LEFT JOIN (SELECT items_table_code,
      MAX(CASE WHEN pttype_price_group_id = 1 AND pttype_department_id = 1 THEN price END) AS g1_opd,
      MAX(CASE WHEN pttype_price_group_id = 1 AND pttype_department_id = 2 THEN price END) AS g1_ipd,
      MAX(CASE WHEN pttype_price_group_id = 2 AND pttype_department_id = 1 THEN price END) AS g2_opd,
      MAX(CASE WHEN pttype_price_group_id = 2 AND pttype_department_id = 2 THEN price END) AS g2_ipd
  FROM pttype_items_price GROUP BY items_table_code) g ON g.items_table_code = n.icode
WHERE n.istatus = 'Y'`;

// รายการค่าบริการเปลี่ยนไม่บ่อย แต่ DataGrid ยิงทุกครั้งที่เปลี่ยนหน้า/เรียง/เปิดตัวกรอง จึงจำผล HOSxP ไว้ 5 นาทีต่อ process
const HIS_TTL = 5 * 60_000;
let hisCache: { at: number; rows: Promise<HisItem[]> } | null = null;
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
function loadHis(): Promise<HisItem[]> {
  if (hisCache && Date.now() - hisCache.at < HIS_TTL) return hisCache.rows;
  const rows = hisQuery<Record<string, unknown>>(HIS_SQL).then((rs) =>
    rs.map((r) => ({
      icode: String(r.icode), name: String(r.name ?? ""), unit: (r.unit as string) ?? null, income: (r.income as string) ?? null,
      price: num(r.price), ipd_price: num(r.ipd_price), nhso_adp_type_id: num(r.nhso_adp_type_id), nhso_adp_code: (r.nhso_adp_code as string) ?? null,
      g1_opd: num(r.g1_opd), g1_ipd: num(r.g1_ipd), g2_opd: num(r.g2_opd), g2_ipd: num(r.g2_ipd),
    })),
  );
  hisCache = { at: Date.now(), rows };
  rows.catch(() => (hisCache = null)); // error ไม่จำ
  return rows;
}

const SORT = {
  icode: (r: CompareRow) => r.icode, name: (r: CompareRow) => r.name, adp_code: (r: CompareRow) => r.adp_code ?? "", problem: (r: CompareRow) => r.problem,
  uc_rate: (r: CompareRow) => r.uc_rate ?? -1, ofc_rate: (r: CompareRow) => r.ofc_rate ?? -1,
} as const;
type SortKey = keyof typeof SORT;
const FILTER_GET: RowGetters<CompareRow, "problem" | "adp_type"> = { problem: (r) => r.problem, adp_type: (r) => r.adp_type };
const PROBLEM_LABEL = (v: string) => PROBLEMS[v as Problem]?.label ?? v;

/** GET + พารามิเตอร์ DataGrid: ปัญหาของรายการค่าบริการ HOSxP เทียบ UC/OFC หนึ่งแถวต่อหนึ่งปัญหา (format=xlsx = รายการที่ต้องแก้ทั้งหมดตามตัวกรอง) */
export async function GET(request: Request) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const grid = parseGridQuery<SortKey>(params, Object.keys(SORT) as SortKey[]);
  if (!grid.ok) return Response.json({ error: grid.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters<"problem" | "adp_type">(params, ["problem", "adp_type"]);
  if (!cf.ok) return Response.json({ error: cf.error }, { status: 400 });
  const { filters, facet, facetQ } = cf.query;

  const [items, uc, ofc, groups, ucInfo, ofcInfo] = await Promise.all([
    loadHis(),
    insightQuery<UcRef & { price: string | null }>("SELECT code, name, price, start_date, end_date, fs_status, chrgitem_group FROM service_catalog_uc WHERE code IS NOT NULL"),
    insightQuery<OfcRef & { price: string | null }>("SELECT code, name, price FROM service_catalog_ofc"),
    insightQuery<{ code: string; adp_types: number[] | null }>("SELECT code, adp_types FROM chrgitem_group"),
    datasetInfo("service_uc"),
    datasetInfo("service_ofc"),
  ]);
  const all = compareItems(
    items,
    uc.map((r) => ({ ...r, price: num(r.price) })),
    ofc.map((r) => ({ ...r, price: num(r.price) })),
    new Map(groups.map((g) => [g.code, g.adp_types])),
    todayIso(),
  );
  const needle = q.toLowerCase();
  const searched = needle ? all.filter((r) => `${r.icode} ${r.name} ${r.adp_code ?? ""}`.toLowerCase().includes(needle)) : all;
  if (facet) return Response.json(facetRows(filterRows(searched, filters, FILTER_GET, facet), FILTER_GET[facet], facetQ, facet === "problem" ? PROBLEM_LABEL : undefined));

  const rows = filterRows(searched, filters, FILTER_GET);
  const key = SORT[sort ?? "icode"];
  const sign = dir === "desc" ? -1 : 1;
  rows.sort((a, b) => {
    const x = key(a), y = key(b);
    return sign * (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "th")) || a.icode.localeCompare(b.icode) || a.problem.localeCompare(b.problem);
  });

  if (format === "xlsx") {
    const out = rows.map((r) => ({ ...r, problem_label: PROBLEMS[r.problem].label, fix: PROBLEMS[r.problem].fix }));
    return xlsxResponse<(typeof out)[number]>("service-catalog-fix.xlsx", [
      { key: "icode", header: "icode", width: 10 },
      { key: "name", header: "ชื่อรายการ", width: 40 },
      { key: "unit", header: "หน่วย", width: 8 },
      { key: "adp_code", header: "รหัส ADP", width: 12 },
      { key: "adp_type", header: "ประเภท ADP", width: 8 },
      { key: "problem_label", header: "ปัญหา", width: 28 },
      { key: "detail", header: "รายละเอียด", width: 40 },
      { key: "fix", header: "วิธีแก้", width: 60 },
      { key: "ofc_opd", header: "ราคาข้าราชการ OPD (บาท)", width: 14, type: "money" },
      { key: "ofc_ipd", header: "ราคาข้าราชการ IPD (บาท)", width: 14, type: "money" },
      { key: "uc_opd", header: "ราคา UC OPD (บาท)", width: 14, type: "money" },
      { key: "uc_ipd", header: "ราคา UC IPD (บาท)", width: 14, type: "money" },
      { key: "uc_rate", header: "อัตรา UC (บาท)", width: 12, type: "money" },
      { key: "ofc_rate", header: "อัตรา OFC (บาท)", width: 12, type: "money" },
    ], out);
  }

  const counts = Object.fromEntries(Object.keys(PROBLEMS).map((p) => [p, 0])) as Record<Problem, number>;
  const base = filterRows(searched, filters, FILTER_GET, "problem");
  for (const r of base) counts[r.problem]++;
  const body: ComparePage = {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    summary: { items: items.length, affected: new Set(base.map((r) => r.icode)).size, counts, uc: ucInfo, ofc: ofcInfo },
  };
  return Response.json(body);
}
