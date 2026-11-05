import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import type { CodeOptionGroup, DepartmentSummary, DepartmentSummaryResponse } from "../../types";
import {
  OPI_BY_DATE, UNKNOWN_FUND, UNKNOWN_NAME, add, badRequest, categoryList, depSql, effectiveCodes, fundOf, inList, int, isAuthed,
  activePttypes, loadDepartments, loadLookups, parseCodes, parseRange, pttypeOptionGroups, round2, unauthorized,
} from "../../_lib/fund";

// แผนก = ovst.main_dep: มูลค่าทุกรายการของ visit นับเข้าแผนกหลักของ visit
// กองทุนภายในแผนก: มูลค่าตาม opitemrece.pttype, จำนวน visit ตาม ovst.pttype (หลักเดียวกับหน้ากองทุน)
// ?deps=<code,…> กรองแผนก, ?pttypes=<code,…> กรองสิทธิ (ทั้ง ovst.pttype และ opitemrece.pttype) รหัสผิดรูปแบบ -> 400
// response เพิ่ม pttypeOptions/depOptions (groups ของ MultiSelect)
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const parsed = parseRange(request.nextUrl.searchParams);
  if (!parsed.ok) return badRequest(parsed.error);
  const { start, end } = parsed.range;
  const rawPttypes = parseCodes(request.nextUrl.searchParams.get("pttypes"));
  if (rawPttypes === "invalid") return badRequest("pttypes ไม่ถูกต้อง");
  const rawDeps = parseCodes(request.nextUrl.searchParams.get("deps"));
  if (rawDeps === "invalid") return badRequest("deps ไม่ถูกต้อง");

  const [lk, deps] = await Promise.all([loadLookups(), loadDepartments()]);
  const activeDeps = deps.filter((d) => d.active);
  const pttypes = effectiveCodes(rawPttypes, activePttypes(lk));
  const depCodes = effectiveCodes(rawDeps, activeDeps.map((d) => d.code));
  const depFilter = depCodes ? inList(depSql("v"), depCodes.length) : "";
  const vFilter = (pttypes ? ` AND ${inList("v.pttype", pttypes.length)}` : "") + (depFilter && ` AND ${depFilter}`);
  const oFilter = pttypes ? ` AND ${inList("o.pttype", pttypes.length)}` : "";
  const params = [start, end, ...(pttypes ?? []), ...(depCodes ?? [])];

  const [visitRows, patientRows, itemRows] = await Promise.all([
    hisQuery<{ dep: string; pttype: string | null; visits: number }>(
      `SELECT ${depSql("v")} AS dep, v.pttype, COUNT(*) AS visits FROM ovst v
       WHERE v.vstdate BETWEEN ? AND ?${vFilter} GROUP BY dep, v.pttype`,
      params,
    ),
    // ROLLUP แถว dep = NULL คือจำนวนคนไม่ซ้ำทั้งช่วง
    hisQuery<{ dep: string | null; patients: number }>(
      `SELECT ${depSql("v")} AS dep, COUNT(DISTINCT v.hn) AS patients FROM ovst v
       WHERE v.vstdate BETWEEN ? AND ?${vFilter} GROUP BY dep WITH ROLLUP`,
      params,
    ),
    // รวม opitemrece ใน derived table ที่ใช้ ix_vstdate ก่อน แล้วค่อย join ovst ด้วย vn (unique) เพื่อหาแผนก
    // ห้าม join ovst กับ opitemrece ตรงๆ: FORCE INDEX ทำให้ใช้ ix_vn ไม่ได้ และ optimizer อาจเริ่มจาก ovst
    hisQuery<{ dep: string; pttype: string; income: string; amount: number }>(
      `SELECT ${depSql("v")} AS dep, x.pttype, x.income, SUM(x.amount) AS amount
       FROM (SELECT o.vn, o.pttype, o.income, SUM(o.sum_price) AS amount FROM ${OPI_BY_DATE}
             WHERE o.vstdate BETWEEN ? AND ? AND o.vn IS NOT NULL${oFilter} GROUP BY o.vn, o.pttype, o.income) x
       LEFT JOIN ovst v ON v.vn = x.vn${depFilter && ` WHERE ${depFilter}`}
       GROUP BY dep, x.pttype, x.income`,
      params,
    ),
  ]);
  const depName = new Map(deps.map((d) => [d.code, d.name]));

  type FundAcc = { visits: number; amount: number; categories: Map<string, number> };
  type DepAcc = { visits: number; amount: number; categories: Map<string, number>; funds: Map<string, FundAcc> };
  const depAcc = new Map<string, DepAcc>();
  const dep = (code: string) => {
    let d = depAcc.get(code);
    if (!d) depAcc.set(code, (d = { visits: 0, amount: 0, categories: new Map(), funds: new Map() }));
    return d;
  };
  const fund = (d: DepAcc, code: string) => {
    let f = d.funds.get(code);
    if (!f) d.funds.set(code, (f = { visits: 0, amount: 0, categories: new Map() }));
    return f;
  };

  for (const r of visitRows) {
    const d = dep(r.dep);
    d.visits += int(r.visits);
    fund(d, fundOf(lk, r.pttype)).visits += int(r.visits);
  }
  const allCategories = new Map<string, number>();
  for (const r of itemRows) {
    const amount = Number(r.amount);
    const d = dep(r.dep);
    d.amount += amount;
    add(d.categories, r.income, amount);
    const f = fund(d, fundOf(lk, r.pttype));
    f.amount += amount;
    add(f.categories, r.income, amount);
    add(allCategories, r.income, amount);
  }
  const patients = new Map(patientRows.map((r) => [r.dep, int(r.patients)]));

  const departments: DepartmentSummary[] = [...depAcc]
    .map(([dep_code, d]) => ({
      dep_code,
      dep_name: dep_code === UNKNOWN_FUND ? UNKNOWN_NAME : (depName.get(dep_code) ?? dep_code),
      visits: d.visits,
      patients: patients.get(dep_code) ?? 0,
      amount: round2(d.amount),
      categories: categoryList(lk, d.categories),
      funds: [...d.funds]
        .map(([fund_code, f]) => ({
          fund_code,
          fund_name: lk.fundName(fund_code),
          visits: f.visits,
          amount: round2(f.amount),
          categories: categoryList(lk, f.categories),
        }))
        .sort((x, y) => y.amount - x.amount || y.visits - x.visits),
    }))
    .sort((x, y) => y.amount - x.amount || y.visits - x.visits);

  // เฉพาะแผนกที่เปิดใช้ (รวม UNKNOWN) ไม่มี hint เพราะชื่อใน kskdepartment ขึ้นต้นด้วยรหัสอยู่แล้ว
  const depOptions: CodeOptionGroup[] = [{
    value: "deps",
    label: "แผนก",
    options: activeDeps.map((d) => ({ value: d.code, label: d.name })),
  }];

  const body: DepartmentSummaryResponse & { pttypeOptions: CodeOptionGroup[]; depOptions: CodeOptionGroup[] } = {
    start,
    end,
    totals: {
      visits: departments.reduce((s, d) => s + d.visits, 0),
      patients: patients.get(null) ?? 0,
      amount: round2([...depAcc.values()].reduce((s, d) => s + d.amount, 0)),
    },
    categories: categoryList(lk, allCategories),
    departments,
    pttypeOptions: pttypeOptionGroups(lk),
    depOptions,
  };
  return Response.json(body);
}
