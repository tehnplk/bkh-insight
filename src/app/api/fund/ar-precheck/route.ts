import type { NextRequest } from "next/server";
import { cacheLife } from "next/cache";
import { hisQuery, insightQuery } from "@/lib/db";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type RowGetters } from "@/lib/grid-query";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import { FULL_NAME_SQL, badRequest, fundOf, isAuthed, loadLookups, parseRange, pttypeName, unauthorized } from "../_lib/fund";
import {
  ADMIT_LABEL, STATUS_LABEL, buildRows, isMismatch, lockLabel, matches, sortRows, summarize,
  type Booked, type PrecheckRow, type PrecheckPage, type PrecheckSource, type PrecheckStatus, type PrecheckType, type RxSum,
} from "./precheck";

// ดึงทั้งช่วงแล้วกรอง/เรียง/แบ่งหน้าในหน่วยความจำ (OPD ราว 18k visit ต่อเดือน) เพราะยอดลงสมุดอยู่ insight ซึ่ง JOIN ข้ามฐานไม่ได้
const SORTABLE = {
  opd: ["date", "vn", "hn", "patient_name", "admit", "pttype_name", "fund", "rx_total", "rx_pay", "income", "diff_total", "paid_money", "rcpt_money", "uc_money", "debt", "diff_debt", "booked", "status"],
  ipd: ["date", "an", "hn", "patient_name", "regdate", "pttype_name", "fund", "rx_total", "rx_pay", "income", "diff_total", "paid_money", "rcpt_money", "uc_money", "debt", "diff_debt", "booked", "status"],
} as const satisfies Record<PrecheckType, readonly (keyof PrecheckRow)[]>;
const FILTER_GET = {
  fund: (r) => r.fund,
  pttype_name: (r) => r.pttype_name,
  status: (r) => r.status,
  admit: (r) => r.admit,
  vn: (r) => r.vn,
  an: (r) => r.an,
  hn: (r) => r.hn,
} satisfies RowGetters<PrecheckRow, string>;
type FilterKey = keyof typeof FILTER_GET;
const FILTERABLE = Object.keys(FILTER_GET) as FilterKey[];
const CHUNK = 1_000;

type Num = string | null;
type StatCols = { has_stat: number; income: Num; paid_money: Num; rcpt_money: Num; uc_money: Num };

// opitemrece เป็น MyISAM: ห้ามเพิ่ม JOIN/ORDER BY ในคิวรีรวมยอด (ล็อกตารางนาน)
const RX_COLS = `COUNT(*) AS n_items, SUM(sum_price) AS rx_total,
  SUM(IF(paidst IN ('00','01','03'), sum_price, 0)) AS rx_pay, SUM(IF(paidst = '02', sum_price, 0)) AS rx_debt`;
const OP_RX = `SELECT vn AS \`key\`, ${RX_COLS} FROM opitemrece FORCE INDEX (ix_vstdate) WHERE vstdate BETWEEN ? AND ? AND vn IS NOT NULL GROUP BY vn`;
const OP_VISITS = `SELECT o.vn, o.hn, ${FULL_NAME_SQL} AS patient_name, o.vstdate, o.pttype, NULLIF(o.an, '') AS an, o.finance_lock,
  vs.vn IS NOT NULL AS has_stat, vs.income, vs.paid_money, vs.rcpt_money, vs.uc_money,
  (SELECT SUM(r.amount) FROM rcpt_debt r WHERE r.vn = o.vn AND (r.status IS NULL OR r.status <> 'ABORT')) AS debt_amount
FROM ovst o LEFT JOIN vn_stat vs ON vs.vn = o.vn LEFT JOIN patient p ON p.hn = o.hn
WHERE o.vstdate BETWEEN ? AND ?`;
const IP_ADMITS = `SELECT i.an, i.hn, ${FULL_NAME_SQL} AS patient_name, i.regdate, i.dchdate, i.pttype, i.finance_lock,
  s.an IS NOT NULL AS has_stat, s.income, s.paid_money, s.rcpt_money, s.uc_money
FROM ipt i LEFT JOIN an_stat s ON s.an = i.an LEFT JOIN patient p ON p.hn = i.hn
WHERE i.dchdate BETWEEN ? AND ?`;
const ipRx = (n: number) =>
  `SELECT an AS \`key\`, ${RX_COLS} FROM opitemrece FORCE INDEX (ix_an) WHERE an IN (${Array(n).fill("?").join(", ")}) GROUP BY an`;
