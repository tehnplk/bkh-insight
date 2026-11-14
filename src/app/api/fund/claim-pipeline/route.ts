import type { NextRequest } from "next/server";
import { hisQuery, insightQuery } from "@/lib/db";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type GridPage, type RowGetters } from "@/lib/grid-query";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import { CLAIM_JOINS, STATUS_SQL } from "../_lib/claim";
import { badRequest, inList, isAuthed, loadLookups, parseRange, pttypeName, unauthorized } from "../_lib/fund";
import {
  GROUPS, REASON_LABEL, STEP_LABEL, classify, inGroup, matches, sortRows, summarize,
  type Funnel, type Group, type HisCase, type PipelineRow, type PipelineType, type RepLatest, type SortKey,
} from "./pipeline";

/** response ของ GET /api/fund/claim-pipeline: รายชื่อของกลุ่มที่เลือก + funnel ของทั้งช่วง (ก่อนค้นหา/กรอง/เลือกกลุ่ม) */
export type ClaimPipelinePage = GridPage<PipelineRow> & { summary: Funnel };

const SORTABLE = ["key", "hn", "date", "pttype_name", "debtor", "step", "codes", "compensation", "stm_paid", "days"] as const satisfies readonly SortKey[];
const FILTER_GET = { pttype_name: (r) => r.pttype_name, codes: (r) => r.codes } satisfies RowGetters<PipelineRow, string>;
type FilterKey = keyof typeof FILTER_GET;
const FILTERABLE = Object.keys(FILTER_GET) as FilterKey[];
// array ระดับหมื่นใน param เดียวได้ แต่แบ่งไว้กัน query ใหญ่เกิน (prove-query)
const CHUNK = 5_000;
const num = (v: string | number | null) => (v == null ? null : Number(v));

async function loadHis(type: PipelineType, start: string, end: string, codes: string[]): Promise<Omit<HisCase, "pttype_name">[]> {
  if (type === "op") {
    // ยอดลูกหนี้สิทธิ (paidst 02) ต่อ vn สรุปจาก opitemrece ด้วย ix_vstdate ก่อน join ovst (MyISAM)
    const rows = await hisQuery<{ vn: string; hn: string; vstdate: string; pttype: string | null; amt: string; status: HisCase["claim"] }>(
      `SELECT o.vn, o.hn, o.vstdate, o.pttype, x.amt, ${STATUS_SQL} AS status
       FROM (SELECT vn, SUM(sum_price) AS amt FROM opitemrece FORCE INDEX (ix_vstdate)
             WHERE vstdate BETWEEN ? AND ? AND vn IS NOT NULL AND paidst = '02'
             GROUP BY vn HAVING SUM(sum_price) > 0) x
       JOIN ovst o ON o.vn = x.vn
       ${CLAIM_JOINS}
       WHERE ${inList("o.pttype", codes.length)}`,
      [start, end, ...codes],
    );
    return rows.map((r) => ({ key: r.vn, hn: r.hn, date: String(r.vstdate).slice(0, 10), pttype: r.pttype, debtor: Number(r.amt), claim: r.status }));
  }
  const rows = await hisQuery<{ an: string; hn: string; dchdate: string; pttype: string | null; finance_lock: string | null; uc_money: string | null }>(
    `SELECT i.an, i.hn, i.dchdate, i.pttype, i.finance_lock, s.uc_money
     FROM ipt i LEFT JOIN an_stat s ON s.an = i.an
     WHERE i.dchdate BETWEEN ? AND ? AND ${inList("i.pttype", codes.length)}`,
    [start, end, ...codes],
  );
  return rows.map((r) => ({
    key: r.an, hn: r.hn, date: String(r.dchdate).slice(0, 10), pttype: r.pttype, debtor: num(r.uc_money),
    claim: r.finance_lock === "Y" ? "closed" : "unlocked",
  }));
}

// REP ฝั่ง main_inscl ไม่ตรงกับกองทุนใน HOSxP จึงไม่กรองกองทุนฝั่ง REP จับด้วย VN/AN เท่านั้น ; col/pt มาจากค่าคงที่ในโค้ด
const REP_SQL = (col: "seq_no" | "an", pt: "OP" | "IP") => `SELECT DISTINCT ON (r.${col}) r.${col} AS key, r.rep_no, r.error_codes, r.deny, r.net_nhso, r.net_affiliation,
  CASE WHEN cardinality(r.error_codes) = 0 THEN 'a' WHEN 'DENY' = ANY(r.error_codes) THEN 'deny' ELSE 'c' END AS status
FROM rep_row r JOIN rep_file f ON f.id = r.rep_file_id
WHERE r.patient_type = '${pt}' AND r.${col} = ANY($1::text[])
ORDER BY r.${col}, r.tran_id::bigint DESC`;
// เงินเข้าต่อ VN/AN (ติดลบได้ = เรียกคืน) ; STM UC ยุคแรกไม่มี seq_no จึงจับผ่าน rep_row ด้วย tran_id
const STM_SQL = {
  op: `SELECT key, sum(paid) AS paid FROM (
  SELECT r.seq_no AS key, sum(r.paid_total) AS paid
  FROM stm_row r JOIN stm_file f ON f.id = r.stm_file_id
  WHERE f.patient_type = 'OP' AND r.seq_no = ANY($1::text[]) GROUP BY r.seq_no
  UNION ALL
  SELECT rr.seq_no, sum(r.paid_total)
  FROM stm_row r JOIN stm_file f ON f.id = r.stm_file_id JOIN rep_row rr ON rr.tran_id = r.tran_id
  WHERE f.patient_type = 'OP' AND NULLIF(r.seq_no, '') IS NULL AND rr.seq_no = ANY($1::text[]) GROUP BY rr.seq_no
) u GROUP BY key`,
  ip: `SELECT r.an AS key, sum(r.paid_total) AS paid
FROM stm_row r JOIN stm_file f ON f.id = r.stm_file_id
WHERE f.patient_type = 'IP' AND r.an = ANY($1::text[]) GROUP BY r.an`,
};

