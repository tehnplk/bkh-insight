import type { NextRequest } from "next/server";
import { escapeLike, hisQuery } from "@/lib/db";
import { parseColumnFilters, parseGridQuery, type GridPage } from "@/lib/grid-query";
import { columnFilterWhere, loadFacet, type ColumnFilterDefs } from "@/lib/column-filter-sql";
import { xlsxResponse } from "@/lib/xlsx";
import type { FundVisitRow } from "../../types";
import {
  FULL_NAME_SQL, OPI_BY_DATE, activePttypes, depNameSql, depSql, badRequest, effectiveCodes, fundPttypeFilter, fundSql, inList, isAuthed,
  loadDepartments, loadLookups, parseCodes, parseRange, round2, unauthorized,
} from "../../_lib/fund";

// allowlist: ค่าที่ client ส่งมา -> alias ใน SELECT ด้านล่าง
const SORT_SQL = {
  vstdate: "vstdate",
  hn: "hn",
  full_name: "full_name",
  pttype_name: "pttype_name",
  dep_name: "dep_name",
  amount: "amount",
} as const;
const SORTABLE = Object.keys(SORT_SQL) as (keyof typeof SORT_SQL)[];

// รหัสกองทุน/สิทธิ/หมวด/แผนก รวม "UNKNOWN"
const CODE = /^[A-Za-z0-9]{1,10}$/;

