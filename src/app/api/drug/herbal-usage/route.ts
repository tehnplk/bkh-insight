import type { NextRequest } from "next/server";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { hisQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { badRequest, int, isAuthed, round2, unauthorized } from "@/app/api/fund/_lib/fund";
import { fiscalYearOf, parseFiscalYear } from "@/app/api/fund/uc-dashboard/dashboard";
import { fiscalMonths, monthRanges, prevMonth, type MonthRange } from "@/app/api/fund/dept-trend/trend";
import { buildReport, reasons, type DrugTotalRow, type HerbalItem, type HerbalResponse, type Side, type UsageRow } from "./herbal";

// รายการยาสมุนไพรอ่านสดจาก HOSxP ทุกครั้ง (ตารางเล็ก) ห้องยาแก้ธงใน HOSxP แล้วเห็นผลทันที ; ธงอ่านจาก drugitems (s_drugitems ค้าง)
const ITEMS_SQL = `SELECT d.icode, COALESCE(s.name, d.name) AS name, COALESCE(s.units, d.units) AS units, d.istatus,
       d.sks_product_category_id AS cat, (d.ttmt_code IS NOT NULL AND d.ttmt_code <> '') AS ttmt
FROM drugitems d LEFT JOIN s_drugitems s ON s.icode = d.icode
WHERE d.sks_product_category_id IN (3, 4) OR d.ttmt_code <> ''
ORDER BY d.icode`;

// opitemrece เป็น MyISAM: ตามช่วงวันด้วย ix_vstdate ราว 1 วินาทีต่อเดือน ; qty <> 0 ตัดคำสั่ง IP ที่ยังไม่จ่าย (qty 0) แต่เก็บรายการคืนยา
// vstdate = วันที่สั่งใช้ยา ทั้ง OP และ IP
const usageSql = (n: number) => `SELECT o.icode,
       IF(o.vn IS NOT NULL, 'OP', 'IP') AS side,
       COUNT(*) AS n_rows,
       COUNT(DISTINCT o.hn) AS n_hn,
       COUNT(DISTINCT IF(o.vn IS NOT NULL, o.vn, o.an)) AS n_visit,
       SUM(o.qty) AS qty,
       SUM(o.sum_price) AS amt
FROM opitemrece o FORCE INDEX (ix_vstdate)
WHERE o.vstdate BETWEEN ? AND ?
  AND o.qty <> 0
  AND o.icode IN (${Array(n).fill("?").join(", ")})
GROUP BY o.icode, side`;

const DRUG_SQL = `SELECT IF(o.vn IS NOT NULL, 'OP', 'IP') AS side, COUNT(*) AS n_rows, SUM(o.sum_price) AS amt
FROM opitemrece o FORCE INDEX (ix_vstdate)
INNER JOIN income inc ON inc.income = o.income AND inc.drg_chrgitem_id IN (3, 4)
WHERE o.vstdate BETWEEN ? AND ? AND o.qty <> 0
GROUP BY side`;

/** โหลดพร้อมกันทีละกี่เดือน (แต่ละเดือนรัน 2 query ต่อกัน) ; น้อยไว้เพราะ opitemrece ล็อกทั้งตาราง */
const CONCURRENCY = 2;
/** POST ดึงใหม่: ข้อมูลใน cache อายุไม่ถึงค่านี้ใช้ของเดิม กันกดถี่ */
const REFRESH_MIN_AGE_MS = 30_000;
const monthTag = (month: string) => `herbal-usage:${month}`;

type RawItem = { icode: string; name: string | null; units: string | null; istatus: string | null; cat: number | string | null; ttmt: number | string };
type RawUsage = { icode: string; side: Side; n_rows: number | string; n_visit: number | string; qty: number | string | null; amt: number | string | null };
type RawDrug = { side: Side; n_rows: number | string; amt: number | string | null };
type Month = { usage: Omit<UsageRow, "month">[]; drug: Omit<DrugTotalRow, "month">[]; computed_at: string };

async function loadItems(): Promise<HerbalItem[]> {
  const rows = await hisQuery<RawItem>(ITEMS_SQL);
  return rows.map((r) => ({
    icode: String(r.icode),
    name: r.name ?? String(r.icode),
    units: r.units ?? "",
    active: r.istatus === "Y",
    cat: r.cat === null ? null : int(r.cat),
    ttmt: int(r.ttmt) === 1,
  }));
}

// cache ต่อเดือนแบบ dept-trend: เดือนนี้/เดือนก่อน minutes, เดือนก่อนนั้น weeks ; icodes (เรียงแล้ว) อยู่ใน key จึงขึ้นชุดใหม่เองเมื่อห้องยาแก้ธง
async function loadMonth(start: string, end: string, live: boolean, icodes: string[]): Promise<Month> {
  "use cache";
  if (live) cacheLife("minutes");
  else cacheLife("weeks");
  cacheTag(monthTag(start.slice(0, 7)));
  // ต่อกันไม่ขนาน ให้แต่ละครั้งล็อก opitemrece สั้น ; รายการว่างไม่ยิง (IN () ไม่ถูกต้อง)
  const usage = icodes.length ? await hisQuery<RawUsage>(usageSql(icodes.length), [start, end, ...icodes]) : [];
  const drug = await hisQuery<RawDrug>(DRUG_SQL, [start, end]);
  return {
    usage: usage.map((r) => ({ icode: String(r.icode), side: r.side, rows: int(r.n_rows), visits: int(r.n_visit), qty: round2(r.qty), amt: round2(r.amt) })),
    drug: drug.map((r) => ({ side: r.side, rows: int(r.n_rows), amt: round2(r.amt) })),
    computed_at: new Date().toISOString(),
  };
}

/** GET ?fy[&format=xlsx] -> HerbalResponse ของปีงบ (ไม่ส่ง fy = ปีงบปัจจุบัน) */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const today = todayIso();
  const currentFy = fiscalYearOf(today);
  const fy = params.get("fy") ? parseFiscalYear(params.get("fy")!, currentFy) : currentFy;
  if (fy === null) return badRequest("fy ไม่ถูกต้อง");
  const ranges = monthRanges(fy, today);

  try {
    const items = await loadItems();
    const icodes = items.map((i) => i.icode).sort();
    const load = (r: MonthRange) => loadMonth(r.start, r.end, r.live, icodes);
    const loaded: Month[] = [];
    for (let i = 0; i < ranges.length; i += CONCURRENCY) loaded.push(...(await Promise.all(ranges.slice(i, i + CONCURRENCY).map(load))));

    const months = fiscalMonths(fy);
    const report = buildReport(
      months,
      ranges.length,
      items,
      loaded.flatMap((m, i) => m.usage.map((u) => ({ ...u, month: ranges[i].month }))),
      loaded.flatMap((m, i) => m.drug.map((d) => ({ ...d, month: ranges[i].month }))),
    );

    if (params.get("format") === "xlsx") {
      const rows = report.items.map((x) => ({
        icode: x.icode, name: x.name, units: x.units, active: x.active ? "ใช้งาน" : "ปิดใช้", reason: reasons(x).join(", "),
        op_rows: x.op.rows, op_visits: x.op.visits, op_qty: x.op.qty, op_amt: x.op.amt,
        ip_rows: x.ip.rows, ip_visits: x.ip.visits, ip_qty: x.ip.qty, ip_amt: x.ip.amt,
        amt: x.amt, share: x.share === null ? null : round2(x.share),
      }));
      return xlsxResponse(`herbal-usage-${fy}.xlsx`, [
        { key: "icode", header: "รหัส", width: 10 },
        { key: "name", header: "รายการ", width: 40 },
        { key: "units", header: "หน่วย", width: 10 },
        { key: "active", header: "สถานะ", width: 10 },
        { key: "reason", header: "เกณฑ์", width: 14 },
        { key: "op_rows", header: "OP ครั้งที่สั่ง", type: "count" },
        { key: "op_visits", header: "OP visit", type: "count" },
        { key: "op_qty", header: "OP จำนวน", type: "count" },
        { key: "op_amt", header: "OP มูลค่า (บาท)", type: "money" },
        { key: "ip_rows", header: "IP ครั้งที่สั่ง", type: "count" },
        { key: "ip_visits", header: "IP AN-เดือน", type: "count" },
        { key: "ip_qty", header: "IP จำนวน", type: "count" },
        { key: "ip_amt", header: "IP มูลค่า (บาท)", type: "money" },
        { key: "amt", header: "รวมมูลค่า (บาท)", type: "money" },
        { key: "share", header: "สัดส่วนในยาสมุนไพร (%)" },
      ], rows);
    }

    const live = ranges.some((r) => r.live);
    const stamps = loaded.filter((_, i) => !live || ranges[i].live).map((m) => m.computed_at).sort();
    const body: HerbalResponse = {
      ...report,
      fy,
      months,
      loaded: ranges.length,
      complete: ranges.filter((r) => r.complete).length,
      through: ranges.at(-1)?.end ?? today,
      live,
      computed_at: stamps[0] ?? new Date().toISOString(),
    };
    return Response.json(body);
  } catch (e) {
    console.error("drug/herbal-usage", e);
    return Response.json({ error: `อ่านข้อมูลไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}

/** ปุ่ม "ดึงใหม่": ล้าง cache ของเดือนนี้และเดือนก่อน ; revalidateTag เพราะ updateTag ใช้ได้แค่ใน Server Action */
export async function POST() {
  if (!(await isAuthed())) return unauthorized();
  const today = todayIso();
  const cur = today.slice(0, 7);
  try {
    const icodes = (await loadItems()).map((i) => i.icode).sort();
    // cache ว่างจะดึงสดตรงนี้เลย (อายุ ~0) จึงไม่ต้องล้าง
    const { computed_at } = await loadMonth(`${cur}-01`, today, true, icodes);
    if (Date.now() - Date.parse(computed_at) >= REFRESH_MIN_AGE_MS) {
      revalidateTag(monthTag(cur), { expire: 0 });
      revalidateTag(monthTag(prevMonth(cur)), { expire: 0 });
    }
  } catch (e) {
    return Response.json({ error: `ดึงข้อมูลไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
  return Response.json({ ok: true });
}
