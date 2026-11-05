import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import {
  DAY_MS, badRequest, depNameSql, depSql, fundSql, int, isAuthed, isoDate, loadLookups, parseRange, previousRange, unauthorized,
} from "@/app/api/fund/_lib/fund";
import { AGE_GROUPS, type CountRow, type HomeOverviewResponse } from "./types";

const TOP_DEPARTMENTS = 15;

// visit OPD / รับใหม่ IPD / ER ของช่วงนี้ (cur = 1) และช่วงก่อนหน้า (cur = 0) ในรอบเดียว ต่อบล็อก: start, prevStart, end
const KPI_SQL = `
  SELECT 'opd' AS kpi, IF(vstdate >= ?, 1, 0) AS cur, COUNT(*) AS n, COUNT(DISTINCT hn) AS patients
  FROM ovst WHERE vstdate BETWEEN ? AND ? GROUP BY cur
  UNION ALL
  SELECT 'adm', IF(regdate >= ?, 1, 0) AS cur, COUNT(*), NULL
  FROM ipt WHERE regdate BETWEEN ? AND ? GROUP BY cur
  UNION ALL
  SELECT 'er', IF(vstdate >= ?, 1, 0) AS cur, COUNT(*), NULL
  FROM er_regist WHERE vstdate BETWEEN ? AND ? GROUP BY cur`;

const DAILY_SQL =
  "SELECT vstdate AS d, COUNT(*) AS visits, COUNT(DISTINCT hn) AS patients FROM ovst WHERE vstdate BETWEEN ? AND ? GROUP BY vstdate ORDER BY vstdate";

const DEPARTMENT_SQL = `
  SELECT ${depSql("o")} AS dep, ${depNameSql("o")} AS name, COUNT(*) AS visits, COUNT(DISTINCT o.hn) AS patients
  FROM ovst o LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
  WHERE o.vstdate BETWEEN ? AND ? GROUP BY dep, name ORDER BY visits DESC, dep`;

const HOURLY_SQL = "SELECT HOUR(vsttime) AS hr, COUNT(*) AS visits FROM ovst WHERE vstdate BETWEEN ? AND ? GROUP BY hr ORDER BY hr";

const FUND_SQL = `
  SELECT ${fundSql("t")} AS fund, COUNT(*) AS visits, COUNT(DISTINCT o.hn) AS patients
  FROM ovst o LEFT JOIN pttype t ON t.pttype = o.pttype
  WHERE o.vstdate BETWEEN ? AND ? GROUP BY fund ORDER BY visits DESC`;

// นับคนละหนึ่งครั้ง: คนที่มาหลาย visit ใช้ MAX ของเพศ/อายุ (ในช่วงไม่เกิน 31 วัน อายุต่างกันได้แค่ 1 ปี)
const PYRAMID_SQL = `
  SELECT sex, CASE WHEN age_y < 5 THEN 0 WHEN age_y < 15 THEN 1 WHEN age_y < 25 THEN 2 WHEN age_y < 35 THEN 3
    WHEN age_y < 45 THEN 4 WHEN age_y < 55 THEN 5 WHEN age_y < 65 THEN 6 WHEN age_y < 75 THEN 7 ELSE 8 END AS age_group,
    COUNT(*) AS patients
  FROM (SELECT hn, MAX(sex) AS sex, MAX(age_y) AS age_y FROM vn_stat WHERE vstdate BETWEEN ? AND ? GROUP BY hn) t
  GROUP BY sex, age_group ORDER BY sex, age_group`;

// ผู้ป่วยในที่ยังไม่จำหน่ายต่อ ward ที่เปิดใช้ (ไม่ขึ้นกับช่วงวันที่)
const WARD_SQL = `
  SELECT w.ward, w.name, w.bedcount AS beds, COUNT(i.an) AS admitted
  FROM ward w LEFT JOIN ipt i ON i.ward = w.ward AND i.dchdate IS NULL
  WHERE w.ward_active = 'Y' GROUP BY w.ward, w.name, w.bedcount ORDER BY w.ward`;

