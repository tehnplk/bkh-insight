import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import { badRequest, isAuthed, parseRange, unauthorized } from "@/app/api/fund/_lib/fund";
import { parseGridQuery } from "@/lib/grid-query";
import { isFile, parseType } from "../c-check/files";
import { countDef } from "../c-check/checks";
import { exportSql, fileColumns, pageSql, type FilePage, type FileRow } from "./sql";
import { toTxt } from "./txt";

/** GET ?type=op|ip&file=&start=&end=&page=&pageSize= ข้อมูลหนึ่งหน้าของแฟ้ม { rows, total, columns }
 *  &format=txt ส่งออกทั้งแฟ้มของช่วงเป็น <FILE>.txt (คั่นด้วย |, CRLF, UTF-8 ไม่มี BOM) ไม่มี sort/ค้นหา */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const type = parseType(params.get("type"));
  if (!type) return badRequest("type ต้องเป็น op หรือ ip");
  const file = params.get("file");
  if (!isFile(type, file)) return badRequest("file ไม่อยู่ในหมวดที่เลือก");
  const range = parseRange(params);
  if (!range.ok) return badRequest(range.error);
  const dates = [range.range.start, range.range.end];
  const columns = fileColumns(type, file);

  try {
    if (params.get("format") === "txt") {
      // shortcut: สร้างทั้งไฟล์ในหน่วยความจำ (ใหญ่สุด ~160k แถว / ~13 MB คือ OP LABFU ทั้งเดือน) ถ้าช่วงยาวขึ้นให้เปลี่ยนเป็น stream
      const rows = await hisQuery<FileRow>(exportSql(type, file), dates);
      return new Response(toTxt(columns, rows), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${file}.txt"`,
        },
      });
    }

    // ไม่มี sort จากผู้ใช้ (allowlist ว่าง ส่ง sort มาได้ 400) และไม่ใช้ q
    const grid = parseGridQuery(params, []);
    if (!grid.ok) return badRequest(grid.error);
    const { page, pageSize } = grid.query;
    const { sql, col } = countDef(type, file);
    const [rows, count] = await Promise.all([
      hisQuery<FileRow>(pageSql(type, file), [...dates, pageSize, (page - 1) * pageSize]),
      hisQuery<Record<string, string | number | null>>(sql, dates),
    ]);
    const body: FilePage = { rows, total: Number(count[0]?.[col] ?? 0), columns };
    return Response.json(body);
  } catch (e) {
    console.error("fdh/files", e);
    return Response.json({ error: `อ่านข้อมูลจาก HOSxP ไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
