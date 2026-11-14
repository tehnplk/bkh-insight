import type { NextRequest } from "next/server";
import { hisQuery, insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { badRequest, inList, isAuthed, unauthorized } from "@/app/api/fund/_lib/fund";
import { CASE_LIMIT, casesSql, maskFound, ruleCodes } from "@/app/api/fdh/c-check/checks";
import { STP_RULES } from "@/app/api/fdh/c-check/files";
import { ipAnDruCheckSql } from "@/app/api/fdh/files/sql";
import { MAX_EXPORT_ANS } from "../admissions/admissions";
import { DRUG_CATALOG_CODES, checkDru, isCheckFile, type CatalogVersion, type CheckFinding, type CheckResult, type DruCheckRow } from "./check";

// เหมือน /api/fdh/c-check/validate
const C_INFO_SQL = "SELECT code, description FROM rep_error_code WHERE kind = 'C' AND code = ANY($1::text[])";
const CATALOG_SQL = `SELECT hosp_drug_code AS code, unit_price, date_effective, date_approved, line_no, product_cat
FROM drug_catalog_nhso WHERE hosp_drug_code = ANY($1::text[])`;

/**
 * POST { ans, file } ตรวจ C หนึ่งแฟ้มของ admission ที่เลือก (หน้าเรียกทีละแฟ้มเพื่อแสดงความคืบหน้า)
 * IPD/PAT/INS: กฎ SQL ของหน้าตรวจ C (skill fdh-pre-validate) บนช่วงวันจำหน่ายของ AN ที่เลือก แล้วกรองเฉพาะ AN/HN ที่เลือก
 * DRU: เทียบ icode กับ HOSPDRUGCODE ของ Drug Catalog ที่นำเข้าใน /catalog/standard-codes ; แฟ้มอื่นยังไม่มีกฎ
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
  if (!isCheckFile(file)) return Response.json(result);
  const anList = ans as string[];

  try {
    if (file === "DRU") {
      result.rules = [...DRUG_CATALOG_CODES];
      const [[{ n }]] = await Promise.all([insightQuery<{ n: number }>("SELECT COUNT(*)::int AS n FROM drug_catalog_nhso")]);
      if (!n) {
        result.rules = [];
        result.note = "ยังไม่ได้นำเข้า Drug Catalog ที่เมนูตั้งค่ารหัสมาตรฐาน จึงยังตรวจแฟ้ม DRU ไม่ได้";
        return Response.json(result);
      }
      const today = todayIso();
      const rows = await hisQuery<DruCheckRow>(ipAnDruCheckSql(anList.length), [today, today, ...anList]);
      const codes = [...new Set(rows.map((r) => r.icode))];
      const versions = codes.length ? await insightQuery<CatalogVersion>(CATALOG_SQL, [codes]) : [];
      result.findings = checkDru(rows, versions.map((v) => ({ ...v, line_no: Number(v.line_no) })));
    } else {
      result.rules = ruleCodes("ip", file);
      // ช่วงวันจำหน่ายที่ครอบ AN ที่เลือก ใช้กฎ SQL เดิมทั้งชุด (ผ่านการพิสูจน์แล้ว) แล้วเก็บเฉพาะของ AN/HN ที่เลือก
      const adm = await hisQuery<{ an: string; hn: string; dchdate: string }>(`SELECT an, hn, dchdate FROM ipt WHERE ${inList("an", anList.length)}`, anList);
      if (adm.length) {
        const days = adm.map((a) => a.dchdate.slice(0, 10)).sort();
        const cases = await hisQuery<Required<Omit<CheckFinding, "row" | "codes" | "found">> & { c_code: string; found: string | null }>(casesSql("ip", file), [days[0], days.at(-1)!]);
        const anSet = new Set(anList);
        const hnSet = new Set(adm.map((a) => a.hn));
        result.truncated = cases.length >= CASE_LIMIT;
        result.findings = cases
          .filter((c) => (file === "PAT" ? !!c.hn && hnSet.has(c.hn) : !!c.an && anSet.has(c.an)))
          .map((c) => ({ an: c.an || null, hn: c.hn || null, seq: c.seq || null, codes: [c.c_code], found: c.found == null ? undefined : String(maskFound(c.c_code, String(c.found))) }));
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
