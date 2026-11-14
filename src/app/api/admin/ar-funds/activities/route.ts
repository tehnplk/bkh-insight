import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { insightQuery } from "@/lib/db";
import { loadLookups } from "@/app/api/fund/_lib/fund";
import { ICD_PATTERN, parseCodeList } from "../rules";
import { itemNames } from "../sql";

async function adminName() {
  const session = await auth();
  if (!session) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (session.user.role !== "admin") return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { name: session.user.name ?? "admin" };
}
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const ID_RE = /^[1-9]\d{0,17}$/;

// เพิ่ม (ไม่มี id) หรือแก้ (มี id) กิจกรรมย่อย: { id?, rule_code, name, items_mode: any|all, incomes[], icodes, icd10, icd_scope: any|pdx, active }
export async function POST(request: Request) {
  const { error, name: user } = await adminName();
  if (error) return error;
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("body ต้องเป็น JSON");
  const id = b.id == null || b.id === "" ? null : String(b.id);
  if (id && !ID_RE.test(id)) return bad("id ไม่ถูกต้อง");
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 200) return bad("ต้องระบุชื่อกิจกรรม ไม่เกิน 200 ตัวอักษร");
  const incomes = parseCodeList(b.incomes, /^\d{2}$/);
  const icodes = parseCodeList(b.icodes, /^\d{7}$/);
  const icd10 = parseCodeList(b.icd10, ICD_PATTERN);
  if (!Array.isArray(incomes)) return bad(`หมวดรายรับไม่ถูกต้อง: ${incomes.invalid}`);
  if (!Array.isArray(icodes)) return bad(`รหัสรายการ (7 หลัก) ไม่ถูกต้อง: ${icodes.invalid}`);
  if (!Array.isArray(icd10)) return bad(`ICD-10 ไม่ถูกต้อง: ${icd10.invalid}`);
  if (!incomes.length && !icodes.length) return bad("ระบุหมวดรายรับหรือรหัสรายการอย่างน้อยหนึ่งอย่าง");
  const items_mode = b.items_mode === "all" ? "all" : "any";
  const icd_scope = b.icd_scope === "pdx" ? "pdx" : "any";
  const active = b.active !== false;

  const [lk, known] = await Promise.all([loadLookups(), itemNames(icodes)]);
  const badIncome = incomes.find((i) => !lk.income.has(i));
  if (badIncome) return bad(`ไม่พบหมวดรายรับ ${badIncome} ใน HOSxP`);
  const knownSet = new Set(known.map((k) => k.code));
  const missing = icodes.filter((i) => !knownSet.has(i));
  if (missing.length) return bad(`ไม่พบรหัสรายการใน HOSxP: ${missing.slice(0, 10).join(", ")}`);

  const args = [name, items_mode, incomes, icodes, icd10, icd_scope, active, user];
  const rows = id
    ? await insightQuery<{ id: string }>(
        `UPDATE ar_fund_activity SET name = $2, items_mode = $3, incomes = $4, icodes = $5, icd10 = $6, icd_scope = $7, active = $8, updated_by = $9, updated_at = now()
WHERE id = $1 RETURNING id`,
        [id, ...args],
      )
    : typeof b.rule_code === "string" && (await insightQuery("SELECT 1 FROM ar_fund_rule WHERE code = $1", [b.rule_code])).length
      ? await insightQuery<{ id: string }>(
          `INSERT INTO ar_fund_activity (rule_code, name, items_mode, incomes, icodes, icd10, icd_scope, active, updated_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [b.rule_code, ...args],
        )
      : null;
  if (!rows) return bad("ไม่พบกติกา", 404);
  if (!rows.length) return bad("ไม่พบกิจกรรม", 404);
  return Response.json(rows[0]);
}

// ลบกิจกรรม ?id=
export async function DELETE(request: NextRequest) {
  const { error } = await adminName();
  if (error) return error;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!ID_RE.test(id)) return bad("id ไม่ถูกต้อง");
  const rows = await insightQuery("DELETE FROM ar_fund_activity WHERE id = $1 RETURNING id", [id]);
  if (!rows.length) return bad("ไม่พบกิจกรรม", 404);
  return Response.json({ id });
}
