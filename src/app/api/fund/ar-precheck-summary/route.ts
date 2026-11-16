import { cacheLife } from "next/cache";
import type { NextRequest } from "next/server";
import { hisQuery, insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { badRequest, fundOf, isAuthed, loadLookups, parseRange, unauthorized } from "../_lib/fund";
import { buildRows, isMismatch, type Booked, type PrecheckSource, type PrecheckType, type RxSum } from "../ar-precheck/precheck";
import { summarizePanel, type SummaryPanel, type SummaryResponse } from "./summary";

// shortcut: SQL คัดลอกจาก ar-precheck/route.ts (ตัดชื่อ/HN) เพราะห้ามแตะหน้านั้นระหว่างมีงานค้าง, รวมเป็น loader เดียวเมื่องาน ar-precheck commit แล้ว
type Num = string | null;
type StatCols = { has_stat: number; income: Num; paid_money: Num; rcpt_money: Num; uc_money: Num };
const CHUNK = 1_000;

// opitemrece เป็น MyISAM: ห้ามเพิ่ม JOIN/ORDER BY ในคิวรีรวมยอด (ล็อกตารางนาน)
const RX_COLS = `COUNT(*) AS n_items, SUM(sum_price) AS rx_total,
  SUM(IF(paidst IN ('00','01','03'), sum_price, 0)) AS rx_pay, SUM(IF(paidst = '02', sum_price, 0)) AS rx_debt`;
// PPFS = ลูกหนี้สิทธิหมวดส่งเสริมป้องกัน (income 21) ลงบัญชี .209 แยกจากลูกหนี้ค่ารักษา
const OP_RX = `SELECT vn AS \`key\`, ${RX_COLS},
  SUM(IF(paidst = '02' AND income = '21', sum_price, 0)) AS rx_pp
FROM opitemrece FORCE INDEX (ix_vstdate) WHERE vstdate BETWEEN ? AND ? AND vn IS NOT NULL GROUP BY vn`;
const OP_VISITS = `SELECT o.vn, o.vstdate, o.pttype, NULLIF(o.an, '') AS an, o.finance_lock,
  vs.vn IS NOT NULL AS has_stat, vs.income, vs.paid_money, vs.rcpt_money, vs.uc_money,
  (SELECT SUM(r.amount) FROM rcpt_debt r WHERE r.vn = o.vn AND (r.status IS NULL OR r.status <> 'ABORT')) AS debt_amount
FROM ovst o LEFT JOIN vn_stat vs ON vs.vn = o.vn
WHERE o.vstdate BETWEEN ? AND ?`;
const IP_ADMITS = `SELECT i.an, i.regdate, i.dchdate, i.pttype, i.finance_lock,
  s.an IS NOT NULL AS has_stat, s.income, s.paid_money, s.rcpt_money, s.uc_money
FROM ipt i LEFT JOIN an_stat s ON s.an = i.an
WHERE i.dchdate BETWEEN ? AND ?`;
const ipRx = (n: number) =>
  `SELECT an AS \`key\`, ${RX_COLS} FROM opitemrece FORCE INDEX (ix_an) WHERE an IN (${Array(n).fill("?").join(", ")}) GROUP BY an`;
// สมุดลูกหนี้ใช้แค่ให้สถานะ "ปรับปรุงในสมุดแล้ว" (stale_fixed) ของ OPD ตรงกับหน้า ar-precheck ที่ลิงก์ไป ; IPD ไม่ใช้
const LEDGER_OPD = `SELECT s.vn AS key,
  SUM(x.amount) FILTER (WHERE x.source = s.source) AS booked,
  SUM(x.amount) AS balance
FROM ar_ledger s JOIN ar_ledger x ON x.patient_type = s.patient_type AND x.ref = s.ref
WHERE s.kind = 'set' AND s.source = 'rcpt_debt' AND s.vn = ANY($1::text[])
GROUP BY s.vn`;

async function chunked<T>(keys: string[], run: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += CHUNK) out.push(...(await run(keys.slice(i, i + CHUNK))));
  return out;
}

async function panel(type: PrecheckType, start: string, end: string, today: string): Promise<SummaryPanel> {
  const lk = await loadLookups();
  const base = (pttype: string | null) => {
    const fund = fundOf(lk, pttype);
    return { pttype, pttype_name: "", fund, fund_name: lk.fundName(fund), hn: "", patient_name: "" };
  };

  let sources: PrecheckSource[];
  let rx: RxSum[];
  let booked: Booked[] | null = null;
  const pp = new Map<string, Num>();
  if (type === "opd") {
    const [items, visits] = await Promise.all([
      hisQuery<RxSum & { rx_pp: Num }>(OP_RX, [start, end]),
      hisQuery<StatCols & { vn: string; vstdate: string; pttype: string | null; an: string | null; finance_lock: string | null; debt_amount: Num }>(OP_VISITS, [start, end]),
    ]);
    rx = items;
    for (const r of items) pp.set(r.key, r.rx_pp);
    sources = visits.map(({ vn, vstdate, pttype, ...r }) => ({ ...r, ...base(pttype), key: vn, vn, date: String(vstdate).slice(0, 10), regdate: null }));
    try {
      booked = await chunked(sources.map((s) => s.key), (part) => insightQuery<Booked>(LEDGER_OPD, [part]));
    } catch (e) {
      // อ่านสมุดไม่ได้ ใบค้างหลัง admit ที่ปรับปรุงแล้วจะนับเป็นไม่ตรง (เหมือน ar-precheck ตอนอ่านสมุดไม่ได้)
      console.error("ar-precheck-summary: ledger", e);
    }
  } else {
    const admits = await hisQuery<StatCols & { an: string; regdate: string | null; dchdate: string; pttype: string | null; finance_lock: string | null }>(IP_ADMITS, [start, end]);
    rx = await chunked(admits.map((a) => a.an), (part) => hisQuery<RxSum>(ipRx(part.length), part));
    sources = admits.map(({ dchdate, regdate, pttype, ...r }) => ({
      ...r, ...base(pttype), key: r.an, vn: null, date: String(dchdate).slice(0, 10), regdate: regdate ? String(regdate).slice(0, 10) : null, debt_amount: null,
    }));
  }

  const rows = buildRows(type, sources, rx, booked, today);
  return summarizePanel(
    rows.map((r) => ({
      fund: r.fund, fund_name: r.fund_name, rx_total: r.rx_total, rx_pay: r.rx_pay,
      income: r.income, paid_money: r.paid_money, rcpt_money: r.rcpt_money,
      pp: Number(pp.get(r.key) ?? 0), mismatch: isMismatch(r.status),
    })),
  );
}

// HOSxP เปลี่ยนตลอดวัน จึง cache สั้น (ราว 1 นาที) เหมือน ar-precheck
async function load(start: string, end: string, today: string): Promise<SummaryResponse> {
  "use cache";
  cacheLife("minutes");
  const [opd, ipd] = await Promise.all([panel("opd", start, end, today), panel("ipd", start, end, today)]);
  return { opd, ipd };
}

export async function GET(request: NextRequest) {
  // auth อ่าน cookie จึงเช็คนอกฟังก์ชันที่ cache
  if (!(await isAuthed())) return unauthorized();
  const range = parseRange(request.nextUrl.searchParams);
  if (!range.ok) return badRequest(range.error);
  return Response.json(await load(range.range.start, range.range.end, todayIso()));
}
