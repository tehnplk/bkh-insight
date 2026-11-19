// ตรวจสิทธิกับ สปสช. (SRM right-search): อ่านผลและเทียบกับสิทธิใน HOSxP แบบ pure ไม่มี import
// รันทดสอบด้วย node ได้ตรง (srm.test.mjs, mock fetch ไม่ยิง สปสช. จริง) และหน้า client ใช้ชนิด/ค่าคงที่ได้

export const SRM_URL = "https://srm.nhso.go.th";
export const TIMEOUT_MS = 15_000;
/** VN ต่อ request (route เรียก สปสช. ทีละรายตามลำดับ หน้าแบ่งชุดเพื่อแสดงความคืบหน้า) */
export const RIGHT_CHECK_CHUNK = 10;
/** รอหลังเรียก สปสช. ทุกครั้ง (รวมครั้งสุดท้ายของ request ชุดถัดไปจึงห่าง ≥ ค่านี้ด้วย): โควตาใช้ร่วมทั้งโรงพยาบาล */
export const SRM_DELAY_MS = 150;
/** ผลที่ตรวจไว้ (srm_right_check ต่อ HN) ไม่เกินกี่ชั่วโมงใช้แทนการยิง สปสช. ซ้ำ */
export const SRM_CACHE_HOURS = 24;

export const VN = /^\d{12}$/;
export const PID = /^\d{13}$/;

/** สิทธิของ visit ใน HOSxP (pttype ของ visit + visit_pttype.hospmain/hospsub) */
export type HisRight = {
  vn: string;
  hn: string;
  name: string;
  /** pttype.hipdata_code */
  fund: string | null;
  pttype_name: string | null;
  hospmain: string | null;
  hospsub: string | null;
};
/** แถวจาก HOSxP ที่ route อ่าน: เลขบัตรใช้ยิง สปสช. เท่านั้น ไม่ออกไปในผล */
export type HisVisit = HisRight & { cid: string | null };

type Code = { id?: string | null; name?: string | null } | null | undefined;
type Hosp = { hcode?: string | null; hname?: string | null } | null | undefined;
export type SrmFund = {
  fundType?: string | null;
  mainInscl?: Code;
  subInscl?: Code;
  hospMain?: Hosp;
  hospSub?: Hosp;
  startDateTime?: string | null;
  expireDateTime?: string | null;
};
export type SrmResult = { funds?: SrmFund[] | null };

export type RightStatus = "ok" | "mismatch_right" | "mismatch_hcode" | "not_found" | "error";
export const RIGHT_STATUS_LABEL: Record<RightStatus, string> = {
  ok: "ตรงกัน",
  mismatch_right: "สิทธิไม่ตรง",
  mismatch_hcode: "HCODE ไม่ตรง",
  not_found: "ไม่พบสิทธิ",
  error: "ตรวจไม่สำเร็จ",
};
/** สิทธิหลักจาก สปสช. (วันที่เป็น YYYY-MM-DD) */
export type SrmInfo = {
  fund: string | null;
  fund_name: string | null;
  sub_name: string | null;
  hospmain: string | null;
  hospmain_name: string | null;
  hospsub: string | null;
  hospsub_name: string | null;
  start: string | null;
  expire: string | null;
};
/** ผลที่บันทึกไว้ต่อ HN (srm null = สปสช. ไม่พบสิทธิ) ; checked_at เป็นเวลาไทยจาก insight */
export type SrmCache = { srm: SrmInfo | null; checked_at: string; checked_by: string };
export type RightRow = {
  vn: string;
  hn: string;
  name: string;
  his: { fund: string | null; pttype_name: string | null; hospmain: string | null; hospsub: string | null };
  srm: SrmInfo | null;
  /** null = ไม่ได้เทียบ (ไม่มีผลจาก สปสช. หรือ สปสช. ไม่ระบุหน่วยบริการ) */
  right_ok: boolean | null;
  hcode_ok: boolean | null;
  status: RightStatus;
  message?: string;
  /** true = ใช้ผลที่ตรวจไว้ไม่เกิน SRM_CACHE_HOURS ไม่ได้ยิง สปสช. */
  cached?: boolean;
  checked_at?: string | null;
  checked_by?: string | null;
};
/** หยุดทั้งชุด: token ใช้ไม่ได้ หรือถูกจำกัดจำนวนครั้ง */
export type RightStop = { kind: "token" | "rate_limit"; message: string; retryAfter?: number };
export type RightCheckPage = { rows: RightRow[]; stop: RightStop | null };

export type Outcome =
  | { kind: "ok"; data: SrmResult }
  | { kind: "not_found"; message: string }
  | { kind: "stop"; stop: RightStop }
  | { kind: "error"; message: string };

// สปสช. อาจสะท้อนเลขบัตรกลับมาในข้อความ: ปิดเลข 13 หลักและตัดความยาว
const clean = (s: string) => s.replace(/\d{13}/g, "*************").slice(0, 300);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export const TOKEN_MESSAGE = "token ของ สปสช. ใน HOSxP หมดอายุหรือใช้ไม่ได้ ให้เจ้าหน้าที่เข้าระบบ สปสช. ใน HOSxP ใหม่ แล้วตรวจอีกครั้ง";

