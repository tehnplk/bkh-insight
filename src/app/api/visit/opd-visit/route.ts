import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { escapeLike, hisQuery } from "@/lib/db";
import { parseGridQuery, type GridPage } from "@/lib/grid-query";
import { xlsxResponse } from "@/lib/xlsx";

export type OpdVisit = {
  vn: string;
  hn: string;
  name: string;
  pttype: string;
  pttypeName: string | null;
  authCode: string | null;
  closeCode: string | null;
};

// allowlist: key ที่ DataGrid ส่งมา -> นิพจน์ ORDER BY จริง
const SORT_SQL = {
  hn: "o.hn",
  name: "CONCAT(p.fname, ' ', p.lname)", // ไม่รวมคำนำหน้า
  pttype: "o.pttype",
  pttypeName: "t.name",
  authCode: "vp.auth_code",
  closeCode: "c.nhso_authen_code",
} as const;
const SORTABLE = Object.keys(SORT_SQL) as (keyof typeof SORT_SQL)[];

// visit_pttype มี PK (vn, pttype) จึง join ด้วยสิทธิหลักของ visit (ovst.pttype) ได้หนึ่งแถวต่อ visit
// nhso_confirm_privilege มี unique vn; สถานะ Y = ปิดสิทธิแล้ว (C = ยกเลิก มี nhso_cancel_datetime)
const FROM = `
  FROM ovst o
  JOIN patient p ON p.hn = o.hn
  LEFT JOIN pttype t ON t.pttype = o.pttype
  LEFT JOIN visit_pttype vp ON vp.vn = o.vn AND vp.pttype = o.pttype
  LEFT JOIN nhso_confirm_privilege c ON c.vn = o.vn AND c.nhso_status = 'Y'
  WHERE o.vstdate = ?`;
const SEARCH = " AND (o.hn LIKE ? OR p.fname LIKE ? OR p.lname LIKE ?)";
const PTTYPE = /^[0-9A-Za-z]{1,2}$/; // pttype.pttype เป็น char(2)

function isDate(v: string | null): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

export async function GET(request: NextRequest) {
  // proxy.ts กันไว้แล้ว แต่ route ที่อ่าน HIS เช็ค session เองซ้ำ
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const vstdate = sp.get("vstdate");
  if (!isDate(vstdate)) return Response.json({ error: "vstdate ต้องเป็นวันที่ YYYY-MM-DD" }, { status: 400 });
  const pttype = sp.get("pttype") || null; // ว่าง = ทุกสิทธิ
  if (pttype !== null && !PTTYPE.test(pttype)) return Response.json({ error: "pttype ต้องเป็นรหัสสิทธิ 1-2 ตัวอักษร" }, { status: 400 });
  const parsed = parseGridQuery(sp, SORTABLE);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = parsed.query;

  let where = FROM;
  const params: string[] = [vstdate];
  if (pttype) {
    where += " AND o.pttype = ?";
    params.push(pttype);
  }
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where += SEARCH;
    params.push(like, like, like);
  }
  const order = sort ? `${SORT_SQL[sort]} ${dir === "desc" ? "DESC" : "ASC"}, o.vn` : "o.vn";
  const select = `SELECT o.vn, o.hn, CONCAT_WS(' ', CONCAT(p.pname, p.fname), p.lname) AS name,
    o.pttype, t.name AS pttypeName, vp.auth_code AS authCode, c.nhso_authen_code AS closeCode ${where} ORDER BY ${order}`;

  if (format === "xlsx") {
    // ponytail: ทั้งวันในครั้งเดียว (~1k แถว) ถ้าเปิดช่วงหลายวันค่อยจำกัดจำนวน
    const rows = await hisQuery<OpdVisit>(select, params);
    return xlsxResponse<OpdVisit>(`opd-visit-${vstdate}.xlsx`, [
      { key: "hn", header: "HN", width: 12 },
      { key: "name", header: "ชื่อ-นามสกุล", width: 28 },
      { key: "pttype", header: "รหัสสิทธิ", width: 10 },
      { key: "pttypeName", header: "สิทธิ", width: 32 },
      { key: "authCode", header: "เลข Authen", width: 18 },
      { key: "closeCode", header: "เลขปิดสิทธิ", width: 18 },
    ], rows);
  }

  const [rows, [{ total }]] = await Promise.all([
    hisQuery<OpdVisit>(`${select} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]),
    hisQuery<{ total: number }>(`SELECT COUNT(*) AS total ${where}`, params),
  ]);
  const body: GridPage<OpdVisit> = { rows, total: Number(total) };
  return Response.json(body);
}
