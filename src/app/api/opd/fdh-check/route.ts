import type { NextRequest } from "next/server";
import { hisQuery, insightQuery } from "@/lib/db";
import { badRequest, isAuthed, unauthorized } from "@/app/api/fund/_lib/fund";
import { CASE_LIMIT, casesSql, maskFound, ruleCodes } from "@/app/api/fdh/c-check/checks";
import { opDruCheckSql } from "@/app/api/fdh/files/sql";
import { DRUG_CATALOG_CODES, checkDru, type CatalogVersion, type CheckResult, type DruCheckRow } from "@/app/api/ipd/fdh-check/check";
import { parseOpdSelection } from "../fdh-files";

const C_INFO_SQL = "SELECT code, description FROM rep_error_code WHERE kind = 'C' AND code = ANY($1::text[])";
const CATALOG_SQL = `SELECT hosp_drug_code AS code, unit_price, date_effective, date_approved, line_no, product_cat
FROM drug_catalog_nhso WHERE hosp_drug_code = ANY($1::text[])`;
/** แฟ้มผู้ป่วยนอกที่มีกฎ: OPD/PAT/INS ใช้กฎ SQL ของหน้าตรวจ C (skill fdh-pre-validate) ส่วน DRU เทียบ Drug Catalog */
const RULE_FILES = new Set(["OPD", "PAT", "INS"]);

type CaseRow = { c_code: string; hn: string | null; an: string | null; seq: string | null; found: string | null };

/**
 * POST { vns, file } ตรวจ C หนึ่งแฟ้มของ visit ที่เลือก (หน้าเรียกทีละแฟ้มเพื่อแสดงความคืบหน้า)
 * กฎรันบนช่วงวันรับบริการที่ครอบ visit ที่เลือก แล้วเก็บเฉพาะ VN/HN ที่เลือก ; DRU: แถวตรวจกรอง SEQ ในลำดับเดียวกับแฟ้ม row จึงตรงแถวที่แสดง
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const body = (await request.json().catch(() => null)) as { vns?: unknown; file?: unknown } | null;
  const file = typeof body?.file === "string" ? body.file : "";
  const result: CheckResult = { file, rules: [], findings: [], info: {} };
  try {
    const sel = await parseOpdSelection(body);
    if ("error" in sel) return badRequest(sel.error);
    if (file === "DRU") {
      result.rules = [...DRUG_CATALOG_CODES];
      const [{ n }] = await insightQuery<{ n: number }>("SELECT COUNT(*)::int AS n FROM drug_catalog_nhso");
      if (!n) {
        result.rules = [];
        result.note = "ยังไม่ได้นำเข้า Drug Catalog ที่เมนูตั้งค่ารหัสมาตรฐาน จึงยังตรวจแฟ้ม DRU ไม่ได้";
        return Response.json(result);
      }
      const rows = (await hisQuery<DruCheckRow & { seq: string }>(opDruCheckSql(), [sel.start, sel.end])).filter((r) => sel.vnSet.has(r.seq));
      const codes = [...new Set(rows.map((r) => r.icode))];
      const versions = codes.length ? await insightQuery<CatalogVersion>(CATALOG_SQL, [codes]) : [];
      result.findings = checkDru(rows, versions.map((v) => ({ ...v, line_no: Number(v.line_no) })));
    } else if (RULE_FILES.has(file)) {
      result.rules = ruleCodes("op", file);
      const cases = await hisQuery<CaseRow>(casesSql("op", file), [sel.start, sel.end]);
      result.truncated = cases.length >= CASE_LIMIT;
      result.findings = cases
        .filter((c) => (file === "PAT" ? !!c.hn && sel.hnSet.has(c.hn) : !!c.seq && sel.vnSet.has(c.seq)))
        .map((c) => ({ hn: c.hn || null, seq: c.seq || null, codes: [c.c_code], found: c.found == null ? undefined : String(maskFound(c.c_code, String(c.found))) }));
    } else {
      return Response.json(result);
    }
    const found = [...new Set(result.findings.flatMap((f) => f.codes))];
    if (found.length) {
      const info = await insightQuery<{ code: string; description: string | null }>(C_INFO_SQL, [found]).catch(() => []);
      for (const i of info) if (i.description) result.info[i.code] = i.description;
    }
    return Response.json(result);
  } catch (e) {
    console.error("opd/fdh-check", file, e);
    return Response.json({ error: `ตรวจแฟ้ม ${file} ไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
