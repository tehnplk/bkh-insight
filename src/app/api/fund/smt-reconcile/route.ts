import type { NextRequest } from "next/server";
import { cacheLife } from "next/cache";
import { hisQuery, insightQuery } from "@/lib/db";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type GridPage, type RowGetters } from "@/lib/grid-query";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { badRequest, isAuthed, unauthorized } from "../_lib/fund";
import { fiscalYearOf, parseFiscalYear } from "../uc-dashboard/dashboard";
import {
  STATUS_LABEL, reconcile, summarize, toLine,
  type ReconcileRow, type ReconcileStatus, type ReconcileSummary, type SmtApiRow, type SmtLine, type StmFileInput,
} from "./reconcile";

export type SmtReconcilePage = GridPage<ReconcileRow> & { summary: ReconcileSummary; smt_error: string | null };

// SMT ของ สปสช. เป็น API สาธารณะ (ไม่ต้อง login) หนึ่ง request คืนทุกรายการโอนในช่วงวันที่ (budgetYear ไม่มีผล กรองด้วยวันที่โอนเท่านั้น)
const SMT_URL = "https://smt.nhso.go.th/smtf/api/budgetreport/budgetSummaryByVendorReport/search";
const SMT_TIMEOUT_MS = 20_000;

const SORTABLE = ["key", "period_month", "patient_type", "smt_date", "smt_total", "stm_doc", "stm_total", "diff", "status"] as const;
const FILTER_GET = {
  key: (r) => r.key,
  period_month: (r) => r.period_month,
  patient_type: (r) => r.patient_type,
  stm_doc: (r) => r.stm_doc,
  status: (r) => r.status,
} satisfies RowGetters<ReconcileRow, string>;
type FilterKey = keyof typeof FILTER_GET;
const FILTERABLE = Object.keys(FILTER_GET) as FilterKey[];

/** "2026-11-19" -> "19/11/2569" (รูปแบบวันที่ของ SMT) */
const beDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${+iso.slice(0, 4) + 543}`;

// รายการโอนสิทธิ UC ทั้งปีงบ fy ถึงสิ้นปีงบถัดไป (โอนเพิ่ม/อุทธรณ์ของงวดปีนี้มาถึงปีหน้า) ใช้ราว 2-3 วินาที
// cache สั้น (cacheLife "minutes") แค่กันยิงซ้ำตอนเรียง/กรอง/เปลี่ยนหน้า error ไม่ถูก cache
async function loadSmt(fy: number, end: string): Promise<SmtLine[]> {
  "use cache";
  cacheLife("minutes");
  const [cfg] = await hisQuery<{ hospitalcode: string | null }>("SELECT hospitalcode FROM opdconfig LIMIT 1");
  const hcode = String(cfg?.hospitalcode ?? "").trim();
  if (!/^\d{5}$/.test(hcode)) throw new Error("ไม่พบรหัสหน่วยบริการ (opdconfig.hospitalcode)");
  const res = await fetch(SMT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vendorSearchConditionCode: "2", vendorId5Digit: hcode, budgetSource: "UC", budgetYear: "",
      transferStartDate: `01/10/${fy - 1}`, transferEndDate: beDate(end), hospType: "", isTest: "",
    }),
    signal: AbortSignal.timeout(SMT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`SMT ตอบ HTTP ${res.status}`);
  const body = (await res.json()) as { status?: string; datas?: SmtApiRow[] };
  if (body.status !== "success" || !Array.isArray(body.datas)) throw new Error("SMT ตอบรูปแบบที่ไม่รู้จัก");
  return body.datas.map(toLine);
}

const STM_SQL = `SELECT doc_no, patient_type, period_month, run_no, transfer_date, net_total
FROM stm_file
WHERE scheme = 'UCS' AND period_month BETWEEN $1 AND $2
ORDER BY period_month, patient_type, run_no`;

function sortRows(rows: ReconcileRow[], sort: (typeof SORTABLE)[number], dir: "asc" | "desc") {
  const sign = dir === "desc" ? -1 : 1;
  return rows.toSorted((a, b) => {
    const x = a[sort], y = b[sort];
    if (x === y) return a.key.localeCompare(b.key);
    if (x === null) return 1; // ว่างไว้ท้ายเสมอ
    if (y === null) return -1;
    return sign * (typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y)));
  });
}

const matches = (r: ReconcileRow, q: string) =>
  [r.key, r.stm_doc, r.batches, ...r.lines.map((l) => l.ref)].some((v) => v?.toLowerCase().includes(q.toLowerCase()));

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const today = todayIso();
  const currentFy = fiscalYearOf(today);
  const fy = params.get("fy") ? parseFiscalYear(params.get("fy")!, currentFy) : currentFy;
  if (fy === null) return badRequest("fy ไม่ถูกต้อง");
  const grid = parseGridQuery(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters<FilterKey>(params, FILTERABLE);
  if (!cf.ok) return badRequest(cf.error);
  const { filters, facet, facetQ } = cf.query;

  const nextFyEnd = `${fy - 542}-09-30`;
  const [smt, files] = await Promise.all([
    loadSmt(fy, nextFyEnd < today ? nextFyEnd : today).then(
      (lines) => ({ lines, error: null }),
      (e: Error) => ({ lines: [] as SmtLine[], error: `ดึงข้อมูล SMT ไม่สำเร็จ: ${e.name === "TimeoutError" ? "หมดเวลารอ" : e.message}` }),
    ),
    insightQuery<StmFileInput>(STM_SQL, [`${fy - 544}-10-01`, `${fy - 543}-09-01`]),
  ]);

  const all = reconcile(smt.lines, files, fy).filter((r) => !q || matches(r, q));
  if (facet) {
    return Response.json(facetRows(filterRows(all, filters, FILTER_GET, facet), FILTER_GET[facet], facetQ, facet === "status" ? (v) => STATUS_LABEL[v as ReconcileStatus] ?? v : undefined));
  }
  const rows = sortRows(filterRows(all, filters, FILTER_GET), sort ?? "key", sort ? dir : "asc");

  if (format === "xlsx") {
    return xlsxResponse(
      `smt-reconcile-${fy}.xlsx`,
      [
        { key: "key", header: "งวด", width: 12 },
        { key: "patient_type", header: "OP/IP", width: 8 },
        { key: "smt_date", header: "วันที่โอนล่าสุด (SMT)", width: 14 },
        { key: "batches", header: "ชุดโอน (SMT)", width: 20 },
        { key: "smt_total", header: "ยอดโอน SMT (บาท)", width: 16, type: "money" },
        { key: "stm_doc", header: "เลขที่ STM", width: 24 },
        { key: "stm_total", header: "ยอดโอนสุทธิ STM (บาท)", width: 16, type: "money" },
        { key: "diff", header: "ส่วนต่าง SMT − STM (บาท)", width: 16, type: "money" },
        { key: "status_label", header: "สถานะ", width: 12 },
      ],
      rows.map((r) => ({ ...r, status_label: STATUS_LABEL[r.status] })),
    );
  }
  const body: SmtReconcilePage = {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    summary: summarize(rows),
    smt_error: smt.error,
  };
  return Response.json(body);
}
