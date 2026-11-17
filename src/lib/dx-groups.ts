// กลุ่มโรค (ICD-10) ที่ใช้กรอง admission และนับบนหน้าแรก: นิยามที่เดียว pure ไม่มี import ใช้ได้ทั้ง route และหน้า (client)
// ช่วงเทียบ LEFT(icd10, 3) แบบรวมปลาย เพราะ iptdiag.icd10 ของ HOSxP ไม่มีจุด (E43, E440, E441)

export const DX_GROUPS = [
  { key: "malnutrition", label: "ภาวะทุพโภชนาการ (E40–E46)", ranges: [["E40", "E46"]] },
] as const satisfies readonly { key: string; label: string; ranges: readonly (readonly [string, string])[] }[];
export type DxKey = (typeof DX_GROUPS)[number]["key"];

/** ตำแหน่งรหัส: pdx = diagtype 1 (โรคหลัก) ; sdx = diagtype อื่นหรือว่าง (2 โรคร่วม 3 แทรกซ้อน 4 อื่นๆ 5 สาเหตุภายนอก) */
export const DX_POSITIONS = [
  { key: "all", label: "ทุกตำแหน่งรหัส" },
  { key: "pdx", label: "โรคหลัก" },
  { key: "sdx", label: "โรคร่วม/แทรกซ้อน" },
] as const;
export type DxPos = (typeof DX_POSITIONS)[number]["key"];

/** ?dx=a,b&dxpos=pdx -> กลุ่มที่เลือก ; ไม่ส่ง dx = null (ไม่กรอง ไม่สน dxpos) ; key หรือ dxpos ที่ไม่รู้จัก = "invalid" */
export function parseDx(rawDx: string | null, rawPos: string | null): { keys: DxKey[]; pos: DxPos } | null | "invalid" {
  const keys = [...new Set((rawDx ?? "").split(",").map((k) => k.trim()).filter(Boolean))];
  const pos = rawPos || "all";
  if (!DX_POSITIONS.some((p) => p.key === pos)) return "invalid";
  if (!keys.length) return null;
  if (!keys.every((k) => DX_GROUPS.some((g) => g.key === k))) return "invalid";
  return { keys: keys as DxKey[], pos: pos as DxPos };
}

/** `((LEFT(icd10, 3) BETWEEN ? AND ?) OR …)` + ตำแหน่ง ; params มาจาก DX_GROUPS เท่านั้น (ผู้ใช้ส่งแค่ key) ห้ามเรียกด้วย keys ว่าง */
export function dxGroupSql(cols: { icd10: string; diagtype?: string }, keys: readonly DxKey[], pos: DxPos = "all") {
  const ranges = DX_GROUPS.filter((g) => keys.includes(g.key)).flatMap((g) => g.ranges);
  const parts = ranges.map(() => `(LEFT(${cols.icd10}, 3) BETWEEN ? AND ?)`);
  // วงเล็บครอบ OR ก่อนต่อ AND ของตำแหน่ง
  const ors = parts.length > 1 ? `(${parts.join(" OR ")})` : parts.join("");
  const posSql = pos === "pdx" ? ` AND ${cols.diagtype} = '1'` : pos === "sdx" ? ` AND (${cols.diagtype} IS NULL OR ${cols.diagtype} <> '1')` : "";
  return { sql: posSql ? `(${ors}${posSql})` : ors, params: ranges.flat() as string[] };
}
