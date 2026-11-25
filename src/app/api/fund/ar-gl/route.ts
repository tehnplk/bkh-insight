import JSZip from "jszip";
import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { formatThaiDate, todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { badRequest, isAuthed, unauthorized } from "../_lib/fund";
import { monthRange } from "../ar-sync/ledger";
import { GL_SALES_NOTE, glSalesOp, type GlRow } from "./gl";

// ยอดรวมต่อ (วัน, ผู้ป่วย, บัญชี, kind, source, เครื่องหมาย) = SQL ของ ar-journal แยกรายวัน ; route กรอง OP rcpt_debt เองใน glSalesOp
const SQL = `SELECT l.entry_date::text AS entry_date, l.patient_type, l.account_code, a.name AS account_name, l.kind, l.source, a.revenue_code, a.diff_under_code, a.diff_over_code,
  cb.clear_code, cb.clear_short_code, count(*)::int AS n, SUM(l.amount) AS amount
FROM ar_ledger l LEFT JOIN ar_account a ON a.code = l.account_code LEFT JOIN ar_capitation_batch cb ON cb.id = l.capitation_batch_id
WHERE l.entry_date BETWEEN $1 AND $2
GROUP BY l.entry_date, l.patient_type, l.account_code, a.name, l.kind, l.source, a.revenue_code, a.diff_under_code, a.diff_over_code, cb.clear_code, cb.clear_short_code, sign(l.amount)`;

const xlsxBuffer = async <T extends object>(...args: Parameters<typeof xlsxResponse<T>>) => (await xlsxResponse<T>(...args)).arrayBuffer();

/** GET ?month=YYYY-MM → zip ของ Excel ใบละวัน (หัว AccCode1/AccName1/Dr1/Cr1 ตรงตาราง TB1 ของโปรแกรม GL) + summary.xlsx */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const today = todayIso();
  const month = request.nextUrl.searchParams.get("month") || today.slice(0, 7);
  const range = monthRange(month, today);
  if (!range) return badRequest("month ต้องเป็น YYYY-MM ตั้งแต่ 2025-10 ถึงเดือนปัจจุบัน");
  const vouchers = glSalesOp(await insightQuery<GlRow>(SQL, [range.from, range.to]));
  if (!vouchers.length) return Response.json({ error: "ไม่มีรายการตั้งหนี้ผู้ป่วยนอกในงวดนี้" }, { status: 404 });

  const zip = new JSZip();
  const fileOf = (v: (typeof vouchers)[number]) => (v.error ? "" : `gl-sales-op-${v.date}.xlsx`);
  for (const v of vouchers) {
    const file = fileOf(v);
    if (file) {
      // Dr1/Cr1 ฝั่งที่ไม่มียอดต้องเป็น 0 ไม่ใช่ช่องว่าง เพราะ qryForAddData1 จะใส่ NULL
      const rows = v.lines.map((l) => ({ AccCode1: l.code, AccName1: l.name, Dr1: l.dr, Cr1: l.cr }));
      zip.file(file, await xlsxBuffer<(typeof rows)[number]>(file, [
        { key: "AccCode1", header: "AccCode1", width: 20 },
        { key: "AccName1", header: "AccName1", width: 40 },
        { key: "Dr1", header: "Dr1", width: 16, type: "money" },
        { key: "Cr1", header: "Cr1", width: 16, type: "money" },
      ], rows));
    }
  }
  const summary = vouchers.map((v) => ({
    thai: formatThaiDate(v.date), date: v.date, book: "3 ขาย", budget: "4 เงินบำรุง", note: GL_SALES_NOTE,
    n: v.lines.length, dr: v.dr, cr: v.cr, file: fileOf(v), status: v.error ? `ใช้ไม่ได้: ${v.error}` : "พร้อมนำเข้า",
  }));
  zip.file("summary.xlsx", await xlsxBuffer<(typeof summary)[number]>("summary.xlsx", [
    { key: "thai", header: "วันที่ (พ.ศ.)", width: 14 },
    { key: "date", header: "วันที่บัญชี", width: 12 },
    { key: "book", header: "สมุด", width: 8 },
    { key: "budget", header: "ประเภทเงิน", width: 12 },
    { key: "note", header: "คำอธิบายหัวใบ", width: 40 },
    { key: "n", header: "จำนวนบรรทัด", width: 12, type: "count" },
    { key: "dr", header: "Dr รวม (บาท)", width: 16, type: "money" },
    { key: "cr", header: "Cr รวม (บาท)", width: 16, type: "money" },
    { key: "file", header: "ไฟล์", width: 28 },
    { key: "status", header: "สถานะ", width: 60 },
  ], summary));
  const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return new Response(data as BodyInit, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="gl-sales-op-${month}.zip"` },
  });
}
