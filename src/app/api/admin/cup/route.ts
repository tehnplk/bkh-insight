import { auth } from "@/auth";
import { hisQuery, insightExecute } from "@/lib/db";
import { loadCup } from "@/app/api/fund/_lib/cup";

/** แถวของ GET: source = ที่มาของหน่วยบริการ (default อำเภอเดียวกัน, include admin เพิ่มเอง, exclude ค่าเริ่มต้นที่ admin นำออก) */
export type CupUnit = { hcode: string; name: string | null; source: "default" | "include" | "exclude"; note: string | null; updated_by: string | null; updated_at: string | null };
export type CupData = { own: string; units: CupUnit[] };

// proxy.ts กันไว้แล้ว แต่ route ใต้ /api/admin ต้องเช็คเองซ้ำ (เหมือน /api/admin/users)
async function adminSession() {
  const session = await auth();
  if (!session) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (session.user.role !== "admin") return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { name: session.user.name ?? "admin" };
}
const bad = (error: string) => Response.json({ error }, { status: 400 });
const HCODE = /^\d{5}$/;
const UPSERT = `INSERT INTO cup_hospcode (hcode, mode, note, updated_by) VALUES ($1, $2, $3, $4)
ON CONFLICT (hcode) DO UPDATE SET mode = EXCLUDED.mode, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()`;

export async function GET() {
  const { error } = await adminSession();
  if (error) return error;
  const cup = await loadCup();
  const names = new Map(cup.defaults.map((d) => [d.hcode, d.name]));
  const added = cup.overrides.filter((o) => o.mode === "include").map((o) => o.hcode);
  if (added.length) {
    const rows = await hisQuery<{ hcode: string; name: string | null }>(
      `SELECT hospcode AS hcode, name FROM hospcode WHERE hospcode IN (${added.map(() => "?").join(", ")})`, added);
    for (const r of rows) names.set(r.hcode, r.name);
  }
  const over = new Map(cup.overrides.map((o) => [o.hcode, o]));
  const isDefault = new Set(cup.defaults.map((d) => d.hcode));
  const units: CupUnit[] = [...new Set([...cup.cup, ...cup.overrides.map((o) => o.hcode)])].sort().map((hcode) => {
    const o = over.get(hcode);
    const source = o?.mode === "exclude" ? "exclude" : isDefault.has(hcode) || hcode === cup.own.hcode ? "default" : "include";
    return { hcode, name: names.get(hcode) ?? null, source, note: o?.note ?? null, updated_by: o?.updated_by ?? null, updated_at: o?.updated_at ?? null };
  });
  return Response.json({ own: cup.own.hcode, units } satisfies CupData);
}

/** body { hcode, note? } ; parse เป็น { hcode, note } หรือข้อความ error */
async function parse(request: Request): Promise<{ hcode: string; note: string | null } | string> {
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const hcode = typeof b?.hcode === "string" ? b.hcode.trim() : "";
  if (!HCODE.test(hcode)) return "HCODE ต้องเป็นตัวเลข 5 หลัก";
  const note = typeof b?.note === "string" ? b.note.trim() : b?.note == null ? "" : null;
  if (note === null || note.length > 200) return "หมายเหตุต้องเป็นข้อความไม่เกิน 200 ตัวอักษร";
  return { hcode, note: note || null };
}

// เพิ่มเข้า CUP: ค่าเริ่มต้นที่เคยนำออก = ลบแถว exclude ; หน่วยอื่นต้องมีใน hospcode ของ his แล้วบันทึกเป็น include
export async function POST(request: Request) {
  const { error, name } = await adminSession();
  if (error) return error;
  const body = await parse(request);
  if (typeof body === "string") return bad(body);
  const cup = await loadCup();
  if (cup.defaults.some((d) => d.hcode === body.hcode)) {
    await insightExecute("DELETE FROM cup_hospcode WHERE hcode = $1", [body.hcode]);
    return Response.json({ ok: true });
  }
  const [found] = await hisQuery<{ name: string | null }>("SELECT name FROM hospcode WHERE hospcode = ?", [body.hcode]);
  if (!found) return bad(`ไม่พบ HCODE ${body.hcode} ในตาราง hospcode ของ HOSxP`);
  await insightExecute(UPSERT, [body.hcode, "include", body.note, name]);
  return Response.json({ ok: true, name: found.name });
}

// นำออกจาก CUP: ค่าเริ่มต้น = บันทึก exclude ; ที่เพิ่มเอง = ลบแถว ; โรงพยาบาลเองนำออกไม่ได้
export async function DELETE(request: Request) {
  const { error, name } = await adminSession();
  if (error) return error;
  const body = await parse(request);
  if (typeof body === "string") return bad(body);
  const cup = await loadCup();
  if (body.hcode === cup.own.hcode) return bad("นำโรงพยาบาลเองออกจาก CUP ไม่ได้");
  if (cup.defaults.some((d) => d.hcode === body.hcode)) await insightExecute(UPSERT, [body.hcode, "exclude", body.note, name]);
  else await insightExecute("DELETE FROM cup_hospcode WHERE hcode = $1", [body.hcode]);
  return Response.json({ ok: true });
}