/** อ่านผล HTTP ตามรหัสของ SRM: 404 ไม่พบ, 401 token, 429 จำกัดจำนวนครั้ง (retryAfterSeconds / Retry-After) */
export function readResponse(status: number, raw: string, retryAfterHeader: string | null): Outcome {
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {}
  const o = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (status >= 200 && status < 300 && o) return { kind: "ok", data: o as SrmResult };
  if (status === 404) return { kind: "not_found", message: "ไม่พบเลขบัตรนี้ในระบบของ สปสช." };
  if (status === 401) return { kind: "stop", stop: { kind: "token", message: TOKEN_MESSAGE } };
  if (status === 429) {
    const sec = Number(o?.retryAfterSeconds ?? retryAfterHeader);
    const retryAfter = Number.isFinite(sec) && sec > 0 ? Math.ceil(sec) : undefined;
    const message = `สปสช. จำกัดจำนวนครั้งที่ตรวจ${retryAfter ? ` ลองใหม่ในอีก ${retryAfter} วินาที` : " ลองใหม่ภายหลัง"}`;
    return { kind: "stop", stop: { kind: "rate_limit", message, retryAfter } };
  }
  const detail = str(o?.message) ?? str(o?.error) ?? str(raw);
  return { kind: "error", message: clean(`สปสช. ตอบ HTTP ${status}${detail ? `: ${detail}` : ""}`) };
}

/** GET หนึ่งราย มี timeout ; fetch ส่งเข้ามา (ทดสอบด้วย mock) ; token ใส่ header เท่านั้น */
export async function fetchRight(fetchImpl: typeof fetch, url: string, token: string, timeoutMs = TIMEOUT_MS): Promise<Outcome> {
  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return readResponse(res.status, await res.text(), res.headers.get("retry-after"));
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err.name === "TimeoutError" || err.name === "AbortError") return { kind: "error", message: `สปสช. ไม่ตอบภายใน ${timeoutMs / 1000} วินาที` };
    return { kind: "error", message: clean(`เชื่อมต่อ สปสช. ไม่สำเร็จ: ${err.message}`) };
  }
}

/** สิทธิหลัก: fundType "Y" ไม่มีใช้ตัวแรก */
export const pickFund = (funds: SrmFund[] | null | undefined) => funds?.find((f) => f?.fundType === "Y") ?? funds?.[0] ?? null;

// HOSxP ใช้ UCS กับบัตรทองทุกแบบ ส่วน สปสช. แยก WEL (ยกเว้นค่าธรรมเนียม 30 บาท)
const SAME_FUND: Record<string, string> = { WEL: "UCS" };
const normFund = (f: string | null) => (f ? (SAME_FUND[f] ?? f) : null);
// สปสช. ใช้ปี 9999 แทนไม่มีวันหมดอายุ ; เก็บเฉพาะส่วนวันที่ (คอลัมน์ date ของ srm_right_check)
const date = (v: string | null | undefined) => {
  const d = /^\d{4}-\d{2}-\d{2}/.exec(str(v) ?? "")?.[0];
  return d && !d.startsWith("9999") ? d : null;
};

const base = (his: HisRight) => ({
  vn: his.vn,
  hn: his.hn,
  name: his.name,
  his: { fund: his.fund, pttype_name: his.pttype_name, hospmain: his.hospmain, hospsub: his.hospsub },
});

/** แถวที่ไม่ได้ผลจาก สปสช. */
export const failedRow = (his: HisRight, status: "not_found" | "error", message: string): RightRow => ({
  ...base(his), srm: null, right_ok: null, hcode_ok: null, status, message,
});

/** สิทธิหลักจากผลของ สปสช. (null = ไม่พบสิทธิ) */
export function srmInfo(data: SrmResult): SrmInfo | null {
  const f = pickFund(data.funds);
  if (!f) return null;
  return {
    fund: str(f.mainInscl?.id),
    fund_name: str(f.mainInscl?.name),
    sub_name: str(f.subInscl?.name),
    hospmain: str(f.hospMain?.hcode),
    hospmain_name: str(f.hospMain?.hname),
    hospsub: str(f.hospSub?.hcode),
    hospsub_name: str(f.hospSub?.hname),
    start: date(f.startDateTime),
    expire: date(f.expireDateTime),
  };
}

