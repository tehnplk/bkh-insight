import type { NextRequest } from "next/server";
import { cacheLife, cacheTag } from "next/cache";
import { hisQuery, insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { badRequest, inList, isAuthed, loadLookups, unauthorized } from "../_lib/fund";
import { mergeDebtors, type LatestRep } from "../uc-debtor/debtor";
import {
  FY_BACK, UC_DASHBOARD_TAG, aggregate, fiscalYearOf, fiscalYearRange, parseFiscalYear,
  type DashRow, type ErrorInfo, type UcDashboard,
} from "./dashboard";

type Debtor = { key: string; date: string; debtor: number };
type Rep = { comp: string; error_codes: string[] };
type Num = string | null;

// REP ล่าสุด (tran_id มากสุด) ต่อ visit/admission ในช่วงปีงบ ชดเชย = net_nhso + net_affiliation (กฎเดียวกับ compensationOf)
const OPD_REP = `SELECT DISTINCT ON (seq_no) seq_no, (net_nhso + COALESCE(net_affiliation, 0)) AS comp, error_codes FROM rep_row
WHERE patient_type = 'OP' AND seq_no IS NOT NULL AND admit_at >= $1::date AND admit_at < ($2::date + 1) ORDER BY seq_no, tran_id::bigint DESC`;
const IPD_REP = `SELECT DISTINCT ON (an) an, (net_nhso + COALESCE(net_affiliation, 0)) AS comp, error_codes FROM rep_row
WHERE patient_type = 'IP' AND an IS NOT NULL AND discharge_at >= $1::date AND discharge_at < ($2::date + 1) ORDER BY an, tran_id::bigint DESC`;
const latest = (cols: string) => `WITH latest AS ((SELECT DISTINCT ON (seq_no) ${cols} FROM rep_row WHERE patient_type = 'OP' AND seq_no IS NOT NULL AND admit_at >= $1::date AND admit_at < ($2::date + 1) ORDER BY seq_no, tran_id::bigint DESC) UNION ALL (SELECT DISTINCT ON (an) ${cols} FROM rep_row WHERE patient_type = 'IP' AND an IS NOT NULL AND discharge_at >= $1::date AND discharge_at < ($2::date + 1) ORDER BY an, tran_id::bigint DESC))`;
// ยอดรวม fund_amounts ต่างจาก net_nhso ราว 0.2% จึงไม่อ้างว่าเท่ากัน
const FUNDS = `${latest("fund_amounts")} SELECT e.key AS fund_key, SUM(e.value::numeric) AS amount FROM latest, jsonb_each_text(latest.fund_amounts) AS e WHERE e.key NOT LIKE 'base rate%' GROUP BY e.key ORDER BY amount DESC`;
const AFFILIATION = `${latest("net_nhso, net_affiliation")} SELECT COUNT(*) AS n, SUM(net_nhso) AS nhso, SUM(net_affiliation) AS affiliation FROM latest`;

// rep_no ไม่ได้ใช้ในภาพรวม ชดเชยคำนวณใน SQL แล้วจึงส่งเป็น net_nhso
const toRep = (key: string, r: Rep): LatestRep => ({ key, rep_no: "", net_nhso: r.comp, net_affiliation: null, error_codes: r.error_codes });

async function loadDebtors(start: string, end: string) {
  const lk = await loadLookups();
  const codes = [...lk.pttype].filter(([, p]) => p.fund === "UCS").map(([c]) => c);
  if (!codes.length) return { opd: [], ipd: [] };
  const [opd, ipd] = await Promise.all([
    hisQuery<{ vn: string; vstdate: string; uc_money: string }>(
      `SELECT s.vn, s.vstdate, s.uc_money FROM vn_stat s WHERE s.vstdate BETWEEN ? AND ? AND ${inList("s.pttype", codes.length)} AND s.uc_money > 0`,
      [start, end, ...codes],
    ),
    hisQuery<{ an: string; dchdate: string; uc_money: string }>(
      `SELECT i.an, i.dchdate, a.uc_money FROM ipt i JOIN an_stat a ON a.an = i.an WHERE i.dchdate BETWEEN ? AND ? AND ${inList("i.pttype", codes.length)} AND a.uc_money > 0`,
      [start, end, ...codes],
    ),
  ]);
  return {
    opd: opd.map<Debtor>((r) => ({ key: r.vn, date: String(r.vstdate).slice(0, 10), debtor: Number(r.uc_money) })),
    ipd: ipd.map<Debtor>((r) => ({ key: r.an, date: String(r.dchdate).slice(0, 10), debtor: Number(r.uc_money) })),
  };
}

/** ปีงบของ REP ล่าสุด (admit_at มากสุด) null = ยังไม่มี REP */
async function latestRepFy(): Promise<number | null> {
  "use cache";
  cacheTag(UC_DASHBOARD_TAG);
  cacheLife("hours");
  const [row] = await insightQuery<{ latest: string | null }>("SELECT MAX(admit_at)::date AS latest FROM rep_row");
  return row?.latest ? fiscalYearOf(row.latest) : null;
}

// ทั้งปีงบ (OPD ~158k แถว) จับคู่ในหน่วยความจำราว 2-4 วินาที จึง cache ผลสรุปต่อ (fy, วันนี้) ราว 1 ชั่วโมง
// ข้อมูล HOSxP ของปีงบปัจจุบันเปลี่ยนทุกวัน จึงช้าได้ไม่เกินอายุ cache ส่วน REP ล้างทันทีหลังนำเข้า
async function loadDashboard(fy: number, today: string): Promise<UcDashboard> {
  "use cache";
  cacheTag(UC_DASHBOARD_TAG);
  cacheLife("hours");
  const { start, end } = fiscalYearRange(fy, today);
  const range = [start, end];
  const [debtors, opdReps, ipdReps, funds, [aff]] = await Promise.all([
    loadDebtors(start, end),
    insightQuery<Rep & { seq_no: string }>(OPD_REP, range),
    insightQuery<Rep & { an: string }>(IPD_REP, range),
    insightQuery<{ fund_key: string; amount: Num }>(FUNDS, range),
    insightQuery<{ n: Num; nhso: Num; affiliation: Num }>(AFFILIATION, range),
  ]);
  const rows: { opd: DashRow[]; ipd: DashRow[] } = {
    opd: mergeDebtors(debtors.opd, opdReps.map((r) => toRep(r.seq_no, r))),
    ipd: mergeDebtors(debtors.ipd, ipdReps.map((r) => toRep(r.an, r))),
  };
  const agg = aggregate(rows, fy, today);

  const codes = agg.errors.map((e) => e.code);
  const info = codes.length
    ? await insightQuery<ErrorInfo & { code: string }>(
        "SELECT code, kind, description, fix, source FROM rep_error_code WHERE code = ANY($1::text[])",
        [codes],
      )
    : [];
  const byCode = new Map(info.map((i) => [i.code, i]));
  const currentFy = fiscalYearOf(today);

  return {
    fy,
    fyOptions: Array.from({ length: FY_BACK + 1 }, (_, i) => currentFy - i),
    start,
    end,
    today,
    generatedAt: new Date().toISOString(),
    hasRep: opdReps.length + ipdReps.length > 0,
    ...agg,
    errors: agg.errors.map((e) => {
      const i = byCode.get(e.code);
      return { ...e, kind: i?.kind ?? null, description: i?.description ?? null, fix: i?.fix ?? null };
    }),
    funds: funds.map((f) => ({ key: f.fund_key, amount: Number(f.amount ?? 0) })),
    affiliation: Number(aff?.affiliation ?? 0),
  };
}

export async function GET(request: NextRequest) {
  // auth อ่าน cookie จึงเช็คนอกฟังก์ชันที่ cache
  if (!(await isAuthed())) return unauthorized();
  const today = todayIso();
  const currentFy = fiscalYearOf(today);
  const raw = request.nextUrl.searchParams.get("fy");
  let fy: number;
  if (raw) {
    const parsed = parseFiscalYear(raw, currentFy);
    if (parsed === null) return badRequest(`fy ต้องเป็นปีงบ พ.ศ. ${currentFy - FY_BACK}–${currentFy}`);
    fy = parsed;
  } else {
    const latestFy = await latestRepFy();
    // REP ล่าสุดเก่าเกินช่วงที่เลือกได้ = ใช้ปีงบปัจจุบัน
    fy = latestFy && parseFiscalYear(String(latestFy), currentFy) ? latestFy : currentFy;
  }
  return Response.json(await loadDashboard(fy, today));
}
