import { insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { fail, loadTypes, lookupHn, sessionUser } from "../data";
import { cardPool, defaultValidity, matchType, parseAddCard, parseCardPatch } from "../fwf";

const INSERT_SQL = `INSERT INTO fwf_card (hn, card_type_id, qty, sale_date, valid_from, valid_to, pool_amount, source, hos_guid, vn, paidst, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
ON CONFLICT (hos_guid) DO NOTHING
RETURNING id::text AS id`;

/**
 * เพิ่มบัตรที่ขาดจากทะเบียน: { hn, hos_guid } = แถวขายใน HOSxP ของ HN นี้ (ตรวจซ้ำกับ HOSxP) หรือ
 * { hn, card_type_id, sale_date, valid_from?, valid_to? } = เพิ่มเอง (HN ต้องมีใน HOSxP) ; ไม่ส่งวันที่ = ค่าเริ่มต้นตามอายุบัตร
 */
export async function POST(request: Request) {
  const user = await sessionUser();
  if (!user) return fail("unauthorized", 401);
  const body = parseAddCard(await request.json().catch(() => null), todayIso());
  if ("error" in body) return fail(body.error);
  const types = await loadTypes();
  const his = await lookupHn(body.hn, types);
  if (!his.patient) return fail("ไม่พบ HN นี้ใน HOSxP", 404);

  let values: unknown[];
  if (body.kind === "hosxp") {
    const sale = his.sales.find((s) => s.hos_guid === body.hos_guid);
    if (!sale) return fail("ไม่พบรายการขายบัตรนี้ของ HN นี้ใน HOSxP", 404);
    const type = matchType(types, sale.icode, sale.unitprice);
    if (!type) return fail("รายการนี้ไม่ตรงกับชนิดบัตรที่ใช้อยู่ (icode และราคา)");
    const qty = Math.max(1, Math.round(Number(sale.qty)));
    const v = defaultValidity(sale.vstdate, type.months);
    values = [body.hn, type.id, qty, sale.vstdate, v.valid_from, v.valid_to, cardPool(type, qty), "hosxp", sale.hos_guid, sale.vn, sale.paidst, user.name];
  } else {
    const type = types.find((t) => t.id === body.card_type_id && t.active);
    if (!type) return fail("ไม่พบชนิดบัตรนี้ หรือปิดใช้งานแล้ว");
    const v = body.validity ?? defaultValidity(body.sale_date, type.months);
    values = [body.hn, type.id, 1, body.sale_date, v.valid_from, v.valid_to, cardPool(type, 1), "manual", null, null, null, user.name];
  }
  const [row] = await insightQuery<{ id: string }>(INSERT_SQL, values);
  if (!row) return fail("รายการขายนี้อยู่ในทะเบียนแล้ว", 409);
  return Response.json(row);
}

// แก้วันใช้ได้ { id, action: "validity", valid_from, valid_to } หรือยกเลิก { id, action: "void", reason } เฉพาะบัตรที่ยังใช้งาน
export async function PATCH(request: Request) {
  const user = await sessionUser();
  if (!user) return fail("unauthorized", 401);
  const body = parseCardPatch(await request.json().catch(() => null));
  if ("error" in body) return fail(body.error);
  const rows =
    body.action === "validity"
      ? await insightQuery<{ id: string }>(
          "UPDATE fwf_card SET valid_from = $2, valid_to = $3, updated_by = $4, updated_at = now() WHERE id = $1 AND status = 'active' RETURNING id::text AS id",
          [body.id, body.validity.valid_from, body.validity.valid_to, user.name],
        )
      : await insightQuery<{ id: string }>(
          "UPDATE fwf_card SET status = 'void', void_reason = $2, updated_by = $3, updated_at = now() WHERE id = $1 AND status = 'active' RETURNING id::text AS id",
          [body.id, body.reason, user.name],
        );
  if (!rows.length) return fail("ไม่พบบัตรนี้ หรือยกเลิกไปแล้ว", 404);
  return Response.json(rows[0]);
}
