import { insightTransaction } from "@/lib/db";
import { fail, loadTypes, sessionUser } from "../data";
import { parseTypePatch } from "../fwf";

// ชนิดบัตร: admin เท่านั้น (หน้าอื่นอ่านชนิดผ่าน register/lookup)
export async function GET() {
  const user = await sessionUser();
  if (!user) return fail("unauthorized", 401);
  if (!user.admin) return fail("forbidden", 403);
  return Response.json({ types: await loadTypes() });
}

/** PATCH { id, label, months, pool_amount (null = ยังไม่กำหนด), active, note? } ; ตั้งยอดแล้วเติม pool ของบัตรชนิดนี้ที่ยังว่าง (บัตรที่มียอดแล้วไม่เปลี่ยน) */
export async function PATCH(request: Request) {
  const user = await sessionUser();
  if (!user) return fail("unauthorized", 401);
  if (!user.admin) return fail("forbidden", 403);
  const body = parseTypePatch(await request.json().catch(() => null));
  if ("error" in body) return fail(body.error);
  const result = await insightTransaction(async (tx) => {
    const [row] = await tx<{ id: string }>(
      "UPDATE fwf_card_type SET label = $2, months = $3, pool_amount = $4, active = $5, note = $6, updated_by = $7, updated_at = now() WHERE id = $1 RETURNING id::text AS id",
      [body.id, body.label, body.months, body.pool_amount, body.active, body.note, user.name],
    );
    if (!row) return null;
    const filled = body.pool_amount == null ? [] : await tx<{ id: string }>(
      "UPDATE fwf_card SET pool_amount = $2::numeric * qty, updated_by = $3, updated_at = now() WHERE card_type_id = $1 AND pool_amount IS NULL RETURNING id",
      [body.id, body.pool_amount, user.name],
    );
    return { id: row.id, filled: filled.length };
  });
  return result ? Response.json(result) : fail("ไม่พบชนิดบัตรนี้", 404);
}
