// ติดตามเคลมกองทุน STP: รวม visit/admission จาก HOSxP กับสถานะที่เจ้าหน้าที่บันทึกใน insight (stp_claim_status_log)
// pure ไม่มี import จึงรันทดสอบด้วย node ได้ตรง (claim.test.mjs)

// ลำดับตามขั้นตอนเคลมใน FDH (ลำดับในแถบสรุปและตัวเลือก) ; ต้องตรงกับ CHECK ใน db/migrations/202611142110_stp_claim_status.sql
export const CLAIM_STATUSES = ["not_sent", "uploaded", "submitted", "fix", "approved", "rejected", "paid", "capitation", "unclaimed", "cancelled"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const STATUS_LABEL: Record<ClaimStatus, string> = {
  not_sent: "ยังไม่ส่ง 16 แฟ้ม",
  uploaded: "ส่ง 16 แฟ้มแล้ว",
  submitted: "กดส่งเคลมแล้ว",
  fix: "แก้ไขข้อมูล",
  approved: "อนุมัติ",
  rejected: "ปฏิเสธ",
  paid: "โอนเงินแล้ว",
  capitation: "เหมาจ่ายรายหัว",
  unclaimed: "ไม่ประสงค์เบิก",
  cancelled: "ยกเลิก",
};
export const STATUS_TONE: Record<ClaimStatus, "danger" | "warning" | "accent" | "success" | "muted"> = {
  not_sent: "danger",
  uploaded: "warning",
  submitted: "accent",
  fix: "danger",
  approved: "success",
  rejected: "danger",
  paid: "success",
  capitation: "muted",
  unclaimed: "muted",
  cancelled: "muted",
};
/** ยังไม่ได้กดส่งเคลมในเมนูกองทุน STP ของ FDH (ค่าเริ่มต้นของหน้า) */
export const isPending = (s: ClaimStatus) => s === "not_sent" || s === "uploaded" || s === "fix";

export type PatientType = "OP" | "IP";
export const MAX_REFS = 100;
export const MAX_NOTE = 500;
const REF = /^\d{1,15}$/;

/** visit (OP: ref = vn, date = vstdate) หรือ admission (IP: ref = an, date = dchdate) ; decimal จาก mysql เป็น string */
export type HisCase = {
  ref: string;
  hn: string;
  date: string;
  pttype: string | null;
  authen_code: string | null;
  fdh_claim_status_message: string | null;
  fdh_claim_status_datetime: string | null;
  claim_amount: string | number;
  has_pdx: number | string | boolean;
};
/** แถวของ stp_claim_status_log เรียงใหม่ไปเก่า */
export type StatusLog = { ref: string; status: ClaimStatus; note: string | null; recorded_by: string; created_at: string };

export type StpClaimRow = {
  ref: string;
  hn: string;
  date: string;
  pttype_name: string;
  authen_code: string | null;
  claim_amount: number;
  has_pdx: boolean;
  status: ClaimStatus;
  status_at: string | null;
  status_by: string | null;
  note: string | null;
  his_status: string | null;
  his_status_at: string | null;
  /** ประวัติสถานะใหม่ไปเก่า (ไม่ส่งในไฟล์ Excel) */
  history: Omit<StatusLog, "ref">[];
};

/** logs ต้องเรียงใหม่ไปเก่า ; สถานะปัจจุบัน = แถวแรกของแต่ละ ref ; ไม่มี log = not_sent */
export function buildRows(cases: HisCase[], logs: StatusLog[], pttypeName: (pttype: string | null) => string): StpClaimRow[] {
  const byRef = new Map<string, Omit<StatusLog, "ref">[]>();
  for (const { ref, ...l } of logs) byRef.set(ref, [...(byRef.get(ref) ?? []), l]);
  return cases.map((c) => {
    const history = byRef.get(c.ref) ?? [];
    const last = history[0];
    return {
      ref: c.ref,
      hn: c.hn,
      date: String(c.date).slice(0, 10),
      pttype_name: pttypeName(c.pttype),
      authen_code: c.authen_code?.trim() || null,
      claim_amount: Number(c.claim_amount),
      has_pdx: Number(c.has_pdx) === 1,
      status: last?.status ?? "not_sent",
      status_at: last?.created_at ?? null,
      status_by: last?.recorded_by ?? null,
      note: last?.note ?? null,
      his_status: c.fdh_claim_status_message?.trim() || null,
      his_status_at: c.fdh_claim_status_datetime ?? null,
      history,
    };
  });
}

export type StpClaimSummary = {
  total: number;
  counts: Record<ClaimStatus, number>;
  pending: { count: number; amount: number };
};

export function summarize(rows: StpClaimRow[]): StpClaimSummary {
  const counts = Object.fromEntries(CLAIM_STATUSES.map((s) => [s, 0])) as Record<ClaimStatus, number>;
  let count = 0, cents = 0;
  for (const r of rows) {
    counts[r.status]++;
    if (isPending(r.status)) {
      count++;
      cents += Math.round(r.claim_amount * 100);
    }
  }
  return { total: rows.length, counts, pending: { count, amount: cents / 100 } };
}

/** response ของ GET /api/fund/stp-claim */
export type StpClaimPage = { rows: StpClaimRow[]; total: number; summary: StpClaimSummary };

/** ค้นหา HN/VN/AN/Authen Code/หมายเหตุ แบบมีคำนั้นอยู่ */
export function matches(r: StpClaimRow, q: string) {
  const needle = q.toLowerCase();
  return [r.hn, r.ref, r.authen_code, r.note].some((v) => v?.toLowerCase().includes(needle));
}

export const SORTABLE = ["date", "hn", "ref", "pttype_name", "authen_code", "claim_amount", "has_pdx", "status", "status_at", "note", "his_status"] as const;
export type SortKey = (typeof SORTABLE)[number];

/** ค่าว่างอยู่ท้ายเสมอทั้งสองทิศ สถานะเรียงตามขั้นตอน แล้วเรียงตามวันที่/ref ให้ผลคงที่ */
export function sortRows(rows: StpClaimRow[], key: SortKey, dir: "asc" | "desc"): StpClaimRow[] {
  const sign = dir === "desc" ? -1 : 1;
  const value = (r: StpClaimRow) => (key === "status" ? CLAIM_STATUSES.indexOf(r.status) : key === "has_pdx" ? Number(r.has_pdx) : r[key]);
  return rows.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if ((x == null) !== (y == null)) return x == null ? 1 : -1;
    const c =
      x == null || y == null ? 0
      : typeof x === "number" && typeof y === "number" ? x - y
      : String(x).localeCompare(String(y), "th", { numeric: true });
    return sign * c || a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref);
  });
}