// ยอดคงเหลือของหนี้ที่ตั้งแล้ว = SUM ทุกแถวของ (source, ref) เดียวกัน
const ledgerSql = (col: "vn" | "an", source: "rcpt_debt" | "ipt") =>
  `SELECT s.${col} AS key, SUM(x.amount) AS booked FROM ar_ledger s JOIN ar_ledger x ON x.source = s.source AND x.ref = s.ref
   WHERE s.kind = 'set' AND s.source = '${source}' AND s.${col} = ANY($1::text[]) GROUP BY s.${col}`;

async function chunked<T>(keys: string[], run: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += CHUNK) out.push(...(await run(keys.slice(i, i + CHUNK))));
  return out;
}

type Loaded = { rows: PrecheckRow[]; ledger_error: string | null };

// HOSxP เปลี่ยนตลอดวันระหว่างแก้ไข จึง cache สั้น (cacheLife "minutes" revalidate ราว 1 นาที) แค่กันโหลดซ้ำตอนเปลี่ยนหน้า/เรียง/กรอง
async function loadRows(type: PrecheckType, start: string, end: string, today: string): Promise<Loaded> {
  "use cache";
  cacheLife("minutes");
  const lk = await loadLookups();
  const base = (pttype: string | null) => {
    const fund = fundOf(lk, pttype);
    return { pttype, pttype_name: pttypeName(lk, pttype), fund, fund_name: lk.fundName(fund) };
  };

  let sources: PrecheckSource[];
  let rx: RxSum[];
  if (type === "opd") {
    const [items, visits] = await Promise.all([
      hisQuery<RxSum>(OP_RX, [start, end]),
      hisQuery<StatCols & { vn: string; hn: string; patient_name: string | null; vstdate: string; pttype: string | null; an: string | null; finance_lock: string | null; debt_amount: Num }>(
        OP_VISITS,
        [start, end],
      ),
    ]);
    rx = items;
    sources = visits.map(({ vn, vstdate, pttype, patient_name, ...r }) => ({
      ...r, ...base(pttype), key: vn, vn, patient_name: patient_name ?? "", date: String(vstdate).slice(0, 10), regdate: null,
    }));
  } else {
    const admits = await hisQuery<StatCols & { an: string; hn: string; patient_name: string | null; regdate: string | null; dchdate: string; pttype: string | null; finance_lock: string | null }>(
      IP_ADMITS,
      [start, end],
    );
    rx = await chunked(admits.map((a) => a.an), (part) => hisQuery<RxSum>(ipRx(part.length), part));
    sources = admits.map(({ dchdate, regdate, pttype, patient_name, ...r }) => ({
      ...r, ...base(pttype), key: r.an, vn: null, patient_name: patient_name ?? "",
      date: String(dchdate).slice(0, 10), regdate: regdate ? String(regdate).slice(0, 10) : null, debt_amount: null,
    }));
  }

  let booked: Booked[] | null = null;
  let ledger_error: string | null = null;
  try {
    const sql = type === "opd" ? ledgerSql("vn", "rcpt_debt") : ledgerSql("an", "ipt");
    booked = await chunked(sources.map((s) => s.key), (part) => insightQuery<Booked>(sql, [part]));
  } catch (e) {
    console.error("ar-precheck: ledger", e);
    ledger_error = "อ่านสมุดลูกหนี้ไม่สำเร็จ";
  }
  return { rows: buildRows(type, sources, rx, booked, today), ledger_error };
}

