import { insightQuery } from "@/lib/db";
import { SRM_CACHE_HOURS, cacheMap, type SrmCache, type SrmCacheRow, type SrmInfo } from "./srm";

// ผลตรวจสิทธิกับ สปสช. ล่าสุดต่อ HN (srm_right_check, PK hn) ใช้ทั้ง /api/opd/right-check และ /api/opd/admissions

const CACHE_SQL = `SELECT hn, found, main_inscl AS fund, main_inscl_name AS fund_name, sub_inscl_name AS sub_name,
  hosp_main AS hospmain, hosp_main_name AS hospmain_name, hosp_sub AS hospsub, hosp_sub_name AS hospsub_name,
  start_date AS start, expire_date AS expire, checked_by, checked_at
FROM srm_right_check
WHERE hn = ANY($1) AND checked_at > now() - make_interval(hours => $2)`;

// $1 = jsonb array ของ { hn, found, fund, ... } (HN ไม่ซ้ำ), $2 = ผู้ตรวจ
const SAVE_SQL = `INSERT INTO srm_right_check (hn, found, main_inscl, main_inscl_name, sub_inscl_name,
  hosp_main, hosp_main_name, hosp_sub, hosp_sub_name, start_date, expire_date, checked_by)
SELECT x.hn, x.found, x.fund, x.fund_name, x.sub_name, x.hospmain, x.hospmain_name, x.hospsub, x.hospsub_name, x.start, x.expire, $2
FROM jsonb_to_recordset($1::jsonb) AS x(hn text, found boolean, fund text, fund_name text, sub_name text,
  hospmain text, hospmain_name text, hospsub text, hospsub_name text, start date, expire date)
ON CONFLICT (hn) DO UPDATE SET found = EXCLUDED.found, main_inscl = EXCLUDED.main_inscl, main_inscl_name = EXCLUDED.main_inscl_name,
  sub_inscl_name = EXCLUDED.sub_inscl_name, hosp_main = EXCLUDED.hosp_main, hosp_main_name = EXCLUDED.hosp_main_name,
  hosp_sub = EXCLUDED.hosp_sub, hosp_sub_name = EXCLUDED.hosp_sub_name, start_date = EXCLUDED.start_date,
  expire_date = EXCLUDED.expire_date, checked_by = EXCLUDED.checked_by, checked_at = now()
RETURNING hn, checked_at`;

/** ผลที่ตรวจไว้ไม่เกิน SRM_CACHE_HOURS ของ HN ที่ขอ */
export async function loadSrmCache(hns: string[]): Promise<Map<string, SrmCache>> {
  const list = [...new Set(hns.filter(Boolean))];
  if (!list.length) return new Map();
  return cacheMap(await insightQuery<SrmCacheRow>(CACHE_SQL, [list, SRM_CACHE_HOURS]));
}

/** บันทึกผลใหม่ (แทนผลเดิมของ HN) คืนเวลาที่บันทึกต่อ HN */
export async function saveSrmResults(results: { hn: string; srm: SrmInfo | null }[], checkedBy: string): Promise<Map<string, string>> {
  if (!results.length) return new Map();
  const json = results.map(({ hn, srm }) => ({ hn, found: !!srm, ...srm }));
  const rows = await insightQuery<{ hn: string; checked_at: string }>(SAVE_SQL, [JSON.stringify(json), checkedBy]);
  return new Map(rows.map((r) => [r.hn, r.checked_at]));
}
