import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { facetRows, filterRows, parseColumnFilters, parseGridQuery, type GridPage, type RowGetters } from "@/lib/grid-query";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { CARDS_SQL, fail, loadNames, loadTypes, sessionUser, type CardRow } from "../data";
import { cardBalance, cents, monthEnd, validMonth } from "../fwf";

/** แถวทะเบียนบัตร (ชื่ออ่านจาก HOSxP ตอนแสดง) */
export type RegisterRow = Omit<CardRow, "usage" | "released"> & { name: string | null; usage: number; released: number; remaining: number | null; loss: number | null };
/** จำนวนบัตร (รวม qty) ต่อชนิดในเดือน แยกที่ดึงจาก HOSxP / เพิ่มเอง / ยกเลิก */
export type TypeCount = { card_type_id: string; label: string; icode: string; unit_price: string; pool_amount: string | null; active: boolean; hosxp: number; manual: number; void: number };
export type RegisterSummary = {
  month: string;
  types: TypeCount[];
  flags: { no_receipt: number; paidst02: number; missing: number; unset_pool: number };
  synced_at: string | null;
};
export type RegisterPage = GridPage<RegisterRow> & { summary: RegisterSummary };

const SORTABLE = ["sale_date", "hn", "name", "type_label", "valid_from", "valid_to", "pool_amount", "usage", "remaining", "status"] as const;
const FILTERABLE = ["type_label", "source", "status"] as const;
const yesNo = (v: boolean | null) => (v == null ? "" : v ? "มี" : "ไม่มี");
const GET_COL: RowGetters<RegisterRow, (typeof FILTERABLE)[number]> = {
  type_label: (r) => r.type_label, source: (r) => r.source, status: (r) => r.status,
};

// ทะเบียนบัตรของเดือนที่ขาย ?month=YYYY-MM (สัญญา DataGrid กรอง/เรียงในหน่วยความจำ เดือนหนึ่งมีไม่กี่ร้อยใบ) ค้นด้วย HN, ชื่อ, VN
export async function GET(request: NextRequest) {
  if (!(await sessionUser())) return fail("unauthorized", 401);
  const params = request.nextUrl.searchParams;
  const month = params.get("month") ?? "";
  if (!validMonth(month, todayIso())) return fail("month ต้องเป็น YYYY-MM ตั้งแต่เดือนเริ่ม pool ถึงเดือนปัจจุบัน");
  const grid = parseGridQuery(params, SORTABLE);
  if (!grid.ok) return fail(grid.error);
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const cf = parseColumnFilters(params, FILTERABLE);
  if (!cf.ok) return fail(cf.error);

  const [cards, types, [sync]] = await Promise.all([
    insightQuery<CardRow>(CARDS_SQL.month, [`${month}-01`, monthEnd(month)]),
    loadTypes(),
    insightQuery<{ synced_at: string }>("SELECT to_char(synced_at, 'YYYY-MM-DD HH24:MI') AS synced_at FROM fwf_sync_month WHERE month = $1", [`${month}-01`]),
  ]);
  const names = await loadNames(cards.map((c) => c.hn));
  const all: RegisterRow[] = cards.map((c) => ({ ...c, name: names.get(c.hn) ?? null, usage: Number(c.usage), released: Number(c.released), ...cardBalance(c.pool_amount, c.usage, c.released) }));

  const { filters, facet, facetQ } = cf.query;
  const needle = q.toLowerCase();
  const searched = needle ? all.filter((r) => [r.hn, r.name, r.vn].some((v) => v?.toLowerCase().includes(needle))) : all;
  if (facet) return Response.json(facetRows(filterRows(searched, filters, GET_COL, facet), GET_COL[facet], facetQ));
  const rows = filterRows(searched, filters, GET_COL);
  const key = sort ?? "sale_date";
  const val = (r: RegisterRow) => (key === "pool_amount" ? (r.pool_amount == null ? null : cents(r.pool_amount)) : r[key]);
  const sign = dir === "desc" ? -1 : 1;
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "th")) * sign || Number(a.id) - Number(b.id);
  });

  if (format === "xlsx") {
    const out = rows.map((r) => ({ ...r, source_text: r.source === "hosxp" ? "HOSxP" : "เพิ่มเอง", status_text: r.status === "void" ? `ยกเลิก: ${r.void_reason}` : "ใช้งาน", receipt: yesNo(r.has_receipt) }));
    return xlsxResponse<(typeof out)[number]>(`fwf-card-${month}.xlsx`, [
      { key: "sale_date", header: "วันขาย", width: 12 },
      { key: "hn", header: "HN", width: 10 },
      { key: "name", header: "ชื่อ-สกุล", width: 28 },
      { key: "type_label", header: "ชนิดบัตร", width: 26 },
      { key: "qty", header: "จำนวน", width: 8, type: "count" },
      { key: "valid_from", header: "เริ่ม", width: 12 },
      { key: "valid_to", header: "หมดอายุ", width: 12 },
      { key: "pool_amount", header: "เงินรับล่วงหน้า (บาท)", width: 16, type: "money" },
      { key: "usage", header: "ใช้แล้ว (บาท)", width: 14, type: "money" },
      { key: "released", header: "โอนเงินบำรุง (บาท)", width: 14, type: "money" },
      { key: "remaining", header: "คงเหลือ (บาท)", width: 14, type: "money" },
      { key: "source_text", header: "ที่มา", width: 10 },
      { key: "vn", header: "VN", width: 14 },
      { key: "receipt", header: "ใบเสร็จ", width: 8 },
      { key: "paidst", header: "paidst", width: 8 },
      { key: "status_text", header: "สถานะ", width: 24 },
    ], out);
  }

  const counts = new Map<string, TypeCount>(types.map((t) => [t.id, {
    card_type_id: t.id, label: t.label, icode: t.icode, unit_price: String(t.unit_price), pool_amount: t.pool_amount == null ? null : String(t.pool_amount), active: t.active, hosxp: 0, manual: 0, void: 0,
  }]));
  const active = all.filter((c) => c.status === "active");
  for (const c of all) {
    const t = counts.get(c.card_type_id);
    if (t) t[c.status === "void" ? "void" : c.source] += c.qty;
  }
  const summary: RegisterSummary = {
    month,
    // ชนิดที่ไม่มีบัตรในเดือนและยังกำหนดยอดแล้วไม่ต้องแสดง ; ชนิดที่ยังไม่กำหนดยอดแสดงเสมอให้เห็นธง
    types: [...counts.values()].filter((t) => t.hosxp + t.manual + t.void > 0 || (t.active && t.pool_amount == null)),
    flags: {
      no_receipt: active.filter((c) => c.source === "hosxp" && c.has_receipt === false).length,
      paidst02: active.filter((c) => c.paidst === "02").length,
      missing: active.filter((c) => c.hosxp_missing).length,
      unset_pool: active.filter((c) => c.pool_amount == null).length,
    },
    synced_at: sync?.synced_at ?? null,
  };
  const body: RegisterPage = { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, summary };
  return Response.json(body);
}
