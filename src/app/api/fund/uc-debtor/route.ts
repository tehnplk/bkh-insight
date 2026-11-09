import type { NextRequest } from "next/server";
import { hisQuery, insightQuery } from "@/lib/db";
import { parseGridQuery, type GridPage } from "@/lib/grid-query";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import { badRequest, inList, isAuthed, loadLookups, parseRange, unauthorized } from "../_lib/fund";
import {
  DEBTOR_STATUSES, STATUS_LABEL, matches, mergeDebtors, sortRows, summarize,
  type DebtorStatus, type DebtorType, type HisDebtor, type LatestRep, type UcDebtorRow, type UcDebtorSummary,
} from "./debtor";

// ดึงทั้งช่วงแล้วกรอง/เรียง/แบ่งหน้าในหน่วยความจำ (OPD ราว 15k แถวต่อเดือน) เพราะสถานะมาจาก insight ซึ่ง JOIN ข้ามฐานไม่ได้
const SORTABLE = {
  opd: ["date", "vn", "hn", "full_name", "pttype_name", "debtor", "debt_amount", "rep_no", "compensation", "diff", "status"],
  ipd: ["date", "an", "hn", "full_name", "pttype_name", "drg", "adjrw", "debtor", "rep_no", "compensation", "diff", "status"],
} as const satisfies Record<DebtorType, readonly (keyof UcDebtorRow)[]>;
const REP_CHUNK = 15_000;

type Person = { hn: string; pname: string | null; fname: string | null; lname: string | null; pttype_name: string | null };
const fullName = (p: Person) => `${p.pname ?? ""}${p.fname ?? ""} ${p.lname ?? ""}`.trim();
const num = (v: string | number | null) => (v == null ? null : Number(v));

async function loadOpd(start: string, end: string, codes: string[]): Promise<HisDebtor[]> {
  const rows = await hisQuery<Person & { vn: string; vstdate: string; uc_money: string; debt_amount: string | null }>(
    `SELECT s.vn, s.hn, s.vstdate, s.pttype, t.name AS pttype_name, s.income, s.uc_money, d.debt_amount, p.pname, p.fname, p.lname
     FROM vn_stat s
     JOIN patient p ON p.hn = s.hn
     LEFT JOIN pttype t ON t.pttype = s.pttype
     LEFT JOIN (
       SELECT r.vn, SUM(r.amount) AS debt_amount
       FROM rcpt_debt r
       JOIN vn_stat x ON x.vn = r.vn
       WHERE x.vstdate BETWEEN ? AND ?
         AND (r.status IS NULL OR r.status <> 'ABORT')
       GROUP BY r.vn
     ) d ON d.vn = s.vn
     WHERE s.vstdate BETWEEN ? AND ?
       AND ${inList("s.pttype", codes.length)}
       AND s.uc_money > 0
     ORDER BY s.vstdate, s.vn`,
    [start, end, start, end, ...codes],
  );
  return rows.map((r) => ({
    key: r.vn, vn: r.vn, an: null, hn: r.hn, date: String(r.vstdate).slice(0, 10), full_name: fullName(r),
    pttype_name: r.pttype_name ?? "", drg: null, adjrw: null, debtor: Number(r.uc_money), debt_amount: num(r.debt_amount),
  }));
}

async function loadIpd(start: string, end: string, codes: string[]): Promise<HisDebtor[]> {
  const rows = await hisQuery<Person & { an: string; vn: string | null; dchdate: string; uc_money: string; drg: string | null; adjrw: string | null }>(
    `SELECT i.an, i.vn, i.hn, i.regdate, i.dchdate, i.pttype, t.name AS pttype_name, a.income, a.uc_money, i.drg, i.adjrw, p.pname, p.fname, p.lname
     FROM ipt i JOIN an_stat a ON a.an = i.an JOIN patient p ON p.hn = i.hn LEFT JOIN pttype t ON t.pttype = i.pttype
     WHERE i.dchdate BETWEEN ? AND ? AND ${inList("i.pttype", codes.length)} AND a.uc_money > 0
     ORDER BY i.dchdate, i.an`,
    [start, end, ...codes],
  );
  return rows.map((r) => ({
    key: r.an, vn: r.vn, an: r.an, hn: r.hn, date: String(r.dchdate).slice(0, 10), full_name: fullName(r),
    pttype_name: r.pttype_name ?? "", drg: r.drg || null, adjrw: num(r.adjrw), debtor: Number(r.uc_money), debt_amount: null,
  }));
}

