import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { insightQuery } from "@/lib/db";
import { UNKNOWN_FUND, loadLookups } from "@/app/api/fund/_lib/fund";
import { ICD_PATTERN, parseCodeList, type FundRule } from "./rules";
import { itemNames, loadFundRules } from "./sql";

export type Option = { code: string; name: string };
/** response ของ GET /api/admin/ar-funds */
export type ArFundsData = {
  rules: FundRule[];
  accounts: Option[];
  incomes: Option[];
  funds: Option[];
  pttypes: (Option & { fund: string })[];
  /** คอลัมน์กองทุนที่มีใน REP ผู้ป่วยนอก (rep_row.fund_amounts) */
  repKeys: string[];
  /** เดือนล่าสุดที่มี REP ผู้ป่วยนอก (YYYY-MM) */
  repLatest: string | null;
};

const CODE_RE = /^[A-Z][A-Z0-9_]{0,15}$/;
const ICODE_RE = /^\d{7}$/;

// proxy.ts กันไว้แล้ว แต่ route ใต้ /api/admin ต้องเช็คเองซ้ำ (เหมือน /api/admin/ar-accounts)
async function adminSession() {
  const session = await auth();
  if (!session) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (session.user.role !== "admin") return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { name: session.user.name ?? "admin" };
}
const bad = (error: string) => Response.json({ error }, { status: 400 });

const repKeysSql = `SELECT DISTINCT k AS key FROM rep_row r, jsonb_object_keys(r.fund_amounts) k WHERE r.patient_type = 'OP' ORDER BY 1`;

export async function GET() {
  const { error } = await adminSession();
  if (error) return error;
  const [rules, accounts, keys, latest, lk] = await Promise.all([
    loadFundRules(),
    insightQuery<Option>("SELECT code, name FROM ar_account ORDER BY code"),
    insightQuery<{ key: string }>(repKeysSql),
    insightQuery<{ month: string | null }>("SELECT to_char(max(admit_at), 'YYYY-MM') AS month FROM rep_row WHERE patient_type = 'OP'"),
    loadLookups(),
  ]);
  const body: ArFundsData = {
    rules,
    accounts,
    incomes: [...lk.income].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code)),
    funds: [...new Set([...lk.pttype.values()].map((p) => p.fund))].filter((f) => f !== UNKNOWN_FUND).sort().map((code) => ({ code, name: lk.fundName(code) })),
    pttypes: [...lk.pttype].filter(([, p]) => p.active).map(([code, p]) => ({ code, name: p.name, fund: p.fund })).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })),
    repKeys: keys.map((k) => k.key),
    repLatest: latest[0]?.month ?? null,
  };
  return Response.json(body);
}

