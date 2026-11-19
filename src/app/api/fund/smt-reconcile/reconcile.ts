// เทียบยอดโอนของ สปสช. จาก SMT (smt.nhso.go.th) กับ STM ที่นำเข้า (stm_file) แบบ pure ไม่มี import จึงรันทดสอบด้วย node ได้ตรง (reconcile.test.mjs)
// key = งวดของ STM "YYMM_OP|IP_NN" (ปี พ.ศ. 2 หลัก) ฝั่ง SMT คือต้น refDocNo ("6809_IP_03_อุทธรณ์", "6808_IP_01(ยกเลิก Rerun)" รวมใน key เดียวกัน)
// ฝั่ง STM คือ stm_summary.period_label ซึ่งเท่ากับ period_month + run_no ของไฟล์ UCS ทุกไฟล์

/** แถวของ SMT budgetSummaryByVendorReport/search ที่ใช้ (หนึ่งแถวต่อรายการโอนในชุด postingDate + batchNo) */
export type SmtApiRow = {
  postingDate: string; // พ.ศ. YYYYMMDD
  batchNo: string;
  refDocNo: string | null;
  fundDescr: string | null;
  efundDesc: string | null;
  mophId: string | null;
  amount: number;
  wait: number;
  debt: number;
  /** ยอดโอนสุทธิ = amount − wait − debt */
  total: number;
  pmntStts: string; // P = โอนแล้ว, W = รอโอน
};

export type SmtLine = {
  date: string; // ISO ค.ศ.
  batch_no: string;
  ref: string;
  fund: string;
  account: string | null;
  amount: number;
  wait: number;
  debt: number;
  total: number;
  paid: boolean;
};

export type StmFileInput = {
  doc_no: string;
  patient_type: string;
  period_month: string; // YYYY-MM-01
  run_no: number;
  transfer_date: string;
  net_total: string | number;
};

export type ReconcileStatus = "match" | "diff" | "smt_only" | "stm_only";
export const RECONCILE_STATUSES = ["match", "diff", "smt_only", "stm_only"] as const satisfies readonly ReconcileStatus[];
export const STATUS_LABEL: Record<ReconcileStatus, string> = {
  match: "ตรงกัน",
  diff: "ต่าง",
  smt_only: "มีแต่ SMT",
  stm_only: "มีแต่ STM",
};

export type ReconcileRow = {
  key: string;
  patient_type: string;
  period_month: string;
  run_no: number;
  /** วันที่โอนล่าสุดของ key */
  smt_date: string | null;
  batches: string;
  smt_total: number | null;
  stm_doc: string | null;
  stm_date: string | null;
  stm_total: number | null;
  /** SMT − STM */
  diff: number | null;
  status: ReconcileStatus;
  lines: SmtLine[];
};

export type ReconcileSummary = { count: Record<ReconcileStatus, number>; smt_total: number; stm_total: number; diff: number };

const KEY_RE = /^(\d{2})(\d{2})_(OP|IP)_(\d{2})(?!\d)/;
const cents = (n: number | string) => Math.round(Number(n) * 100);

