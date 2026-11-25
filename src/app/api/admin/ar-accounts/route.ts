import type { NextRequest } from "next/server";
import { cacheLife } from "next/cache";
import { auth } from "@/auth";
import { hisQuery, insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { loadLookups } from "@/app/api/fund/_lib/fund";
import { LOCS, type AccountRule, type Loc, type PatientType, type Right } from "@/app/api/fund/ar-sync/ledger";

export type ArAccount = {
  code: string;
  name: string;
  /** บัญชีรายได้คู่ และบัญชีส่วนต่าง (ชื่อตามผังบัญชี สธ.: ส่วนต่างค่ารักษาที่สูงกว่าข้อตกลง = Dr เมื่อได้รับต่ำกว่า, ที่ต่ำกว่าข้อตกลง = Cr เมื่อได้รับสูงกว่า) สำหรับสมุดรายวัน */
  revenue_code: string | null;
  diff_under_code: string | null;
  diff_over_code: string | null;
  /** ตัดหนี้ด้วย STM ได้ (บัญชีที่จ่ายรายครั้ง) */
  settles_by_stm: boolean;
  /** กลุ่มเรียกเก็บ (ar_collect_group) ตามโปรแกรม Claim ของการเงิน */
  collect_group: number | null;
  /** บัญชี Dr เมื่อตัดหนี้อัตโนมัติ เช่น .201 ตัดด้วยเงินเหมาจ่ายรายหัว */
  clear_code: string | null;
};
export type CollectGroup = { id: number; name: string; send_mode: "book" | "claim" | "auto" | "none" };
export type Edited = { updated_by: string | null; updated_at: string };
export type RightPttype = Edited & { pttype: string; right_code: string };
export type RuleRow = AccountRule & Edited;
/** กลุ่มรายการใน ledger ที่ยังไม่มีบัญชี */
export type Unassigned = { patient_type: PatientType; pttype: string | null; hipdata_code: string | null; refs: number; amount: string };

/** response ของ GET /api/admin/ar-accounts */
export type ArAccountsData = {
  accounts: ArAccount[];
  groups: CollectGroup[];
  rights: Right[];
  /** pttype -> กลุ่มสิทธิ */
  rightPttypes: RightPttype[];
  rules: RuleRow[];
  unassigned: Unassigned[];
  /** pttype ของ HOSxP */
  pttypes: { code: string; name: string; fund: string }[];
  /** บัญชีที่มีรายการใน ledger */
  used: string[];
};

// proxy.ts กันไว้แล้ว แต่ route ใต้ /api/admin ต้องเช็คเองซ้ำ (เหมือน /api/admin/users)
async function adminSession() {
  const session = await auth();
  if (!session) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (session.user.role !== "admin") return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { name: session.user.name ?? "admin" };
}
const bad = (error: string) => Response.json({ error }, { status: 400 });
const EDITED = "updated_by, to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at";

// pttype ที่เลิกใช้ (isuse <> 'Y') แต่ยังมี visit/จำหน่ายใน 12 เดือน ; FORCE INDEX (dchdate) ไม่งั้นสแกน ipt ทั้งตาราง (~1.3 วินาที จึง cache ตามวันตัด)
async function recentInactivePttypes(cutoff: string): Promise<string[]> {
  "use cache";
  cacheLife("hours");
  const rows = await hisQuery<{ pttype: string }>(
    `SELECT t.pttype
FROM pttype t
WHERE NOT (t.isuse <=> 'Y')
  AND (EXISTS (SELECT 1 FROM ovst o WHERE o.pttype = t.pttype AND o.vstdate >= ?)
    OR EXISTS (SELECT 1 FROM ipt i FORCE INDEX (dchdate) WHERE i.pttype = t.pttype AND i.dchdate >= ?))
LIMIT 200`,
    [cutoff, cutoff],
  );
  return rows.map((r) => r.pttype);
}

export async function GET() {
  const { error } = await adminSession();
  if (error) return error;
  const [y, m, d] = todayIso().split("-").map(Number);
  const cutoff = new Date(Date.UTC(y - 1, m - 1, d)).toISOString().slice(0, 10);
  const [accounts, groups, rights, rightPttypes, rules, unassigned, lk, used, recent, ledger] = await Promise.all([
    insightQuery<ArAccount>("SELECT code, name, revenue_code, diff_under_code, diff_over_code, settles_by_stm, collect_group, clear_code FROM ar_account ORDER BY code"),
    insightQuery<CollectGroup>("SELECT id, name, send_mode FROM ar_collect_group ORDER BY sort"),
    insightQuery<Right>("SELECT code, name, main_hcode, books_ar FROM ar_right ORDER BY code"),
    insightQuery<RightPttype>(`SELECT pttype, right_code, ${EDITED} FROM ar_right_pttype`),
    insightQuery<RuleRow>(`SELECT right_code, patient_type, loc, account_code, cap, debt_pct, ${EDITED} FROM ar_account_rule
ORDER BY right_code, patient_type DESC, array_position($1::text[], loc)`, [LOCS]),
    insightQuery<Unassigned>(
      `SELECT patient_type, pttype, hipdata_code, count(DISTINCT ref)::int AS refs, SUM(amount) AS amount
FROM ar_ledger WHERE account_code IS NULL
GROUP BY patient_type, pttype, hipdata_code HAVING SUM(amount) <> 0 ORDER BY SUM(amount) DESC`,
    ),
    loadLookups(),
    insightQuery<{ code: string }>("SELECT DISTINCT account_code AS code FROM ar_ledger WHERE account_code IS NOT NULL"),
    recentInactivePttypes(cutoff).then((c) => new Set(c)),
    insightQuery<{ pttype: string }>("SELECT DISTINCT pttype FROM ar_ledger WHERE pttype IS NOT NULL").then((r) => new Set(r.map((x) => x.pttype))),
  ]);
  const mapped = new Set(rightPttypes.map((r) => r.pttype));
  const body: ArAccountsData = {
    accounts,
    groups,
    rights,
    rightPttypes,
    rules,
    unassigned,
    used: used.map((u) => u.code),
    // ซ่อน pttype ที่เลิกใช้แล้ว: แสดงเฉพาะที่ใช้อยู่ มีใช้ใน 12 เดือน มีใน ledger หรือจับคู่ไว้แล้ว
    pttypes: [...lk.pttype].filter(([code, p]) => p.active || recent.has(code) || ledger.has(code) || mapped.has(code)).map(([code, p]) => ({ code, name: p.name, fund: p.fund })).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })),
  };
  return Response.json(body);
}