async function byChunks<T>(sql: string, keys: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += CHUNK) out.push(...(await insightQuery<T>(sql, [keys.slice(i, i + CHUNK)])));
  return out;
}

async function load(type: PipelineType, start: string, end: string, codes: string[], names: (p: string | null) => string): Promise<PipelineRow[]> {
  const [cases, [files]] = await Promise.all([
    loadHis(type, start, end, codes),
    insightQuery<{ op: string | null; ip: string | null }>(
      "SELECT max(file_date) FILTER (WHERE rep_type = 'OP')::text AS op, max(file_date) FILTER (WHERE rep_type = 'IP')::text AS ip FROM rep_file",
    ),
  ]);
  const keys = cases.map((c) => c.key);
  const [reps, stm] = keys.length
    ? await Promise.all([
        byChunks<RepLatest & { key: string }>(type === "op" ? REP_SQL("seq_no", "OP") : REP_SQL("an", "IP"), keys),
        byChunks<{ key: string; paid: string }>(STM_SQL[type], keys),
      ])
    : [[], []];
  const repBy = new Map(reps.map((r) => [r.key, r]));
  const paidBy = new Map(stm.map((s) => [s.key, Number(s.paid)]));
  const ctx = { today: todayIso(), repFileDate: files?.[type] ?? null };
  return cases.map((c) => classify(type, { ...c, pttype_name: names(c.pttype) }, repBy.get(c.key), paidBy.get(c.key), ctx));
}

// opitemrece เป็น MyISAM (อ่านนานล็อกการบันทึกของ HOSxP) เปลี่ยนหน้า/เรียง/ค้นหา/กรองของ grid จึงใช้ผลชุดล่าสุดซ้ำ 60 วินาที
// เก็บเป็น promise ให้คำขอที่มาพร้อมกัน (หน้า + facet) อ่านฐานครั้งเดียว
const CACHE_MS = 60_000;
let cached: { key: string; at: number; rows: Promise<PipelineRow[]> } | null = null;

function loadCached(...args: Parameters<typeof load>) {
  const key = args.slice(0, 4).join("|");
  if (cached?.key === key && Date.now() - cached.at < CACHE_MS) return cached.rows;
  const rows = load(...args);
  const entry = { key, at: Date.now(), rows };
  cached = entry;
  rows.catch(() => {
    if (cached === entry) cached = null;
  });
  return rows;
}

const XLSX_COLUMNS = (type: PipelineType): XlsxColumn<PipelineRow & { stage: string }>[] => [
  { key: "key", header: type === "op" ? "VN" : "AN", width: 14 },
  { key: "hn", header: "HN", width: 10 },
  { key: "date", header: type === "op" ? "วันที่รับบริการ" : "วันจำหน่าย", width: 12 },
  { key: "pttype_name", header: "สิทธิ", width: 28 },
  { key: "debtor", header: "ลูกหนี้สิทธิ (บาท)", width: 14, type: "money" },
  { key: "stage", header: "ขั้นที่ไปถึง/สาเหตุ", width: 24 },
  { key: "rep_no", header: "REP", width: 14 },
  { key: "codes", header: "รหัส C/Deny", width: 16 },
  { key: "compensation", header: "REP ชดเชยสุทธิ (บาท)", width: 14, type: "money" },
  { key: "stm_paid", header: "เงินเข้า STM (บาท)", width: 14, type: "money" },
  { key: "days", header: "วันนับจากบริการ", width: 10, type: "count" },
];

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const typeRaw = params.get("type") || "op";
  if (typeRaw !== "op" && typeRaw !== "ip") return badRequest("type ต้องเป็น op หรือ ip");
  const type: PipelineType = typeRaw;
  const stage = params.get("stage") || null;
  if (stage && !(GROUPS as readonly string[]).includes(stage)) return badRequest(`stage ได้เฉพาะ: ${GROUPS.join(", ")}`);
  const grid = parseGridQuery<SortKey>(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters<FilterKey>(params, FILTERABLE);
  if (!cf.ok) return badRequest(cf.error);
  const { filters, facet, facetQ } = cf.query;

  const lk = await loadLookups();
  const fund = params.get("fund") || "UCS";
  // fund ใช้เลือก pttype ในโค้ดเท่านั้น ไม่เข้า SQL ; ไม่มี pttype ของกองทุนนี้ = ค่าไม่ถูกต้อง (และกัน IN ว่าง)
  const codes = [...lk.pttype].filter(([, p]) => p.fund === fund).map(([c]) => c);
  if (!codes.length) return badRequest("ไม่พบกองทุนนี้");

  const all = await loadCached(type, start, end, codes, (p) => pttypeName(lk, p));
  const inStage = (stage ? all.filter((r) => inGroup(r, stage as Group)) : all).filter((r) => !q || matches(r, q));
  if (facet) return Response.json(facetRows(filterRows(inStage, filters, FILTER_GET, facet), FILTER_GET[facet], facetQ));
  const rows = sortRows(filterRows(inStage, filters, FILTER_GET), sort ?? "date", dir);

  if (format === "xlsx") {
    const out = rows.map((r) => ({ ...r, stage: r.reason ? REASON_LABEL[r.reason] : STEP_LABEL[type][r.step] }));
    return xlsxResponse(`claim-pipeline-${type}-${fund}-${start}_${end}.xlsx`, XLSX_COLUMNS(type), out);
  }
  const body: ClaimPipelinePage = { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, summary: summarize(all) };
  return Response.json(body);
}
