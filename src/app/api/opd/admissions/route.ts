import type { NextRequest } from "next/server";
import { escapeLike, hisQuery } from "@/lib/db";
import { MAX_FILTER_VALUES, inFilterSql, parseColumnFilters, parseGridQuery, type FacetPage, type FacetValue } from "@/lib/grid-query";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import {
  FULL_NAME_SQL, UNKNOWN_FUND, activePttypes, badRequest, depSql, effectiveCodes, fundOf, inList, isAuthed, loadDepartments, loadLookups, parseCodes, parseRange, unauthorized,
} from "@/app/api/fund/_lib/fund";
import { CLAIM_JOINS, STATUS_SQL } from "@/app/api/fund/_lib/claim";
import { OPD_MAX_DAYS, buildRows, dischargeLabel, type RawVisit, type VisitRow, type VisitsPage } from "./admissions";

// key ที่ DataGrid ส่งเป็น sort -> SQL (allowlist จึงต่อเข้า ORDER BY ได้)
const SORT_SQL = {
  vn: "o.vn", hn: "o.hn", vstdate: "o.vstdate", vsttime: "o.vsttime", dep_name: "dep_name", pttype_name: "pttype_name", pdx: "vs.pdx", ovst_status: "os.export_code",
  income: "vs.income", uc_money: "vs.uc_money",
} as const;
type SortKey = keyof typeof SORT_SQL;
const SORTABLE = Object.keys(SORT_SQL) as SortKey[];
// shortcut: Excel ดึงไม่เกินนี้ (ทุกสิทธิ 31 วันราว 18,000 visit) ถ้าเกินจริงให้แบ่งดึงเป็นชุด
const XLSX_MAX = 30_000;

// เลขที่ใบเสร็จ: rcpt_print (index vn) เฉพาะ status OK (ABORT = ยกเลิก) visit จ่ายหลายใบคั่นด้วย ", "
// visit ผู้ป่วยนอก (ไม่ใช่ visit ที่ถูกรับไว้นอน ซึ่งไปอยู่หน้า IPD) PDx/มูลค่าจาก vn_stat ชื่อโรคจาก icd101 (PK)
// authen/เลขปิดสิทธิ/สถานะปิดสิทธิ ใช้หลักเดียวกับ /fund/claim-status (CLAIM_JOINS: c = nhso_confirm_privilege, vp = visit_pttype)
// เลขปิดสิทธิ: ยืนยันกับ สปสช. แล้ว (ไม่ถูกยกเลิก) หรือ EP ; ใช้ทั้งแสดงผลและตัวกรอง unclosed
const CLOSE_CODE_SQL = `COALESCE(IF(c.nhso_status = 'Y' AND c.nhso_cancel_datetime IS NULL, NULLIF(c.nhso_authen_code, ''), NULL),
         IF(vp.auth_code LIKE 'EP%', vp.auth_code, NULL))`;
const AUTH_CODE_SQL = `COALESCE(IF(vp.auth_code LIKE 'PP%', vp.auth_code, NULL), (SELECT s2.claim_code FROM nhso_smartcard_agent s2
         WHERE s2.vn = o.vn AND s2.claim_code LIKE 'PP%' ORDER BY s2.nhso_smartcard_agent_id DESC LIMIT 1))`;
const RCPT_SQL = `(SELECT GROUP_CONCAT(r.rcpno ORDER BY r.finance_number SEPARATOR ', ') FROM rcpt_print r
         WHERE r.vn = o.vn AND r.status = 'OK')`;
const FROM = `FROM ovst o
LEFT JOIN patient p ON p.hn = o.hn
LEFT JOIN vn_stat vs ON vs.vn = o.vn
LEFT JOIN icd101 cd ON cd.code = vs.pdx
LEFT JOIN ovstost os ON os.ovstost = o.ovstost
LEFT JOIN pttype t ON t.pttype = o.pttype
LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
${CLAIM_JOINS}`;
const SELECT = `SELECT o.vn, o.hn, ${FULL_NAME_SQL} AS patient_name, o.vstdate, o.vsttime,
       ${depSql("o")} AS dep_code, k.department AS dep_name,
       o.pttype, t.name AS pttype_name, vs.pdx, cd.name AS pdx_name, os.name AS ovst_status, os.export_code AS ovst_export, vs.income, vs.uc_money,
       ${AUTH_CODE_SQL} AS auth_code,
       ${CLOSE_CODE_SQL} AS close_code,
       ${STATUS_SQL} AS claim_status,
       ${RCPT_SQL} AS rcpt_no
${FROM}`;