/** เพดาน (บาท) หรือ % จาก body: null/"" = ไม่กำหนด, ค่าผิด = undefined */
function amount(v: unknown, max: number): number | null | undefined {
  if (v == null || v === "") return null;
  const n = Number(v);
  return /^\d+(\.\d{1,2})?$/.test(String(v).trim()) && n > 0 && n < max ? n : undefined;
}

/**
 * แก้กติกา (ตรวจทุกค่าที่นี่ ใช้ค่าที่ตรวจแล้วเท่านั้น):
 * - { pttype, right_code } จับคู่ pttype กับกลุ่มสิทธิ (right_code = null คือเลิกจับคู่)
 * - { right_code, patient_type, loc, account_code, cap?, debt_pct? } ตั้งบัญชีของกลุ่มสิทธิ × OP/IP × ที่ตั้ง (มีอยู่แล้ว = แก้)
 * มีผลกับรายการใหม่ทันที รายการเดิมเปลี่ยนเมื่อกด "คำนวณบัญชีใหม่"
 */
export async function POST(request: Request) {
  const { error, name } = await adminSession();
  if (error) return error;
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("body ไม่ถูกต้อง");
  const right = typeof b.right_code === "string" ? (await insightQuery("SELECT 1 FROM ar_right WHERE code = $1", [b.right_code]))[0] : null;

  if ("pttype" in b) {
    if (typeof b.pttype !== "string" || !(await loadLookups()).pttype.has(b.pttype)) return bad("ไม่พบ pttype นี้ใน HOSxP");
    if (b.right_code === null) {
      await insightQuery("DELETE FROM ar_right_pttype WHERE pttype = $1", [b.pttype]);
      return Response.json({ pttype: b.pttype, right_code: null });
    }
    if (!right) return bad("ไม่พบกลุ่มสิทธินี้");
    const [row] = await insightQuery<{ pttype: string }>(
      `INSERT INTO ar_right_pttype (pttype, right_code, updated_by) VALUES ($1, $2, $3)
ON CONFLICT (pttype) DO UPDATE SET right_code = EXCLUDED.right_code, updated_by = EXCLUDED.updated_by, updated_at = now()
RETURNING pttype`,
      [b.pttype, b.right_code, name],
    );
    return Response.json(row);
  }

  if (!right) return bad("ไม่พบกลุ่มสิทธินี้");
  if (b.patient_type !== "OP" && b.patient_type !== "IP") return bad("patient_type ต้องเป็น OP หรือ IP");
  if (!LOCS.includes(b.loc as Loc)) return bad("ที่ตั้งหน่วยบริการประจำไม่ถูกต้อง");
  if (typeof b.account_code !== "string" || !(await insightQuery("SELECT 1 FROM ar_account WHERE code = $1", [b.account_code])).length)
    return bad("ไม่พบรหัสบัญชีนี้ในผังบัญชี");
  const cap = amount(b.cap, 1e10), pct = amount(b.debt_pct, 100);
  if (cap === undefined) return bad("เพดานต้องเป็นจำนวนเงินมากกว่า 0 ทศนิยมไม่เกิน 2 ตำแหน่ง");
  if (pct === undefined) return bad("สัดส่วนลูกหนี้ต้องมากกว่า 0 และน้อยกว่า 100");
  if (cap != null && pct != null) return bad("ใส่เพดานหรือสัดส่วนอย่างใดอย่างหนึ่ง");
  await insightQuery(
    `INSERT INTO ar_account_rule (right_code, patient_type, loc, account_code, cap, debt_pct, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (right_code, patient_type, loc) DO UPDATE SET account_code = EXCLUDED.account_code, cap = EXCLUDED.cap, debt_pct = EXCLUDED.debt_pct,
  updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [b.right_code, b.patient_type, b.loc, b.account_code, cap, pct, name],
  );
  return Response.json({ right_code: b.right_code, patient_type: b.patient_type, loc: b.loc });
}

// ลบกติกา ?right_code=&patient_type=&loc= (รายการที่ตั้งบัญชีไปแล้วคงบัญชีเดิม)
export async function DELETE(request: NextRequest) {
  const { error } = await adminSession();
  if (error) return error;
  const p = request.nextUrl.searchParams;
  const rows = await insightQuery("DELETE FROM ar_account_rule WHERE right_code = $1 AND patient_type = $2 AND loc = $3 RETURNING right_code", [
    p.get("right_code") ?? "", p.get("patient_type") ?? "", p.get("loc") ?? "",
  ]);
  if (!rows.length) return Response.json({ error: "ไม่พบกติกา" }, { status: 404 });
  return Response.json({ ok: true });
}