/** เทียบสิทธิ (hipdata_code กับ mainInscl.id) และหน่วยบริการหลัก (hospmain กับ hospMain.hcode เมื่อ สปสช. ระบุ) */
export function compareSrm(his: HisRight, srm: SrmInfo | null): RightRow {
  if (!srm) return failedRow(his, "not_found", "สปสช. ไม่พบสิทธิของเลขบัตรนี้");
  const right_ok = normFund(str(his.fund)) === normFund(srm.fund);
  const hcode_ok = srm.hospmain ? str(his.hospmain) === srm.hospmain : null;
  const status: RightStatus = !right_ok ? "mismatch_right" : hcode_ok === false ? "mismatch_hcode" : "ok";
  return { ...base(his), srm, right_ok, hcode_ok, status };
}
export const compareRight = (his: HisRight, data: SrmResult) => compareSrm(his, srmInfo(data));

/** ผลที่บันทึกไว้ของ HN เทียบกับสิทธิของ visit นี้ใน HOSxP (สิทธิ/HCODE ต่างกันได้ทุก visit จึงเทียบใหม่ทุกครั้ง) */
export const fromCache = (his: HisRight, c: SrmCache): RightRow => ({
  ...compareSrm(his, c.srm), cached: true, checked_at: c.checked_at, checked_by: c.checked_by,
});

/** แถวจาก srm_right_check (CACHE_SQL ของ cache.ts) */
export type SrmCacheRow = SrmInfo & { hn: string; found: boolean; checked_at: string; checked_by: string };
export const cacheMap = (rows: SrmCacheRow[]) =>
  new Map(rows.map(({ hn, found, checked_at, checked_by, ...srm }): [string, SrmCache] => [hn, { srm: found ? srm : null, checked_at, checked_by }]));

/** ผลตรวจเป็นข้อความ (Excel) */
export function srmText(r: RightRow | undefined) {
  const s = r?.srm;
  return {
    srm_right: s?.fund ? [s.fund, s.sub_name ?? s.fund_name].filter(Boolean).join(" ") : "",
    srm_hcode: [s?.hospmain, s?.hospsub].filter(Boolean).join(","),
    srm_status: r ? RIGHT_STATUS_LABEL[r.status] : "",
  };
}

/** รอ ms หรือจนกว่า signal จะ abort (ไม่ throw ผู้เรียกเช็ค signal.aborted เอง) */
export const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });

/**
 * ตรวจทีละรายตามลำดับ รอ SRM_DELAY_MS หลังเรียก สปสช. ทุกครั้ง ; 401/429 หยุดทันที ; abort = หยุดยิง (รวมระหว่างรอ)
 * HN ที่อยู่ใน cache (ตรวจไว้ไม่เกิน SRM_CACHE_HOURS) หรือเพิ่งตรวจในชุดนี้ ใช้ผลนั้น ไม่ยิงและไม่รอ
 * แถวที่ไม่มี cached และไม่ใช่ error = ผลใหม่ที่ route บันทึก (freshResults)
 */
export async function checkVisits(
  vns: string[],
  visits: Map<string, HisVisit>,
  fetchOne: (pid: string) => Promise<Outcome>,
  signal: AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<void> = wait,
  cache: Map<string, SrmCache> = new Map(),
): Promise<RightCheckPage> {
  const rows: RightRow[] = [];
  const seen = new Map<string, SrmInfo | null>();
  for (const vn of vns) {
    if (signal.aborted) break;
    const v = visits.get(vn);
    if (!v) {
      rows.push(failedRow({ vn, hn: "", name: "", fund: null, pttype_name: null, hospmain: null, hospsub: null }, "error", "ไม่พบ visit นี้ใน HOSxP"));
      continue;
    }
    const { cid, ...his } = v;
    his.name = (his.name ?? "").trim();
    const hit = cache.get(his.hn);
    if (hit) {
      rows.push(fromCache(his, hit));
      continue;
    }
    if (seen.has(his.hn)) {
      rows.push(compareSrm(his, seen.get(his.hn) ?? null));
      continue;
    }
    const pid = String(cid ?? "").trim();
    if (!PID.test(pid)) {
      rows.push(failedRow(his, "error", "เลขบัตรผู้ป่วยใน HOSxP ไม่ใช่ตัวเลข 13 หลัก จึงไม่ได้ตรวจ"));
      continue;
    }
    const r = await fetchOne(pid);
    if (r.kind === "stop") return { rows, stop: r.stop };
    if (r.kind !== "error") seen.set(his.hn, r.kind === "ok" ? srmInfo(r.data) : null);
    rows.push(r.kind === "ok" ? compareRight(his, r.data) : failedRow(his, r.kind, r.message));
    await sleep(SRM_DELAY_MS, signal);
  }
  return { rows, stop: null };
}

/** ผลใหม่ที่ต้องบันทึก ต่อ HN (HN ซ้ำในชุดเหลือแถวเดียว: ON CONFLICT แก้แถวเดิมซ้ำใน statement เดียวไม่ได้) ; srm null = ไม่พบสิทธิ */
export function freshResults(rows: RightRow[]): { hn: string; srm: SrmInfo | null }[] {
  const out = new Map<string, SrmInfo | null>();
  for (const r of rows) if (!r.cached && r.status !== "error" && r.hn) out.set(r.hn, r.srm);
  return [...out].map(([hn, srm]) => ({ hn, srm }));
}