type XlsxRow = PrecheckRow & { lock_label: string; status_label: string };
const money = (key: keyof PrecheckRow, header: string): XlsxColumn<XlsxRow> => ({ key, header: `${header} (บาท)`, width: 14, type: "money" });
const MONEY_COLUMNS: XlsxColumn<XlsxRow>[] = [
  money("rx_total", "ค่าใช้จ่าย ใบสั่งยา"),
  money("rx_pay", "ต้องชำระ ใบสั่งยา"),
  money("income", "ค่าใช้จ่าย สรุป"),
  money("diff_total", "ส่วนต่างค่าใช้จ่าย"),
  money("paid_money", "ต้องชำระ สรุป"),
  money("rcpt_money", "ชำระแล้ว"),
  money("uc_money", "ลูกหนี้ สรุป"),
  money("debt", "ตั้งหนี้แล้ว"),
  money("diff_debt", "ส่วนต่างลูกหนี้"),
  money("booked", "ลงสมุดแล้ว"),
  { key: "lock_label", header: "ล็อกรายการ", width: 12 },
  { key: "status_label", header: "สถานะ", width: 20 },
];
const PERSON: XlsxColumn<XlsxRow>[] = [
  { key: "hn", header: "HN", width: 10 },
  { key: "patient_name", header: "ชื่อ-สกุล", width: 28 },
];
const RIGHTS: XlsxColumn<XlsxRow>[] = [
  { key: "pttype_name", header: "สิทธิ", width: 28 },
  { key: "fund", header: "กองทุน", width: 10 },
];
const XLSX_COLUMNS: Record<PrecheckType, XlsxColumn<XlsxRow>[]> = {
  opd: [{ key: "date", header: "วันที่รับบริการ", width: 12 }, { key: "vn", header: "VN", width: 14 }, ...PERSON, { key: "an", header: "AN", width: 12 }, ...RIGHTS, ...MONEY_COLUMNS],
  ipd: [{ key: "date", header: "วันจำหน่าย", width: 12 }, { key: "an", header: "AN", width: 12 }, ...PERSON, { key: "regdate", header: "วันรับไว้", width: 12 }, ...RIGHTS, ...MONEY_COLUMNS],
};

export async function GET(request: NextRequest) {
  // auth อ่าน cookie จึงเช็คนอกฟังก์ชันที่ cache
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params);
  if (!range.ok) return badRequest(range.error);
  const { start, end } = range.range;
  const typeRaw = params.get("type") || "opd";
  if (typeRaw !== "opd" && typeRaw !== "ipd") return badRequest("type ต้องเป็น opd หรือ ipd");
  const type: PrecheckType = typeRaw;
  const only = params.get("only") || "";
  if (only !== "" && only !== "mismatch") return badRequest("only ได้เฉพาะ mismatch");
  const grid = parseGridQuery<(typeof SORTABLE)[PrecheckType][number]>(params, SORTABLE[type]);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters<FilterKey>(params, FILTERABLE);
  if (!cf.ok) return badRequest(cf.error);
  const { filters, facet, facetQ } = cf.query;

  const { rows: all, ledger_error } = await loadRows(type, start, end, todayIso());
  const pool = all.filter((r) => (!only || isMismatch(r.status)) && (!q || matches(r, q)));
  if (facet) {
    const labels: Partial<Record<FilterKey, (v: string) => string>> = {
      fund: (v) => {
        const name = all.find((r) => r.fund === v)?.fund_name;
        return name && name !== v ? `${v} ${name}` : v;
      },
      status: (v) => STATUS_LABEL[v as PrecheckStatus] ?? v,
      admit: (v) => ADMIT_LABEL[v as keyof typeof ADMIT_LABEL] ?? v,
    };
    return Response.json(facetRows(filterRows(pool, filters, FILTER_GET, facet), FILTER_GET[facet], facetQ, labels[facet]));
  }
  // copy ก่อนเรียง: sortRows เรียงในที่ และ all มาจาก cache
  const rows = sortRows([...filterRows(pool, filters, FILTER_GET)], sort ?? "date", dir);

  if (format === "xlsx") {
    return xlsxResponse(`ar-precheck-${type}-${start}_${end}.xlsx`, XLSX_COLUMNS[type], rows.map((r) => ({ ...r, lock_label: lockLabel(r.finance_lock), status_label: STATUS_LABEL[r.status] })));
  }
  const body: PrecheckPage = {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    // สรุปทั้งช่วงและประเภท ไม่สนการค้นหา/ตัวกรอง
    summary: summarize(all),
    ledger_error,
  };
  return Response.json(body);
}
