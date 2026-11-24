import { todayIso } from "@/lib/thai-date";
import { locked } from "../../ar-sync/sync";
import { CARDS_SQL, fail, loadPool, sessionUser, type CardRow } from "../data";
import { cardBalance, cents, parseRelease } from "../fwf";

class ReleaseError extends Error {}

/**
 * บันทึกโอนเงินคงเหลือของบัตรที่หมดอายุไปเงินบำรุง { card_id, amount, released_on, ref?, note? }
 * ถือ lock เดียวกับตัดหนี้สิ้นเดือน: ยอดต้องไม่เกินคงเหลือของบัตรและไม่เกินเงินรับล่วงหน้าคงเหลือ ; ไม่โอนอัตโนมัติ
 */
export async function POST(request: Request) {
  const user = await sessionUser();
  if (!user) return fail("unauthorized", 401);
  const today = todayIso();
  const body = parseRelease(await request.json().catch(() => null), today);
  if ("error" in body) return fail(body.error);
  try {
    const id = await locked(async (tx) => {
      const [card] = await tx<CardRow>(CARDS_SQL.id, [body.card_id]);
      if (!card || card.status !== "active") throw new ReleaseError("ไม่พบบัตรนี้ หรือยกเลิกไปแล้ว");
      if (card.valid_to >= today) throw new ReleaseError("บัตรยังไม่หมดอายุ");
      const { remaining } = cardBalance(card.pool_amount, card.usage, card.released);
      if (remaining == null) throw new ReleaseError("ชนิดบัตรยังไม่กำหนดค่าบริการทางการแพทย์");
      if (cents(body.amount) > Math.round(remaining * 100)) throw new ReleaseError(`โอนได้ไม่เกินคงเหลือของบัตร ${remaining.toFixed(2)} บาท`);
      const pool = await loadPool(tx, today);
      if (cents(body.amount) > Math.round(pool.balance * 100)) throw new ReleaseError(`โอนได้ไม่เกินเงินรับล่วงหน้าคงเหลือ ${pool.balance.toFixed(2)} บาท`);
      const [row] = await tx<{ id: string }>(
        "INSERT INTO fwf_card_release (card_id, amount, released_on, ref, note, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id",
        [body.card_id, body.amount, body.released_on, body.ref, body.note, user.name],
      );
      return row.id;
    });
    return Response.json({ id });
  } catch (e) {
    if (e instanceof ReleaseError) return fail(e.message, 409);
    throw e;
  }
}
