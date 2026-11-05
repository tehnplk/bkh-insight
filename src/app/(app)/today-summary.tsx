import type { ReactNode } from "react";
import { connection } from "next/server";
import { auth } from "@/auth";
import { hisQuery } from "@/lib/db";
import { addDaysIso, todayTh } from "@/app/api/visit/opd-visit/opd-visit";

// สรุปวันนี้: ไม่ขึ้นกับ filter ของหน้า (ช่วงวันที่/สิทธิ) เทียบกับวันเดียวกันของสัปดาห์ก่อน "ถึงเวลาเดียวกัน"
// เพราะวันนี้ยังไม่จบวัน ถ้าเทียบทั้งวันจะติดลบเสมอ
// ทุก query ขับจาก index ของวันที่ (วัดบน HIS จริง แต่ละตัวไม่เกิน ~60 ms ไม่นับเวลาเชื่อมต่อ):
//   ovst.ix_vstdate (range 2 วัน) + vn_stat PK, er_regist.ix_vstdate + ovst.vn,
//   ipt.dchdate (range dchdate IS NULL OR >= สัปดาห์ก่อน ~300 แถว), ipt.regdate / ipt.dchdate (2 วัน)

// ผู้ป่วยนอก + ค่าใช้จ่าย (vn_stat.income ตัวเดียวกับตารางสรุปตามสิทธิ จึงตรงกับยอดรวมของวันนี้)
const OPD_SQL = `
  SELECT SUM(o.vstdate = ?) AS visits, SUM(o.vstdate = ?) AS visitsLw,
    SUM(IF(o.vstdate = ?, v.income, 0)) AS income, SUM(IF(o.vstdate = ?, v.income, 0)) AS incomeLw
  FROM ovst o FORCE INDEX (ix_vstdate)
  LEFT JOIN vn_stat v ON v.vn = o.vn
  WHERE o.vstdate IN (?, ?) AND (o.vstdate = ? OR o.vsttime <= ?)`;

// ฉุกเฉิน: visit ที่ลงทะเบียน ER (er_regist) เวลามาจาก ovst.vsttime
const ER_SQL = `
  SELECT SUM(e.vstdate = ?) AS er, SUM(e.vstdate = ?) AS erLw
  FROM er_regist e
  JOIN ovst o ON o.vn = e.vn
  WHERE e.vstdate IN (?, ?) AND (e.vstdate = ? OR o.vsttime <= ?)`;

// ผู้ป่วยในที่นอนอยู่: ตอนนี้ = ยังไม่จำหน่าย, สัปดาห์ก่อน = รับก่อนเวลานั้นและยังไม่จำหน่าย ณ เวลานั้น
const CENSUS_SQL = `
  SELECT SUM(dchdate IS NULL) AS census,
    SUM((regdate < ? OR (regdate = ? AND regtime <= ?))
      AND (dchdate IS NULL OR dchdate > ? OR (dchdate = ? AND dchtime > ?))) AS censusLw
  FROM ipt
  WHERE dchdate IS NULL OR dchdate >= ?`;

const ADMIT_SQL = `
  SELECT SUM(regdate = ?) AS admit, SUM(regdate = ? AND regtime <= ?) AS admitLw
  FROM ipt WHERE regdate IN (?, ?)`;

const DISCHARGE_SQL = `
  SELECT SUM(dchdate = ?) AS discharge, SUM(dchdate = ? AND dchtime <= ?) AS dischargeLw
  FROM ipt WHERE dchdate IN (?, ?)`;

type Num = number | string | null;
const one = async <T,>(sql: string, params: string[]) => (await hisQuery<T>(sql, params))[0];
const n = (v: Num | undefined) => Number(v ?? 0);

type Tile = { key: string; label: string; value: number; lastWeek: number; money?: boolean };

async function loadToday(today: string, lw: string, time: string): Promise<Tile[]> {
  const [opd, er, census, admit, discharge] = await Promise.all([
    one<{ visits: Num; visitsLw: Num; income: Num; incomeLw: Num }>(OPD_SQL, [today, lw, today, lw, today, lw, today, time]),
    one<{ er: Num; erLw: Num }>(ER_SQL, [today, lw, today, lw, today, time]),
    one<{ census: Num; censusLw: Num }>(CENSUS_SQL, [lw, lw, time, lw, lw, time, lw]),
    one<{ admit: Num; admitLw: Num }>(ADMIT_SQL, [today, lw, time, today, lw]),
    one<{ discharge: Num; dischargeLw: Num }>(DISCHARGE_SQL, [today, lw, time, today, lw]),
  ]);
  return [
    { key: "opd", label: "ผู้ป่วยนอก", value: n(opd?.visits), lastWeek: n(opd?.visitsLw) },
    { key: "er", label: "ฉุกเฉิน", value: n(er?.er), lastWeek: n(er?.erLw) },
    { key: "census", label: "ผู้ป่วยในนอนอยู่", value: n(census?.census), lastWeek: n(census?.censusLw) },
    { key: "admit", label: "รับใหม่", value: n(admit?.admit), lastWeek: n(admit?.admitLw) },
    { key: "discharge", label: "จำหน่าย", value: n(discharge?.discharge), lastWeek: n(discharge?.dischargeLw) },
    { key: "income", label: "ค่าใช้จ่ายผู้ป่วยนอก (บาท)", value: n(opd?.income), lastWeek: n(opd?.incomeLw), money: true },
  ];
}

