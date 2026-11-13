import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import { badRequest, isAuthed, unauthorized } from "@/app/api/fund/_lib/fund";
import type { AdmissionDetail, DiagRow, OperRow } from "../admissions/admissions";

// ใช้ index ix_an_dxtype / ix_an ชื่อโรคจาก icd101 ชื่อหัตถการจาก icd9cm1 ประเภทวินิจฉัยจาก diagtype
const DIAG_SQL = `SELECT d.diagtype, dt.name AS diagtype_name, d.icd10, c.name AS icd_name, doc.name AS doctor_name
FROM iptdiag d
LEFT JOIN diagtype dt ON dt.diagtype = d.diagtype
LEFT JOIN icd101 c ON c.code = d.icd10
LEFT JOIN doctor doc ON doc.code = d.doctor
WHERE d.an = ?
ORDER BY d.diagtype, d.ipt_diag_id`;
const OPER_SQL = `SELECT o.icd9, c.name AS icd_name, o.opdate, o.optime, o.enddate, o.endtime, doc.name AS doctor_name
FROM iptoprt o
LEFT JOIN icd9cm1 c ON c.code = o.icd9
LEFT JOIN doctor doc ON doc.code = o.doctor
WHERE o.an = ?
ORDER BY o.opdate, o.optime, o.iptoprt_id`;

/** GET ?an=<9 หลัก> รหัสโรคและหัตถการทั้งหมดของ admission */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const an = request.nextUrl.searchParams.get("an") ?? "";
  if (!/^\d{9}$/.test(an)) return badRequest("an ต้องเป็นตัวเลข 9 หลัก");
  const [diags, opers] = await Promise.all([hisQuery<DiagRow>(DIAG_SQL, [an]), hisQuery<OperRow>(OPER_SQL, [an])]);
  const body: AdmissionDetail = { diags, opers };
  return Response.json(body);
}
