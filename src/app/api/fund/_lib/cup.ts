import "server-only";
import { hisQuery, insightQuery } from "@/lib/db";
import { effectiveCup } from "../claim-type/claim-type";

// หน่วยบริการใน CUP: ค่าเริ่มต้น = hospcode 5 หลักในอำเภอเดียวกับโรงพยาบาล (opdconfig.hospitalcode) ไม่รวมคลินิกเอกชน (hospital_type_id 16)
// admin เพิ่ม/นำออกได้ที่ /admin/cup (ตาราง cup_hospcode ของ insight)
const OWN_SQL = `SELECT h.hospcode, h.name, h.chwpart, h.amppart FROM opdconfig c JOIN hospcode h ON h.hospcode = c.hospitalcode LIMIT 1`;
const DEFAULT_SQL = `SELECT hospcode AS hcode, name FROM hospcode
WHERE chwpart = ? AND amppart = ? AND hospcode REGEXP '^[0-9]{5}$' AND IFNULL(hospital_type_id, 0) <> 16 ORDER BY hospcode`;
const OVERRIDE_SQL = `SELECT hcode, mode, note, updated_by, to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at FROM cup_hospcode ORDER BY hcode`;

export type CupOverride = { hcode: string; mode: "include" | "exclude"; note: string | null; updated_by: string; updated_at: string };
export type Cup = {
  own: { hcode: string; name: string | null; chw: string; amp: string };
  defaults: { hcode: string; name: string | null }[];
  overrides: CupOverride[];
  /** CUP จริง เรียงตามรหัส */
  cup: string[];
};

export async function loadCup(): Promise<Cup> {
  const [[own], overrides] = await Promise.all([
    hisQuery<{ hospcode: string; name: string | null; chwpart: string; amppart: string }>(OWN_SQL),
    insightQuery<CupOverride>(OVERRIDE_SQL),
  ]);
  if (!own) throw new Error("ไม่พบรหัสโรงพยาบาล (opdconfig.hospitalcode) ในตาราง hospcode");
  const defaults = await hisQuery<{ hcode: string; name: string | null }>(DEFAULT_SQL, [own.chwpart, own.amppart]);
  const cup = [...effectiveCup(defaults.map((d) => d.hcode), overrides, own.hospcode)].sort();
  return { own: { hcode: own.hospcode, name: own.name, chw: own.chwpart, amp: own.amppart }, defaults, overrides, cup };
}