const TZ = "Asia/Bangkok";
const count = new Intl.NumberFormat("th-TH");
const baht = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const signed = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0, signDisplay: "exceptZero" });
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
// "พ. 28 ต.ค." ไม่ต้องมีปี (ห่างกัน 7 วัน)
const weekday = new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

/** ส่วนต่างจากสัปดาห์ก่อน: ค่าใช้จ่ายขึ้น = success ลง = danger ส่วนจำนวนคน (ภาระงาน) ไม่มีทิศที่ดีกว่า จึงเป็นสีจางเสมอ */
function Delta({ tile }: { tile: Tile }) {
  const diff = tile.value - tile.lastWeek;
  const fmt = tile.money ? baht : count;
  const tone = !tile.money || diff === 0 ? "text-muted" : diff > 0 ? "text-success" : "text-danger";
  // ใช้เครื่องหมายลบจริง (U+2212) ให้กว้างเท่า +
  const text = diff === 0 ? "เท่าเดิม" : signed.format(diff).replace("-", "−");
  return (
    <dd className="text-xs text-muted tabular-nums" title={`สัปดาห์ก่อน ${fmt.format(tile.lastWeek)}`}>
      <span className={tone}>{text}</span>
      <span className="sr-only"> จากสัปดาห์ก่อน ({fmt.format(tile.lastWeek)})</span>
    </dd>
  );
}

const GRID = "grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3 lg:grid-cols-6";

function Heading({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <h2 id="today-heading" className="text-title">
        สรุปวันนี้
      </h2>
      {children}
    </div>
  );
}

export async function TodaySummary() {
  await connection(); // อ่าน HIS ตอน request ไม่ใช่ตอน build
  if (!(await auth())) return null; // proxy.ts กั้นแล้ว เช็คซ้ำก่อนอ่าน HIS

  const today = todayTh();
  const lw = addDaysIso(today, -7);
  const time = clock.format(new Date());

  let tiles: Tile[];
  try {
    tiles = await loadToday(today, lw, time);
  } catch (e) {
    // ไม่แสดงข้อความดิบของ driver (อาจมี host/user)
    console.error("today summary query failed", (e as { code?: string }).code ?? e);
    return (
      <section aria-labelledby="today-heading">
        <Heading />
        <p role="alert" className="mt-2 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-danger">
          อ่านสรุปวันนี้จาก HIS ไม่สำเร็จ ลองโหลดหน้าใหม่อีกครั้ง
        </p>
      </section>
    );
  }

  const lwLabel = weekday.format(new Date(`${lw}T00:00:00Z`));
  return (
    <section aria-labelledby="today-heading">
      <Heading>
        <p className="text-sm text-muted tabular-nums">
          ถึง {time.slice(0, 5)} น. เทียบ {lwLabel} เวลาเดียวกัน
        </p>
      </Heading>
      <dl className={`mt-2 ${GRID}`}>
        {tiles.map((t) => (
          <div key={t.key} className="flex flex-col gap-0.5 bg-surface px-3 py-2">
            <dt className="text-sm text-muted">{t.label}</dt>
            <dd className="text-title font-semibold tabular-nums">{(t.money ? baht : count).format(t.value)}</dd>
            <Delta tile={t} />
          </div>
        ))}
      </dl>
    </section>
  );
}

/** โครงเดียวกับแถบจริง (6 ช่อง) ระหว่างรอ HIS หน้าไม่กระโดด */
export function TodaySummarySkeleton() {
  return (
    <section aria-labelledby="today-heading" aria-busy="true">
      <Heading>
        <span className="sr-only">กำลังโหลด</span>
      </Heading>
      <div className={`mt-2 ${GRID}`}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5 bg-surface px-3 py-2">
            <div className="h-3 w-16 animate-pulse rounded bg-hover motion-reduce:animate-none" />
            <div className="h-4 w-12 animate-pulse rounded bg-hover motion-reduce:animate-none" />
            <div className="h-3 w-8 animate-pulse rounded bg-hover motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </section>
  );
}
