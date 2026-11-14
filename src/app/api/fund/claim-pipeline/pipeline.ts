// จัดขั้นเส้นทางเคลมต่อราย (OP = visit, IP = admission) แบบ pure ไม่มี import รันทดสอบด้วย node ได้ตรง (pipeline.test.mjs)

export type PipelineType = "op" | "ip";
/** ขั้นตามลำดับ รายหนึ่งอยู่ที่ขั้นสุดท้ายที่ผ่านต่อเนื่องมา (ตกขั้นไหนไม่นับขั้นถัดไป) */
export const STEPS = ["served", "closed", "rep", "a", "paid"] as const;
export type Step = (typeof STEPS)[number];
export const REASONS = ["authen_only", "none", "no_approve", "unlocked", "rep_wait", "rep_missing", "c", "deny", "stm_wait"] as const;
export type Reason = (typeof REASONS)[number];
/** กลุ่มที่เลือกดูรายชื่อได้ (param stage): ขั้น = รายที่ไปถึงขั้นนั้น, สาเหตุ = รายที่ตกด้วยสาเหตุนั้น, overdue = ไม่มี REP เกินกำหนดส่ง */
export const GROUPS = [...STEPS, ...REASONS, "overdue"] as const;
export type Group = (typeof GROUPS)[number];

/** มุมมองของขั้นและสาเหตุ: OP ของข้าราชการ (OFC) ขั้น 2 คือ Approval Code จากเครื่อง EDC แทนการปิดสิทธิ สปสช. ; IP เหมือนกันทุกกองทุน */
export type View = PipelineType | "ofc";
export const EDC_FUND = "OFC";
export const viewOf = (type: PipelineType, fund: string): View => (type === "op" && fund === EDC_FUND ? "ofc" : type);

export const STEP_LABEL: Record<View, Record<Step, string>> = {
  op: { served: "ให้บริการ", closed: "ปิดสิทธิแล้ว", rep: "มี REP", a: "REP ผ่าน (A)", paid: "เงินเข้า" },
  ofc: { served: "ให้บริการ", closed: "มี Approval Code แล้ว", rep: "มี REP", a: "REP ผ่าน (A)", paid: "เงินเข้า" },
  ip: { served: "จำหน่าย", closed: "ล็อกการเงินแล้ว", rep: "มี REP", a: "REP ผ่าน (A)", paid: "เงินเข้า" },
};
export const REASON_LABEL: Record<Reason, string> = {
  authen_only: "Authen แล้วยังไม่ปิดสิทธิ",
  none: "ยังไม่ Authen",
  no_approve: "ยังไม่มี Approval Code",
  unlocked: "ยังไม่ล็อกการเงิน",
  rep_wait: "รอ REP",
  rep_missing: "ไม่พบ REP",
  c: "ติด C",
  deny: "Deny",
  stm_wait: "รอ Statement",
};
/** สาเหตุที่ทำให้ไม่ถึงแต่ละขั้น (แสดงใต้ขั้นนั้น) */
export const REASONS_AT: Record<View, Partial<Record<Step, readonly Reason[]>>> = {
  op: { closed: ["authen_only", "none"], rep: ["rep_wait", "rep_missing"], a: ["c", "deny"], paid: ["stm_wait"] },
  ofc: { closed: ["no_approve"], rep: ["rep_wait", "rep_missing"], a: ["c", "deny"], paid: ["stm_wait"] },
  ip: { closed: ["unlocked"], rep: ["rep_wait", "rep_missing"], a: ["c", "deny"], paid: ["stm_wait"] },
};

// กำหนดส่งข้อมูลเคลมนับจากวันรับบริการ/วันจำหน่าย: จากการประชุมชี้แจง สปสช. เขต 7 (11 พ.ย. 2569) ยังไม่ได้ยืนยันกับประกาศ
export const SUBMIT_DEADLINE_DAYS: Record<PipelineType, number> = { op: 15, ip: 30 };
// shortcut: REP มาช้า 2–4 สัปดาห์หลังส่ง จึงถือว่ารายที่ไม่มี REP ภายใน 30 วันก่อนไฟล์ REP ล่าสุดยัง "รอ REP" เก่ากว่านั้น = "ไม่พบ REP"
// ถ้ามีวันที่ส่งเคลมจริง (FDH) ให้เทียบกับวันที่ส่งแทน
export const REP_LAG_DAYS = 30;

/** รายจาก HOSxP: claim = สถานะปิดสิทธิ (OP), approved/no_approve จาก Approval Code EDC (OP ของ OFC) หรือ closed/unlocked จาก ipt.finance_lock (IP) */
export type HisCase = {
  key: string;
  hn: string;
  date: string;
  pttype: string | null;
  pttype_name: string;
  debtor: number | null;
  claim: "closed" | "authen_only" | "none" | "approved" | "no_approve" | "unlocked";
};
/** REP ล่าสุดของราย ค่าเงินจาก pg เป็น string */
export type RepLatest = {
  rep_no: string;
  error_codes: string[];
  deny: Record<string, unknown> | null;
  net_nhso: string | number | null;
  net_affiliation: string | number | null;
  status: "a" | "c" | "deny";
};