// ตัวกรองหัวคอลัมน์: key = id คอลัมน์ของหน้า -> SQL ของค่า (allowlist) และชื่อที่แสดง
// fund/ovst_status เป็นค่าที่คำนวณในโค้ด (pttype -> กองทุน, ovstost -> สถานะการจำหน่าย) จึงกรองผ่านรหัสต้นทาง
const CODES_LABEL: Record<string, string> = {
  YY: "มี Authen และเลขปิดสิทธิ",
  YN: "มี Authen ไม่พบเลขปิดสิทธิ",
  NY: "ไม่พบ Authen มีเลขปิดสิทธิ",
  NN: "ไม่พบ Authen และเลขปิดสิทธิ",
};
const FILTER_SQL: Record<string, { expr: string; label?: string; labels?: Record<string, string> }> = {
  vn: { expr: "o.vn" },
  hn: { expr: "o.hn" },
  patient_name: { expr: FULL_NAME_SQL },
  pttype_name: { expr: "o.pttype", label: "t.name" },
  codes: { expr: `CONCAT(IF(${AUTH_CODE_SQL} IS NULL, 'N', 'Y'), IF(${CLOSE_CODE_SQL} IS NULL, 'N', 'Y'))`, labels: CODES_LABEL },
  vstdate: { expr: "DATE_FORMAT(o.vstdate, '%Y-%m-%d')" },
  vsttime: { expr: "TIME_FORMAT(o.vsttime, '%H:%i')" },
  dep_name: { expr: depSql("o"), label: "k.department" },
  pdx: { expr: "vs.pdx", label: "cd.name" },
  rcpt_no: { expr: RCPT_SQL },
};
const FILTERABLE = [...Object.keys(FILTER_SQL), "fund", "ovst_status"] as const;
type FilterKey = (typeof FILTERABLE)[number];
const FACET_LIMIT = MAX_FILTER_VALUES;
const q1 = () => "?";

const XLSX_COLUMNS: XlsxColumn<VisitRow>[] = [
  { key: "vn", header: "VN", width: 14 },
  { key: "hn", header: "HN", width: 10 },
  { key: "patient_name", header: "ชื่อ-สกุล", width: 28 },
  { key: "fund", header: "กองทุน", width: 8 },
  { key: "pttype_name", header: "สิทธิ", width: 28 },
  { key: "auth_code", header: "Authen", width: 16 },
  { key: "close_code", header: "ปิดสิทธิ", width: 16 },
  { key: "vstdate", header: "วันที่มา", width: 12 },
  { key: "vsttime", header: "เวลา", width: 8 },
  { key: "dep_name", header: "แผนก", width: 22 },
  { key: "pdx", header: "PDx", width: 8 },
  { key: "pdx_name", header: "ชื่อโรคหลัก", width: 36 },
  { key: "ovst_status", header: "สถานะผู้ป่วย", width: 18 },
  { key: "rcpt_no", header: "เลขที่ใบเสร็จ", width: 16 },
  { key: "income", header: "มูลค่า (บาท)", width: 14, type: "money" },
  { key: "uc_money", header: "ลูกหนี้สิทธิ (บาท)", width: 14, type: "money" },
];