// ตัวกรองหัวคอลัมน์ (allowlist) บน ovst v ; facet นับจาก FROM/WHERE เดียวกับ count
const FILTER_DEFS: ColumnFilterDefs = {
  vstdate: { expr: "DATE_FORMAT(v.vstdate, '%Y-%m-%d')" },
  hn: { expr: "v.hn" },
  full_name: { expr: FULL_NAME_SQL },
  pttype_name: { expr: "v.pttype", label: "t.name" },
  dep_name: { expr: depSql("v"), label: "k.department" },
};
const FILTERABLE = ["vstdate", "hn", "full_name", "pttype_name", "dep_name"] as const;

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const grid = parseGridQuery(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters(params, FILTERABLE);
  if (!cf.ok) return badRequest(cf.error);

  const filters = {
    fund: params.get("fund") || null,
    pttype: params.get("pttype") || null,
    income: params.get("income") || null,
    dep: params.get("dep") || null,
    // แผนกของคิว (opd_dep_queue) ไม่ใช่ main_dep: visit ที่ถูกส่งเข้าคิวแผนกนั้น
    qdep: params.get("qdep") || null,
  };
  for (const [k, v] of Object.entries(filters)) {
    if (v !== null && !CODE.test(v)) return badRequest(`${k} ไม่ถูกต้อง`);
  }
  // หลายค่าจากตัวเลือกของหน้า AND กับ pttype/dep ตัวเดียว (chip ใน modal)
  const rawPttypes = parseCodes(params.get("pttypes"));
  const rawDeps = parseCodes(params.get("deps"));
  if (rawPttypes === "invalid") return badRequest("pttypes ไม่ถูกต้อง");
  if (rawDeps === "invalid") return badRequest("deps ไม่ถูกต้อง");
  const [lk, allDeps] = await Promise.all([
    filters.fund || rawPttypes ? loadLookups() : null,
    rawDeps ? loadDepartments() : null,
  ]);
  // "เลือกครบ" เทียบกับตัวเลือกที่เปิดใช้ ชุดเดียวกับ summary ยอดจึงตรงกัน
  const pttypes = lk && effectiveCodes(rawPttypes, activePttypes(lk));
  const deps = allDeps && effectiveCodes(rawDeps, allDeps.filter((d) => d.active).map((d) => d.code));

  // ยอดต่อ visit จากรายการ OPD (vn IS NOT NULL) ตามกองทุน/สิทธิ/หมวดของรายการนั้น (opitemrece.pttype)
  let itemWhere = "o.vstdate BETWEEN ? AND ? AND o.vn IS NOT NULL";
  const itemParams: string[] = [start, end];
  if (filters.fund && lk) {
    const f = fundPttypeFilter(lk, filters.fund);
    itemWhere += ` AND ${f.sql}`;
    itemParams.push(...f.params);
  }
  if (pttypes) {
    itemWhere += ` AND ${inList("o.pttype", pttypes.length)}`;
    itemParams.push(...pttypes);
  }
  if (filters.pttype) {
    itemWhere += " AND o.pttype = ?";
    itemParams.push(filters.pttype);
  }
  if (filters.income) {
    itemWhere += " AND o.income = ?";
    itemParams.push(filters.income);
  }
  const itemSql = `SELECT o.vn, SUM(o.sum_price) AS amount FROM ${OPI_BY_DATE}
    WHERE ${itemWhere} GROUP BY o.vn`;

  // visit ที่แสดง: ไม่กรอง = ทุก visit ในช่วง (ไม่มีรายการ = 0)
  // กรองกองทุน/สิทธิ = visit ที่สิทธิหลัก (ovst.pttype) ตรง หรือมีรายการที่เรียกเก็บสิทธินั้น จึงนับตรงกับ summary
  // กรองหมวด = เฉพาะ visit ที่มีรายการหมวดนั้น
  let where = "WHERE v.vstdate BETWEEN ? AND ?";
  const whereParams: string[] = [start, end];
  if (filters.income) {
    where += " AND a.vn IS NOT NULL";
  } else if (filters.fund || filters.pttype || pttypes) {
    const own: string[] = [];
    if (filters.fund) {
      own.push(`${fundSql("t")} = ?`);
      whereParams.push(filters.fund);
    }
    if (filters.pttype) {
      own.push("v.pttype = ?");
      whereParams.push(filters.pttype);
    }
    if (pttypes) {
      own.push(inList("v.pttype", pttypes.length));
      whereParams.push(...pttypes);
    }
    where += ` AND (a.vn IS NOT NULL OR (${own.join(" AND ")}))`;
  }
  if (filters.dep) {
    where += ` AND ${depSql("v")} = ?`;
    whereParams.push(filters.dep);
  }
  if (filters.qdep) {
    where += " AND EXISTS (SELECT 1 FROM opd_dep_queue dq WHERE dq.vn = v.vn AND dq.depcode = ?)";
    // summary นับ depcode ว่างเป็น UNKNOWN
    whereParams.push(filters.qdep === "UNKNOWN" ? "" : filters.qdep);
  }
  if (deps) {
    where += ` AND ${inList(depSql("v"), deps.length)}`;
    whereParams.push(...deps);
  }
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where += ` AND (v.hn LIKE ? OR ${FULL_NAME_SQL} LIKE ?)`;
    whereParams.push(like, like);
  }

  const facet = cf.query.facet;
  const cfw = columnFilterWhere(FILTER_DEFS, cf.query.filters, facet);
  where += cfw.parts.map((p) => ` AND ${p}`).join("");
  whereParams.push(...cfw.params.map(String));

  const from = `FROM ovst v
    LEFT JOIN (${itemSql}) a ON a.vn = v.vn
    LEFT JOIN patient p ON p.hn = v.hn
    LEFT JOIN pttype t ON t.pttype = v.pttype
    LEFT JOIN kskdepartment k ON k.depcode = v.main_dep`;
  const select = `SELECT v.vn, v.vstdate, v.hn, ${FULL_NAME_SQL} AS full_name, v.pttype, IFNULL(t.name, v.pttype) AS pttype_name,
    ${fundSql("t")} AS fund_code, ${depSql("v")} AS dep_code, ${depNameSql("v")} AS dep_name,
    IFNULL(a.amount, 0) AS amount ${from}`;
  // sort มาจาก allowlist และ dir เป็น asc|desc เท่านั้น
  const orderBy = `ORDER BY ${sort ? `${SORT_SQL[sort]} ${dir}, ` : "v.vstdate, "}v.vn`;
  const allParams = [...itemParams, ...whereParams];
  if (facet) return Response.json(await loadFacet(hisQuery, FILTER_DEFS, facet, cf.query.facetQ, from, { sql: where, params: allParams }));

  const normalize = (r: FundVisitRow): FundVisitRow => ({ ...r, pttype: r.pttype ?? "", amount: round2(r.amount) });

  if (format === "xlsx") {
    const rows = (await hisQuery<FundVisitRow>(`${select} ${where} ${orderBy}`, allParams)).map(normalize);
    return xlsxResponse<FundVisitRow>(`opd-fund-${start}_${end}.xlsx`, [
      { key: "vstdate", header: "วันที่รับบริการ", width: 14 },
      { key: "vn", header: "VN", width: 14 },
      { key: "hn", header: "HN", width: 12 },
      { key: "full_name", header: "ชื่อ-นามสกุล", width: 28 },
      { key: "pttype_name", header: "สิทธิ", width: 32 },
      { key: "fund_code", header: "กองทุน", width: 10 },
      { key: "dep_name", header: "แผนก", width: 24 },
      { key: "amount", header: "มูลค่า (บาท)", width: 14, type: "money" },
    ], rows);
  }

  const [rows, [{ total }]] = await Promise.all([
    hisQuery<FundVisitRow>(`${select} ${where} ${orderBy} LIMIT ? OFFSET ?`, [...allParams, pageSize, (page - 1) * pageSize]),
    hisQuery<{ total: number }>(`SELECT COUNT(*) AS total ${from} ${where}`, allParams),
  ]);
  const body: GridPage<FundVisitRow> = { rows: rows.map(normalize), total: Number(total) };
  return Response.json(body);
}
