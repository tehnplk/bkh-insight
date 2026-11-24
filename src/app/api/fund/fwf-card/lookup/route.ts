import type { NextRequest } from "next/server";
import { insightQuery } from "@/lib/db";
import { CARDS_SQL, fail, loadTypes, lookupHn, sessionUser, type CardRow, type HisPatient, type HisVisit } from "../data";
import { HN_RE, cardBalance, matchType } from "../fwf";

/** แถวขายบัตรใน HOSxP ของ HN: type = ชนิดที่จับคู่ได้ (null = ไม่ใช่บัตร), card_id = มีในทะเบียนแล้ว */
export type LookupSale = { hos_guid: string; vn: string | null; vstdate: string; icode: string; unitprice: string; qty: number; sum_price: string; paidst: string | null; type_id: string | null; type_label: string | null; card_id: string | null };
export type LookupCard = Omit<CardRow, "usage" | "released"> & { usage: number; released: number; remaining: number | null };
/** response ของ GET /api/fund/fwf-card/lookup?hn= */
export type LookupResult = {
  patient: HisPatient; visits: HisVisit[]; sales: LookupSale[]; cards: LookupCard[];
  /** ชนิดบัตรที่ใช้อยู่ สำหรับเพิ่มเอง */
  types: { id: string; label: string; months: number; pool_amount: string | null }[];
};

// ค้น HN สำหรับเพิ่มบัตรที่ขาด: ชื่อ อายุ สัญชาติ visit ล่าสุด 5 ครั้ง รายการขายบัตรใน HOSxP และบัตรในทะเบียน
export async function GET(request: NextRequest) {
  if (!(await sessionUser())) return fail("unauthorized", 401);
  const hn = (request.nextUrl.searchParams.get("hn") ?? "").trim();
  if (!HN_RE.test(hn)) return fail("HN ต้องเป็นตัวเลขไม่เกิน 9 หลัก");
  const types = await loadTypes();
  const [his, cards] = await Promise.all([lookupHn(hn, types), insightQuery<CardRow>(CARDS_SQL.hn, [hn])]);
  if (!his.patient) return fail("ไม่พบ HN นี้ใน HOSxP", 404);
  const byGuid = new Map(cards.filter((c) => c.hos_guid).map((c) => [c.hos_guid, c.id]));
  const sales: LookupSale[] = his.sales
    .sort((a, b) => b.vstdate.localeCompare(a.vstdate))
    .map((s) => {
      const t = matchType(types, s.icode, s.unitprice);
      return { ...s, qty: Number(s.qty), type_id: t?.id ?? null, type_label: t?.label ?? null, card_id: byGuid.get(s.hos_guid) ?? null };
    });
  const body: LookupResult = {
    patient: { ...his.patient, display_name: his.patient.display_name.trim() },
    visits: his.visits,
    sales,
    cards: cards.map((c) => ({ ...c, usage: Number(c.usage), released: Number(c.released), remaining: cardBalance(c.pool_amount, c.usage, c.released).remaining })),
    types: types.filter((t) => t.active).map((t) => ({ id: t.id, label: t.label, months: t.months, pool_amount: t.pool_amount == null ? null : String(t.pool_amount) })),
  };
  return Response.json(body);
}
