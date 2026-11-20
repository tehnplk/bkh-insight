// สถานะส่งเคลมต่อราย (OP = VN, IP = AN) จากหลายแหล่ง และ payload ของบันทึกชุดส่งออก (claim_batch) แบบ pure
// ไม่มี import ค่า จึงใช้ได้ทั้ง route, หน้า (client) และ claim.test.mjs

export type PatientType = "OP" | "IP";
export const CHANNELS = ["fdh", "eclaim_txt", "eclaim_dbf"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = { fdh: "ส่งออก 16 แฟ้ม", eclaim_txt: "ส่งออก e-Claim TEXT", eclaim_dbf: "ส่งออก e-Claim DBF" };
/** ชื่อสั้นในตารางประวัติส่งออก */
export const CHANNEL_SHORT: Record<Channel, string> = { fdh: "FDH", eclaim_txt: "e-Claim TXT", eclaim_dbf: "e-Claim DBF" };

/** กองทุนที่ต้องส่งเคลมและมี REP นำเข้า (= rep_row.scheme): ไม่มีหลักฐานจึงเป็น "ยังไม่ส่ง" ; กองทุนอื่นแสดงเฉพาะเมื่อมีหลักฐาน */
export const CLAIM_FUNDS = ["UCS", "OFC", "LGO", "BKK", "BMT"];
/** ยังไม่ส่งเกินจำนวนวันนี้นับจากวันรับบริการ (OP) / วันจำหน่าย (IP) = เกินกำหนด (ผู้ใช้กำหนด 19 พ.ย. 2569) */
export const CLAIM_DEADLINE_DAYS: Record<PatientType, number> = { OP: 30, IP: 30 };

export const CLAIM_STATUSES = ["paid", "rep_pass", "rep_c", "rep_deny", "nhso", "submitted", "exported", "unclaimed", "failed", "wait_close", "unsent", "overdue"] as const;
export type ClaimStatusKey = (typeof CLAIM_STATUSES)[number];
export const CLAIM_LABEL: Record<ClaimStatusKey, string> = {
  paid: "ได้รับเงิน",
  rep_pass: "REP ผ่าน",
  rep_c: "ติด C",
  rep_deny: "Deny",
  nhso: "ส่งถึง สปสช.",
  submitted: "ส่งแล้ว",
  exported: "ส่งออกแล้ว รอยืนยัน",
  unclaimed: "ไม่ประสงค์เบิก",
  failed: "ส่งไม่ผ่าน",
  wait_close: "รอปิดสิทธิ",
  unsent: "ยังไม่ส่ง",
  overdue: "เกินกำหนด",
};
/** ค่าตัวกรองหัวคอลัมน์ claim ของปุ่มในแถบสรุป (เรียงแล้ว): "ยังไม่ส่ง" รวมรายที่ยังรอปิดสิทธิ */
export const UNSENT_VALUES = ["unsent", "wait_close"];
export const OVERDUE_VALUES = ["overdue"];

/**
 * สถานะเคลมของแถว: at = วันที่ของหลักฐาน (ยังไม่ส่ง = วันรับบริการ/จำหน่าย), detail = แหล่ง/ข้อความ, days = วันนับจาก at ถึงวันนี้, amount = ยอด STM, batch = id ของชุดส่งออก
 * เฉพาะสถานะจากชุดส่งออก: channel, by = ผู้ยืนยัน (submitted) / ผู้ส่งออก (exported), exported_at = วันที่ส่งออกของชุดที่ยืนยันแล้ว
 */
export type ClaimInfo = {
  status: ClaimStatusKey;
  at: string | null;
  detail?: string;
  days?: number;
  amount?: number;
  batch?: string;
  channel?: Channel;
  by?: string;
  exported_at?: string | null;
};
export type ClaimCounts = { unsent: number; overdue: number };

/** fdh_claim_status ของ HOSxP (OP เท่านั้น: IP จองส่งก่อนวันจำหน่าย = ของ visit ผู้ป่วยนอก) */
export type FdhStatus = { resv: string | null; resv_at: string | null; msg: string | null; msg_at: string | null };
// ผลตรวจสถานะจาก สปสช. ที่แปลว่ารับข้อมูลแล้ว ; "ไม่มีรายการนี้ส่งเข้ามาในระบบ", Token หมดอายุ, เชื่อมต่อไม่ได้ = ไม่ใช่หลักฐาน
// (ตรวจกับฐานจริง: ข้อความส่วนใหญ่เป็นผลตรวจก่อนส่ง จึงไม่แปลว่ายังไม่ส่ง)
const FDH_SENT = /^(received|waited|approved|cut_off_batch|settled|dupplicated|rejected)\b/;
const FDH_UNCLAIMED = /^unclaimed\b/;

export type ClaimInput = {
  type: PatientType;
  fund: string;
  /** OP วันรับบริการ, IP วันจำหน่าย */
  date: string | null;
  /** ลูกหนี้สิทธิ (uc_money) ; 0 = ไม่มีอะไรต้องเบิก */
  amount: number;
  /** OP ปิดสิทธิ/Approval Code แล้ว, IP ปิดสิทธิการเงิน (finance_lock) */
  closed: boolean;
  fdh?: FdhStatus | null;
  rep?: { status: "pass" | "c" | "deny"; rep_date: string | null; rep_no: string | null } | null;
  stm?: { paid: number | string; paid_at: string | null } | null;
  /** ชุดส่งออกที่ยังไม่ยกเลิกต่อราย: ยืนยันแล้วก่อน แล้วล่าสุด (BATCH_SQL ใน load.ts) */
  batch?: {
    id?: string;
    at: string;
    channel: Channel;
    created_by?: string | null;
    confirmed_at?: string | null;
    confirmed_by?: string | null;
    submitted_on?: string | null;
  } | null;
};

const day = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : null);
const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const REP_STATUS = { pass: "rep_pass", c: "rep_c", deny: "rep_deny" } as const;