// เพิ่มหรือแก้กติกา (code มีอยู่แล้ว = แก้): { code, name, match_mode, hipdata_codes[], pttypes[], incomes[], icodes, icd10, icd_scope,
//   required_icodes, rep_keys[], account_op, account_ip } (กิจกรรมย่อยแก้ที่ /api/admin/ar-funds/activities)
export async function POST(request: Request) {
  const { error, name: user } = await adminSession();
  if (error) return error;
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("body ต้องเป็น JSON");
  const code = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
  if (!CODE_RE.test(code)) return bad("รหัสกองทุนต้องเป็นอักษรอังกฤษตัวแรก ตามด้วยอักษร ตัวเลข หรือ _ ไม่เกิน 16 ตัว");
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 200) return bad("ต้องระบุชื่อกองทุน ไม่เกิน 200 ตัวอักษร");

  const lists = {
    hipdata_codes: parseCodeList(b.hipdata_codes, /^[A-Z0-9]{2,6}$/),
    incomes: parseCodeList(b.incomes, /^\d{2}$/),
    pttypes: parseCodeList(b.pttypes, /^[0-9A-Z]{1,4}$/),
    icodes: parseCodeList(b.icodes, ICODE_RE),
    required_icodes: parseCodeList(b.required_icodes, ICODE_RE),
    icd10: parseCodeList(b.icd10, ICD_PATTERN),
  };
  const LABEL = { hipdata_codes: "กองทุน", incomes: "หมวดรายรับ", pttypes: "สิทธิ", icodes: "รหัสรายการ (7 หลัก)", required_icodes: "รายการจำเป็น (7 หลัก)", icd10: "ICD-10 (เช่น E11 หรือ C00-C96)" } as const;
  for (const [k, v] of Object.entries(lists)) if (!Array.isArray(v)) return bad(`${LABEL[k as keyof typeof LABEL]} ไม่ถูกต้อง: ${v.invalid}`);
  const { hipdata_codes, incomes, pttypes, icodes, required_icodes, icd10 } = lists as Record<keyof typeof lists, string[]>;
  const match_mode = b.match_mode ?? "items";
  if (!["items", "rights", "icd"].includes(match_mode)) return bad("match_mode ต้องเป็น items, rights หรือ icd");
  if (match_mode === "icd" && !icd10.length) return bad("แบบตามรหัสโรคต้องระบุ ICD-10 อย่างน้อยหนึ่งรหัส");
  const icd_scope = b.icd_scope === "pdx" ? "pdx" : "any";
  if (!hipdata_codes.length) return bad("เลือกกองทุนอย่างน้อยหนึ่งกองทุน");
  if (icodes.length > 2000 || icd10.length > 200) return bad("รหัสรายการได้ไม่เกิน 2,000 รหัส และ ICD-10 ไม่เกิน 200 รหัส");
  const rep_keys = Array.isArray(b.rep_keys) ? [...new Set(b.rep_keys.filter((k: unknown) => typeof k === "string"))] as string[] : [];
  const account = (v: unknown) => (typeof v === "string" && v ? v : null);
  const account_op = account(b.account_op);
  const account_ip = account(b.account_ip);

  const [lk, known, keys, accounts] = await Promise.all([
    loadLookups(),
    itemNames([...new Set([...icodes, ...required_icodes])]),
    insightQuery<{ key: string }>(repKeysSql),
    insightQuery<{ code: string }>("SELECT code FROM ar_account WHERE code = ANY($1)", [[account_op, account_ip].filter(Boolean)]),
  ]);
  const fundSet = new Set([...lk.pttype.values()].map((p) => p.fund));
  const badFund = hipdata_codes.find((f) => !fundSet.has(f));
  if (badFund) return bad(`ไม่พบกองทุน ${badFund} ใน HOSxP`);
  const badIncome = incomes.find((i) => !lk.income.has(i));
  if (badIncome) return bad(`ไม่พบหมวดรายรับ ${badIncome} ใน HOSxP`);
  const knownSet = new Set(known.map((k) => k.code));
  const badPt = pttypes.find((p) => !lk.pttype.has(p));
  if (badPt) return bad(`ไม่พบสิทธิ ${badPt} ใน HOSxP`);
  const missing = [...icodes, ...required_icodes].filter((i) => !knownSet.has(i));
  if (missing.length) return bad(`ไม่พบรหัสรายการใน HOSxP: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` และอีก ${missing.length - 10} รหัส` : ""}`);
  const keySet = new Set(keys.map((k) => k.key));
  const badKey = rep_keys.find((k) => !keySet.has(k));
  if (badKey) return bad(`ไม่พบคอลัมน์ ${badKey} ใน REP`);
  const accSet = new Set(accounts.map((a) => a.code));
  if ((account_op && !accSet.has(account_op)) || (account_ip && !accSet.has(account_ip))) return bad("ไม่พบรหัสบัญชีในผังบัญชี");

  const [row] = await insightQuery<{ code: string }>(
    `INSERT INTO ar_fund_rule (code, name, hipdata_codes, incomes, icodes, icd10, rep_keys, account_op, account_ip, updated_by,
  match_mode, pttypes, icd_scope, required_icodes)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, hipdata_codes = EXCLUDED.hipdata_codes, incomes = EXCLUDED.incomes,
  icodes = EXCLUDED.icodes, icd10 = EXCLUDED.icd10, rep_keys = EXCLUDED.rep_keys, account_op = EXCLUDED.account_op,
  account_ip = EXCLUDED.account_ip, updated_by = EXCLUDED.updated_by, updated_at = now(),
  match_mode = EXCLUDED.match_mode, pttypes = EXCLUDED.pttypes, icd_scope = EXCLUDED.icd_scope, required_icodes = EXCLUDED.required_icodes
RETURNING code`,
    [code, name, hipdata_codes, incomes, icodes, icd10, rep_keys, account_op, account_ip, user, match_mode, pttypes, icd_scope, required_icodes],
  );
  return Response.json(row);
}

// ลบกติกา ?code=
export async function DELETE(request: NextRequest) {
  const { error } = await adminSession();
  if (error) return error;
  const code = request.nextUrl.searchParams.get("code") ?? "";
  if (!CODE_RE.test(code)) return bad("code ไม่ถูกต้อง");
  const rows = await insightQuery("DELETE FROM ar_fund_rule WHERE code = $1 RETURNING code", [code]);
  if (!rows.length) return Response.json({ error: "ไม่พบกติกา" }, { status: 404 });
  return Response.json({ code });
}
