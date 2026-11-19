import { auth } from "@/auth";
import { hisQuery } from "@/lib/db";
import { FULL_NAME_SQL, badRequest, fundSql, inList, unauthorized } from "@/app/api/fund/_lib/fund";
import { RIGHT_CHECK_CHUNK, SRM_URL, VN, checkVisits, confirmedFor, fetchRight, freshResults, type HisVisit, type RightCheckPage } from "./srm";
import { loadSrmCache, saveSrmResults } from "./cache";

// ตรวจสิทธิกับ สปสช. (SRM right-search) ทีละรายตามลำดับ เว้น SRM_DELAY_MS ต่อครั้ง (โควตาใช้ร่วมทั้งโรงพยาบาล ห้ามยิงขนาน)
// token และเลขบัตรอยู่ฝั่ง server เท่านั้น: ไม่ส่งให้ client ไม่ log และไม่เก็บลงฐาน
// HN ที่ตรวจไว้ไม่เกิน SRM_CACHE_HOURS (srm_right_check) ใช้ผลเดิม ไม่ยิงซ้ำ ; ผลใหม่ (พบ/ไม่พบสิทธิ) บันทึกทับต่อ HN

// สิทธิของ visit (prove-query ผ่าน: ix_vn_unique + eq_ref) params: vn…
const VISIT_SQL = (n: number) => `SELECT o.vn, o.hn, p.cid, ${FULL_NAME_SQL} AS name, t.name AS pttype_name, ${fundSql("t")} AS fund,
  vp.hospmain, vp.hospsub
FROM ovst o
LEFT JOIN patient p ON p.hn = o.hn
LEFT JOIN pttype t ON t.pttype = o.pttype
LEFT JOIN visit_pttype vp ON vp.vn = o.vn AND vp.pttype = o.pttype
WHERE ${inList("o.vn", n)}`;

// token ที่ HOSxP ได้จาก สปสช. ตอนเจ้าหน้าที่เข้าระบบ (อายุราว 30 นาที ตารางมีไม่กี่สิบแถว) ใช้ตัวที่หมดอายุช้าสุด
const TOKEN_SQL = `SELECT token FROM nhso_token
WHERE access_token_expire > NOW() AND IFNULL(is_invalid, 'N') <> 'Y' AND token <> ''
ORDER BY access_token_expire DESC LIMIT 1`;

/** ที่เดียวที่กำหนด token และปลายทาง: ย้ายไป NHSO ENDPOINT ภายหลังแก้แค่ฟังก์ชันนี้ */
async function srmTarget(): Promise<{ token: string; url: (pid: string) => string } | null> {
  const [row] = await hisQuery<{ token: string | null }>(TOKEN_SQL);
  const token = row?.token?.trim();
  if (!token) return null;
  const base = (process.env.SRM_API_URL?.trim() || SRM_URL).replace(/\/+$/, "");
  return { token, url: (pid) => `${base}/api/ucws/v1/right-search?pid=${pid}` };
}

/** POST { vns: string[] } (≤ RIGHT_CHECK_CHUNK กันงานต่อ request ยาวเกิน) -> RightCheckPage ; 401/429 จาก สปสช. หยุดทั้งชุดและคืนผลที่ได้ถึงตรงนั้น */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  const raw = (await request.json().catch(() => null))?.vns;
  if (!Array.isArray(raw) || !raw.length || raw.length > RIGHT_CHECK_CHUNK) return badRequest(`vns ต้องเป็นรายการ VN 1–${RIGHT_CHECK_CHUNK} ราย`);
  if (!raw.every((v) => typeof v === "string" && VN.test(v))) return badRequest("VN ต้องเป็นตัวเลข 12 หลัก");
  const vns = [...new Set(raw as string[])];

  try {
    const visits = new Map((await hisQuery<HisVisit>(VISIT_SQL(vns.length), vns)).map((v) => [v.vn, v]));
    const cache = await loadSrmCache([...visits.values()].map((v) => v.hn));
    // ทุกรายมีผลเดิมแล้ว = ไม่ต้องใช้ token
    const target = [...visits.values()].every((v) => cache.has(v.hn)) ? { token: "", url: () => "" } : await srmTarget();
    if (!target) return Response.json({ error: "ไม่พบ token ของ สปสช. ที่ยังไม่หมดอายุใน HOSxP ให้เจ้าหน้าที่เข้าระบบ สปสช. ใน HOSxP ก่อน" }, { status: 503 });
    // ผู้ใช้ออกจากหน้า (หรือ effect ซ้ำของ StrictMode ตอน dev) = request.signal abort หยุดยิง ไม่เปลืองโควตา
    const body: RightCheckPage = await checkVisits(vns, visits, (pid) => fetchRight(fetch, target.url(pid), target.token), request.signal, undefined, cache);
    // บันทึกไม่ได้ = ผลยังส่งกลับ (ใช้โควตาไปแล้ว) แค่ครั้งหน้าต้องตรวจใหม่
    const checkedBy = session.user.name ?? "ไม่ทราบชื่อ";
    const saved = await saveSrmResults(freshResults(body.rows), checkedBy).catch((e) => {
      console.error("opd/right-check save", e instanceof Error ? e.message : e);
      return new Map<string, { checked_at: string; confirmed: null }>();
    });
    for (const r of body.rows) {
      const s = r.cached ? undefined : saved.get(r.hn);
      if (s) Object.assign(r, { checked_at: s.checked_at, checked_by: checkedBy, confirmed: confirmedFor(r, s.confirmed) });
    }
    return Response.json(body);
  } catch (e) {
    console.error("opd/right-check", e instanceof Error ? e.message : e);
    return Response.json({ error: "ตรวจสิทธิไม่สำเร็จ ลองอีกครั้ง" }, { status: 500 });
  }
}
