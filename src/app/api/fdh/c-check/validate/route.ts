import type { NextRequest } from "next/server";
import { hisQuery, insightQuery } from "@/lib/db";
import { badRequest, isAuthed, parseRange, unauthorized } from "@/app/api/fund/_lib/fund";
import { STP_RULES, compareCode, isFile, parseType, type ValidateResponse } from "../files";
import { casesSql, countDef, maskFound, ruleCodes, ruleSummarySql } from "../checks";

type Raw = { c_code: string; hn: string | null; an: string | null; seq: string | null; found: string | number | null };
const str = (v: string | number | null) => (v == null ? "" : String(v));

/** GET ?type=op|ip&file=&start=&end= ผลตรวจรหัส C ของแฟ้มเดียว: จำนวนแถว, สรุปต่อรหัส และรายเคสไม่เกิน CASE_LIMIT */
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

  const codes = ruleCodes(type, file);
  const { sql, col } = countDef(type, file);
  try {
    const [count, grouped, raw, info] = await Promise.all([
      hisQuery<Record<string, string | number | null>>(sql, dates),
      codes.length ? hisQuery<{ c_code: string; n: number }>(ruleSummarySql(type, file), dates) : [],
      codes.length ? hisQuery<Raw>(casesSql(type, file), dates) : [],
      codes.length
        ? insightQuery<{ code: string; description: string | null; fix: string | null }>(
            "SELECT code, description, fix FROM rep_error_code WHERE kind = 'C' AND code = ANY($1::text[])",
            [codes],
          )
        : [],
    ]);
    const byCode = new Map(info.map((i) => [i.code, i]));
    const summary = grouped
      .map((g) => {
        const c = byCode.get(g.c_code), stp = STP_RULES[g.c_code];
        return { c_code: g.c_code, detail: c?.description ?? stp?.detail ?? null, fix: c?.fix ?? stp?.fix ?? null, n: Number(g.n) };
      })
      .sort((a, b) => compareCode(a.c_code, b.c_code));
    const total = summary.reduce((s, c) => s + c.n, 0);

    const body: ValidateResponse = {
      type,
      file,
      rows: Number(count[0]?.[col] ?? 0),
      ruleCodes: codes,
      summary,
      cases: raw.map((r) => ({ c_code: r.c_code, hn: str(r.hn), an: str(r.an), seq: str(r.seq), found: maskFound(r.c_code, r.found == null ? null : String(r.found)) })),
      total,
      truncated: total > raw.length,
    };
    return Response.json(body);
  } catch (e) {
    console.error("fdh/c-check/validate", e);
    return Response.json({ error: `อ่านข้อมูลไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
