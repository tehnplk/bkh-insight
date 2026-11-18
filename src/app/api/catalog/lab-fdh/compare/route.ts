import { auth } from "@/auth";
import { hisQuery, insightQuery } from "@/lib/db";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type GridPage, type RowGetters } from "@/lib/grid-query";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import type { CatalogFileInfo } from "../../drug-nhso/drug-nhso";
import { PROBLEMS, compareLab, isLabItem, type CatRow, type CompareRow, type HisLab, type Problem } from "./compare";

export type LabCompareSummary = {
  /** รายการ Lab ที่ใช้งานใน HOSxP */
  his: number;
  /** Lab Code ไม่ซ้ำใน catalog */
  catalog: number;
  /** จำนวนรหัสที่มีปัญหาอย่างน้อยหนึ่งข้อ ตามคำค้นและตัวกรองอื่นนอกจากปัญหา */
  affected: number;
  counts: Record<Problem, number>;
  file: CatalogFileInfo;
};
export type LabComparePage = GridPage<CompareRow> & { summary: LabCompareSummary };

// พิสูจน์แล้วด้วย db-cli (2,543 แถว = icode ไม่ซ้ำ ~0.9 วินาที) อ่านทุกแถวเพราะต้องรู้ว่ารหัสใน catalog มีใน HOSxP และยัง active ไหม
// tmlt_n NULL = ไม่ผูก lab_items ที่ active ; group 1 = ข้าราชการ, department 1 = OPD
const HIS_SQL = `SELECT n.icode, n.name, n.istatus, n.income, n.price, n.nhso_adp_code,
       li.lab_items_codes, li.tmlt_codes, li.tmlt_n, t.sks_code, p1.price AS price_ofc
FROM nondrugitems n
LEFT JOIN (SELECT icode,
                  GROUP_CONCAT(lab_items_code ORDER BY lab_items_code) AS lab_items_codes,
                  GROUP_CONCAT(DISTINCT NULLIF(tmlt_code, '') ORDER BY tmlt_code) AS tmlt_codes,
                  COUNT(DISTINCT NULLIF(tmlt_code, '')) AS tmlt_n,
                  MIN(NULLIF(tmlt_code, '')) AS tmlt_code
           FROM lab_items
           WHERE active_status = 'Y' AND icode IS NOT NULL AND icode <> ''
           GROUP BY icode) li ON li.icode = n.icode
LEFT JOIN lab_items_tmlt t ON t.tmlt_code = li.tmlt_code AND li.tmlt_n = 1
LEFT JOIN (SELECT items_table_code, MAX(price) AS price FROM pttype_items_price
           WHERE pttype_price_group_id = 1 AND pttype_department_id = 1
           GROUP BY items_table_code) p1 ON p1.items_table_code = n.icode`;

// DataGrid ยิงทุกครั้งที่เปลี่ยนหน้า/เรียง/เปิดตัวกรอง จึงจำผล HOSxP ไว้ 5 นาทีต่อ process (เหมือน service-catalog)
const HIS_TTL = 5 * 60_000;
let hisCache: { at: number; rows: Promise<HisLab[]> } | null = null;
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const str = (v: unknown) => (v == null ? null : String(v));
function loadHis(): Promise<HisLab[]> {
  if (hisCache && Date.now() - hisCache.at < HIS_TTL) return hisCache.rows;
  const rows = hisQuery<Record<string, unknown>>(HIS_SQL).then((rs) =>
    rs.map((r) => ({
      icode: String(r.icode), name: String(r.name ?? ""), istatus: str(r.istatus), income: str(r.income), price: num(r.price),
      nhso_adp_code: str(r.nhso_adp_code), lab_items_codes: str(r.lab_items_codes), tmlt_codes: str(r.tmlt_codes), tmlt_n: num(r.tmlt_n),
      sks_code: str(r.sks_code), price_ofc: num(r.price_ofc),
    })),
  );
  hisCache = { at: Date.now(), rows };
  rows.catch(() => (hisCache = null)); // error ไม่จำ
  return rows;
}

const SORT = {
  code: (r: CompareRow) => r.code, name: (r: CompareRow) => r.name, problem: (r: CompareRow) => r.problem,
  cat_price: (r: CompareRow) => r.cat_price ?? -1, ofc_price: (r: CompareRow) => r.ofc_price ?? -1,
} as const;
type SortKey = keyof typeof SORT;
const FILTER_GET: RowGetters<CompareRow, "problem" | "plans"> = { problem: (r) => r.problem, plans: (r) => r.plans };
const PROBLEM_LABEL = (v: string) => PROBLEMS[v as Problem]?.label ?? v;
const ORDER = Object.keys(PROBLEMS);

