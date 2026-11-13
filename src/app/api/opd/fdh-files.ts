import "server-only";
import { hisQuery } from "@/lib/db";
import { inList } from "@/app/api/fund/_lib/fund";
import { MAX_EXPORT_VNS, OPD_MAX_DAYS } from "./admissions/admissions";

/** เลือก visit ของผู้ป่วยนอก (ใช้ร่วม /api/opd/fdh-export และ /api/opd/fdh-check) */
export type OpdSelection = { vns: string[]; vnSet: Set<string>; hnSet: Set<string>; start: string; end: string };

/**
 * ตรวจ body.vns แล้วหาช่วงวันรับบริการที่ครอบ visit ที่เลือก (SQL ของ 16 แฟ้มผู้ป่วยนอกกรองตามช่วงวันที่ ใช้ index วันที่)
 * แล้วค่อยกรองแถวเหลือเฉพาะ VN/HN ที่เลือกในโค้ด ; ช่วงยาวเกิน OPD_MAX_DAYS = error เพราะ opitemrece ล็อกนาน
 */
export async function parseOpdSelection(body: { vns?: unknown } | null): Promise<OpdSelection | { error: string }> {
  const vns = Array.isArray(body?.vns) ? [...new Set(body.vns)] : [];
  if (!vns.length || vns.length > MAX_EXPORT_VNS || !vns.every((v) => typeof v === "string" && /^\d{12}$/.test(v))) {
    return { error: `vns ต้องเป็น VN 12 หลัก 1–${MAX_EXPORT_VNS} รายการ` };
  }
  const list = vns as string[];
  const visits = await hisQuery<{ vn: string; hn: string; vstdate: string }>(`SELECT vn, hn, vstdate FROM ovst WHERE ${inList("vn", list.length)}`, list);
  if (!visits.length) return { error: "ไม่พบ visit ที่เลือก" };
  const days = visits.map((v) => v.vstdate.slice(0, 10)).sort();
  const [start, end] = [days[0], days.at(-1)!];
  const span = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > OPD_MAX_DAYS) return { error: `visit ที่เลือกห่างกัน ${span} วัน เลือกได้ในช่วงไม่เกิน ${OPD_MAX_DAYS} วันต่อครั้ง` };
  return { vns: list, vnSet: new Set(list), hnSet: new Set(visits.map((v) => v.hn)), start, end };
}

/** เก็บเฉพาะแถวของ visit ที่เลือก: PAT ใช้ HN อื่นใช้ SEQ (= VN ทุกแฟ้มผู้ป่วยนอก) */
export const keepSelected = (file: string, sel: OpdSelection) => (row: Record<string, unknown>) =>
  file === "PAT" ? sel.hnSet.has(String(row.HN ?? "")) : sel.vnSet.has(String(row.SEQ ?? ""));
