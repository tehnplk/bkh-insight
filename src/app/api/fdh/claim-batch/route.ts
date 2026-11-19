import { auth } from "@/auth";
import { insightQuery } from "@/lib/db";
import { parseBatch } from "./claim";

/**
 * POST { channel, patient_type, file_sha256, items } บันทึกชุดไฟล์ส่งเคลมที่ modal 16 แฟ้มเพิ่งสร้าง (หลักฐาน "ส่งออกแล้ว" ของสถานะเคลม)
 * คำสั่งเดียว = ลงหัวชุดและทุกรายพร้อมกันหรือไม่ลงเลย ; super user ไม่มี user_id จึงเก็บชื่อใน session
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = parseBatch(await request.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { channel, patient_type, file_sha256, items } = parsed.value;
  const total = items.reduce((s, i) => s + (i.cht_total ?? 0), 0);
  const col = <K extends keyof (typeof items)[number]>(k: K) => items.map((i) => i[k]);
  try {
    const [row] = await insightQuery<{ id: string }>(
      `WITH b AS (
         INSERT INTO claim_batch (channel, patient_type, created_by, user_id, item_count, total_amount, file_sha256)
         VALUES ($1, $2, $3, $4, $5, round($6::numeric, 2), $7) RETURNING id
       ), i AS (
         INSERT INTO claim_batch_item (batch_id, patient_type, ref, hn, service_date, scheme, subtype, hospmain, cht_total, pdx)
         SELECT b.id, $2, u.* FROM b,
           unnest($8::text[], $9::text[], $10::date[], $11::text[], $12::text[], $13::text[], $14::numeric[], $15::text[])
             AS u(ref, hn, service_date, scheme, subtype, hospmain, cht_total, pdx)
       )
       SELECT id::text FROM b`,
      [
        channel, patient_type, session.user.name ?? "ไม่ทราบชื่อ", session.user.userId ?? null, items.length, total, file_sha256,
        col("ref"), col("hn"), col("service_date"), col("scheme"), col("subtype"), col("hospmain"), col("cht_total"), col("pdx"),
      ],
    );
    return Response.json({ id: row.id, items: items.length });
  } catch (e) {
    console.error("fdh/claim-batch", e);
    return Response.json({ error: `บันทึกชุดส่งออกไม่สำเร็จ: ${(e as Error).message}` }, { status: 500 });
  }
}
