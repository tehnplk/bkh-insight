import { connection, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { escapeLike, hisQuery } from "@/lib/db";
import { parseGridQuery, type GridPage } from "@/lib/grid-query";
import { xlsxResponse } from "@/lib/xlsx";
import { isIsoDate, MAX_SPAN_DAYS, spanDays, todayTh } from "../opd-visit/opd-visit";
import { isWardCode, type IpdVisit, type IpdVisitSummary } from "./ipd-visit";

// allowlist: ชื่อที่ client ส่งมา -> expression ใน SQL (ต่อเข้า ORDER BY ได้เพราะมาจากโค้ดเท่านั้น)
const SORT_SQL = {
  an: ["i.an"],
  hn: ["i.hn"],
  name: ["p.fname", "p.lname"],
  sex: ["p.sex"],
  age: ["age"],
  pttype: ["t.name"],
  ward: ["w.name"],
  regdate: ["i.regdate", "i.regtime"],
  dchdate: ["i.dchdate", "i.dchtime"],
  los: ["los"],
  doctor: ["dr.name"],
} as const;
const SORTABLE = Object.keys(SORT_SQL) as (keyof typeof SORT_SQL)[];

// 1 แถวต่อ an (ipt PK) ช่วงวันรับใช้ index ipt.regdate (เดือนเดียว ~700 แถว)
const FROM = `
  FROM ipt i
  LEFT JOIN patient p ON p.hn = i.hn
  LEFT JOIN an_stat a ON a.an = i.an
  LEFT JOIN pttype t ON t.pttype = i.pttype
  LEFT JOIN ward w ON w.ward = i.ward
  LEFT JOIN doctor dr ON dr.code = i.admdoctor
  WHERE i.regdate BETWEEN ? AND ?`;
// การวินิจฉัยหลัก: iptdiag diagtype 1 ตัวแรกตามลำดับที่ลง (ผู้ป่วยที่ยังนอนอยู่ส่วนใหญ่ยังไม่ลงรหัส จึงส่ง prediag ไปด้วย)
const PDX = `(SELECT d.icd10 FROM iptdiag d WHERE d.an = i.an AND d.diagtype = '1'
      ORDER BY d.diag_no IS NULL, d.diag_no, d.ipt_diag_id LIMIT 1)`;
// วันนอนของผู้ที่ยังไม่จำหน่ายนับถึงวันนี้ (เวลาไทย ส่งเป็น parameter ไม่พึ่ง CURDATE() ของ server) จึงมี ? ตัวแรกใน SELECT
const SELECT = `
  SELECT i.an, i.hn,
    CONCAT(IFNULL(p.pname, ''), IFNULL(p.fname, ''), ' ', IFNULL(p.lname, '')) AS name,
    CASE p.sex WHEN '1' THEN 'ชาย' WHEN '2' THEN 'หญิง' END AS sex,
    COALESCE(a.age_y, TIMESTAMPDIFF(YEAR, p.birthday, i.regdate)) AS age,
    i.pttype AS pttypeCode,
    t.name AS pttype,
    w.name AS ward,
    i.regdate, i.dchdate,
    DATEDIFF(COALESCE(i.dchdate, ?), i.regdate) AS los,
    dr.name AS doctor,
    ${PDX} AS dxCode,
    (SELECT x.name FROM icd101 x WHERE x.code = ${PDX}) AS dxName,
    NULLIF(TRIM(i.prediag), '') AS prediag`;
const SEARCH = " AND (i.an LIKE ? OR i.hn LIKE ? OR CONCAT_WS(' ', p.fname, p.lname) LIKE ?)";

export async function GET(request: NextRequest) {
  await connection(); // run per request, not at build time
  // proxy.ts กั้น /api/* แล้ว แต่ route ที่อ่าน HIS ต้องเช็ค session เองซ้ำ
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const parsed = parseGridQuery(sp, SORTABLE);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = parsed.query;
  const today = todayTh();
  const from = sp.get("from") || today;
  const to = sp.get("to") || today;
  if (!isIsoDate(from) || !isIsoDate(to)) return Response.json({ error: "วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD" }, { status: 400 });
  if (from > to) return Response.json({ error: "วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด" }, { status: 400 });
  if (spanDays(from, to) > MAX_SPAN_DAYS)
    return Response.json({ error: `ช่วงวันที่ต้องไม่เกิน ${MAX_SPAN_DAYS} วัน` }, { status: 400 });
  const ward = sp.get("ward") ?? "";
  if (ward && !isWardCode(ward)) return Response.json({ error: "รหัส ward ไม่ถูกต้อง" }, { status: 400 });

  // ข้อความ SQL มาจากโค้ดเท่านั้น ค่าทุกตัวเป็น bind parameter
  const wardSql = ward ? " AND ward = ?" : "";
  const wardParams = ward ? [ward] : [];
  let where = FROM + (ward ? " AND i.ward = ?" : "");
  const params: (string | number)[] = [from, to, ...wardParams];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where += SEARCH;
    params.push(like, like, like);
  }
  const order = ` ORDER BY ${sort ? SORT_SQL[sort].map((c) => `${c} ${dir}`).join(", ") + ", " : ""}i.an`;

  try {
    if (format === "xlsx") {
      const rows = (await hisQuery<IpdVisit>(SELECT + where + order, [today, ...params])).map((r) => ({
        ...r,
        dchdate: r.dchdate ?? "ยังนอนอยู่",
        principalDx: r.dxCode ? `${r.dxCode} ${r.dxName ?? ""}`.trim() : "",
      }));
      return xlsxResponse<(typeof rows)[number]>(from === to ? `ipd-visit-${from}.xlsx` : `ipd-visit-${from}_${to}.xlsx`, [
        { key: "an", header: "AN", width: 12 },
        { key: "hn", header: "HN", width: 12 },
        { key: "name", header: "ชื่อ-นามสกุล", width: 28 },
        { key: "sex", header: "เพศ", width: 8 },
        { key: "age", header: "อายุ (ปี)", width: 10 },
        { key: "pttypeCode", header: "รหัสสิทธิ", width: 10 },
        { key: "pttype", header: "สิทธิ", width: 28 },
        { key: "ward", header: "ward", width: 20 },
        { key: "regdate", header: "วันรับ", width: 12 },
        { key: "dchdate", header: "วันจำหน่าย", width: 12 },
        { key: "los", header: "วันนอน", width: 8 },
        { key: "doctor", header: "แพทย์ผู้รับ", width: 28 },
        { key: "principalDx", header: "การวินิจฉัยหลัก", width: 40 },
        { key: "prediag", header: "การวินิจฉัยแรกรับ", width: 40 },
      ], rows);
    }

    // สรุปตาม ward อย่างเดียว (ไม่ขึ้นกับคำค้นหา) ทุกเงื่อนไขใช้ index ของ ipt (regdate, dchdate)
    const [rows, [{ total }], [s]] = await Promise.all([
      hisQuery<IpdVisit>(SELECT + where + order + " LIMIT ? OFFSET ?", [today, ...params, pageSize, (page - 1) * pageSize]),
      hisQuery<{ total: number }>("SELECT COUNT(*) AS total" + where, params),
      hisQuery<{ admitted: number; inHouse: number; discharged: number; avgLos: number | string | null }>(
        `SELECT
          (SELECT COUNT(*) FROM ipt WHERE regdate BETWEEN ? AND ?${wardSql}) AS admitted,
          (SELECT COUNT(*) FROM ipt WHERE dchdate IS NULL${wardSql}) AS inHouse,
          COUNT(*) AS discharged,
          AVG(DATEDIFF(dchdate, regdate)) AS avgLos
        FROM ipt WHERE dchdate BETWEEN ? AND ?${wardSql}`,
        [from, to, ...wardParams, ...wardParams, from, to, ...wardParams],
      ),
    ]);
    const body: GridPage<IpdVisit> & { summary: IpdVisitSummary } = {
      rows,
      total: Number(total),
      summary: {
        admitted: Number(s.admitted),
        inHouse: Number(s.inHouse),
        discharged: Number(s.discharged),
        avgLos: s.avgLos == null ? null : Number(s.avgLos),
      },
    };
    return Response.json(body);
  } catch (e) {
    // ไม่ส่งข้อความดิบของ driver ออกไป (อาจมี host/user)
    console.error("ipd-visit query failed", (e as { code?: string }).code ?? e);
    return Response.json({ error: "อ่านข้อมูลจาก HIS ไม่สำเร็จ" }, { status: 503 });
  }
}
