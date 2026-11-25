import type { NextRequest } from "next/server";
import { hisQuery, insightQuery } from "@/lib/db";
import type { FdhStatus } from "@/app/api/fdh/claim-batch/claim";
import { loadClaims, type ClaimCand } from "@/app/api/fdh/claim-batch/load";
import { badRequest, inList, isAuthed, parseRange, unauthorized } from "../_lib/fund";
import { fdhByVnSql } from "../_lib/claim";
import { latestRepSql } from "../_lib/rep";
import {
  MAX_DAYS, amountsOf, countSent, hospKey, pivotGroups, sentOf,
  type ArCollectGroup, type ArCollectSummary, type GroupSqlRow, type HospRow, type Num, type PatientType, type SendMode,
} from "./collect";

// SQL ผ่าน prove-query แล้ว (insight/his, 25 พ.ย. 2569) ห้ามเปลี่ยน logic ถ้าไม่ได้ prove ใหม่
// ค่ารักษา = ยอดตั้งหนี้จาก HOSxP (set/adjust/cancel/reverse), ส่วนต่าง = diff ของหนี้, รับแล้ว = settle ทุก source, คงเหลือ = ผลรวมทุกแถวของหนี้
// Q1 ตารางกลุ่ม ($1 start, $2 end)
const GROUPS_SQL = `WITH s AS (
  SELECT patient_type, ref, COALESCE(vn, an) AS k, account_code
  FROM ar_ledger
  WHERE kind = 'set' AND source IN ('rcpt_debt', 'ipt') AND ref_date BETWEEN $1::date AND $2::date
), d AS (
  SELECT s.patient_type, s.k, s.account_code,
    COALESCE(SUM(l.amount) FILTER (WHERE l.source IN ('rcpt_debt', 'ipt') AND l.kind IN ('set', 'adjust', 'cancel', 'reverse')), 0) AS cost,
    COALESCE(SUM(l.amount) FILTER (WHERE l.source IN ('rcpt_debt', 'ipt') AND l.kind = 'diff'), 0) AS diff,
    COALESCE(-SUM(l.amount) FILTER (WHERE l.kind = 'settle'), 0) AS received,
    SUM(l.amount) AS balance
  FROM s JOIN ar_ledger l ON l.patient_type = s.patient_type AND l.ref = s.ref
  GROUP BY s.patient_type, s.k, s.account_code
)
SELECT g.id AS grp, g.name, g.send_mode, d.patient_type,
  COUNT(*) AS visits,
  COUNT(*) FILTER (WHERE d.balance <= 0) AS closed,
  SUM(d.cost) AS cost, SUM(d.cost + d.diff) AS debt, SUM(d.diff) AS diff, SUM(d.received) AS received, SUM(d.balance) AS balance
FROM d
LEFT JOIN ar_account a ON a.code = d.account_code
LEFT JOIN ar_collect_group g ON g.id = a.collect_group
GROUP BY g.id, g.name, g.send_mode, g.sort, d.patient_type
ORDER BY g.sort NULLS LAST, d.patient_type`;
// Q2 ตารางขวาของกลุ่ม ($1 start, $2 end, $3 patient_type, $4 กลุ่ม)
const HOSP_SQL = `WITH s AS (
  SELECT l.patient_type, l.ref, COALESCE(l.vn, l.an) AS k, l.hospmain, l.hipdata_code
  FROM ar_ledger l
  JOIN ar_account a ON a.code = l.account_code
  WHERE l.kind = 'set' AND l.source IN ('rcpt_debt', 'ipt') AND l.ref_date BETWEEN $1::date AND $2::date
    AND l.patient_type = $3 AND a.collect_group = $4
), d AS (
  SELECT s.patient_type, s.k, s.hospmain, s.hipdata_code,
    COALESCE(SUM(l.amount) FILTER (WHERE l.source IN ('rcpt_debt', 'ipt') AND l.kind IN ('set', 'adjust', 'cancel', 'reverse')), 0) AS cost,
    COALESCE(SUM(l.amount) FILTER (WHERE l.source IN ('rcpt_debt', 'ipt') AND l.kind = 'diff'), 0) AS diff,
    COALESCE(-SUM(l.amount) FILTER (WHERE l.kind = 'settle'), 0) AS received,
    SUM(l.amount) AS balance
  FROM s JOIN ar_ledger l ON l.patient_type = s.patient_type AND l.ref = s.ref
  GROUP BY s.patient_type, s.k, s.hospmain, s.hipdata_code
)
SELECT hospmain, hipdata_code, COUNT(*) AS visits, SUM(cost) AS cost, SUM(cost + diff) AS debt, SUM(diff) AS diff,
  COUNT(*) FILTER (WHERE balance <= 0) AS closed, SUM(received) AS received, SUM(balance) AS balance
FROM d GROUP BY hospmain, hipdata_code ORDER BY COUNT(*) DESC, hospmain, hipdata_code`;
// Q4 key ของกลุ่มที่ส่งด้วยสถานะเคลม ($1 start, $2 end, $3 กลุ่ม)
const KEYS_SQL = `SELECT l.patient_type, COALESCE(l.vn, l.an) AS k, l.hospmain, l.hipdata_code
FROM ar_ledger l
JOIN ar_account a ON a.code = l.account_code
WHERE l.kind = 'set' AND l.source IN ('rcpt_debt', 'ipt')
  AND l.ref_date BETWEEN $1::date AND $2::date AND a.collect_group = $3`;