/**
 * หลักฐานที่แรงสุดชนะ: STM จ่าย > REP ล่าสุด > ข้อความ FDH ว่ารับแล้ว > ชุดส่งออกที่ยืนยันว่าอัปโหลดแล้ว > HOSxP จองส่ง FDH (Y)
 * > ชุดส่งออกที่ยังไม่ยืนยัน > HOSxP บอกไม่ประสงค์เบิก/ส่งไม่สำเร็จ > ไม่มีหลักฐาน
 */
export function classifyClaim(x: ClaimInput, today: string): ClaimInfo | undefined {
  const paid = Number(x.stm?.paid ?? 0);
  if (paid > 0) return { status: "paid", at: day(x.stm?.paid_at), amount: Math.round(paid * 100) / 100 };
  if (x.rep) return { status: REP_STATUS[x.rep.status], at: day(x.rep.rep_date), ...(!!x.rep.rep_no && { detail: x.rep.rep_no }) };
  const f = x.type === "OP" ? x.fdh : null;
  if (f?.msg && FDH_SENT.test(f.msg)) return { status: "nhso", at: day(f.msg_at), detail: `FDH: ${f.msg}` };
  const b = x.batch;
  const batchId = b?.id ? { batch: String(b.id) } : {};
  if (b?.confirmed_at)
    return {
      status: "submitted",
      at: day(b.submitted_on ?? b.confirmed_at),
      detail: `ยืนยันโดย ${b.confirmed_by ?? "ไม่ทราบชื่อ"}`,
      ...batchId,
      channel: b.channel,
      ...(!!b.confirmed_by && { by: b.confirmed_by }),
      exported_at: day(b.at),
    };
  if (f?.resv === "Y") return { status: "nhso", at: day(f.resv_at), detail: "HOSxP ส่ง FDH" };
  if (b) return { status: "exported", at: day(b.at), detail: CHANNEL_LABEL[b.channel], ...batchId, channel: b.channel, ...(!!b.created_by && { by: b.created_by }) };
  if (f?.msg && FDH_UNCLAIMED.test(f.msg)) return { status: "unclaimed", at: day(f.msg_at), detail: `FDH: ${f.msg}` };
  if (f?.resv === "N") return { status: "failed", at: day(f.resv_at), detail: "HOSxP ส่ง FDH ไม่สำเร็จ" };
  if (!CLAIM_FUNDS.includes(x.fund) || !(x.amount > 0)) return undefined;
  const at = day(x.date);
  const days = at ? Math.round((utc(today) - utc(at)) / 86_400_000) : undefined;
  if (days != null && days > CLAIM_DEADLINE_DAYS[x.type]) return { status: "overdue", at, days };
  return { status: x.closed ? "unsent" : "wait_close", at, ...(days != null && { days }) };
}

/** ข้อความในไฟล์ Excel: ไม่มีสถานะ = ว่าง */
export const claimText = (c: ClaimInfo | undefined) =>
  c ? [CLAIM_LABEL[c.status], c.detail, c.amount != null ? `${c.amount.toFixed(2)} บาท` : null, c.at, c.batch && `ชุด #${c.batch}`].filter(Boolean).join(" · ") : "";

