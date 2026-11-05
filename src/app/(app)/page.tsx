import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { hisQuery } from "@/lib/db";
import { hipdataGroupOf, hipdataLabel, isPttypeCode, todayTh } from "@/app/api/visit/opd-visit/opd-visit";
import { loadPttypeOptions } from "@/app/api/visit/opd-visit/pttype-options";
import { HomeFilters } from "./home-filters";
import { HomeTabs } from "./home-tabs";
import {
  first,
  MAX_PTTYPES,
  panelId,
  parsePttypes,
  parseTab,
  pickDate,
  pttypeGroups,
  pttypeInSql,
  rangeError,
  type SearchParams,
  tabId,
} from "./home-params";
import { TodaySummary, TodaySummarySkeleton } from "./today-summary";
import { TrendPanel } from "./trend-panel";

export const metadata = { title: "ค่าใช้จ่ายผู้ป่วยนอกตามสิทธิ" };

type Right = { code: string | null; name: string | null; visits: number; income: number };
type Group = { value: string; label: string; visits: number; income: number; rights: Right[] };

const baht = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("th-TH");
const percent = new Intl.NumberFormat("th-TH", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ผลรวมต่อสิทธิในช่วงวันที่: ขับจาก ovst.ix_vstdate (ช่วงไม่เกิน 31 วัน) แล้ว eq_ref pttype, pttype_coverage_group, vn_stat ด้วย PK
//   FORCE INDEX ตามเหตุผลเดียวกับ /api/visit/opd-visit (เดือนเดียว ~36k visit ~0.6 วินาที)
//   กรองสิทธิด้วย IN (placeholder ตามจำนวนรหัส ไม่ส่ง list ว่าง) หลังอ่านช่วงวันที่
//   ชื่อกลุ่มอ่านพร้อมผลรวม จึงมีชื่อแม้สิทธินั้นปิดใช้แล้ว (ไม่อยู่ในตัวเลือกของ filter)
function summarySql(pttypeCount: number) {
  return `
  SELECT o.pttype AS code, t.name, t.hipdata_code AS hipdata, g.pttype_coverage_group_name AS hipdataName,
    COUNT(*) AS visits, COALESCE(SUM(v.income), 0) AS income
  FROM ovst o FORCE INDEX (ix_vstdate)
  LEFT JOIN pttype t ON t.pttype = o.pttype
  LEFT JOIN pttype_coverage_group g ON g.pttype_coverage_group_code = t.hipdata_code
  LEFT JOIN vn_stat v ON v.vn = o.vn
  WHERE o.vstdate BETWEEN ? AND ? ${pttypeInSql(pttypeCount)}
  GROUP BY o.pttype, t.name, t.hipdata_code, g.pttype_coverage_group_name`;
}

/** จัดกลุ่มตาม hipdata_code (กติกาเดียวกับ ?group= ของ opd-visit) เรียงค่าใช้จ่ายมากไปน้อยทั้งกลุ่มและสิทธิในกลุ่ม */
async function loadSummary(from: string, to: string, pttypes: string[]): Promise<Group[]> {
  const rows = await hisQuery<{
    code: string | null;
    name: string | null;
    hipdata: string | null;
    hipdataName: string | null;
    visits: number | string;
    income: number | string;
  }>(summarySql(pttypes.length), [from, to, ...pttypes]);
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const value = hipdataGroupOf(r.hipdata);
    let g = groups.get(value);
    if (!g) groups.set(value, (g = { value, label: hipdataLabel(value, r.hipdataName), visits: 0, income: 0, rights: [] }));
    const right = { code: r.code, name: r.name, visits: Number(r.visits), income: Number(r.income) };
    g.rights.push(right);
    g.visits += right.visits;
    g.income += right.income;
  }
  const byIncome = (a: { income: number; visits: number }, b: { income: number; visits: number }) =>
    b.income - a.income || b.visits - a.visits;
  return [...groups.values()].map((g) => ({ ...g, rights: g.rights.sort(byIncome) })).sort(byIncome);
}

/** link ไปรายชื่อผู้รับบริการ ตาม convention ของ /visit/opd-visit (วันนี้ไม่ใส่ from/to) */
function listHref(from: string, to: string, today: string, filter: [string, string]) {
  const sp = new URLSearchParams();
  if (from !== today) sp.set("from", from);
  if (to !== today) sp.set("to", to);
  sp.set(...filter);
  return `/visit/opd-visit?${sp}`;
}

const NUM = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
// ทั้งแถวกดได้: ::after ของ link ขยายเต็มแถว (tr เป็น relative) ยังเป็น <a> จริงที่ tab/Enter ได้
const ROW_LINK = "after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset";

type Params = Awaited<SearchParams>;

