import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import { parseGridQuery, type GridPage } from "@/lib/grid-query";
import { xlsxResponse } from "@/lib/xlsx";
import { DAY_MS, badRequest, inList, isAuthed, isoDate, parseRange, unauthorized } from "../_lib/fund";
import {
  THRESHOLD, ageAt, hasCandidatePair, normalizeResults, remissionEvents,
  type DmRemissionRow, type DmRemissionSummary, type LabResult, type RemissionEvent,
} from "./remission";

// lab_items_code ของ HbA1c ใน HOSxP
const HBA1C = 334;
const NUMERIC_RE = "^[0-9]+([.][0-9]+)?$";
const DRUG_RE =
  "metformin|glipizide|glibenclamide|gliclazide|glimepiride|chlorpropamide|pioglitazone|rosiglitazone|gliptin|gliflozin|insulin|acarbose|mixtard|humulin|novorapid|lantus|NPH";
// shortcut: ดูประวัติย้อนหลังแค่ 730 วันก่อน start คนที่เคยได้ครั้งแรกก่อนช่วงนี้อาจถูกนับเป็นครั้งแรกซ้ำ ถ้าต้องแม่นให้เก็บประวัติการจ่ายใน insight
const LOOKBACK_DAYS = 730;
// opitemrece เป็น MyISAM: แบ่ง hn ทีละ 50 และรันทีละชุด ไม่ให้ query เดียวถือ table lock นาน
const DRUG_BATCH = 50;

const SORTABLE = ["hn", "full_name", "age", "prev_date", "date", "days", "kind", "amount"] as const satisfies readonly (keyof DmRemissionRow)[];

const day = (v: string) => String(v).slice(0, 10);

