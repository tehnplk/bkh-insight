import type { NextRequest } from "next/server";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { hisQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { SVC_OVERRIDE_DEP, badRequest, fundOf, int, isAuthed, loadDepartments, loadLookups, round2, svcDepJoin, svcDepSql, unauthorized } from "../_lib/fund";
import { fiscalYearOf, parseFiscalYear } from "../uc-dashboard/dashboard";
import { aggregate, fiscalMonths, monthRanges, prevMonth, type DeptTrendResponse, type MonthRange, type RawRow } from "./trend";

// ovst/opd_dep_queue/vn_stat เป็น InnoDB (ไม่ล็อกตารางแบบ MyISAM) ; ราว 0.8 วินาทีต่อเดือน (JOIN คิวใช้ ix_vn_depcode) ; ไม่แตะ opitemrece
// ไม่นับ visit ที่ admit เพราะ vn_stat.income ของ visit นั้นค้างค่าเดิม (HOSxP ย้ายรายการไป AN) เหมือน /fund/claim-type
// 1 visit = 1 แผนก ตามกติกาเดียวกับ /fund/opd-department (svcDepSql: SVC_OVERRIDE_DEP ถ้ามีคิว ไม่งั้น main_dep)
const MONTH_SQL = `SELECT ${svcDepSql("v")} AS dep, vs.pttype,
       COUNT(*) AS visits, SUM(vs.income) AS income, SUM(vs.uc_money) AS claim
FROM ovst v JOIN vn_stat vs ON vs.vn = v.vn
${svcDepJoin("v.vn")}
WHERE v.vstdate BETWEEN ? AND ? AND (v.an IS NULL OR v.an = '')
GROUP BY dep, vs.pttype`;

/** โหลดพร้อมกันทีละกี่เดือน */
const CONCURRENCY = 3;
/** POST ดึงใหม่: ข้อมูลใน cache อายุไม่ถึงค่านี้ใช้ของเดิม กันกดถี่ */
const REFRESH_MIN_AGE_MS = 30_000;
const monthTag = (month: string) => `dept-trend:${month}`;

type Raw = { dep: string; pttype: string | null; visits: number | string; income: number | string | null; claim: number | string | null };

// เก็บผลต่อเดือนไว้ใน cache ของ server: เดือนที่จบไปก่อนเดือนที่แล้วแทบไม่เปลี่ยน (weeks: ดึงใหม่เบื้องหลังสัปดาห์ละครั้ง)
// เดือนนี้และเดือนก่อนยังลงค่าใช้จ่ายย้อนหลังได้ (minutes) ; end ของเดือนนี้ = วันนี้ จึงขึ้น entry ใหม่ทุกวัน
async function loadMonth(start: string, end: string, live: boolean): Promise<{ rows: RawRow[]; computed_at: string }> {
  "use cache";
  if (live) cacheLife("minutes");
  else cacheLife("weeks");
  cacheTag(monthTag(start.slice(0, 7)));
  const raws = await hisQuery<Raw>(MONTH_SQL, [SVC_OVERRIDE_DEP, start, end]);
  return {
    rows: raws.map((r) => ({ dep: String(r.dep), pttype: r.pttype, visits: int(r.visits), income: round2(r.income), claim: round2(r.claim) })),
    computed_at: new Date().toISOString(),
  };
}

const load = (r: MonthRange) => loadMonth(r.start, r.end, r.live);

/** ?fy= ปีงบ พ.ศ. (ไม่ส่ง = ปีงบปัจจุบัน) ; null = ไม่ถูกต้อง (ย้อนได้ FY_BACK ปี ไม่เกินปีงบปัจจุบัน) */
function parseFy(params: URLSearchParams, today: string) {
  const currentFy = fiscalYearOf(today);
  const raw = params.get("fy");
  return raw ? parseFiscalYear(raw, currentFy) : currentFy;
}

/** GET ?fy -> DeptTrendResponse ทุกแผนก × กองทุน × เดือนของปีงบ (หน้ากรองแผนก/กองทุน/ตัวชี้วัดเองจากก้อนนี้) */
export async function GET(request: NextRequest) {
  // auth อ่าน cookie จึงเช็คนอกฟังก์ชันที่ cache
  if (!(await isAuthed())) return unauthorized();
  const today = todayIso();
  const fy = parseFy(request.nextUrl.searchParams, today);
  if (fy === null) return badRequest("fy ไม่ถูกต้อง");
  const ranges = monthRanges(fy, today);

  try {
    const [lk, deps] = await Promise.all([loadLookups(), loadDepartments()]);
    const loaded: Awaited<ReturnType<typeof loadMonth>>[] = [];
    for (let i = 0; i < ranges.length; i += CONCURRENCY) loaded.push(...(await Promise.all(ranges.slice(i, i + CONCURRENCY).map(load))));

    const rows = aggregate(ranges.map((r, i) => ({ month: r.month, rows: loaded[i].rows })), (p) => fundOf(lk, p));
    const usedDeps = new Set(rows.map((r) => r.dep));
    const fundCodes = [...new Set(rows.map((r) => r.fund))].sort();
    const live = ranges.some((r) => r.live);
    const stamps = loaded.filter((_, i) => !live || ranges[i].live).map((m) => m.computed_at).sort();

    const body: DeptTrendResponse = {
      fy,
      months: fiscalMonths(fy),
      loaded: ranges.length,
      complete: ranges.filter((r) => r.complete).length,
      through: ranges.at(-1)?.end ?? today,
      live,
      rows,
      deps: deps.filter((d) => d.active || usedDeps.has(d.code)),
      funds: fundCodes.map((code) => ({ code, name: lk.fundName(code) })),
      computed_at: stamps[0] ?? new Date().toISOString(),
      override_dep: SVC_OVERRIDE_DEP,
    };
    return Response.json(body);
  } catch (e) {
    console.error("fund/dept-trend", e);
    return Response.json({ error: `อ่านข้อมูลไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}

/** ปุ่ม "ดึงใหม่": ล้าง cache ของเดือนนี้และเดือนก่อน ; revalidateTag เพราะ updateTag ใช้ได้แค่ใน Server Action */
export async function POST() {
  if (!(await isAuthed())) return unauthorized();
  const today = todayIso();
  const cur = today.slice(0, 7);
  try {
    // cache ว่างจะดึงสดตรงนี้เลย (อายุ ~0) จึงไม่ต้องล้าง
    const { computed_at } = await loadMonth(`${cur}-01`, today, true);
    if (Date.now() - Date.parse(computed_at) >= REFRESH_MIN_AGE_MS) {
      revalidateTag(monthTag(cur), { expire: 0 });
      revalidateTag(monthTag(prevMonth(cur)), { expire: 0 });
    }
  } catch (e) {
    return Response.json({ error: `ดึงข้อมูลไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
  return Response.json({ ok: true });
}