/** จำนวนรายของปุ่มในแถบสรุป */
export const claimCounts = (vals: { v: string }[]): ClaimCounts => ({
  unsent: vals.filter((r) => UNSENT_VALUES.includes(r.v)).length,
  overdue: vals.filter((r) => OVERDUE_VALUES.includes(r.v)).length,
});

// ---- บันทึกชุดส่งออก (POST /api/fdh/claim-batch) ----

/** รายต่อชุดสูงสุด = MAX_SELECT_VNS ของ opd/admissions (ผู้ป่วยในเลือกได้น้อยกว่า) */
export const MAX_BATCH_ITEMS = 5000;
export type BatchItem = {
  ref: string;
  hn: string | null;
  service_date: string | null;
  scheme: string | null;
  subtype: string | null;
  hospmain: string | null;
  cht_total: number | null;
  pdx: string | null;
};
export type BatchBody = { channel: Channel; patient_type: PatientType; file_sha256: string | null; items: BatchItem[] };

type PreviewFile = { file: string; rows: Record<string, string | number | null | undefined>[] };
const str = (v: unknown) => (v == null || v === "" ? null : String(v).trim() || null);

/** รายที่อยู่ในแฟ้มที่ส่งออก: หนึ่งรายต่อแถว OPD (SEQ) / IPD (AN) ค่าจาก INS แถวแรก, CHT และ ODX/IDX DXTYPE 1 ของรายนั้น */
export function batchItems(files: PreviewFile[], type: PatientType): BatchItem[] {
  const key = type === "OP" ? "SEQ" : "AN";
  const rows = (name: string) => files.find((f) => f.file === name)?.rows ?? [];
  const first = (name: string, keep: (r: PreviewFile["rows"][number]) => boolean = () => true) => {
    const m = new Map<string, PreviewFile["rows"][number]>();
    for (const r of rows(name)) {
      const k = str(r[key]);
      if (k && !m.has(k) && keep(r)) m.set(k, r);
    }
    return m;
  };
  const ins = first("INS");
  const cht = first("CHT");
  const dx = first(type === "OP" ? "ODX" : "IDX", (r) => String(r.DXTYPE ?? "") === "1");
  return [...first(type === "OP" ? "OPD" : "IPD")].map(([ref, base]) => {
    const total = cht.get(ref)?.TOTAL;
    return {
      ref,
      hn: str(base.HN),
      service_date: day(str(type === "OP" ? base.DATEOPD : base.DATEDSC)),
      scheme: str(ins.get(ref)?.INSCL),
      subtype: str(ins.get(ref)?.SUBTYPE),
      hospmain: str(ins.get(ref)?.HOSPMAIN),
      cht_total: total == null || total === "" || !Number.isFinite(Number(total)) ? null : Number(total),
      pdx: str(dx.get(ref)?.DIAG),
    };
  });
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const shortText = (v: unknown, max: number): v is string | null => v === null || (typeof v === "string" && v.length <= max);

/** ตรวจ body ของ POST (ข้อมูลจาก browser) ; ห้ามมีเลขบัตร/ชื่อ จึงรับเฉพาะ field ที่กำหนด */
export function parseBatch(body: unknown): { ok: true; value: BatchBody } | { ok: false; error: string } {
  const b = body as Partial<Record<keyof BatchBody, unknown>> | null;
  if (!b || typeof b !== "object") return { ok: false, error: "body ไม่ถูกต้อง" };
  if (!CHANNELS.includes(b.channel as Channel)) return { ok: false, error: "channel ไม่ถูกต้อง" };
  if (b.patient_type !== "OP" && b.patient_type !== "IP") return { ok: false, error: "patient_type ไม่ถูกต้อง" };
  if (b.file_sha256 != null && !(typeof b.file_sha256 === "string" && /^[0-9a-f]{64}$/.test(b.file_sha256))) return { ok: false, error: "file_sha256 ไม่ถูกต้อง" };
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > MAX_BATCH_ITEMS) return { ok: false, error: `items ต้องมี 1–${MAX_BATCH_ITEMS} ราย` };
  const seen = new Set<string>();
  const items: BatchItem[] = [];
  for (const it of b.items as Partial<Record<keyof BatchItem, unknown>>[]) {
    const ref = it?.ref;
    if (typeof ref !== "string" || !/^\d{1,15}$/.test(ref) || seen.has(ref)) return { ok: false, error: "ref ไม่ถูกต้องหรือซ้ำ" };
    seen.add(ref);
    const { hn = null, service_date = null, scheme = null, subtype = null, hospmain = null, cht_total = null, pdx = null } = it;
    if (!shortText(hn, 15) || !shortText(scheme, 10) || !shortText(subtype, 10) || !shortText(hospmain, 10) || !shortText(pdx, 10))
      return { ok: false, error: `ข้อมูลของ ${ref} ไม่ถูกต้อง` };
    if (service_date !== null && !(typeof service_date === "string" && ISO.test(service_date))) return { ok: false, error: `วันที่ของ ${ref} ไม่ถูกต้อง` };
    if (cht_total !== null && !(typeof cht_total === "number" && Number.isFinite(cht_total) && Math.abs(cht_total) < 1e10))
      return { ok: false, error: `ยอดของ ${ref} ไม่ถูกต้อง` };
    items.push({ ref, hn, service_date, scheme, subtype, hospmain, cht_total, pdx });
  }
  return { ok: true, value: { channel: b.channel as Channel, patient_type: b.patient_type, file_sha256: (b.file_sha256 as string | null | undefined) ?? null, items } };
}

