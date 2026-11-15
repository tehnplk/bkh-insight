import type { NextRequest } from "next/server";
import { hisQuery, insightQuery } from "@/lib/db";
import { badRequest, isAuthed, unauthorized } from "@/app/api/fund/_lib/fund";
import { CASE_LIMIT, casesSql, maskFound, ruleCodes, ruleParams } from "@/app/api/fdh/c-check/checks";
import { closedByVns } from "@/app/api/fdh/c-check/closed";
import { STP_RULES } from "@/app/api/fdh/c-check/files";
import { opDruCheckSql } from "@/app/api/fdh/files/sql";
import { DRUG_CATALOG_CODES, checkDru, type CatalogVersion, type CheckResult, type DruCheckRow } from "@/app/api/ipd/fdh-check/check";
import { parseOpdSelection } from "../fdh-files";

const C_INFO_SQL = "SELECT code, description FROM rep_error_code WHERE kind = 'C' AND code = ANY($1::text[])";
const CATALOG_SQL = `SELECT hosp_drug_code AS code, unit_price, date_effective, date_approved, line_no, product_cat
FROM drug_catalog_nhso WHERE hosp_drug_code = ANY($1::text[])`;
const NO_CATALOG = "ยังไม่ได้นำเข้า Drug Catalog ที่เมนูตั้งค่ารหัสมาตรฐาน จึงยังเทียบแฟ้ม DRU กับ Drug Catalog ไม่ได้";

type CaseRow = { c_code: string; hn: string | null; an: string | null; seq: string | null; found: string | null };

/**
 * POST { vns, file } ตรวจ C หนึ่งแฟ้มของ visit ที่เลือก (หน้าเรียกทีละแฟ้มเพื่อแสดงความคืบหน้า)
 * ทุกแฟ้มที่มีกฎ: กฎ SQL ของหน้าตรวจ C บนช่วงวันรับบริการที่ครอบ visit ที่เลือก กรอง VN/HN ที่เลือกใน SQL ก่อน LIMIT
 * DRU: กฎ SQL + เทียบ Drug Catalog (แถวตรวจกรอง SEQ ในลำดับเดียวกับแฟ้ม row จึงตรงแถวที่แสดง)
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const body = (await request.json().catch(() => null)) as { vns?: unknown; file?: unknown } | null;
  const file = typeof body?.file === "string" ? body.file : "";
  const result: CheckResult = { file, rules: [], findings: [], info: {} };
  try {
    const sel = await parseOpdSelection(body);
    if ("error" in sel) return badRequest(sel.error);
    const codes = ruleCodes("op", file);
    if (file !== "DRU" && !codes.length) return Response.json(result);
    if (codes.length) {
      result.rules = [...codes];
      // ขอเกิน 1 แถว: ได้ครบ CASE_LIMIT พอดีจะไม่ขึ้นว่าถูกตัด
      const rows = await hisQuery<CaseRow>(casesSql("op", file, CASE_LIMIT + 1), ruleParams(sel.start, sel.end, sel.vns, await closedByVns(sel.vns)));
      const cases = rows.slice(0, CASE_LIMIT);
      result.truncated = rows.length > CASE_LIMIT;
      result.findings = cases.map((c) => ({ hn: c.hn || null, seq: c.seq || null, codes: [c.c_code], found: c.found == null ? undefined : String(maskFound(c.c_code, String(c.found))) }));
    }
    if (file === "DRU") {
      const [{ n }] = await insightQuery<{ n: number }>("SELECT COUNT(*)::int AS n FROM drug_catalog_nhso");
      if (!n) result.note = NO_CATALOG;
      else {
        result.rules = [...DRUG_CATALOG_CODES, ...result.rules];
        const rows = (await hisQuery<DruCheckRow & { seq: string }>(opDruCheckSql(), [sel.start, sel.end])).filter((r) => sel.vnSet.has(r.seq));
        const icodes = [...new Set(rows.map((r) => r.icode))];
        const versions = icodes.length ? await insightQuery<CatalogVersion>(CATALOG_SQL, [icodes]) : [];
        result.findings = [...checkDru(rows, versions.map((v) => ({ ...v, line_no: Number(v.line_no) }))), ...result.findings];
      }
    }
    const found = [...new Set(result.findings.flatMap((f) => f.codes))];
    if (found.length) {
      const info = await insightQuery<{ code: string; description: string | null }>(C_INFO_SQL, [found]).catch(() => []);
      for (const i of info) if (i.description) result.info[i.code] = i.description;
      // กฎ STP ไม่อยู่ใน rep_error_code
      for (const c of found) if (!result.info[c] && STP_RULES[c]) result.info[c] = STP_RULES[c].detail;
    }
    return Response.json(result);
  } catch (e) {
    console.error("opd/fdh-check", file, e);
    return Response.json({ error: `ตรวจแฟ้ม ${file} ไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