/** GET + พารามิเตอร์ DataGrid: ปัญหาของ Lab Catalog FDH เทียบรายการ Lab ของ HOSxP หนึ่งแถวต่อหนึ่งปัญหา (format=xlsx = ทั้งหมดตามตัวกรอง) */
export async function GET(request: Request) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const grid = parseGridQuery<SortKey>(params, Object.keys(SORT) as SortKey[]);
  if (!grid.ok) return Response.json({ error: grid.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters<"problem" | "plans">(params, ["problem", "plans"]);
  if (!cf.ok) return Response.json({ error: cf.error }, { status: 400 });
  const { filters, facet, facetQ } = cf.query;

  const [his, cat, [file]] = await Promise.all([
    loadHis(),
    insightQuery<CatRow & { price: string | null }>(
      "SELECT lab_code, benefit_plan, cgd_code, name, price, tmlt_code, start_at, end_at FROM lab_catalog_fdh ORDER BY lab_code, benefit_plan, line_no",
    ),
    insightQuery<NonNullable<CatalogFileInfo>>(
      "SELECT file_name, row_count, item_count, imported_by, imported_at FROM catalog_file WHERE kind = 'lab_fdh' ORDER BY imported_at DESC, id DESC LIMIT 1",
    ),
  ]);
  // ยังไม่นำเข้า catalog = เทียบไม่ได้ (ไม่งั้นทุกรายการ Lab จะขึ้นว่าไม่มีใน catalog)
  const all = cat.length ? compareLab(his, cat.map((r) => ({ ...r, price: num(r.price) })), todayIso()) : [];
  const needle = q.toLowerCase();
  const searched = needle ? all.filter((r) => `${r.code} ${r.name} ${r.tmlt_his ?? ""} ${r.tmlt_cat ?? ""} ${r.cgd_his ?? ""} ${r.cgd_cat ?? ""}`.toLowerCase().includes(needle)) : all;
  if (facet) return Response.json(facetRows(filterRows(searched, filters, FILTER_GET, facet), FILTER_GET[facet], facetQ, facet === "problem" ? PROBLEM_LABEL : undefined));

  const rows = filterRows(searched, filters, FILTER_GET);
  const sign = dir === "desc" ? -1 : 1;
  // ค่าเริ่มต้นเรียงตามระดับปัญหา (error ก่อน) แล้วตามรหัส
  const key = sort ? SORT[sort] : (r: CompareRow) => ORDER.indexOf(r.problem);
  rows.sort((a, b) => {
    const x = key(a), y = key(b);
    return sign * (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "th")) || a.code.localeCompare(b.code) || a.problem.localeCompare(b.problem);
  });

  if (format === "xlsx") {
    const out = rows.map((r) => ({ ...r, problem_label: PROBLEMS[r.problem].label, fix: PROBLEMS[r.problem].fix }));
    return xlsxResponse<(typeof out)[number]>("lab-catalog-fdh-fix.xlsx", [
      { key: "code", header: "Lab Code (icode)", width: 10 },
      { key: "name", header: "ชื่อรายการ", width: 36 },
      { key: "plans", header: "สิทธิประโยชน์ใน catalog", width: 16 },
      { key: "problem_label", header: "ปัญหา", width: 26 },
      { key: "detail", header: "รายละเอียด", width: 36 },
      { key: "fix", header: "วิธีแก้", width: 60 },
      { key: "tmlt_his", header: "TMLT HOSxP", width: 14 },
      { key: "tmlt_cat", header: "TMLT catalog", width: 14 },
      { key: "cgd_his", header: "รหัส ADP HOSxP", width: 12 },
      { key: "cgd_cat", header: "รหัสกรมบัญชีกลาง catalog", width: 14 },
      { key: "cat_price", header: "ราคากลาง (บาท)", width: 12, type: "money" },
      { key: "ofc_price", header: "ราคาข้าราชการ HOSxP (บาท)", width: 14, type: "money" },
    ], out);
  }

  const counts = Object.fromEntries(ORDER.map((p) => [p, 0])) as Record<Problem, number>;
  const base = filterRows(searched, filters, FILTER_GET, "problem");
  for (const r of base) counts[r.problem]++;
  const body: LabComparePage = {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    summary: {
      his: his.filter(isLabItem).length, catalog: new Set(cat.map((r) => r.lab_code.trim().toUpperCase())).size,
      affected: new Set(base.map((r) => r.code)).size, counts, file: file ?? null,
    },
  };
  return Response.json(body);
}
