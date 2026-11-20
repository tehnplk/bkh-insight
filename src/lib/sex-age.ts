// เพศ + อายุแบบ pure (ไม่มี import) ใช้ได้ทั้ง route และหน้า (client)

const SEX: Record<string, string> = { "1": "ชาย", "2": "หญิง" };

/** "ชาย 25ปี 10ด 15ว" แสดงครบทุกหน่วยที่มีค่า (รวม 0) ; เพศอื่น/ไม่มีค่า = ไม่แสดงส่วนนั้น ; ไม่มีทั้งหมด = null */
export function sexAgeText(sex: string | null, y: number | null, m: number | null, d: number | null): string | null {
  const age = [[y, "ปี"], [m, "ด"], [d, "ว"]].filter(([v]) => v != null).map(([v, u]) => `${v}${u}`);
  return [SEX[sex?.trim() ?? ""], ...age].filter(Boolean).join(" ") || null;
}
