import "server-only";
import { hisQuery } from "@/lib/db";
import { hipdataGroupOf, hipdataLabel, NO_HIPDATA, type HipdataOption, type PttypeOption } from "./opd-visit";

/**
 * ตัวเลือกของ filter สิทธิ: pttype ที่ isuse = 'Y' (~160 แถว อ่านทั้งตาราง) กับกลุ่มสิทธิ = hipdata_code ที่ไม่ซ้ำของสิทธิเหล่านั้น
 * ชื่อกลุ่มจาก pttype_coverage_group (PK = รหัส hipdata, eq_ref) รหัสที่ไม่มีในตารางนั้น (เช่น A2, CSH, INS) แสดงรหัสอย่างเดียว
 * อ่าน HIS ไม่สำเร็จให้รายการว่าง หน้าที่เรียกยังทำงานและแสดง error ของตัวเอง
 */
export async function loadPttypeOptions(): Promise<{ pttypes: PttypeOption[]; groups: HipdataOption[] }> {
  try {
    const rows = await hisQuery<{ code: string; name: string | null; hipdata: string | null; hipdataName: string | null }>(
      `SELECT t.pttype AS code, t.name, t.hipdata_code AS hipdata, g.pttype_coverage_group_name AS hipdataName
       FROM pttype t
       LEFT JOIN pttype_coverage_group g ON g.pttype_coverage_group_code = t.hipdata_code
       WHERE t.isuse = 'Y'
       ORDER BY t.pttype`,
    );
    const groups = new Map<string, HipdataOption>();
    const pttypes = rows.map((r) => {
      const group = hipdataGroupOf(r.hipdata);
      if (!groups.has(group)) groups.set(group, { value: group, label: hipdataLabel(group, r.hipdataName) });
      return { code: r.code, name: r.name ?? "", group };
    });
    return { pttypes, groups: [...groups.values()].sort(byGroup) };
  } catch (e) {
    console.error("pttype options query failed", (e as { code?: string }).code ?? e);
    return { pttypes: [], groups: [] };
  }
}

/** เรียงตามรหัส hipdata และ "ไม่ระบุ" ไว้ท้ายสุด */
export const byGroup = (a: { value: string }, b: { value: string }) =>
  Number(a.value === NO_HIPDATA) - Number(b.value === NO_HIPDATA) || a.value.localeCompare(b.value);
