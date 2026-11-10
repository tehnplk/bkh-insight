import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { insightQuery } from "@/lib/db";
import { loadLookups, UNKNOWN_FUND } from "@/app/api/fund/_lib/fund";
import type { PatientType } from "@/app/api/fund/ar-sync/ledger";

export type ArAccount = { code: string; name: string };
export type ArAccountMap = {
  id: string;
  hipdata_code: string | null;
  pttype: string | null;
  patient_type: PatientType;
  account_code: string;
  updated_by: string | null;
  updated_at: string;
};
/** กลุ่มรายการใน ledger ที่ยังไม่มีบัญชี */
export type Unassigned = { patient_type: PatientType; pttype: string | null; hipdata_code: string | null; refs: number; amount: string };
export type Option = { code: string; name: string };

/** response ของ GET /api/admin/ar-accounts */
export type ArAccountsData = {
  accounts: ArAccount[];
  maps: ArAccountMap[];
  unassigned: Unassigned[];
  funds: Option[];
  pttypes: (Option & { fund: string })[];
};

// proxy.ts กันไว้แล้ว แต่ route ใต้ /api/admin ต้องเช็คเองซ้ำ (เหมือน /api/admin/users)
async function adminSession() {
  const session = await auth();
  if (!session) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (session.user.role !== "admin") return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { name: session.user.name ?? "admin" };
}
const bad = (error: string) => Response.json({ error }, { status: 400 });

export async function GET() {
  const { error } = await adminSession();
  if (error) return error;
  const [accounts, maps, unassigned, lk] = await Promise.all([
    insightQuery<ArAccount>("SELECT code, name FROM ar_account ORDER BY code"),
    insightQuery<ArAccountMap>(
      `SELECT id, hipdata_code, pttype, patient_type, account_code, updated_by, to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at
FROM ar_account_map ORDER BY hipdata_code NULLS LAST, pttype, patient_type DESC`,
    ),
    insightQuery<Unassigned>(
      `SELECT patient_type, pttype, hipdata_code, count(DISTINCT ref)::int AS refs, SUM(amount) AS amount
FROM ar_ledger WHERE account_code IS NULL
GROUP BY patient_type, pttype, hipdata_code HAVING SUM(amount) <> 0 ORDER BY SUM(amount) DESC`,
    ),
    loadLookups(),
  ]);
  const fundCodes = [...new Set([...lk.pttype.values()].map((p) => p.fund))].filter((f) => f !== UNKNOWN_FUND).sort();
  const body: ArAccountsData = {
    accounts,
    maps,
    unassigned,
    funds: fundCodes.map((code) => ({ code, name: lk.fundName(code) })),
    pttypes: [...lk.pttype].map(([code, p]) => ({ code, name: p.name, fund: p.fund })).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })),
  };
  return Response.json(body);
}

// ตั้งบัญชีให้กองทุนหรือ pttype (มีอยู่แล้ว = แก้บัญชี): { hipdata_code | pttype, patient_type: "OP" | "IP", account_code }
export async function POST(request: Request) {
  const { error, name } = await adminSession();
  if (error) return error;
  const body = await request.json().catch(() => null);
  const { hipdata_code, pttype, patient_type, account_code } = body ?? {};
  if ((typeof hipdata_code === "string") === (typeof pttype === "string")) return bad("ส่ง hipdata_code หรือ pttype อย่างใดอย่างหนึ่ง");
  if (patient_type !== "OP" && patient_type !== "IP") return bad("patient_type ต้องเป็น OP หรือ IP");
  if (typeof account_code !== "string") return bad("ต้องระบุ account_code");
  if (hipdata_code === "UCS" && patient_type === "OP") return bad("UCS OP แยกบัญชีตามหน่วยบริการประจำ ถ้าต้องการกำหนดเองให้ตั้งราย pttype");

  const lk = await loadLookups();
  const known = typeof pttype === "string" ? lk.pttype.has(pttype) : [...lk.pttype.values()].some((p) => p.fund === hipdata_code);
  if (!known) return bad(typeof pttype === "string" ? "ไม่พบ pttype นี้ใน HOSxP" : "ไม่พบกองทุนนี้ใน HOSxP");
  const [account] = await insightQuery("SELECT 1 FROM ar_account WHERE code = $1", [account_code]);
  if (!account) return bad("ไม่พบรหัสบัญชีนี้ในผังบัญชี");

  const key = typeof pttype === "string" ? "pttype" : "hipdata_code"; // ชื่อคอลัมน์จากค่าคงที่ในโค้ด
  const [row] = await insightQuery<{ id: string }>(
    `INSERT INTO ar_account_map (${key}, patient_type, account_code, updated_by) VALUES ($1, $2, $3, $4)
ON CONFLICT (${key}, patient_type) WHERE ${key} IS NOT NULL
DO UPDATE SET account_code = EXCLUDED.account_code, updated_by = EXCLUDED.updated_by, updated_at = now()
RETURNING id`,
    [pttype ?? hipdata_code, patient_type, account_code, name],
  );
  return Response.json(row);
}

// ลบการจับคู่ ?id= (รายการที่ตั้งบัญชีไปแล้วคงบัญชีเดิม)
export async function DELETE(request: NextRequest) {
  const { error } = await adminSession();
  if (error) return error;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[1-9]\d{0,17}$/.test(id)) return bad("id ต้องเป็นจำนวนเต็มบวก");
  const rows = await insightQuery("DELETE FROM ar_account_map WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) return Response.json({ error: "ไม่พบรายการ" }, { status: 404 });
  return Response.json({ id });
}