/**
 * GET ?start&end[&pttypes=89,77][&deps=053][&unclosed=1][&cf={...}] + พารามิเตอร์ DataGrid: visit ผู้ป่วยนอกในช่วงวันรับบริการ
 * &facet=<คอลัมน์>[&facetQ=] -> ค่าที่ไม่ซ้ำของคอลัมน์ (ตัวกรองหัวคอลัมน์)
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params, OPD_MAX_DAYS);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const rawPttypes = parseCodes(params.get("pttypes"));
  if (rawPttypes === "invalid") return badRequest("pttypes ไม่ถูกต้อง");
  const rawDeps = parseCodes(params.get("deps"));
  if (rawDeps === "invalid") return badRequest("deps ไม่ถูกต้อง");
  // unclosed=1: เฉพาะ visit ที่ยังไม่มีเลขปิดสิทธิ (ช่อง "ไม่พบเลขปิดสิทธิ")
  const unclosed = params.get("unclosed") === "1";
  const grid = parseGridQuery<SortKey>(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters<FilterKey>(params, FILTERABLE);
  if (!cf.ok) return badRequest(cf.error);
  const { filters, facet, facetQ } = cf.query;
  const xlsx = format === "xlsx";

  try {
    const needStatus = !!filters.ovst_status || facet === "ovst_status";
    const [lk, deps, ovstost] = await Promise.all([
      loadLookups(),
      rawDeps ? loadDepartments() : null,
      needStatus ? hisQuery<{ code: string; name: string | null; export_code: string | null }>("SELECT ovstost AS code, name, export_code FROM ovstost") : [],
    ]);
    // เลือกครบทุกค่าที่เปิดใช้ = ไม่กรอง (ชุดเดียวกับตัวเลือกของหน้า)
    const pttypes = effectiveCodes(rawPttypes, activePttypes(lk));
    const depCodes = deps && effectiveCodes(rawDeps, deps.filter((d) => d.active).map((d) => d.code));
    const statusOf = new Map(ovstost.map((s) => [s.code, dischargeLabel(s.export_code, s.name) ?? ""]));

    /** WHERE ตามตัวกรองทั้งหมด ยกเว้นตัวกรองหัวคอลัมน์ของ except (ใช้ตอนหาค่า facet ของคอลัมน์นั้น) */
    const whereFor = (except: FilterKey | null) => {
      const parts = ["o.vstdate BETWEEN ? AND ?", "(o.an IS NULL OR o.an = '')"];
      const args: string[] = [start, end];
      if (pttypes) {
        parts.push(inList("o.pttype", pttypes.length));
        args.push(...pttypes);
      }
      if (depCodes) {
        parts.push(inList(depSql("o"), depCodes.length));
        args.push(...depCodes);
      }
      if (q) {
        const like = `%${escapeLike(q)}%`;
        {
          parts.push(`(o.vn LIKE ? OR o.hn LIKE ? OR ${FULL_NAME_SQL} LIKE ?)`);
          args.push(like, like, like);
        }
      }
      if (unclosed) parts.push(`${CLOSE_CODE_SQL} IS NULL`);
      for (const [key, values] of Object.entries(filters) as [FilterKey, string[]][]) {
        if (key === except) continue;
        if (key === "fund") {
          const set = new Set(values);
          const codes = [...lk.pttype].filter(([, v]) => set.has(v.fund)).map(([code]) => code);
          const known = [...lk.pttype.keys()];
          const ors = codes.length ? [inList("o.pttype", codes.length)] : [];
          args.push(...codes);
          // กองทุน UNKNOWN = pttype ที่ไม่อยู่ใน lookup
          if (set.has(UNKNOWN_FUND)) {
            ors.push(`o.pttype IS NULL OR ${known.length ? `o.pttype NOT IN (${known.map(q1).join(", ")})` : "1 = 1"}`);
            args.push(...known);
          }
          parts.push(ors.length ? `(${ors.join(" OR ")})` : "1 = 0");
        } else if (key === "ovst_status") {
          const set = new Set(values);
          const codes = [...statusOf].filter(([, label]) => set.has(label) && label !== "").map(([code]) => code);
          const ors = codes.length ? [inList("o.ovstost", codes.length)] : [];
          args.push(...codes);
          if (set.has("")) ors.push("o.ovstost IS NULL OR o.ovstost = '' OR os.ovstost IS NULL");
          parts.push(ors.length ? `(${ors.join(" OR ")})` : "1 = 0");
        } else {
          const f = inFilterSql(FILTER_SQL[key].expr, values, q1);
          {
            parts.push(f.sql);
            args.push(...f.params);
          }
        }
      }
      return { sql: `WHERE ${parts.join("\n  AND ")}`, args };
    };

    if (facet) return Response.json(await loadFacet(facet, facetQ, whereFor(facet), (p) => fundOf(lk, p), statusOf));

    const { sql: where, args } = whereFor(null);
    const order = `${SORT_SQL[sort ?? "vstdate"]} ${(sort ? dir : "desc") === "desc" ? "DESC" : "ASC"}, o.vn`;
    const [limit, offset] = xlsx ? [XLSX_MAX, 0] : [pageSize, (page - 1) * pageSize];
    const [raws, count] = await Promise.all([
      hisQuery<RawVisit>(`${SELECT}\n${where}\nORDER BY ${order}\nLIMIT ? OFFSET ?`, [...args, limit, offset]),
      xlsx ? null : hisQuery<{ total: number }>(`SELECT COUNT(*) AS total ${FROM}\n${where}`, args),
    ]);
    const rows = buildRows(raws, (pttype) => fundOf(lk, pttype));
    if (xlsx) return xlsxResponse(`opd-admissions-${start}_${end}.xlsx`, XLSX_COLUMNS, rows);
    const body: VisitsPage = { rows, total: Number(count?.[0]?.total ?? 0) };
    return Response.json(body);
  } catch (e) {
    console.error("opd/admissions", e);
    return Response.json({ error: `อ่านข้อมูลไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}

/** ค่าที่ไม่ซ้ำของคอลัมน์ key ตามตัวกรองอื่น เรียงตามจำนวนมากไปน้อย ไม่เกิน FACET_LIMIT ค่า */
async function loadFacet(
  key: FilterKey,
  facetQ: string,
  where: { sql: string; args: string[] },
  fund: (pttype: string | null) => string,
  statusOf: Map<string, string>,
): Promise<FacetPage> {
  const needle = facetQ.toLowerCase();
  const pick = (values: FacetValue[]) => {
    const hit = needle ? values.filter((v) => `${v.value} ${v.label}`.toLowerCase().includes(needle)) : values;
    hit.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "th"));
    return { values: hit.slice(0, FACET_LIMIT), truncated: hit.length > FACET_LIMIT };
  };
  // ค่าที่คำนวณในโค้ด: นับตามรหัสต้นทางแล้วรวมตามค่าที่แสดง
  const derived = async (expr: string, toValue: (raw: string | null) => string) => {
    const rows = await hisQuery<{ v: string | null; n: number }>(`SELECT ${expr} AS v, COUNT(*) AS n ${FROM}\n${where.sql}\nGROUP BY v`, where.args);
    const sum = new Map<string, number>();
    for (const r of rows) sum.set(toValue(r.v), (sum.get(toValue(r.v)) ?? 0) + Number(r.n));
    return pick([...sum].map(([value, count]) => ({ value, label: value, count })));
  };
  if (key === "fund") return derived("o.pttype", (p) => fund(p));
  if (key === "ovst_status") return derived("o.ovstost", (c) => (c && statusOf.get(c)) || "");

  const def = FILTER_SQL[key];
  const searchSql = needle && !def.labels ? ` AND (${def.expr} LIKE ?${def.label ? ` OR ${def.label} LIKE ?` : ""})` : "";
  const like = `%${escapeLike(facetQ)}%`;
  const rows = await hisQuery<{ v: string | null; l: string | null; n: number }>(
    `SELECT ${def.expr} AS v, ${def.label ? `MAX(${def.label})` : "NULL"} AS l, COUNT(*) AS n ${FROM}\n${where.sql}${searchSql}\nGROUP BY v ORDER BY n DESC LIMIT ?`,
    [...where.args, ...(searchSql ? (def.label ? [like, like] : [like]) : []), FACET_LIMIT + 1],
  );
  const values = rows.map((r) => {
    const value = r.v ?? "";
    const label = def.labels?.[value] ?? (key === "rcpt_no" ? value.replaceAll(":", "/") : r.l ? `${value} ${r.l}` : value);
    return { value, label, count: Number(r.n) };
  });
  if (def.labels) return pick(values);
  return { values: values.slice(0, FACET_LIMIT), truncated: values.length > FACET_LIMIT };
}
