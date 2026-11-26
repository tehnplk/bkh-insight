import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hisQuery, insightExecute, insightQuery, insightTransaction } from "@/lib/db";
import { MAX_FILE_BYTES, parseHsub, type HsubSummary, type ParsedHsub } from "../stm";

type Num = string; // numeric ของ pg มาเป็น string

/** response ของ GET /api/fund/stm-import/hsub?stm_file_id= (modal ไฟล์ STM ใน /fund/stm-import) ; file null = ยังไม่นำเข้า */
export type StmHsubDetail = {
  file: { file_name: string; printed_at: string | null; cases: number; net_total: Num; amounts: Record<string, number>; imported_by: string | null; imported_at: string } | null;
  rows: (Omit<HsubSummary, "net"> & { net: Num; name: string | null })[];
};

/** ผล POST */
export type StmHsubImportResult = { status: "imported" | "duplicate"; cases: number; netTotal: number } | { error: string };

// ---------- SQL (ค่าทุกตัวเป็น bind parameter) ----------
// insight: $1 = stm_file_id
const HSUB_FILE_SQL = `SELECT file_name, printed_at, cases, net_total, amounts, imported_by, imported_at
FROM stm_hsub_file WHERE stm_file_id = $1`;
// insight: $1 = stm_file_id ; shortcut: ไม่แบ่งหน้า (ไฟล์จริง ~15 แถว) ถ้าเกิน 1,000 ค่อยแบ่งหน้า
const HSUB_SUMMARY_SQL = `SELECT s.section, s.hcode, s.rep_no, s.cases, s.amounts, s.net
FROM stm_hsub_summary s JOIN stm_hsub_file f ON f.id = s.hsub_file_id
WHERE f.stm_file_id = $1
ORDER BY s.section, s.hcode, s.rep_no
LIMIT 1000`;
// his: ? x n = hcode ของ รพ.สต. (placeholder ตามจำนวนค่า ไม่ส่ง list ว่าง)
const hospNameSql = (n: number) => `SELECT hospcode, name FROM hospcode WHERE hospcode IN (${Array(n).fill("?").join(", ")})`;
// his: รหัสโรงพยาบาล (สูตรเดียวกับ smt-reconcile/ar-transfer)
const HOSPITAL_SQL = "SELECT hospitalcode FROM opdconfig LIMIT 1";
// insight: $1 = stm_file_id
const STM_FILE_SQL = `SELECT scheme, patient_type, period_month FROM stm_file WHERE id = $1`;
// insight: $1 = sha256 ของไฟล์
const HSUB_SHA_SQL = `SELECT stm_file_id FROM stm_hsub_file WHERE file_sha256 = $1`;
// insight: $1 = stm_file_id (นำเข้าใหม่ = ลบของเดิมก่อน, ลบ (admin)) cascade ลง stm_hsub_summary
const HSUB_DELETE_SQL = `DELETE FROM stm_hsub_file WHERE stm_file_id = $1`;
// insight: $1 stm_file_id, $2 file_name, $3 file_sha256, $4 printed_at, $5 cases, $6 net_total, $7 amounts (jsonb), $8 imported_by
const HSUB_INSERT_FILE_SQL = `INSERT INTO stm_hsub_file (stm_file_id, file_name, file_sha256, printed_at, cases, net_total, amounts, imported_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`;
// insight: $1 = JSON array ของ HsubSummary, $2 = stm_hsub_file.id
const HSUB_INSERT_SUMMARY_SQL = `INSERT INTO stm_hsub_summary (hsub_file_id, section, hcode, rep_no, cases, amounts, net)
SELECT $2::bigint, section, hcode, rep_no, cases, amounts, net
FROM jsonb_to_recordset($1::jsonb) AS x(section text, hcode varchar, rep_no varchar, cases int, amounts jsonb, net numeric)`;

const ID_RE = /^[1-9]\d{0,17}$/;
const fail = (error: string, status: number) => Response.json({ error } satisfies StmHsubImportResult, { status });
/** "2026-10-01" -> "10/2569" */
const monthText = (iso: string) => `${iso.slice(5, 7)}/${+iso.slice(0, 4) + 543}`;

export async function GET(request: NextRequest) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("stm_file_id") ?? "";
  if (!ID_RE.test(id)) return Response.json({ error: "stm_file_id ต้องเป็นจำนวนเต็มบวก" }, { status: 400 });
  const [[file], rows] = await Promise.all([
    insightQuery<NonNullable<StmHsubDetail["file"]>>(HSUB_FILE_SQL, [id]),
    insightQuery<Omit<StmHsubDetail["rows"][number], "name">>(HSUB_SUMMARY_SQL, [id]),
  ]);
  if (!file) return Response.json({ file: null, rows: [] } satisfies StmHsubDetail);
  const codes = [...new Set(rows.map((r) => r.hcode))];
  // ชื่อ รพ.สต. ไม่ได้ก็แสดงรหัสอย่างเดียว ไม่ให้ทั้งส่วนล้ม
  const names = codes.length
    ? new Map((await hisQuery<{ hospcode: string; name: string }>(hospNameSql(codes.length), codes).catch(() => [])).map((h) => [h.hospcode, h.name]))
    : new Map<string, string>();
  return Response.json({ file, rows: rows.map((r) => ({ ...r, name: names.get(r.hcode) ?? null })) } satisfies StmHsubDetail);
}