async function Summary({ sp }: { sp: Params }) {
  await connection(); // อ่าน HIS ตอน request ไม่ใช่ตอน build
  // proxy.ts กั้นหน้าแล้ว แต่ส่วนที่อ่าน HIS เช็ค session เองซ้ำ
  if (!(await auth())) redirect("/login?callbackUrl=/");

  const today = todayTh();
  const from = pickDate(sp.from, today);
  const to = pickDate(sp.to, today);
  const pttypes = parsePttypes(sp.pttype);
  const invalid = rangeError(from, to, "day") || (pttypes.length > MAX_PTTYPES ? `เลือกสิทธิได้ไม่เกิน ${MAX_PTTYPES} รายการ` : "");

  // รายการสิทธิอ่านคู่กับผลรวม (คนละ connection ใน pool)
  const optionsPromise = loadPttypeOptions();
  let groups: Group[] = [];
  let loadError = "";
  if (!invalid) {
    try {
      groups = await loadSummary(from, to, pttypes);
    } catch (e) {
      // ไม่แสดงข้อความดิบของ driver (อาจมี host/user)
      console.error("cost summary query failed", (e as { code?: string }).code ?? e);
      loadError = "อ่านข้อมูลจาก HIS ไม่สำเร็จ ลองโหลดหน้าใหม่อีกครั้ง";
    }
  }
  const total = groups.reduce((s, g) => ({ visits: s.visits + g.visits, income: s.income + g.income }), { visits: 0, income: 0 });
  const share = (income: number) => (total.income > 0 ? percent.format(income / total.income) : "–");
  const error = invalid || loadError;
  const options = await optionsPromise;
  const filterGroups = pttypeGroups(options.pttypes, options.groups, pttypes);

  return (
    <>
      <HomeFilters from={from} to={to} pttypes={pttypes} pttypeGroups={filterGroups} today={today} />
      {!error && groups.length > 0 && (
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1">
          <div className="flex items-baseline gap-2">
            <dt className="text-muted">ค่าใช้จ่ายรวม</dt>
            <dd className="text-title tabular-nums">{baht.format(total.income)} บาท</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-muted">จำนวนครั้ง</dt>
            <dd className="text-title tabular-nums">{count.format(total.visits)}</dd>
          </div>
        </dl>
      )}

      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-danger">
          {error}
        </p>
      ) : groups.length === 0 ? (
        <p className="mt-4 text-muted">
          {pttypes.length ? "ไม่มีผู้รับบริการของสิทธิที่เลือกในช่วงวันที่นี้" : "ไม่มีผู้รับบริการในช่วงวันที่นี้"}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full border-collapse">
            <thead className="bg-surface-sunken text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="px-3 py-2 text-left font-medium">สิทธิ</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">จำนวนครั้ง</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">ค่าใช้จ่าย (บาท)</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">สัดส่วน</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.value} className="border-b border-line last:border-b-0">
                <tr className="relative bg-surface-sunken font-semibold hover:bg-hover">
                  <th scope="rowgroup" className="px-3 py-2 text-left font-semibold">
                    <Link href={listHref(from, to, today, ["group", g.value])} className={ROW_LINK}>
                      {g.label}
                    </Link>
                  </th>
                  <td className={NUM}>{count.format(g.visits)}</td>
                  <td className={NUM}>{baht.format(g.income)}</td>
                  <td className={NUM}>{share(g.income)}</td>
                </tr>
                {g.rights.map((r) => {
                  const label = (
                    <>
                      <span className="inline-block w-8 text-muted tabular-nums">{r.code || "–"}</span>
                      {r.name || <span className="text-muted">ไม่ระบุสิทธิ</span>}
                    </>
                  );
                  return (
                    <tr key={r.code ?? ""} className="relative border-t border-line hover:bg-hover">
                      <th scope="row" className="py-2 pr-3 pl-6 text-left font-normal">
                        {r.code && isPttypeCode(r.code) ? (
                          <Link href={listHref(from, to, today, ["pttype", r.code])} className={ROW_LINK}>
                            {label}
                          </Link>
                        ) : (
                          label
                        )}
                      </th>
                      <td className={NUM}>{count.format(r.visits)}</td>
                      <td className={NUM}>{baht.format(r.income)}</td>
                      <td className={`${NUM} text-muted`}>{share(r.income)}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </>
  );
}

const loading = <p className="text-sm text-muted">กำลังโหลด…</p>;

/** แท็บ (?tab=) แสดงทันทีที่อ่าน searchParams ได้ ส่วนข้อมูลของแท็บที่เลือกเท่านั้นที่ query HIS ใน Suspense ชั้นใน */
async function Tabs({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const tab = parseTab(first(sp.tab));
  await connection(); // วันนี้ (href ของแท็บ) ต้องเป็นของ request ไม่ใช่ของตอน prerender
  return (
    <>
      <HomeTabs active={tab} today={todayTh()} />
      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} className="mt-4">
        <Suspense fallback={loading}>{tab === "trend" ? <TrendPanel sp={sp} /> : <Summary sp={sp} />}</Suspense>
      </div>
    </>
  );
}

export default function Home({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="max-w-4xl">
      <h1 className="text-title text-balance">ค่าใช้จ่ายผู้ป่วยนอกตามสิทธิ</h1>
      {/* ไม่ขึ้นกับแท็บ/filter จึงมี Suspense ของตัวเอง แท็บไม่ต้องรอ */}
      <div className="mt-4">
        <Suspense fallback={<TodaySummarySkeleton />}>
          <TodaySummary />
        </Suspense>
      </div>
      <div className="mt-6">
        {/* searchParams, cookie และ HIS ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={loading}>
          <Tabs searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
