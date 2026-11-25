import { insightQuery, insightTransaction } from "@/lib/db";
import { fail, sessionUser } from "../../fwf-card/data";
import { DEFAULT_SIGNERS, parseSigners, type Signer } from "../report";

/** response ของ GET: migrated = false เมื่อยังไม่ได้รัน migration (ใช้ค่าเริ่มต้น ชื่อว่าง ยังบันทึกไม่ได้) */
export type SignerList = { signers: Signer[]; can_edit: boolean; migrated: boolean };

const LIST_SQL = `SELECT slot, role_label, person_name, position FROM ar_report_signer ORDER BY slot`;
const UPDATE_SQL = `UPDATE ar_report_signer SET role_label = $2, person_name = $3, position = $4, updated_by = $5, updated_at = now() WHERE slot = $1`;
const missingTable = (e: unknown) => (e as { code?: string }).code === "42P01";

export async function GET() {
  const user = await sessionUser();
  if (!user) return fail("unauthorized", 401);
  try {
    const signers = await insightQuery<Signer>(LIST_SQL);
    return Response.json({ signers, can_edit: user.admin, migrated: true } satisfies SignerList);
  } catch (e) {
    if (!missingTable(e)) throw e;
    return Response.json({ signers: DEFAULT_SIGNERS, can_edit: user.admin, migrated: false } satisfies SignerList);
  }
}

/** PUT { signers: [3 ช่อง] } เฉพาะ admin */
export async function PUT(request: Request) {
  const user = await sessionUser();
  if (!user) return fail("unauthorized", 401);
  if (!user.admin) return fail("forbidden", 403);
  const parsed = parseSigners(await request.json().catch(() => null));
  if (!parsed.ok) return fail(parsed.error);
  try {
    await insightTransaction(async (tx) => {
      for (const s of parsed.signers) await tx(UPDATE_SQL, [s.slot, s.role_label, s.person_name, s.position, user.name]);
    });
  } catch (e) {
    if (!missingTable(e)) throw e;
    return fail("ยังไม่ได้รัน migration ผู้ลงนาม (202611252200_ar_report_signer.sql)", 503);
  }
  return Response.json({ signers: parsed.signers, can_edit: true, migrated: true } satisfies SignerList);
}