export type PipelineRow = Omit<HisCase, "claim"> & {
  step: Step;
  reason: Reason | null;
  rep_no: string | null;
  /** รหัส C และรหัส Deny (ค่าใน deny jsonb) คั่นด้วย ", " */
  codes: string;
  /** ชดเชยสุทธิ = net_nhso + net_affiliation (UC OP เงินส่วนใหญ่อยู่ที่ net_affiliation) เหมือน /fund/uc-debtor */
  compensation: number | null;
  stm_paid: number | null;
  /** วันนับจากวันรับบริการ/จำหน่ายถึงวันนี้ */
  days: number;
  /** ยังไม่มี REP และเกินกำหนดส่ง */
  overdue: boolean;
};

type Totals = { count: number; amount: number };
export type Funnel = { steps: Record<Step, Totals>; reasons: Record<Reason, Totals>; overdue: Totals };

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const round2 = (n: number) => Math.round(n * 100) / 100;

// deny jsonb มีค่า "C" ในแถวที่ผ่าน (ไม่ใช่รหัส) รหัส Deny จริงอยู่ในแถว status deny เท่านั้น เช่น { "Deny / AE": "D611" }
const denyCodes = (rep: RepLatest) => (rep.status === "deny" ? Object.values(rep.deny ?? {}).map(String).filter((v) => v !== "C") : []);
export const codesOf = (rep: RepLatest) => [...rep.error_codes.filter((c) => c !== "DENY"), ...denyCodes(rep)].join(", ");

export function classify(
  type: PipelineType,
  { claim, ...c }: HisCase,
  rep: RepLatest | undefined,
  stmPaid: number | undefined,
  ctx: { today: string; repFileDate: string | null },
): PipelineRow {
  const days = Math.round((utc(ctx.today) - utc(c.date)) / DAY_MS);
  const row = {
    ...c,
    rep_no: rep?.rep_no ?? null,
    codes: rep ? codesOf(rep) : "",
    compensation: rep ? round2(Number(rep.net_nhso ?? 0) + Number(rep.net_affiliation ?? 0)) : null,
    stm_paid: stmPaid ?? null,
    days,
    overdue: !rep && days > SUBMIT_DEADLINE_DAYS[type],
  };
  // มี REP = ส่งเคลมถึง สปสช. แล้ว นับว่าผ่านขั้นปิดสิทธิ/ล็อกการเงิน แม้ HOSxP ไม่มีบันทึก (ส.ค. 2569 OP UCS ไม่ปิดสิทธิ 2,799 ราย ส่วนใหญ่มี REP)
  if (claim !== "closed" && claim !== "approved" && !rep) return { ...row, step: "served", reason: claim };
  if (!rep) {
    const waiting = !ctx.repFileDate || utc(c.date) > utc(ctx.repFileDate) - REP_LAG_DAYS * DAY_MS;
    return { ...row, step: "closed", reason: waiting ? "rep_wait" : "rep_missing" };
  }
  if (rep.status !== "a") return { ...row, step: "rep", reason: rep.status };
  if (!(stmPaid && stmPaid > 0)) return { ...row, step: "a", reason: "stm_wait" };
  return { ...row, step: "paid", reason: null };
}

/** ราย OP ที่ปิดสิทธิผ่าน /fund/close-privilege (nhso_close_log ไม่ย้อนเข้า HOSxP) นับเป็นปิดสิทธิแล้ว */
export const markClosed = <T extends Pick<HisCase, "key" | "claim">>(cases: T[], closed: Set<string>): T[] =>
  closed.size ? cases.map((c) => (closed.has(c.key) ? { ...c, claim: "closed" } : c)) : cases;

const rank = (s: Step) => STEPS.indexOf(s);

export function inGroup(r: PipelineRow, g: Group): boolean {
  if (g === "overdue") return r.overdue;
  return (STEPS as readonly string[]).includes(g) ? rank(r.step) >= rank(g as Step) : r.reason === g;
}

export function summarize(rows: PipelineRow[]): Funnel {
  const zero = () => ({ count: 0, amount: 0 });
  const f: Funnel = {
    steps: Object.fromEntries(STEPS.map((s) => [s, zero()])) as Funnel["steps"],
    reasons: Object.fromEntries(REASONS.map((s) => [s, zero()])) as Funnel["reasons"],
    overdue: zero(),
  };
  const add = (t: Totals, r: PipelineRow) => {
    t.count++;
    t.amount = round2(t.amount + (r.debtor ?? 0));
  };
  for (const r of rows) {
    for (const s of STEPS.slice(0, rank(r.step) + 1)) add(f.steps[s], r);
    if (r.reason) add(f.reasons[r.reason], r);
    if (r.overdue) add(f.overdue, r);
  }
  return f;
}

/** ค้นหา VN/AN, HN, เลข REP, รหัส C/Deny แบบมีคำนั้นอยู่ */
export const matches = (r: PipelineRow, q: string) => [r.key, r.hn, r.rep_no, r.codes].some((v) => v?.includes(q));

export type SortKey = "key" | "hn" | "date" | "pttype_name" | "debtor" | "step" | "codes" | "compensation" | "stm_paid" | "days";

/** เรียงตามคอลัมน์ ค่าว่างอยู่ท้ายเสมอทั้งสองทิศ แล้วเรียงตามวันที่และ key ให้ผลคงที่ ; step เรียงตามลำดับขั้น */
export function sortRows(rows: PipelineRow[], key: SortKey, dir: "asc" | "desc"): PipelineRow[] {
  const sign = dir === "desc" ? -1 : 1;
  const value = (r: PipelineRow) => (key === "step" ? rank(r.step) : key === "codes" ? r.codes || null : r[key]);
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
