import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import { badRequest, isAuthed, parseRange, unauthorized } from "@/app/api/fund/_lib/fund";
import { FILE_ORDER, parseType } from "../../c-check/files";
import { countDef } from "../../c-check/checks";
import type { FilesSummary } from "../sql";

/** GET ?type=op|ip&start=&end= จำนวนแถวของทุกแฟ้มในหมวด (ไม่ตรวจกฎ C จึงไม่ใช้ summary ของ c-check) */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const type = parseType(params.get("type"));
  if (!type) return badRequest("type ต้องเป็น op หรือ ip");
  const range = parseRange(params);
  if (!range.ok) return badRequest(range.error);
  const dates = [range.range.start, range.range.end];

  const files = FILE_ORDER[type];
  // ADP/PHDB/DRU ใช้ statement เดียวกัน จึงรันครั้งเดียว (pool ของ his ต่อคิวเองไม่เกิน 3 statement)
  const statements = [...new Set(files.map((f) => countDef(type, f).sql))];
  try {
    const counts = await Promise.all(statements.map((sql) => hisQuery<Record<string, string | number | null>>(sql, dates)));
    const bySql = new Map(statements.map((sql, i) => [sql, counts[i][0]]));
    const body: FilesSummary = {
      type,
      files: files.map((file) => {
        const { sql, col } = countDef(type, file);
        return { file, rows: Number(bySql.get(sql)?.[col] ?? 0) };
      }),
    };
    return Response.json(body);
  } catch (e) {
    console.error("fdh/files/summary", e);
    return Response.json({ error: `อ่านข้อมูลจาก HOSxP ไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
