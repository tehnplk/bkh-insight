import "server-only";
import { hisQuery } from "@/lib/db";
import type { WardOption } from "./ipd-visit";

/** ตัวเลือกของ filter ward: ward ที่ ward_active = 'Y' (ตารางเล็ก อ่านทั้งตาราง) อ่าน HIS ไม่สำเร็จให้รายการว่าง */
export async function loadWardOptions(): Promise<WardOption[]> {
  try {
    return await hisQuery<WardOption>("SELECT ward AS code, name FROM ward WHERE ward_active = 'Y' ORDER BY ward");
  } catch (e) {
    console.error("ward options query failed", (e as { code?: string }).code ?? e);
    return [];
  }
}
