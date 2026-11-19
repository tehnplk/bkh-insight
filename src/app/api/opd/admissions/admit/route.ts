import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import { badRequest, isAuthed, unauthorized } from "@/app/api/fund/_lib/fund";
import type { AdmitInfo } from "../admissions";

// ovst.an = ipt.an (ตรวจแล้วตรงกับ ipt.vn ทุกราย) ทุก JOIN เป็น PK/unique (EXPLAIN const ทั้งหมด)
const SQL = `SELECT i.an, i.regdate, i.regtime, i.dchdate, i.dchtime, w.name AS ward_name, i.pttype, t.name AS pttype_name,
       d.name AS doctor_name, NULLIF(TRIM(s.pdx), '') AS pdx, cd.name AS pdx_name,
       DATEDIFF(IFNULL(i.dchdate, CURDATE()), i.regdate) AS los_days, ds.name AS dchstts_name, i.finance_lock
FROM ovst o
JOIN ipt i ON i.an = o.an
LEFT JOIN an_stat s ON s.an = i.an
LEFT JOIN ward w ON w.ward = i.ward
LEFT JOIN pttype t ON t.pttype = i.pttype
LEFT JOIN doctor d ON d.code = i.admdoctor
LEFT JOIN icd101 cd ON cd.code = s.pdx
LEFT JOIN dchstts ds ON ds.dchstts = i.dchstts
WHERE o.vn = ?`;

/** GET ?vn=<12 หลัก> ข้อมูล AN ของ visit ที่ admit ; ไม่ได้ admit = 404 */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const vn = request.nextUrl.searchParams.get("vn") ?? "";
  if (!/^\d{12}$/.test(vn)) return badRequest("vn ต้องเป็นตัวเลข 12 หลัก");
  const [row] = await hisQuery<AdmitInfo>(SQL, [vn]);
  if (!row) return Response.json({ error: "visit นี้ไม่ได้ admit" }, { status: 404 });
  return Response.json(row);
}