/** REP ล่าสุด (tran_id มากสุด) ต่อ seq_no (= vn) หรือ an */
async function loadReps(type: DebtorType, keys: string[]): Promise<LatestRep[]> {
  const col = type === "opd" ? "seq_no" : "an";
  const out: LatestRep[] = [];
  for (let i = 0; i < keys.length; i += REP_CHUNK) {
    // col มาจากค่าคงที่ในโค้ด ไม่ใช่ input
    const rows = await insightQuery<Omit<LatestRep, "key"> & Record<"seq_no" | "an", string>>(
      `SELECT DISTINCT ON (${col}) ${col}, tran_id, rep_no, net_nhso, net_affiliation, claim_total, paid, error_codes, main_fund, pay_mode
       FROM rep_row WHERE ${col} = ANY($1::text[]) ORDER BY ${col}, tran_id::bigint DESC`,
      [keys.slice(i, i + REP_CHUNK)],
    );
    for (const r of rows) out.push({ ...r, key: r[col] });
  }
  return out;
}

const XLSX_COLUMNS: Record<DebtorType, XlsxColumn<UcDebtorRow & { status_label: string; errors: string }>[]> = {
  opd: [
    { key: "date", header: "วันที่รับบริการ", width: 12 },
    { key: "vn", header: "VN", width: 14 },
    { key: "hn", header: "HN", width: 10 },
    { key: "full_name", header: "ชื่อ-สกุล", width: 28 },
    { key: "pttype_name", header: "สิทธิ", width: 28 },
    { key: "debtor", header: "ลูกหนี้ (บาท)", width: 14, type: "money" },
    { key: "debt_amount", header: "ใบลูกหนี้ (บาท)", width: 14, type: "money" },
    { key: "rep_no", header: "REP", width: 14 },
    { key: "compensation", header: "ชดเชยสุทธิ (บาท)", width: 14, type: "money" },
    { key: "diff", header: "ส่วนต่าง (บาท)", width: 14, type: "money" },
    { key: "status_label", header: "สถานะ", width: 14 },
    { key: "errors", header: "รหัส error", width: 16 },
  ],
  ipd: [
    { key: "date", header: "วันจำหน่าย", width: 12 },
    { key: "an", header: "AN", width: 12 },
    { key: "hn", header: "HN", width: 10 },
    { key: "full_name", header: "ชื่อ-สกุล", width: 28 },
    { key: "pttype_name", header: "สิทธิ", width: 28 },
    { key: "drg", header: "DRG", width: 8 },
    { key: "adjrw", header: "AdjRW", width: 10 },
    { key: "debtor", header: "ลูกหนี้ (บาท)", width: 14, type: "money" },
    { key: "rep_no", header: "REP", width: 14 },
    { key: "compensation", header: "ชดเชยสุทธิ (บาท)", width: 14, type: "money" },
    { key: "diff", header: "ส่วนต่าง (บาท)", width: 14, type: "money" },
    { key: "status_label", header: "สถานะ", width: 14 },
    { key: "errors", header: "รหัส error", width: 16 },
  ],
};

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const typeRaw = params.get("type") || "opd";
  if (typeRaw !== "opd" && typeRaw !== "ipd") return badRequest("type ต้องเป็น opd หรือ ipd");
  const type: DebtorType = typeRaw;
  const statusRaw = params.get("status") || "all";
  if (statusRaw !== "all" && !(DEBTOR_STATUSES as readonly string[]).includes(statusRaw)) {
    return badRequest(`status ได้เฉพาะ: all, ${DEBTOR_STATUSES.join(", ")}`);
  }
  const grid = parseGridQuery<(typeof SORTABLE)[DebtorType][number]>(params, SORTABLE[type]);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;

  const lk = await loadLookups();
  const codes = [...lk.pttype].filter(([, p]) => p.fund === "UCS").map(([c]) => c);
  const debtors = !codes.length ? [] : type === "opd" ? await loadOpd(start, end, codes) : await loadIpd(start, end, codes);
  const reps = debtors.length ? await loadReps(type, debtors.map((d) => d.key)) : [];

  const searched = mergeDebtors(debtors, reps).filter((r) => !q || matches(r, q));
  const rows = sortRows(statusRaw === "all" ? searched : searched.filter((r) => r.status === (statusRaw as DebtorStatus)), sort ?? "date", dir);

  if (format === "xlsx") {
    const out = rows.map((r) => ({ ...r, status_label: STATUS_LABEL[r.status], errors: r.error_codes.join(", ") }));
    return xlsxResponse(`uc-debtor-${type}-${start}_${end}.xlsx`, XLSX_COLUMNS[type], out);
  }
  const body: GridPage<UcDebtorRow> & { summary: UcDebtorSummary } = {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    summary: summarize(rows, searched),
  };
  return Response.json(body);
}
