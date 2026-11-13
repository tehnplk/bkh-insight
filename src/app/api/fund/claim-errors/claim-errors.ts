// คิวแก้ C/Deny (/api/fund/claim-errors): validate filter และจัดรูปผล แบบ pure ไม่มี import จึงรันทดสอบด้วย node ได้ตรง (claim-errors.test.mjs)

export type ClaimType = "OP" | "IP";
export type ClaimStatus = "c" | "deny";
export const STATUS_LABEL: Record<ClaimStatus, string> = { c: "C", deny: "Deny" };
/** bucket จาก SQL (Query C) ตาม age_service_days */
export const AGE_BUCKETS = [
  { bucket: 1, label: "≤ 30 วัน" },
  { bucket: 2, label: "31–60 วัน" },
  { bucket: 3, label: "61–90 วัน" },
  { bucket: 4, label: "> 90 วัน" },
] as const;

export type Amount = { n: number; amount: number };

/** แถวของ grid: key = VN (OP) หรือ AN (IP), fy = ปีงบ พ.ศ., fund = main_inscl (ว่าง = UNKNOWN) */
export type ClaimErrorRow = {
  type: ClaimType;
  key: string;
  hn: string | null;
  /** จาก his patient ไม่พบ = null */
  full_name: string | null;
  rep_no: string;
  rep_date: string;
  service_at: string;
  fy: number;
  fund: string;
  fund_name: string;
  sub_inscl: string | null;
  status: ClaimStatus;
  codes: string[];
  claim_total: number | null;
  age_rep_days: number;
  age_service_days: number;
};

export type CodeSummary = {
  code: string;
  kind: "C" | "DENY" | null;
  description: string | null;
  n: number;
  amount: number;
  avg_age: number;
  max_age: number;
};

/** response ของ GET /api/fund/claim-errors (สัญญา DataGrid + ข้อมูลแถบสรุป) */
export type ClaimErrorsResponse = {
  rows: ClaimErrorRow[];
  total: number;
  totals: Amount & { c: number; deny: number; op: number; ip: number };
  buckets: (Amount & { bucket: number })[];
  codes: CodeSummary[];
  /** ตัวเลือกกองทุน (ไม่กรองกองทุน ตัวเลือกจึงไม่หายเมื่อเลือกแล้ว) */
  funds: (Amount & { fund: string; name: string })[];
  /** แถว REP ที่ไม่มี VN/AN ยังค้าง error (ไม่อยู่ใน rows) */
  orphan: Amount;
};

export type Filters = {
  type: ClaimType | null;
  status: ClaimStatus | null;
  code: string | null;
  /** ปีงบ ค.ศ. สำหรับ SQL ($4) */
  fyCe: number | null;
  /** null = ไม่กรอง (ห้ามส่ง array ว่างให้ SQL) */
  funds: string[] | null;
};

const CODE = /^[A-Za-z0-9-]{1,20}$/;
const FUND = /^[A-Za-z0-9]{1,10}$/;
const MAX_FUNDS = 50;

/** type=op|ip, status=c|deny, code, fy (ปีงบ พ.ศ. 2500..ปีงบปัจจุบัน), funds=UCS,WEL ค่าว่าง = ไม่กรอง */
export function parseFilters(params: URLSearchParams, currentFy: number): { ok: true; filters: Filters } | { ok: false; error: string } {
  const type = params.get("type") || null;
  if (type !== null && type !== "op" && type !== "ip") return { ok: false, error: "type ต้องเป็น op หรือ ip" };
  const status = params.get("status") || null;
  if (status !== null && status !== "c" && status !== "deny") return { ok: false, error: "status ต้องเป็น c หรือ deny" };
  const code = params.get("code") || null;
  if (code !== null && !CODE.test(code)) return { ok: false, error: "code ไม่ถูกต้อง" };
  const fyRaw = params.get("fy") || null;
  if (fyRaw !== null && (!/^\d{4}$/.test(fyRaw) || +fyRaw < 2500 || +fyRaw > currentFy)) {
    return { ok: false, error: `fy ต้องเป็นปีงบ พ.ศ. ไม่เกิน ${currentFy}` };
  }
  const funds = [...new Set((params.get("funds") ?? "").split(",").map((f) => f.trim()).filter(Boolean))];
  if (funds.length > MAX_FUNDS || !funds.every((f) => FUND.test(f))) return { ok: false, error: "funds ไม่ถูกต้อง" };
  return {
    ok: true,
    filters: {
      type: type === null ? null : type === "op" ? "OP" : "IP",
      status,
      code,
      fyCe: fyRaw === null ? null : +fyRaw - 543,
      funds: funds.length ? funds : null,
    },
  };
}

const num = (v: number | string | null | undefined) => Number(v ?? 0);

/** Query C คืนเฉพาะ bucket ที่มีแถว: เติมให้ครบ 4 ช่วง ค่าเป็นตัวเลข */
export function fillBuckets(rows: { bucket: number | string; n: number | string | null; amount: number | string | null }[]) {
  const by = new Map(rows.map((r) => [Number(r.bucket), r]));
  return AGE_BUCKETS.map(({ bucket }) => ({ bucket, n: num(by.get(bucket)?.n), amount: num(by.get(bucket)?.amount) }));
}