// shortcut: แยก Home ward (ดูแลที่บ้าน ผู้ป่วยเกินจำนวน "เตียง" ได้) ด้วยชื่อ เพราะ query ward ที่พิสูจน์แล้วไม่มีคอลัมน์ประเภท ward
//   ถ้าพบคอลัมน์ประเภทใน ward ของ HOSxP ให้เปลี่ยนมาใช้คอลัมน์นั้นแทน
const isHomeCare = (name: string) => /home\s*ward/i.test(name);

type Num = number | string | null;

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const parsed = parseRange(request.nextUrl.searchParams);
  if (!parsed.ok) return badRequest(parsed.error);
  const r = parsed.range;
  const { start, end } = r;
  const prev = previousRange(r);
  const range = [start, end];
  const kpiBlock = [start, prev.start, end];

  const [lk, kpiRows, dailyRows, depRows, hourRows, fundRows, pyramidRows, wardRows] = await Promise.all([
    loadLookups(),
    hisQuery<{ kpi: "opd" | "adm" | "er"; cur: Num; n: Num; patients: Num }>(KPI_SQL, [...kpiBlock, ...kpiBlock, ...kpiBlock]),
    hisQuery<{ d: string; visits: Num; patients: Num }>(DAILY_SQL, range),
    hisQuery<{ dep: string; name: string | null; visits: Num; patients: Num }>(DEPARTMENT_SQL, range),
    hisQuery<{ hr: Num; visits: Num }>(HOURLY_SQL, range),
    hisQuery<{ fund: string; visits: Num; patients: Num }>(FUND_SQL, range),
    hisQuery<{ sex: Num; age_group: Num; patients: Num }>(PYRAMID_SQL, range),
    hisQuery<{ ward: string; name: string | null; beds: Num; admitted: Num }>(WARD_SQL),
  ]);

  // ช่วงที่ไม่มีแถว (ไม่มีข้อมูล) = 0
  const kpiOf = (kpi: string, field: "n" | "patients") => {
    const pick = (cur: number) => int(kpiRows.find((k) => k.kpi === kpi && int(k.cur) === cur)?.[field] ?? 0);
    return { cur: pick(1), prev: pick(0) };
  };

  const dayMap = new Map(dailyRows.map((d) => [d.d, d]));
  const daily: HomeOverviewResponse["daily"] = [];
  for (let t = r.startMs; t <= r.endMs; t += DAY_MS) {
    const date = isoDate(t);
    const d = dayMap.get(date);
    daily.push({ date, visits: int(d?.visits ?? 0), patients: int(d?.patients ?? 0) });
  }

  const hourly = Array<number>(24).fill(0);
  for (const h of hourRows) if (h.hr !== null) hourly[int(h.hr)] = int(h.visits);

  const deps: CountRow[] = depRows.map((d) => ({ code: d.dep, name: d.name ?? d.dep, visits: int(d.visits), patients: int(d.patients) }));
  const rest = deps.slice(TOP_DEPARTMENTS);

  const male = Array<number>(AGE_GROUPS.length).fill(0);
  const female = Array<number>(AGE_GROUPS.length).fill(0);
  let unknownSex = 0;
  for (const p of pyramidRows) {
    const n = int(p.patients);
    const sex = String(p.sex ?? "");
    const side = sex === "1" ? male : sex === "2" ? female : null;
    if (side) side[int(p.age_group)] += n;
    else unknownSex += n;
  }

  const body: HomeOverviewResponse = {
    start,
    end,
    prevStart: prev.start,
    prevEnd: prev.end,
    kpi: {
      patients: kpiOf("opd", "patients"),
      visits: kpiOf("opd", "n"),
      admissions: kpiOf("adm", "n"),
      er: kpiOf("er", "n"),
    },
    daily,
    hourly,
    departments: deps.slice(0, TOP_DEPARTMENTS),
    otherDepartments: rest.length ? { count: rest.length, visits: rest.reduce((s, d) => s + d.visits, 0) } : null,
    funds: fundRows.map((f) => ({ code: f.fund, name: lk.fundName(f.fund), visits: int(f.visits), patients: int(f.patients) })),
    pyramid: { male, female, unknownSex },
    wards: wardRows.map((w) => {
      const name = w.name ?? w.ward;
      return { code: w.ward, name, beds: int(w.beds), admitted: int(w.admitted), homeCare: isHomeCare(name) };
    }),
  };
  return Response.json(body);
}
