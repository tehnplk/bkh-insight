import type { NextRequest } from "next/server";
import { escapeLike, hisQuery } from "@/lib/db";
import { parseGridQuery, type GridPage } from "@/lib/grid-query";
import { xlsxResponse } from "@/lib/xlsx";
import type { PendingRow } from "../../types";
import {
  FULL_NAME_SQL, UNKNOWN_NAME, badRequest, depSql, fundOf, fundPttypeFilter, isAuthed, loadLookups, parseRange, round2, unauthorized,
} from "../../_lib/fund";
import { CLAIM_JOINS, STATUS_SQL, VISIT_AMOUNT_JOIN } from "../../_lib/claim";

// allowlist: ค่าที่ client ส่งมา -> คอลัมน์ใน SQL
const SORT_SQL = {
  amount: "t.amount",
  vstdate: "t.vstdate",
  hn: "t.hn",
  full_name: "t.full_name",
  dep_name: "d.department",
} as const;
const SORTABLE = Object.keys(SORT_SQL) as (keyof typeof SORT_SQL)[];
// IN (?, ?) สองค่าเสมอ สถานะเดียวส่งซ้ำ
const STATUSES = {
  pending: ["authen_only", "none"],
  authen_only: ["authen_only", "authen_only"],
  none: ["none", "none"],
} as const;
const CODE = /^[A-Za-z0-9]{1,10}$/;

type Raw = Omit<PendingRow, "fund_code" | "fund_name"> & { pttype: string | null; main_dep: string | null };

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const grid = parseGridQuery(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;

  const status = params.get("status") || "pending";
  if (!(status in STATUSES)) return badRequest("status ได้เฉพาะ: pending, authen_only, none");
  const fund = params.get("fund") || null;
  const dep = params.get("dep") || null;
  if (fund !== null && !CODE.test(fund)) return badRequest("fund ไม่ถูกต้อง");
  if (dep !== null && !CODE.test(dep)) return badRequest("dep ไม่ถูกต้อง");

  const lk = await loadLookups();
  let extra = "";
  const extraParams: string[] = [];
  if (fund) {
    const f = fundPttypeFilter(lk, fund);
    // กองทุนที่ไม่มี pttype เลย ไม่ต้องถาม his
    if (f.sql === "1 = 0") return Response.json({ rows: [], total: 0 } satisfies GridPage<PendingRow>);
    extra += ` AND ${f.sql}`;
    extraParams.push(...f.params);
  }
  if (dep) {
    extra += ` AND ${depSql("o")} = ?`;
    extraParams.push(dep);
  }
  if (q) {
    const like = `%${escapeLike(q)}%`;
    extra += ` AND (o.hn LIKE ? OR ${FULL_NAME_SQL} LIKE ?)`;
    extraParams.push(like, like);
  }
  const statusParams = STATUSES[status as keyof typeof STATUSES];

  const select = `
SELECT t.vn, t.vstdate, t.hn, t.full_name, t.pttype, IFNULL(pt.name, IFNULL(t.pttype, '')) AS pttype_name, t.main_dep,
  d.department AS dep_name,
  COALESCE(IF(t.vp_auth LIKE 'PP%', t.vp_auth, NULL), (SELECT s2.claim_code FROM nhso_smartcard_agent s2
    WHERE s2.vn = t.vn AND s2.claim_code LIKE 'PP%' ORDER BY s2.nhso_smartcard_agent_id DESC LIMIT 1)) AS authen_code,
  IF(t.status = 'closed', t.close_code, NULL) AS close_code, t.status, t.amount
FROM (
  SELECT o.vn, o.vstdate, o.hn, ${FULL_NAME_SQL} AS full_name, o.pttype, o.main_dep,
    COALESCE(x.amt, 0) AS amount, vp.auth_code AS vp_auth,
    COALESCE(IF(c.nhso_status = 'Y' AND c.nhso_cancel_datetime IS NULL, NULLIF(c.nhso_authen_code, ''), NULL),
      IF(vp.auth_code LIKE 'EP%', vp.auth_code, NULL)) AS close_code,
    ${STATUS_SQL} AS status
  FROM ovst o
  ${VISIT_AMOUNT_JOIN}
  ${CLAIM_JOINS}
  LEFT JOIN patient p ON p.hn = o.hn
  WHERE o.vstdate BETWEEN ? AND ?${extra}
) t
LEFT JOIN pttype pt ON pt.pttype = t.pttype
LEFT JOIN kskdepartment d ON d.depcode = t.main_dep
WHERE t.status IN (?, ?)
ORDER BY ${sort ? SORT_SQL[sort] : "t.amount"} ${sort ? dir : "desc"}, t.vn`;
  const selectParams = [start, end, start, end, ...extraParams, ...statusParams];

  const toRow = ({ pttype, main_dep, ...r }: Raw): PendingRow => {
    const fund_code = fundOf(lk, pttype);
    return {
      ...r,
      fund_code,
      fund_name: lk.fundName(fund_code),
      dep_name: main_dep?.trim() ? (r.dep_name ?? main_dep) : UNKNOWN_NAME,
      amount: round2(r.amount),
    };
  };

  if (format === "xlsx") {
    const rows = (await hisQuery<Raw>(select, selectParams)).map(toRow);
    return xlsxResponse<PendingRow>(`claim-pending-${start}_${end}.xlsx`, [
      { key: "vstdate", header: "วันที่รับบริการ", width: 14 },
      { key: "vn", header: "VN", width: 14 },
      { key: "hn", header: "HN", width: 12 },
      { key: "full_name", header: "ชื่อ-นามสกุล", width: 28 },
      { key: "pttype_name", header: "สิทธิ", width: 32 },
      { key: "fund_name", header: "กองทุน", width: 18 },
      { key: "dep_name", header: "แผนก", width: 24 },
      { key: "authen_code", header: "เลข authen", width: 18 },
      { key: "status", header: "สถานะ", width: 12 },
      { key: "amount", header: "มูลค่า (บาท)", width: 14, type: "money" },
    ], rows);
  }

  // ทีละคิวรี: select อ่าน opitemrece (MyISAM) ส่วน count ไม่แตะ opitemrece
  const rows = await hisQuery<Raw>(`${select} LIMIT ? OFFSET ?`, [...selectParams, pageSize, (page - 1) * pageSize]);
  const [{ total }] = await hisQuery<{ total: number }>(
    `SELECT COUNT(*) AS total FROM (
  SELECT ${STATUS_SQL} AS status
  FROM ovst o
  ${CLAIM_JOINS}
  LEFT JOIN patient p ON p.hn = o.hn
  WHERE o.vstdate BETWEEN ? AND ?${extra}
) t
WHERE t.status IN (?, ?)`,
    [start, end, ...extraParams, ...statusParams],
  );
  const body: GridPage<PendingRow> = { rows: rows.map(toRow), total: Number(total) };
  return Response.json(body);
}