async function loadRows(start: string, end: string, from: string): Promise<DmRemissionRow[]> {
  const [ucsRows, drugRows] = await Promise.all([
    hisQuery<{ pttype: string }>("SELECT pttype FROM pttype WHERE hipdata_code = ?", ["UCS"]),
    hisQuery<{ icode: string }>("SELECT icode FROM drugitems WHERE CONCAT_WS(' ', generic_name, name) REGEXP ?", [DRUG_RE]),
  ]);
  const candidates = (
    await hisQuery<{ hn: string }>(
      `SELECT DISTINCT h.hn FROM lab_head h JOIN lab_order o ON o.lab_order_number = h.lab_order_number
       WHERE o.lab_items_code = ? AND h.order_date BETWEEN ? AND ? AND o.lab_order_result REGEXP ? AND o.lab_order_result + 0 < ?`,
      [HBA1C, start, end, NUMERIC_RE, THRESHOLD],
    )
  ).map((r) => r.hn);
  if (!candidates.length) return [];

  const hnIn = inList("hn", candidates.length);
  const [labRows, e11Rows, patients] = await Promise.all([
    hisQuery<{ hn: string; vn: string | null; order_date: string; lab_order_result: string }>(
      `SELECT h.hn, h.vn, h.order_date, o.lab_order_result FROM lab_head h JOIN lab_order o ON o.lab_order_number = h.lab_order_number
       WHERE ${inList("h.hn", candidates.length)} AND h.order_date BETWEEN ? AND ? AND o.lab_items_code = ? AND o.lab_order_result REGEXP ?`,
      [...candidates, from, end, HBA1C, NUMERIC_RE],
    ),
    hisQuery<{ hn: string }>(`SELECT DISTINCT hn FROM ovstdiag WHERE ${hnIn} AND icd10 LIKE 'E11%'`, candidates),
    hisQuery<{ hn: string; pname: string | null; fname: string | null; lname: string | null; birthday: string | null; pttype: string | null }>(
      `SELECT hn, pname, fname, lname, birthday, pttype FROM patient WHERE ${hnIn}`,
      candidates,
    ),
  ]);

  const history = new Map<string, LabResult[]>();
  for (const r of labRows) {
    const list = history.get(r.hn) ?? [];
    list.push({ vn: r.vn, date: day(r.order_date), value: Number(r.lab_order_result) });
    history.set(r.hn, list);
  }
  const e11 = new Set(e11Rows.map((r) => r.hn));
  // คัดก่อนแตะ opitemrece: มี E11 และมีคู่ผลที่ผ่านเกณฑ์ค่า/ระยะห่างโดยผลหลังอยู่ในช่วง (ยาตัดคู่ได้อย่างเดียว ไม่เพิ่มคู่)
  const results = new Map<string, LabResult[]>();
  for (const [hn, rows] of history) {
    const sorted = normalizeResults(rows);
    if (e11.has(hn) && hasCandidatePair(sorted, start, end)) results.set(hn, sorted);
  }
  if (!results.size) return [];

  const drugs = new Map<string, string[]>();
  const icodes = drugRows.map((r) => r.icode);
  if (icodes.length) {
    const hns = [...results.keys()];
    for (let i = 0; i < hns.length; i += DRUG_BATCH) {
      const batch = hns.slice(i, i + DRUG_BATCH);
      const rows = await hisQuery<{ hn: string; rxdate: string }>(
        `SELECT hn, rxdate FROM opitemrece FORCE INDEX (ix_hn) WHERE ${inList("hn", batch.length)} AND ${inList("icode", icodes.length)}
         AND rxdate BETWEEN ? AND ? GROUP BY hn, rxdate`,
        [...batch, ...icodes, from, end],
      );
      for (const r of rows) drugs.set(r.hn, [...(drugs.get(r.hn) ?? []), day(r.rxdate)]);
    }
  }

  const events: (RemissionEvent & { hn: string })[] = [];
  for (const [hn, list] of results) {
    for (const e of remissionEvents(list, drugs.get(hn) ?? [])) {
      if (e.cur.date >= start && e.cur.date <= end) events.push({ ...e, hn });
    }
  }
  // สิทธิ UC อิงสิทธิของ visit ที่ตรวจ ไม่มี vn หรือหา visit ไม่เจอ = ไม่ใช่ UC
  const vns = [...new Set(events.map((e) => e.cur.vn).filter((vn): vn is string => !!vn))];
  if (!vns.length) return [];
  const visits = await hisQuery<{ vn: string; pttype: string | null }>(`SELECT vn, pttype FROM ovst WHERE ${inList("vn", vns.length)}`, vns);
  const ucs = new Set(ucsRows.map((r) => r.pttype));
  const ucVisits = new Set(visits.filter((v) => v.pttype && ucs.has(v.pttype)).map((v) => v.vn));
  const people = new Map(patients.map((p) => [p.hn, p]));

  const rows: DmRemissionRow[] = [];
  for (const e of events) {
    const p = people.get(e.hn);
    const age = ageAt(p?.birthday ?? null, e.cur.date);
    if (!e.cur.vn || !ucVisits.has(e.cur.vn) || age === null || age < 18) continue;
    rows.push({
      id: `${e.hn}|${e.cur.date}`,
      hn: e.hn,
      full_name: `${p?.pname ?? ""}${p?.fname ?? ""} ${p?.lname ?? ""}`.trim(),
      age,
      prev_date: e.prev.date,
      prev_value: e.prev.value,
      date: e.cur.date,
      value: e.cur.value,
      days: e.days,
      kind: e.kind,
      amount: e.amount,
    });
  }
  return rows;
}

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const range = parseRange(params);
  if (!range.ok) return badRequest(range.error);
  const { start, end, startMs } = range.range;
  const grid = parseGridQuery(params, SORTABLE);
  if (!grid.ok) return badRequest(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;

  let rows = await loadRows(start, end, isoDate(startMs - LOOKBACK_DAYS * DAY_MS));
  if (q) rows = rows.filter((r) => r.hn.includes(q) || r.full_name.includes(q));
  const key = sort ?? "date";
  const sign = dir === "desc" ? -1 : 1;
  rows.sort((a, b) => {
    const x = a[key];
    const y = b[key];
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "th");
    return sign * c || a.hn.localeCompare(b.hn) || a.date.localeCompare(b.date);
  });

  if (format === "xlsx") {
    return xlsxResponse<DmRemissionRow>(`dm-remission-${start}_${end}.xlsx`, [
      { key: "hn", header: "HN", width: 12 },
      { key: "full_name", header: "ชื่อ-สกุล", width: 28 },
      { key: "age", header: "อายุ (ปี)", width: 10, type: "count" },
      { key: "prev_date", header: "วันที่ HbA1c ครั้งก่อน", width: 16 },
      { key: "prev_value", header: "HbA1c ครั้งก่อน (%)", width: 14 },
      { key: "date", header: "วันที่ HbA1c ที่ผ่านเกณฑ์", width: 16 },
      { key: "value", header: "HbA1c ที่ผ่านเกณฑ์ (%)", width: 14 },
      { key: "days", header: "ห่าง (วัน)", width: 10, type: "count" },
      { key: "kind", header: "ประเภท", width: 12 },
      { key: "amount", header: "จำนวนเงิน (บาท)", width: 14, type: "money" },
    ], rows);
  }

  const summary: DmRemissionSummary = {
    first: rows.filter((r) => r.kind === "ครั้งแรก").length,
    extra: rows.filter((r) => r.kind === "เพิ่มเติม").length,
    amount: rows.reduce((s, r) => s + r.amount, 0),
  };
  const body: GridPage<DmRemissionRow> & { summary: DmRemissionSummary } = {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    summary,
  };
  return Response.json(body);
}