// ---- ยืนยันส่งแล้ว / ยกเลิกชุด (PATCH /api/fdh/claim-batch) และประวัติส่งออก (/fdh/claim-batch) ----

export const BATCH_STATUSES = ["pending", "confirmed", "cancelled"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = { pending: "รอยืนยัน", confirmed: "ยืนยันแล้ว", cancelled: "ยกเลิก" };
/** ชุดต่อการยืนยันหนึ่งครั้ง (เหมือน MAX_DECIDE_IDS ของ ar-adjust) */
export const MAX_CONFIRM_IDS = 200;
export const MAX_BATCH_NOTE = 500;

export type BatchAction =
  | { action: "confirm"; ids: string[]; submitted_on: string; note: string | null }
  | { action: "cancel"; id: string; note: string };

const ID = /^\d{1,15}$/;
/** วันจริงแบบ YYYY-MM-DD (ไม่รับ 2026-02-30) */
const realDate = (s: unknown): s is string =>
  typeof s === "string" && ISO.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** ตรวจ body ของ PATCH ; submitted_on ไม่ส่ง = วันนี้ และต้องไม่เกินวันนี้ (route ตรวจเพิ่มว่าไม่ก่อนวันส่งออก) */
export function parseBatchAction(body: unknown, today: string): { ok: true; value: BatchAction } | { ok: false; error: string } {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return { ok: false, error: "body ไม่ถูกต้อง" };
  const note = typeof b.note === "string" ? b.note.trim() : b.note == null ? "" : null;
  if (note === null || note.length > MAX_BATCH_NOTE) return { ok: false, error: `หมายเหตุต้องเป็นข้อความไม่เกิน ${MAX_BATCH_NOTE} ตัวอักษร` };
  if (b.action === "confirm") {
    const ids = b.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_CONFIRM_IDS) return { ok: false, error: `เลือกได้ 1–${MAX_CONFIRM_IDS} ชุด` };
    if (!ids.every((id) => typeof id === "string" && ID.test(id))) return { ok: false, error: "id ของชุดไม่ถูกต้อง" };
    const on = b.submitted_on == null || b.submitted_on === "" ? today : b.submitted_on;
    if (!realDate(on) || on > today) return { ok: false, error: "วันที่อัปโหลดต้องเป็นวันจริงและไม่เกินวันนี้" };
    return { ok: true, value: { action: "confirm", ids: [...new Set(ids as string[])], submitted_on: on, note: note || null } };
  }
  if (b.action === "cancel") {
    if (typeof b.id !== "string" || !ID.test(b.id)) return { ok: false, error: "id ของชุดไม่ถูกต้อง" };
    if (!note) return { ok: false, error: "ต้องระบุเหตุผลที่ยกเลิก" };
    return { ok: true, value: { action: "cancel", id: b.id, note } };
  }
  return { ok: false, error: "action ต้องเป็น confirm หรือ cancel" };
}

/** แถวของ GET /api/fdh/claim-batch (เวลาเป็น "YYYY-MM-DD HH:MI" เวลาไทย) */
export type BatchRow = {
  id: string;
  created_at: string;
  channel: Channel;
  patient_type: PatientType;
  item_count: number;
  total_amount: number;
  created_by: string;
  status: BatchStatus;
  confirmed_at: string | null;
  confirmed_by: string | null;
  submitted_on: string | null;
  note: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
};
export type BatchPage = { rows: BatchRow[]; total: number; summary: Record<BatchStatus, number> };

/** แถวของ GET /api/fdh/claim-batch/items: รายในชุดพร้อมสถานะเคลมปัจจุบัน */
export type BatchItemRow = BatchItem & { claim?: ClaimInfo };
export type BatchItemsPage = { rows: BatchItemRow[]; total: number; summary: { counts: Partial<Record<ClaimStatusKey, number>>; error?: string } };
