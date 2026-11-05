import type { NextRequest } from "next/server";
import { escapeLike, hisQuery } from "@/lib/db";
import { parseGridQuery, type GridPage } from "@/lib/grid-query";
import { xlsxResponse } from "@/lib/xlsx";
import type { FundVisitRow } from "../../types";
import {
  FULL_NAME_SQL, OPI_BY_DATE, depNameSql, depSql, badRequest, fundPttypeFilter, fundSql, isAuthed, loadLookups, parseRange, round2, unauthorized,
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

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const grid = parseGridQuery(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;

  const filters = {
    fund: params.get("fund") || null,
    pttype: params.get("pttype") || null,
    income: params.get("income") || null,
    dep: params.get("dep") || null,
  };
  for (const [k, v] of Object.entries(filters)) {
    if (v !== null && !CODE.test(v)) return badRequest(`${k} ไม่ถูกต้อง`);
  }

  // ยอดต่อ visit จากรายการ OPD (vn IS NOT NULL) ตามกองทุน/สิทธิ/หมวดของรายการนั้น (opitemrece.pttype)
  let itemWhere = "o.vstdate BETWEEN ? AND ? AND o.vn IS NOT NULL";
  const itemParams: string[] = [start, end];
  if (filters.fund) {
    const f = fundPttypeFilter(await loadLookups(), filters.fund);
    itemWhere += ` AND ${f.sql}`;
    itemParams.push(...f.params);
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
  } else if (filters.fund || filters.pttype) {
    const own: string[] = [];
    if (filters.fund) {
      own.push(`${fundSql("t")} = ?`);
      whereParams.push(filters.fund);
    }
    if (filters.pttype) {
      own.push("v.pttype = ?");
      whereParams.push(filters.pttype);
    }
    where += ` AND (a.vn IS NOT NULL OR (${own.join(" AND ")}))`;
  }
  if (filters.dep) {
    where += ` AND ${depSql("v")} = ?`;
    whereParams.push(filters.dep);
  }
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where += ` AND (v.hn LIKE ? OR ${FULL_NAME_SQL} LIKE ?)`;
    whereParams.push(like, like);
  }

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
