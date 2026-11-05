import { connection, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { escapeLike, hisQuery } from "@/lib/db";
import { parseGridQuery, type GridPage } from "@/lib/grid-query";
import { xlsxResponse } from "@/lib/xlsx";
import {
  DIAG_TYPE_LABEL,
  isCloseStatus,
  isIsoDate,
  isPttypeCode,
  isHipdataGroup,
  MAX_SPAN_DAYS,
  NO_HIPDATA,
  spanDays,
  todayTh,
  type Diagnosis,
  type OpdVisit,
  type OpdVisitSummary,
} from "./opd-visit";

// allowlist: ชื่อที่ client ส่งมา -> expression ใน SQL (ต่อเข้า ORDER BY ได้เพราะมาจากโค้ดเท่านั้น)
const SORT_SQL = {
  vstdate: ["o.vstdate"],
  hn: ["o.hn"],
  name: ["p.fname", "p.lname"],
  sex: ["p.sex"],
  age: ["age"],
  pttypeCode: ["o.pttype"],
  pttype: ["t.name"],
  authen: ["authen"],
  closeCode: ["closeCode"],
  income: ["v.income"],
} as const;
const SORTABLE = Object.keys(SORT_SQL) as (keyof typeof SORT_SQL)[];

// 1 แถวต่อ vn: visit_pttype join ด้วย PK (vn, pttype) ของสิทธิหลักใน ovst, nhso_confirm_privilege unique ที่ vn
// authen (PP): nhso_smartcard_agent อาจมีหลายแถวต่อ vn จึงเอาแถวล่าสุด ถ้าไม่มีใช้ visit_pttype.auth_code ที่ยังเป็น PP
// ปิดสิทธิ (EP): nhso_confirm_privilege สถานะ Y (C = ยกเลิก) ถ้าปิดผ่านช่องทางอื่นจะมีแค่ EP ใน visit_pttype.auth_code
//   (ค่านั้นไม่นับถ้าเป็นเลขเดียวกับรายการที่ถูกยกเลิก)
// FORCE INDEX: ช่วงวันที่บังคับมีเสมอและไม่เกิน 31 วัน ถ้าไม่บังคับ ตัวกรองกลุ่มสิทธิทำให้ optimizer ไปขับจาก
//   pttype -> ovst.ix_pttype ซึ่งสแกน visit ทุกปี (UC เดือนเดียว 18.7 วินาที เทียบกับ 0.9 วินาที)
const FROM = `
  FROM ovst o FORCE INDEX (ix_vstdate)
  LEFT JOIN patient p ON p.hn = o.hn
  LEFT JOIN pttype t ON t.pttype = o.pttype
  LEFT JOIN visit_pttype vp ON vp.vn = o.vn AND vp.pttype = o.pttype
  LEFT JOIN nhso_confirm_privilege c ON c.vn = o.vn
  LEFT JOIN vn_stat v ON v.vn = o.vn
  WHERE o.vstdate BETWEEN ? AND ?`;
const marks = (n: number) => Array(n).fill("?").join(", ");
// เลขปิดสิทธิ: expression เดียวใช้ทั้งคอลัมน์ที่แสดงและตัวกรอง ?closed= ผลกรองจึงตรงกับตารางเสมอ
//   (confirm ที่ถูกยกเลิก C และไม่มี EP อื่น = ยังไม่ปิดสิทธิ)
const CLOSE_CODE = `CASE
      WHEN c.nhso_status = 'Y' THEN c.nhso_authen_code
      WHEN vp.auth_code LIKE 'EP%' AND (c.vn IS NULL OR vp.auth_code <> c.nhso_authen_code) THEN vp.auth_code
    END`;
const SEARCH = ` AND (o.hn LIKE ? OR CONCAT_WS(' ', p.fname, p.lname) LIKE ?`;
// ข้อความที่หน้าตาเป็นรหัส ICD-10 (E11, E11.9, e119) ค้นเพิ่มจากรหัสวินิจฉัยแบบขึ้นต้นด้วย
//   EXISTS ใช้ index (vn, icd10) ทีละ visit ในช่วงวันที่ (เดือนเดียว ~0.7 วินาที) ค้นชื่อ/HN จึงไม่เสียค่านี้
const ICD10_Q = /^[a-z]\d[\da-z]*(\.[\da-z]*)?$/i;
const SEARCH_ICD = ` OR EXISTS (SELECT 1 FROM ovstdiag d WHERE d.vn = o.vn AND d.icd10 LIKE ?)`;
const SELECT = `
  SELECT o.vn, o.vstdate, o.hn,
    CONCAT(IFNULL(p.pname, ''), IFNULL(p.fname, ''), ' ', IFNULL(p.lname, '')) AS name,
    CASE p.sex WHEN '1' THEN 'ชาย' WHEN '2' THEN 'หญิง' END AS sex,
    COALESCE(v.age_y, TIMESTAMPDIFF(YEAR, p.birthday, o.vstdate)) AS age,
    o.pttype AS pttypeCode,
    t.name AS pttype,
    COALESCE(
      (SELECT s.claim_code FROM nhso_smartcard_agent s
        WHERE s.vn = o.vn AND s.claim_code LIKE 'PP%'
        ORDER BY s.nhso_smartcard_agent_id DESC LIMIT 1),
      IF(vp.auth_code LIKE 'PP%', vp.auth_code, NULL)
    ) AS authen,
    ${CLOSE_CODE} AS closeCode,
    v.income`;

// การวินิจฉัย: เฉพาะรหัสที่อยู่ใน icd101 (ovstdiag เก็บหัตถการ ICD-9-CM รหัสตัวเลขไว้ด้วย ไม่นับเป็นการวินิจฉัย)
//   เรียง diagtype (1 หลัก ก่อน) แล้วตามลำดับที่ลง (diag_no, id)
type DiagRow = Diagnosis & { vn: string };
const DIAG_SELECT = "SELECT d.vn, d.icd10 AS code, IFNULL(i.name, '') AS name, d.diagtype AS type";
const DIAG_JOIN = " JOIN icd101 i ON i.code = d.icd10";
const DIAG_ORDER = " ORDER BY d.vn, d.diagtype, d.diag_no IS NULL, d.diag_no, d.ovst_diag_id";

/** แปะ diagnoses ให้แต่ละแถวตาม vn */
function attachDiagnoses(rows: Omit<OpdVisit, "diagnoses">[], diags: DiagRow[]): OpdVisit[] {
  const byVn = new Map<string, Diagnosis[]>();
  for (const { vn, ...d } of diags) {
    const list = byVn.get(vn);
    if (list) list.push(d);
    else byVn.set(vn, [d]);
  }
  return rows.map((r) => ({ ...r, diagnoses: byVn.get(r.vn) ?? [] }));
}

const diagText = (d: Diagnosis) => `${d.code} ${d.name}`;

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
  // กันการ query ช่วงยาวบน HIS production (Excel ดึงทุกแถวในช่วง)
  if (spanDays(from, to) > MAX_SPAN_DAYS)
    return Response.json({ error: `ช่วงวันที่ต้องไม่เกิน ${MAX_SPAN_DAYS} วัน` }, { status: 400 });

  const group = sp.get("group") ?? "";
  if (group && !isHipdataGroup(group)) return Response.json({ error: "กลุ่มสิทธิไม่ถูกต้อง" }, { status: 400 });
  const closed = sp.get("closed") ?? "";
  if (closed && !isCloseStatus(closed)) return Response.json({ error: "สถานะปิดสิทธิไม่ถูกต้อง" }, { status: 400 });
  const pttype = sp.get("pttype") ?? "";
  if (pttype && !isPttypeCode(pttype)) return Response.json({ error: "รหัสสิทธิไม่ถูกต้อง" }, { status: 400 });

  let where = FROM;
  const params: (string | number)[] = [from, to];
  // กลุ่มสิทธิ = hipdata_code ตรงๆ (bind parameter) ส่วน NO_HIPDATA = ไม่มีรหัส (กติกาเดียวกับ hipdataGroupOf)
  if (group === NO_HIPDATA) {
    where += " AND (t.hipdata_code IS NULL OR TRIM(t.hipdata_code) = '')";
  } else if (group) {
    where += " AND t.hipdata_code = ?";
    params.push(group);
  }
  if (pttype) {
    where += " AND o.pttype = ?";
    params.push(pttype);
  }
  // ข้อความ SQL มาจากโค้ดเท่านั้น (closed ผ่าน allowlist แล้ว)
  if (closed) where += ` AND (${CLOSE_CODE}) IS ${closed === "yes" ? "NOT " : ""}NULL`;
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where += SEARCH;
    params.push(like, like);
    if (ICD10_Q.test(q)) {
      where += SEARCH_ICD;
      params.push(`${escapeLike(q.replace(".", ""))}%`);
    }
    where += ")";
  }
  const order = ` ORDER BY ${sort ? SORT_SQL[sort].map((c) => `${c} ${dir}`).join(", ") + ", " : ""}o.vn`;

  try {
    if (format === "xlsx") {
      // การวินิจฉัยของทุก visit ในช่วง: ขับจาก ovst.ix_vstdate แล้ว ref ovstdiag.vn (เดือนเดียว ~46k แถว ~0.6 วินาที)
      //   query เดียวแทนการแบ่ง IN ทีละ 1000 vn และผูกกับ visit จริง (ไม่พึ่ง ovstdiag.vstdate) แถวที่ถูก filter ออกถูกทิ้งตอนแปะ
      const [base, diags] = await Promise.all([
        hisQuery<Omit<OpdVisit, "diagnoses">>(SELECT + where + order, params),
        hisQuery<DiagRow>(
          `${DIAG_SELECT} FROM ovst o FORCE INDEX (ix_vstdate) JOIN ovstdiag d ON d.vn = o.vn${DIAG_JOIN}
            WHERE o.vstdate BETWEEN ? AND ?${DIAG_ORDER}`,
          [from, to],
        ),
      ]);
      const rows = attachDiagnoses(base, diags).map((r) => {
        const principal = r.diagnoses.find((d) => d.type === "1");
        return {
          ...r,
          principalDx: principal ? diagText(principal) : "",
          allDx: r.diagnoses.map((d) => `${diagText(d)} (${DIAG_TYPE_LABEL[d.type] ?? d.type})`).join("; "),
        };
      });
      return xlsxResponse<(typeof rows)[number]>(from === to ? `opd-visit-${from}.xlsx` : `opd-visit-${from}_${to}.xlsx`, [
        { key: "vn", header: "VN", width: 14 },
        { key: "vstdate", header: "วันที่รับบริการ", width: 14 },
        { key: "hn", header: "HN", width: 12 },
        { key: "name", header: "ชื่อ-นามสกุล", width: 28 },
        { key: "sex", header: "เพศ", width: 8 },
        { key: "age", header: "อายุ (ปี)", width: 10 },
        { key: "pttypeCode", header: "รหัสสิทธิ", width: 10 },
        { key: "pttype", header: "สิทธิ", width: 32 },
        { key: "authen", header: "เลข authen", width: 16 },
        { key: "closeCode", header: "เลขปิดสิทธิ", width: 16 },
        { key: "principalDx", header: "การวินิจฉัยหลัก", width: 36 },
        { key: "allDx", header: "การวินิจฉัยทั้งหมด", width: 60 },
        { key: "income", header: "ค่าใช้จ่าย (บาท)", width: 14 },
      ], rows);
    }

    // ผลรวมค่าใช้จ่ายของทุกแถวที่ตรง filter มากับ query นับจำนวน (vn_stat join อยู่ใน FROM แล้ว) ไม่เพิ่ม round trip
    const [base, [{ total, income }]] = await Promise.all([
      hisQuery<Omit<OpdVisit, "diagnoses">>(SELECT + where + order + " LIMIT ? OFFSET ?", [...params, pageSize, (page - 1) * pageSize]),
      hisQuery<{ total: number; income: number | string }>(
        "SELECT COUNT(*) AS total, COALESCE(SUM(v.income), 0) AS income" + where,
        params,
      ),
    ]);
    // การวินิจฉัยเฉพาะ vn ในหน้านี้ (ref ที่ index ovstdiag.vn) หน้าว่างไม่ query
    const diags = base.length
      ? await hisQuery<DiagRow>(
          `${DIAG_SELECT} FROM ovstdiag d${DIAG_JOIN} WHERE d.vn IN (${marks(base.length)})${DIAG_ORDER}`,
          base.map((r) => r.vn),
        )
      : [];
    const body: GridPage<OpdVisit> & { summary: OpdVisitSummary } = {
      rows: attachDiagnoses(base, diags),
      total: Number(total),
      summary: { income: Number(income) },
    };
    return Response.json(body);
  } catch (e) {
    // ไม่ส่งข้อความดิบของ driver ออกไป (อาจมี host/user)
    console.error("opd-visit query failed", (e as { code?: string }).code ?? e);
    return Response.json({ error: "อ่านข้อมูลจาก HIS ไม่สำเร็จ" }, { status: 503 });
  }
}
