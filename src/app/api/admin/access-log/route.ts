import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { escapeLike, insightQuery } from "@/lib/db";
import { parseColumnFilters, parseGridQuery, type GridPage } from "@/lib/grid-query";
import { columnFilterWhere, loadFacet, type ColumnFilterDefs, type SqlValue } from "@/lib/column-filter-sql";
import { xlsxResponse } from "@/lib/xlsx";
import { parseRange } from "@/app/api/fund/_lib/fund";
import { ACCESS_MAX_DAYS } from "./config";

export type AccessRow = { id: string; at: string; user_name: string | null; role: string | null; method: string; path: string; query: string | null };

const SORTABLE = ["at", "user_name", "method", "path"] as const;
const FILTER_DEFS: ColumnFilterDefs = {
  user_name: { expr: "user_name" },
  role: { expr: "role" },
  method: { expr: "method" },
  path: { expr: "path" },
};
const FILTERABLE = Object.keys(FILTER_DEFS);

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  const params = request.nextUrl.searchParams;
  const parsed = parseGridQuery(params, SORTABLE);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const range = parseRange(params, ACCESS_MAX_DAYS);
  if (!range.ok) return Response.json({ error: range.error }, { status: 400 });
  const cf = parseColumnFilters(params, FILTERABLE);
  if (!cf.ok) return Response.json({ error: cf.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = parsed.query;

  // วันที่ตามเวลาไทย (session timezone ของ insight เป็น Asia/Bangkok) ; $3 = คำค้น
  const cfw = columnFilterWhere(FILTER_DEFS, cf.query.filters, cf.query.facet, "pg", 4);
  const where = `WHERE at >= $1::date AND at < $2::date + 1 AND ($3::text IS NULL OR user_name ILIKE $3 OR path ILIKE $3 OR query ILIKE $3)${cfw.parts.map((p) => ` AND ${p}`).join("")}`;
  const args = [range.range.start, range.range.end, q ? `%${escapeLike(q)}%` : null, ...cfw.params] as SqlValue[];
  if (cf.query.facet) return Response.json(await loadFacet(insightQuery, FILTER_DEFS, cf.query.facet, cf.query.facetQ, "FROM access_log", { sql: where, params: args }, "pg"));

  // sort มาจาก allowlist จึงใช้เป็นชื่อคอลัมน์ได้
  const select = `SELECT id, to_char(at, 'YYYY-MM-DD HH24:MI:SS') AS at, user_name, role, method, path, query FROM access_log ${where}
ORDER BY ${sort ?? "at"} ${sort && dir === "asc" ? "ASC" : "DESC"}, id DESC`;
  if (format === "xlsx") {
    const rows = await insightQuery<AccessRow>(`${select} LIMIT 100000`, args);
    return xlsxResponse<AccessRow>("access-log.xlsx", [
      { key: "at", header: "เวลา", width: 20 },
      { key: "user_name", header: "ผู้ใช้", width: 24 },
      { key: "role", header: "role", width: 8 },
      { key: "method", header: "method", width: 8 },
      { key: "path", header: "path", width: 40 },
      { key: "query", header: "query", width: 60 },
    ], rows);
  }
  const n = args.length;
  const [rows, [{ total }]] = await Promise.all([
    insightQuery<AccessRow>(`${select} LIMIT $${n + 1} OFFSET $${n + 2}`, [...args, pageSize, (page - 1) * pageSize]),
    insightQuery<{ total: number }>(`SELECT count(*)::int AS total FROM access_log ${where}`, args),
  ]);
  const body: GridPage<AccessRow> = { rows, total };
  return Response.json(body);
}
