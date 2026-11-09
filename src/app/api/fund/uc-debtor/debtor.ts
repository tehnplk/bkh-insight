// จับคู่ลูกหนี้ UC (HOSxP) กับ REP ล่าสุด (insight rep_row) แบบ pure ไม่มี import จึงรันทดสอบด้วย node ได้ตรง (debtor.test.mjs)

export type DebtorType = "opd" | "ipd";
export type DebtorStatus = "paid" | "error" | "none";
export const DEBTOR_STATUSES = ["paid", "error", "none"] as const satisfies readonly DebtorStatus[];
export const STATUS_LABEL: Record<DebtorStatus, string> = { paid: "ได้รับชดเชย", error: "ติด error", none: "ยังไม่มี REP" };

/** ลูกหนี้หนึ่งราย: OPD = visit (key = vn), IPD = admission ที่จำหน่ายแล้ว (key = an) */
export type HisDebtor = {
  key: string;
  vn: string | null;
  an: string | null;
  hn: string;
  date: string;
  full_name: string;
  pttype_name: string;
  drg: string | null;
  adjrw: number | null;
  debtor: number;
  debt_amount: number | null;
};

/** REP ล่าสุดของ visit/admission ค่าเงินจาก pg เป็น string */
export type LatestRep = {
  key: string;
  rep_no: string;
  net_nhso: string | number | null;
  net_affiliation: string | number | null;
  error_codes: string[];
};

/** ผลจับคู่กับ REP ล่าสุดของลูกหนี้หนึ่งราย */
export type DebtorMatch = {
  rep_no: string | null;
  compensation: number | null;
  diff: number | null;
  status: DebtorStatus;
  error_codes: string[];
};

/** แถวของ /api/fund/uc-debtor */
export type UcDebtorRow = HisDebtor & DebtorMatch;

export type UcDebtorSummary = {
  count: number;
  debtor: number;
  compensation: number;
  diff: number;
  /** นับก่อนกรองสถานะ (หลังค้นหา) ให้เห็นสัดส่วนทุกสถานะแม้เลือกสถานะเดียว */
  status: Record<DebtorStatus, number>;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ชดเชยสุทธิ = net_nhso + net_affiliation (UC OPD เงินส่วนใหญ่อยู่ที่ net_affiliation) ไม่ใช้ paid */
export const compensationOf = (rep: Pick<LatestRep, "net_nhso" | "net_affiliation">) =>
  round2(Number(rep.net_nhso ?? 0) + Number(rep.net_affiliation ?? 0));

/** ใช้ทั้ง /api/fund/uc-debtor (HisDebtor เต็ม) และ /api/fund/uc-dashboard (แค่ key/date/debtor) */
export function mergeDebtors<D extends Pick<HisDebtor, "key" | "debtor">>(debtors: D[], reps: LatestRep[]): (D & DebtorMatch)[] {
  const byKey = new Map(reps.map((r) => [r.key, r]));
  return debtors.map((d): D & DebtorMatch => {
    const rep = byKey.get(d.key);
    if (!rep) return { ...d, rep_no: null, compensation: null, diff: null, status: "none", error_codes: [] };
    const compensation = compensationOf(rep);
    return {
      ...d,
      rep_no: rep.rep_no,
      compensation,
      diff: round2(d.debtor - compensation),
      status: rep.error_codes.length ? "error" : "paid",
      error_codes: rep.error_codes,
    };
  });
}

export function summarize(rows: UcDebtorRow[], beforeStatus: UcDebtorRow[]): UcDebtorSummary {
  const status: Record<DebtorStatus, number> = { paid: 0, error: 0, none: 0 };
  for (const r of beforeStatus) status[r.status]++;
  let debtor = 0, compensation = 0, diff = 0;
  for (const r of rows) {
    debtor += r.debtor;
    compensation += r.compensation ?? 0;
    diff += r.diff ?? 0;
  }
  return { count: rows.length, debtor: round2(debtor), compensation: round2(compensation), diff: round2(diff), status };
}

/** ค้นหา VN/AN/HN/ชื่อ/เลข REP แบบมีคำนั้นอยู่ */
export const matches = (r: UcDebtorRow, q: string) =>
  [r.vn, r.an, r.hn, r.full_name, r.rep_no].some((v) => v?.includes(q));

/** เรียงตามคอลัมน์ ค่าว่าง (null) อยู่ท้ายเสมอทั้งสองทิศ แล้วเรียงตามวันที่และ key ให้ผลคงที่ */
export function sortRows(rows: UcDebtorRow[], key: keyof UcDebtorRow, dir: "asc" | "desc"): UcDebtorRow[] {
  const sign = dir === "desc" ? -1 : 1;
  const value = (r: UcDebtorRow) => (key === "status" ? STATUS_LABEL[r.status] : r[key]);
  return rows.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if ((x == null) !== (y == null)) return x == null ? 1 : -1;
    const c =
      x == null || y == null ? 0
      : typeof x === "number" && typeof y === "number" ? x - y
      : String(x).localeCompare(String(y), "th", { numeric: true });
    return sign * c || a.date.localeCompare(b.date) || a.key.localeCompare(b.key);
  });
}
