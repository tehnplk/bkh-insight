import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import { badRequest, isAuthed, parseRange, unauthorized } from "@/app/api/fund/_lib/fund";
import { FILE_ORDER, codeLevel, parseType, type Level, type SummaryResponse } from "../files";
import { RULES, countDef, ruleSummarySql } from "../checks";

type Count = Record<string, string | number | null>;
const RANK: Level[] = ["info", "warn", "error"];

/** GET ?type=op|ip&start=&end= จำนวนแถวและจำนวนเคสที่ติดกฎของทุกแฟ้มในหมวด (left tab + badge) */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const type = parseType(params.get("type"));
  if (!type) return badRequest("type ต้องเป็น op หรือ ip");
  const range = parseRange(params);
  if (!range.ok) return badRequest(range.error);
  const dates = [range.range.start, range.range.end];

  const files = FILE_ORDER[type];
  // ADP/PHDB/DRU ใช้ statement เดียวกัน จึงรันครั้งเดียว และ pool ของ his มี 3 connection จึงรันพร้อมกันไม่เกิน 3 statement
  const statements = [...new Set(files.map((f) => countDef(type, f).sql))];
  try {
    const [rules, ...counts] = await Promise.all([
      hisQuery<{ c_code: string; fdh_file: string; n: number }>(ruleSummarySql(type), dates),
      ...statements.map((sql) => hisQuery<Count>(sql, dates)),
    ]);
    const bySql = new Map(statements.map((sql, i) => [sql, counts[i][0]]));
    const cases = new Map<string, number>();
    const level = new Map<string, Level>();
    for (const r of rules) {
      cases.set(r.fdh_file, (cases.get(r.fdh_file) ?? 0) + Number(r.n));
      const l = codeLevel(r.c_code), cur = level.get(r.fdh_file);
      if (!cur || RANK.indexOf(l) > RANK.indexOf(cur)) level.set(r.fdh_file, l);
    }

    const body: SummaryResponse = {
      type,
      files: files.map((file) => {
        const { sql, col } = countDef(type, file);
        // SUM() ของ mysql2 คืน string
        return { file, rows: Number(bySql.get(sql)?.[col] ?? 0), cases: RULES[type][file] ? (cases.get(file) ?? 0) : null, level: level.get(file) };
      }),
    };
    return Response.json(body);
  } catch (e) {
    console.error("fdh/c-check/summary", e);
    return Response.json({ error: `อ่านข้อมูลจาก HOSxP ไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
