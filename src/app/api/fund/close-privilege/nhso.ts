// ปิดสิทธิผ่าน NHSO ENDPOINT ของ สปสช.: ค่าตั้ง สร้างคำขอ ตรวจเวลา และอ่านผล แบบ pure ไม่มี import
// รันทดสอบด้วย node ได้ตรง (nhso.test.mjs) และหน้า client ใช้ msUntilMidnight ได้

export const TEST_URL = "https://test.nhso.go.th/nhsoendpoint/";
const PROD_HOST = "nhsoapi.nhso.go.th";
export const CLAIM_SERVICE_CODE = "PG0060001";
export const TIMEOUT_MS = 20_000;
// HOSxP ส่งเวลาย้อน 5 นาทีทั้ง serviceDateTime และ invoiceDateTime (ตรวจจาก nhso_confirm_privilege 3,000 แถว)
const SHIFT_MS = 300_000;
const TH_OFFSET_MS = 7 * 3_600_000; // เวลาไทย UTC+7 ไม่มี DST

export const VN = /^\d{12}$/;
export const PID = /^\d{13}$/;

export type Zone = "test" | "prod";
export type NhsoConfig = { endpoint: string | null; token: string; sourceId: string; zone: Zone; missing: string[] };

/** อ่านค่าจาก env ; missing = ชื่อ env ที่ยังไม่ตั้ง (ปุ่มปิดสิทธิ disabled) ; zone prod เฉพาะ host production จริงเท่านั้น */
export function readConfig(env: Record<string, string | undefined>): NhsoConfig {
  const token = env.NHSO_ENDPOINT_TOKEN?.trim() ?? "";
  const path = env.NHSO_ENDPOINT_CLAIM_PATH?.trim() ?? "";
  const sourceId = env.NHSO_ENDPOINT_SOURCE_ID?.trim() ?? "";
  const missing = [!token && "NHSO_ENDPOINT_TOKEN", !path && "NHSO_ENDPOINT_CLAIM_PATH", !sourceId && "NHSO_ENDPOINT_SOURCE_ID"].filter(
    (k): k is string => Boolean(k),
  );
  let base: URL | null = null;
  try {
    base = new URL(env.NHSO_ENDPOINT_URL?.trim() || TEST_URL);
  } catch {
    missing.unshift("NHSO_ENDPOINT_URL (รูปแบบไม่ถูกต้อง)");
  }
  const zone: Zone = base?.hostname === PROD_HOST ? "prod" : "test";
  // path ต่อท้าย base (ตัด / หน้าออก ไม่งั้น /nhsoendpoint/ หาย)
  const endpoint = base && path ? new URL(path.replace(/^\/+/, ""), base.href.endsWith("/") ? base : `${base.href}/`).href : null;
  return { endpoint, token, sourceId, zone, missing };
}

// ยังไม่ยืนยันรูปแบบกับ Swagger ของ NHSO ENDPOINT: ถ้าต้องใช้ header อื่นแก้ที่นี่ที่เดียว
export const authHeaders = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

/** วันที่ไทย (YYYY-MM-DD) ของเวลา ms */
export const thaiDate = (ms: number) => new Date(ms + TH_OFFSET_MS).toISOString().slice(0, 10);

/** ms ที่เหลือถึงเที่ยงคืนเวลาไทย */
export function msUntilMidnight(nowMs: number): number {
  const d = thaiDate(nowMs);
  return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1) - TH_OFFSET_MS - nowMs;
}

/** ปิดสิทธิได้เฉพาะ visit ของวันนี้ (เวลาไทย) ก่อน 24.00 น. */
export const isClosableNow = (vstdate: string, nowMs: number) => String(vstdate).slice(0, 10) === thaiDate(nowMs);

export type ClaimInput = {
  hcode: string;
  vn: string;
  pid: string;
  vstdate: string;
  vsttime: string;
  mainInscl: string;
  total: number;
  cash: number;
  privilege: number;
  sourceId: string;
  recorderPid: string;
  nowMs: number;
};

const money = (n: number) => Math.round(Number(n || 0) * 100) / 100;

/** body ตามลำดับ key ที่ HOSxP ส่งจริง (ไม่มี department) ; เวลาเป็น unix ms ย้อน 5 นาที */
export function buildClaimBody(i: ClaimInput) {
  return {
    hcode: i.hcode,
    visitNumber: i.vn,
    pid: i.pid,
    transactionId: `${i.hcode}${i.vn}`,
    serviceDateTime: Date.parse(`${String(i.vstdate).slice(0, 10)}T${String(i.vsttime).slice(0, 8)}+07:00`) - SHIFT_MS,
    invoiceDateTime: i.nowMs - SHIFT_MS,
    mainInsclCode: i.mainInscl,
    totalAmount: money(i.total),
    paidAmount: money(i.cash),
    privilegeAmount: money(i.privilege),
    claimServiceCode: CLAIM_SERVICE_CODE,
    sourceId: i.sourceId,
    recorderPid: i.recorderPid,
  };
}
export type ClaimBody = ReturnType<typeof buildClaimBody>;

export type ClaimResult = { ok: true; seq: string; authenCode: string } | { ok: false; error: string };

// ข้อความ error เก็บลง log: ปิดเลข 13 หลัก (สปสช. อาจสะท้อนเลขบัตรกลับมา) และตัดความยาว
const clean = (s: string) => s.replace(/\d{13}/g, "*************").slice(0, 500);
function text(v: unknown): string | null {
  if (v == null || v === "") return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** อ่านผลแบบทนทาน: สำเร็จ = 2xx ที่มี authenCode และ seq ; ไม่งั้นใช้ dataError / message / error / ข้อความดิบ / HTTP status */
export function parseResponse(status: number, raw: string): ClaimResult {
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {}
  const o = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const ok2xx = status >= 200 && status < 300;
  if (ok2xx && o && typeof o.authenCode === "string" && o.authenCode && o.seq != null && o.seq !== "") {
    return { ok: true, seq: String(o.seq), authenCode: o.authenCode };
  }
  const detail = (o && (text(o.dataError) ?? text(o.message) ?? text(o.error) ?? text(o.errors))) || raw.trim() || null;
  if (ok2xx) return { ok: false, error: clean(detail ? `ผลตอบกลับไม่มีรหัส authenCode: ${detail}` : "ผลตอบกลับไม่มีรหัส authenCode") };
  return { ok: false, error: clean(`HTTP ${status}${detail ? `: ${detail}` : ""}`) };
}

/** POST หนึ่งราย มี timeout ; fetch ส่งเข้ามา (ทดสอบด้วย mock) */
export async function postClaim(
  fetchImpl: typeof fetch,
  endpoint: string,
  token: string,
  body: ClaimBody,
  timeoutMs = TIMEOUT_MS,
): Promise<ClaimResult & { httpStatus: number | null }> {
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...authHeaders(token) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return { ...parseResponse(res.status, await res.text()), httpStatus: res.status };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    // หมดเวลาไม่ได้แปลว่าไม่สำเร็จ สปสช. อาจปิดไปแล้ว
    const error =
      err.name === "TimeoutError" || err.name === "AbortError"
        ? `ไม่ได้รับผลภายใน ${timeoutMs / 1000} วินาที (อาจปิดสำเร็จแล้ว ตรวจสอบก่อนกดซ้ำ)`
        : clean(`เชื่อมต่อ สปสช. ไม่สำเร็จ: ${err.message}`);
    return { ok: false, error, httpStatus: null };
  }
}
