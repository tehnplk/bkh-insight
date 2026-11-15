import type { NextRequest } from "next/server";
import { hisQuery, insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { badRequest, inList, isAuthed, unauthorized } from "@/app/api/fund/_lib/fund";
import { CASE_LIMIT, casesSql, maskFound, ruleCodes, ruleParams } from "@/app/api/fdh/c-check/checks";
import { STP_RULES } from "@/app/api/fdh/c-check/files";
import { ipAnDruCheckSql } from "@/app/api/fdh/files/sql";
import { MAX_EXPORT_ANS } from "../admissions/admissions";
import { DRUG_CATALOG_CODES, checkDru, type CatalogVersion, type CheckResult, type DruCheckRow } from "./check";

// เหมือน /api/fdh/c-check/validate
const C_INFO_SQL = "SELECT code, description FROM rep_error_code WHERE kind = 'C' AND code = ANY($1::text[])";
const CATALOG_SQL = `SELECT hosp_drug_code AS code, unit_price, date_effective, date_approved, line_no, product_cat
FROM drug_catalog_nhso WHERE hosp_drug_code = ANY($1::text[])`;
const NO_CATALOG = "ยังไม่ได้นำเข้า Drug Catalog ที่เมนูตั้งค่ารหัสมาตรฐาน จึงยังเทียบแฟ้ม DRU กับ Drug Catalog ไม่ได้";

type CaseRow = { c_code: string; hn: string | null; an: string | null; seq: string | null; found: string | null };

/**
 * POST { ans, file } ตรวจ C หนึ่งแฟ้มของ admission ที่เลือก (หน้าเรียกทีละแฟ้มเพื่อแสดงความคืบหน้า)
 * ทุกแฟ้มที่มีกฎ: กฎ SQL ของหน้าตรวจ C บนช่วงวันจำหน่ายของ AN ที่เลือก กรอง AN/HN ที่เลือกใน SQL ก่อน LIMIT
 * DRU: กฎ SQL + เทียบ icode กับ HOSPDRUGCODE ของ Drug Catalog ที่นำเข้าใน /catalog/standard-codes
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const body = (await request.json().catch(() => null)) as { ans?: unknown; file?: unknown } | null;
  const ans = Array.isArray(body?.ans) ? [...new Set(body.ans)] : [];
  if (!ans.length || ans.length > MAX_EXPORT_ANS || !ans.every((a) => typeof a === "string" && /^\d{9}$/.test(a))) {
    return badRequest(`ans ต้องเป็น AN 9 หลัก 1–${MAX_EXPORT_ANS} รายการ`);
  }
  const file = typeof body?.file === "string" ? body.file : "";
  const result: CheckResult = { file, rules: [], findings: [], info: {} };
  const codes = ruleCodes("ip", file);
  if (file !== "DRU" && !codes.length) return Response.json(result);
  const anList = ans as string[];

  try {
    if (codes.length) {
      result.rules = [...codes];
      const adm = await hisQuery<{ dchdate: string }>(`SELECT dchdate FROM ipt WHERE ${inList("an", anList.length)}`, anList);
      if (adm.length) {
        const days = adm.map((a) => a.dchdate.slice(0, 10)).sort();
        const cases = await hisQuery<CaseRow>(casesSql("ip", file), ruleParams(days[0], days.at(-1)!, anList));
        result.truncated = cases.length >= CASE_LIMIT;
        result.findings = cases.map((c) => ({ an: c.an || null, hn: c.hn || null, seq: c.seq || null, codes: [c.c_code], found: c.found == null ? undefined : String(maskFound(c.c_code, String(c.found))) }));
      }
    }
    if (file === "DRU") {
      const [{ n }] = await insightQuery<{ n: number }>("SELECT COUNT(*)::int AS n FROM drug_catalog_nhso");
      if (!n) result.note = NO_CATALOG;
      else {
        result.rules = [...DRUG_CATALOG_CODES, ...result.rules];
        const today = todayIso();
        const rows = await hisQuery<DruCheckRow>(ipAnDruCheckSql(anList.length), [today, today, ...anList]);
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
    console.error("ipd/fdh-check", file, e);
    return Response.json({ error: `ตรวจแฟ้ม ${file} ไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