// ใครที่ login แล้วนำเข้าได้ (เหมือนนำเข้า STM) ; หนึ่งไฟล์ Hsub ต่อหนึ่งไฟล์ STM นำเข้าใหม่ = แทนที่
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("อ่านไฟล์ที่ส่งมาไม่ได้", 400);
  }
  const id = form.get("stm_file_id");
  const file = form.get("file");
  if (typeof id !== "string" || !ID_RE.test(id)) return fail("stm_file_id ต้องเป็นจำนวนเต็มบวก", 400);
  if (!(file instanceof File)) return fail("ไม่พบไฟล์", 400);
  if (!/\.xls$/i.test(file.name)) return fail("ไม่ใช่ไฟล์ .xls", 400);
  if (file.size > MAX_FILE_BYTES) return fail("ไฟล์ใหญ่เกิน 30 MB", 400);

  const buf = new Uint8Array(await file.arrayBuffer());
  let p: ParsedHsub;
  try {
    p = parseHsub(buf);
  } catch (e) {
    return fail((e as Error).message, 400);
  }

  const [[stm], [cfg]] = await Promise.all([
    insightQuery<{ scheme: string; patient_type: string; period_month: string }>(STM_FILE_SQL, [id]),
    hisQuery<{ hospitalcode: string | null }>(HOSPITAL_SQL),
  ]);
  if (!stm) return fail("ไม่พบไฟล์ STM", 404);
  // Hsub มาคู่กับ STM UC ผู้ป่วยนอก (งบ OP/PP ของ รพ.สต.) ผู้ป่วยในไม่มี
  if (stm.scheme !== "UCS" || stm.patient_type !== "OP") return fail("รายงานพึงจ่าย รพ.สต. ใช้กับ STM UC ผู้ป่วยนอกเท่านั้น", 400);
  if (stm.period_month !== p.periodMonth) return fail(`REP ในไฟล์เป็นเดือน ${monthText(p.periodMonth)} แต่ STM เป็นเดือน ${monthText(stm.period_month)}`, 400);
  const hcode = String(cfg?.hospitalcode ?? "").trim();
  if (!/^\d{5}$/.test(hcode)) return fail("ไม่พบรหัสหน่วยบริการ (opdconfig.hospitalcode)", 500);
  if (p.hcodePaid !== hcode) return fail(`หน่วยบริการที่รับเงิน (HCODE_PAID ${p.hcodePaid}) ไม่ใช่โรงพยาบาลนี้ (${hcode})`, 400);

  if (!p.summaries.length) return fail("ไม่พบรายการในไฟล์", 400); // parseHsub กันไว้แล้ว กันซ้ำไม่ให้ส่ง array ว่างเข้า SQL
  const sha = createHash("sha256").update(buf).digest("hex");
  const [same] = await insightQuery<{ stm_file_id: string }>(HSUB_SHA_SQL, [sha]);
  const ok = (status: "imported" | "duplicate") => Response.json({ status, cases: p.cases, netTotal: p.netTotal } satisfies StmHsubImportResult);
  if (same) return same.stm_file_id === id ? ok("duplicate") : fail("ไฟล์นี้นำเข้าไว้กับ STM ไฟล์อื่นแล้ว", 409);

  try {
    await insightTransaction(async (tx) => {
      await tx(HSUB_DELETE_SQL, [id]);
      const [row] = await tx<{ id: string }>(HSUB_INSERT_FILE_SQL, [
        id, file.name, sha, p.printedAt, p.cases, p.netTotal, JSON.stringify(p.amounts), session.user.name ?? null,
      ]);
      await tx(HSUB_INSERT_SUMMARY_SQL, [JSON.stringify(p.summaries), row.id]);
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "23503") return fail("ไม่พบไฟล์ STM", 404); // STM ถูกลบระหว่างนำเข้า
    if (code === "23505") return fail("มีการนำเข้าไฟล์นี้พร้อมกัน ลองโหลดใหม่", 409);
    console.error("stm-hsub-import", file.name, (e as Error).message);
    return fail("บันทึกลงฐานข้อมูลไม่สำเร็จ", 500);
  }
  return ok("imported");
}

// ลบ Hsub ของไฟล์ STM (admin เท่านั้น เหมือนลบ STM)
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  const id = request.nextUrl.searchParams.get("stm_file_id") ?? "";
  if (!ID_RE.test(id)) return Response.json({ error: "stm_file_id ต้องเป็นจำนวนเต็มบวก" }, { status: 400 });
  const { rowCount } = await insightExecute(HSUB_DELETE_SQL, [id]);
  if (!rowCount) return Response.json({ error: "ไม่พบรายงานพึงจ่าย รพ.สต. ของไฟล์นี้" }, { status: 404 });
  return new Response(null, { status: 204 });
}