/** "6809_IP_03_อุทธรณ์" -> "6809_IP_03" ; refDocNo ที่ไม่อ้างงวด STM (งบจัดสรร, DNAP, เลข REP ของ LGO) -> null */
export function periodKey(ref: string | null): string | null {
  const m = ref?.trim().match(KEY_RE);
  return m && +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}${m[2]}_${m[3]}_${m[4]}` : null;
}

/** key เดียวกับ periodKey จากไฟล์ STM */
export const stmKey = (f: Pick<StmFileInput, "period_month" | "patient_type" | "run_no">) =>
  `${String((+f.period_month.slice(0, 4) + 543) % 100).padStart(2, "0")}${f.period_month.slice(5, 7)}_${f.patient_type}_${String(f.run_no).padStart(2, "0")}`;

/** "6810_IP_01" -> { period_month: "2025-10-01", patient_type: "IP", run_no: 1 } (ปี 2 หลักเป็น 25xx) */
function parseKey(key: string) {
  return { period_month: `${2500 + +key.slice(0, 2) - 543}-${key.slice(2, 4)}-01`, patient_type: key.slice(5, 7), run_no: +key.slice(8, 10) };
}

/** ปีงบ พ.ศ. ของเดือนบริการ (ต.ค.–ธ.ค. เป็นปีงบถัดไป) */
const fiscalYear = (periodMonth: string) => +periodMonth.slice(0, 4) + 543 + (+periodMonth.slice(5, 7) >= 10 ? 1 : 0);

/** "25691113" -> "2026-11-13" */
export const smtDate = (be: string) => `${+be.slice(0, 4) - 543}-${be.slice(4, 6)}-${be.slice(6, 8)}`;

export function toLine(r: SmtApiRow): SmtLine {
  return {
    date: smtDate(r.postingDate), batch_no: r.batchNo, ref: r.refDocNo?.trim() ?? "",
    fund: r.efundDesc || r.fundDescr || "", account: r.mophId, amount: r.amount, wait: r.wait, debt: r.debt, total: r.total, paid: r.pmntStts === "P",
  };
}

/** หนึ่งแถวต่องวด STM ของปีงบ fy (ตามเดือนบริการ) ที่มีใน SMT หรือ STM ; ยอด SMT = ผลรวม total (ยอดโอนสุทธิ ไม่นับรอโอน) ของทุกรายการใน key */
export function reconcile(lines: SmtLine[], files: StmFileInput[], fy: number): ReconcileRow[] {
  const smt = new Map<string, SmtLine[]>();
  for (const l of lines) {
    const key = periodKey(l.ref);
    if (key && fiscalYear(parseKey(key).period_month) === fy) smt.set(key, [...(smt.get(key) ?? []), l]);
  }
  const stm = new Map(files.filter((f) => fiscalYear(f.period_month) === fy).map((f) => [stmKey(f), f]));

  return [...new Set([...smt.keys(), ...stm.keys()])].sort().map((key) => {
    const ls = (smt.get(key) ?? []).toSorted((a, b) => a.date.localeCompare(b.date) || a.batch_no.localeCompare(b.batch_no));
    const f = stm.get(key);
    const smtC = ls.length ? ls.reduce((s, l) => s + cents(l.total), 0) : null;
    const stmC = f ? cents(f.net_total) : null;
    const diffC = smtC !== null && stmC !== null ? smtC - stmC : null;
    return {
      key,
      ...(f ? { patient_type: f.patient_type, period_month: f.period_month, run_no: f.run_no } : parseKey(key)),
      smt_date: ls.at(-1)?.date ?? null,
      batches: [...new Set(ls.map((l) => l.batch_no))].join(", "),
      smt_total: smtC === null ? null : smtC / 100,
      stm_doc: f?.doc_no ?? null,
      stm_date: f?.transfer_date ?? null,
      stm_total: stmC === null ? null : stmC / 100,
      diff: diffC === null ? null : diffC / 100,
      status: smtC === null ? "stm_only" : stmC === null ? "smt_only" : diffC === 0 ? "match" : "diff",
      lines: ls,
    };
  });
}

/** ยอดรวมทุกแถว ส่วนต่างรวมเฉพาะแถวที่มีทั้งสองฝั่ง */
export function summarize(rows: ReconcileRow[]): ReconcileSummary {
  const count: Record<ReconcileStatus, number> = { match: 0, diff: 0, smt_only: 0, stm_only: 0 };
  let smtC = 0, stmC = 0, diffC = 0;
  for (const r of rows) {
    count[r.status]++;
    smtC += cents(r.smt_total ?? 0);
    stmC += cents(r.stm_total ?? 0);
    diffC += cents(r.diff ?? 0);
  }
  return { count, smt_total: smtC / 100, stm_total: stmC / 100, diff: diffC / 100 };
}
