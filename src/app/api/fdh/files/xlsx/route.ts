import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { badRequest, isAuthed, unauthorized } from "@/app/api/fund/_lib/fund";

const MAX_SHEETS = 20;
const MAX_COLUMNS = 80;
const MAX_ROWS = 100_000;

type Sheet = { name: string; columns: string[]; rows: Record<string, unknown>[] };

/**
 * POST { filename, sheets: [{ name, columns, rows }] } -> .xlsx หนึ่ง sheet ต่อแฟ้ม (ใช้กับ modal 16 แฟ้ม: ผลตรวจ C อยู่ใน browser)
 * ค่าทุกช่องลงเป็นข้อความตามแฟ้ม (HN/รหัสไม่เสียเลข 0 นำหน้า) ; exceljs ไม่สร้างสูตรจาก string จึงไม่เกิด formula injection
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const body = (await request.json().catch(() => null)) as { filename?: unknown; sheets?: unknown } | null;
  const sheets = Array.isArray(body?.sheets) ? (body.sheets as Sheet[]) : null;
  if (!sheets?.length || sheets.length > MAX_SHEETS) return badRequest(`sheets ต้องมี 1–${MAX_SHEETS} แฟ้ม`);
  let total = 0;
  for (const s of sheets) {
    if (typeof s?.name !== "string" || !/^[A-Z]{2,6}$/.test(s.name)) return badRequest("ชื่อแฟ้มไม่ถูกต้อง");
    if (!Array.isArray(s.columns) || s.columns.length > MAX_COLUMNS || !s.columns.every((c) => typeof c === "string" && c.length <= 60)) return badRequest(`คอลัมน์ของ ${s.name} ไม่ถูกต้อง`);
    if (!Array.isArray(s.rows) || !s.rows.every((r) => r && typeof r === "object")) return badRequest(`แถวของ ${s.name} ไม่ถูกต้อง`);
    total += s.rows.length;
  }
  if (total > MAX_ROWS) return badRequest(`ส่งออกได้ไม่เกิน ${MAX_ROWS.toLocaleString("th-TH")} แถว`);

  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(8, c.length + 4)) }));
    ws.getRow(1).font = { bold: true };
    ws.addRows(s.rows.map((r) => Object.fromEntries(s.columns.map((c) => [c, r[c] == null ? "" : String(r[c])]))));
  }
  const name = typeof body?.filename === "string" ? body.filename.replace(/[^\w.-]/g, "_").slice(0, 80) : "fdh.xlsx";
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name.endsWith(".xlsx") ? name : `${name}.xlsx`}"`,
    },
  });
}