// Q5 ชื่อหน่วยบริการ (his)
const hospSql = (count: number) => `SELECT hospcode, name FROM hospcode WHERE ${inList("hospcode", count)}`;
const REP_SQL = { OP: latestRepSql("seq_no", "vn", "OP"), IP: latestRepSql("an", "an", "IP") } as const;

type Key = { patient_type: PatientType; k: string; hospmain: string | null; hipdata_code: string | null };

/**
 * จำนวน vn/an ที่ส่งเคลมแล้ว (สถานะ "ส่งออกแล้ว" ขึ้นไป) ของกลุ่ม ; อ่านไม่ได้ = undefined
 * สถานะตั้งแต่ exported ขึ้นไปมาจาก STM/REP/ชุดส่งออก/fdh_claim_status เท่านั้น ส่วน fund/date/amount/closed มีผลแค่สถานะที่ต่ำกว่า
 * (ยังไม่ส่ง/รอปิดสิทธิ/เกินกำหนด) จึงใส่ค่าคงที่ได้โดยไม่ต้องอ่าน HOSxP เพิ่ม
 */
async function claimSent(start: string, end: string, grp: number): Promise<Map<string, number> | undefined> {
  try {
    const keys = await insightQuery<Key>(KEYS_SQL, [start, end, grp]);
    const byType = (t: PatientType) => [...new Set(keys.filter((r) => r.patient_type === t).map((r) => r.k))];
    const vns = byType("OP");
    const fdh = vns.length ? await hisQuery<FdhStatus & { k: string }>(fdhByVnSql(vns.length), vns) : [];
    const fdhBy = new Map(fdh.map((f) => [String(f.k), f]));
    const cands = (t: PatientType, ks: string[]): ClaimCand[] =>
      ks.map((k) => ({ k, fund: "", date: null, amount: 0, closed: true, fdh: t === "OP" ? (fdhBy.get(k) ?? null) : null }));
    const [op, ip] = await Promise.all([
      loadClaims("OP", cands("OP", vns), REP_SQL.OP, "vn"),
      loadClaims("IP", cands("IP", byType("IP")), REP_SQL.IP, "an"),
    ]);
    return countSent(keys, (t, k) => (t === "OP" ? op : ip).get(k)?.status);
  } catch (e) {
    console.error("fund/ar-collect claim", e);
    return undefined;
  }
}

type HospSqlRow = Record<"visits" | "closed" | "cost" | "debt" | "diff" | "received" | "balance", Num> & { hospmain: string | null; hipdata_code: string | null };

/**
 * GET ?start&end -> ArCollectSummary (ตารางกลุ่มเรียกเก็บ)
 * GET ?start&end&group=<id> -> ArCollectGroup (hospmain × กองทุน ของ OP และ IP)
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params, MAX_DAYS);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const groupRaw = params.get("group");
  if (groupRaw !== null && !/^\d{1,4}$/.test(groupRaw)) return badRequest("group ไม่ถูกต้อง");

  try {
    if (groupRaw === null) {
      const rows = await insightQuery<GroupSqlRow>(GROUPS_SQL, [start, end]);
      const claimGroups = [...new Set(rows.filter((r) => r.send_mode === "claim" && r.grp != null).map((r) => Number(r.grp)))];
      const counted = new Map<number, Map<string, number>>();
      for (const g of claimGroups) {
        const m = await claimSent(start, end, g);
        if (m) counted.set(g, m);
      }
      const body: ArCollectSummary = { ...pivotGroups(rows, counted), claim_error: claimGroups.length !== counted.size };
      return Response.json(body);
    }

    const grp = Number(groupRaw);
    const [[meta], op, ip] = await Promise.all([
      insightQuery<{ send_mode: SendMode }>("SELECT send_mode FROM ar_collect_group WHERE id = $1", [grp]),
      insightQuery<HospSqlRow>(HOSP_SQL, [start, end, "OP", grp]),
      insightQuery<HospSqlRow>(HOSP_SQL, [start, end, "IP", grp]),
    ]);
    if (!meta) return badRequest("ไม่พบกลุ่มเรียกเก็บนี้");
    const counted = meta.send_mode === "claim" ? await claimSent(start, end, grp) : undefined;
    const codes = [...new Set([...op, ...ip].flatMap((r) => (r.hospmain ? [r.hospmain] : [])))];
    const names = new Map(
      (codes.length ? await hisQuery<{ hospcode: string; name: string | null }>(hospSql(codes.length), codes) : []).map((h) => [h.hospcode, h.name]),
    );
    const toRows = (t: PatientType, rows: HospSqlRow[]): HospRow[] =>
      rows.map((r) => {
        const visits = Number(r.visits ?? 0);
        return {
          hospmain: r.hospmain, hosp_name: r.hospmain ? (names.get(r.hospmain) ?? null) : null, fund: r.hipdata_code,
          visits, closed: Number(r.closed ?? 0), ...amountsOf(r),
          sent: sentOf(meta.send_mode, visits, counted && (counted.get(hospKey(t, r.hospmain, r.hipdata_code)) ?? 0)),
        };
      });
    const body: ArCollectGroup = { grp, OP: toRows("OP", op), IP: toRows("IP", ip), claim_error: meta.send_mode === "claim" && !counted };
    return Response.json(body);
  } catch (e) {
    console.error("fund/ar-collect", e);
    return Response.json({ error: `อ่านข้อมูลไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