export type SaveInput = { type: PatientType; refs: string[]; status: ClaimStatus; note: string | null; start: string; end: string };

/** body ของ POST: { type: "op" | "ip", start, end, refs: string[1..100], status, note? } (start/end ตรวจต่อด้วย parseRange) */
export function parseSave(body: unknown): { ok: true; value: SaveInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.type !== "op" && b.type !== "ip") return { ok: false, error: "type ต้องเป็น op หรือ ip" };
  const refs = b.refs;
  if (!Array.isArray(refs) || !refs.length || refs.length > MAX_REFS) return { ok: false, error: `refs ต้องเป็นรายการ 1–${MAX_REFS} ราย` };
  if (!refs.every((r) => typeof r === "string" && REF.test(r))) return { ok: false, error: "VN/AN ต้องเป็นตัวเลข" };
  if (typeof b.status !== "string" || !(CLAIM_STATUSES as readonly string[]).includes(b.status)) return { ok: false, error: "สถานะไม่ถูกต้อง" };
  if (b.note != null && typeof b.note !== "string") return { ok: false, error: "หมายเหตุต้องเป็นข้อความ" };
  const note = (b.note as string | undefined)?.trim() || null;
  if (note && note.length > MAX_NOTE) return { ok: false, error: `หมายเหตุยาวได้ไม่เกิน ${MAX_NOTE} ตัวอักษร` };
  if (typeof b.start !== "string" || typeof b.end !== "string") return { ok: false, error: "start และ end ต้องเป็นวันที่รูปแบบ YYYY-MM-DD" };
  return {
    ok: true,
    value: { type: b.type === "op" ? "OP" : "IP", refs: [...new Set(refs as string[])], status: b.status as ClaimStatus, note, start: b.start, end: b.end },
  };
}
