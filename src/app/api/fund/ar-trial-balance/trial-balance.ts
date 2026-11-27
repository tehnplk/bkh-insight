// งบทดลองรายเดือนของสมุดลูกหนี้ ต่อบัญชี: ยกมา / ระหว่างงวด / ยกไป ฝั่งเดบิตและเครดิต (test: trial-balance.test.mjs)
// กติกา Dr/Cr มาจาก journalLines() ที่เดียว แยกทีละ bucket ตามวันที่ลงบัญชี:
//   prior = ก่อนต้นปีงบของเดือนนี้, ytd = ต้นปีงบถึงก่อนต้นเดือน, month = ในเดือน (ไม่เกินวันนี้)
// บัญชีจริง (ลูกหนี้, เงินฝาก, เงินรับล่วงหน้า, ทุน/กำไรสะสมปีก่อน) ยกมาสะสมทุกปี ; บัญชีรายได้/ส่วนต่างปิดทุก 1 ต.ค. ยอดก่อนปีงบรวมเป็นแถว "ผลสะสมปีงบก่อน"
import { journalLines, type AccountType, type JournalGroup } from "../ar-journal/journal";

export type TbBucket = "prior" | "ytd" | "month";
export type TbGroup = JournalGroup & { bucket: TbBucket };
export type TbType = AccountType | "retained";
/** ยกมา/ยกไปเป็นยอดสุทธิ อยู่ข้างเดียว อีกข้าง null ; ระหว่างงวดเป็นยอดรวมแต่ละข้าง (ไม่หักกลบ) */
export type TbRow = {
  type: TbType; code: string | null; name: string;
  opening_dr: number | null; opening_cr: number | null; dr: number; cr: number; closing_dr: number | null; closing_cr: number | null;
};
export type TbTotals = { opening_dr: number; opening_cr: number; dr: number; cr: number; closing_dr: number; closing_cr: number };
/** missing = บัญชีที่ยังไม่มีรหัส (ไม่นับเงินฝากธนาคาร ที่งานบัญชีเลือกเองตอนรับโอน) */
export type TrialBalance = { rows: TbRow[]; totals: TbTotals; missing: number };

export const RETAINED_NAME = "ผลสะสมปีงบก่อน";
const NOMINAL = new Set<TbType>(["revenue", "diff_under", "diff_over"]);
const ORDER: TbType[] = ["ar", "cash", "pool", "revenue", "diff_under", "diff_over", "equity", "retained"];
const LAST = "￿";
const BUCKETS: TbBucket[] = ["prior", "ytd", "month"];

/** ต้นปีงบของเดือน YYYY-MM (ปีงบเริ่ม 1 ต.ค.) */
export const fiscalStart = (month: string) => `${+month.slice(0, 4) - (+month.slice(5, 7) >= 10 ? 0 : 1)}-10-01`;

const side = (cents: number): [number | null, number | null] => (cents > 0 ? [cents / 100, null] : cents < 0 ? [null, -cents / 100] : [null, null]);

export function trialBalance(groups: TbGroup[]): TrialBalance {
  type Acc = { type: TbType; code: string | null; name: string; open: number; dr: number; cr: number }; // สตางค์
  const accs = new Map<string, Acc>();
  const post = (type: AccountType, code: string | null, name: string, bucket: TbBucket, cents: number) => {
    const retained = bucket === "prior" && NOMINAL.has(type);
    const key = retained ? "retained|" : `${type}|${code ?? ""}`;
    let a = accs.get(key);
    if (!a) accs.set(key, (a = retained ? { type: "retained", code: null, name: RETAINED_NAME, open: 0, dr: 0, cr: 0 } : { type, code, name, open: 0, dr: 0, cr: 0 }));
    if (bucket !== "month") a.open += cents;
    else if (cents > 0) a.dr += cents;
    else a.cr -= cents;
  };
  for (const bucket of BUCKETS) {
    for (const l of journalLines(groups.filter((g) => g.bucket === bucket))) {
      const cents = Math.round(l.amount * 100);
      post(l.dr_type, l.dr_code, l.dr_name, bucket, cents);
      post(l.cr_type, l.cr_code, l.cr_name, bucket, -cents);
    }
  }
  const rows: TbRow[] = [...accs.values()]
    .filter((a) => a.open || a.dr || a.cr)
    .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || (a.code ?? LAST).localeCompare(b.code ?? LAST))
    .map((a) => {
      const [opening_dr, opening_cr] = side(a.open);
      const [closing_dr, closing_cr] = side(a.open + a.dr - a.cr);
      return { type: a.type, code: a.code, name: a.name, opening_dr, opening_cr, dr: a.dr / 100, cr: a.cr / 100, closing_dr, closing_cr };
    });
  const sum = (k: keyof TbTotals) => Math.round(rows.reduce((s, r) => s + (r[k] ?? 0) * 100, 0)) / 100;
  const totals: TbTotals = { opening_dr: sum("opening_dr"), opening_cr: sum("opening_cr"), dr: sum("dr"), cr: sum("cr"), closing_dr: sum("closing_dr"), closing_cr: sum("closing_cr") };
  return { rows, totals, missing: rows.filter((r) => r.code == null && r.type !== "cash" && r.type !== "retained").length };
}

/** จำนวนบัญชีที่ยอดปัจจุบันต่างจาก snapshot ตอนปิดงวด (รวมบัญชีที่เพิ่มหรือหายไป) */
export function snapshotChanges(live: TrialBalance, snap: TrialBalance): number {
  const sig = (tb: TrialBalance) =>
    new Map(tb.rows.map((r) => [`${r.type}|${r.code ?? ""}`, [r.opening_dr, r.opening_cr, r.dr, r.cr, r.closing_dr, r.closing_cr].join("|")]));
  const a = sig(live), b = sig(snap);
  return [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).length;
}

type Query = <T>(sql: string, params: unknown[]) => Promise<T[]>;

// S1 (prove-query ผ่าน ; เพิ่ม JOIN ar_capitation_batch 25 พ.ย. 2569, prior_year เหมือน ar-journal 27 พ.ย. 2569): $1 ต้นปีงบ, $2 ต้นเดือน, $3 สิ้นเดือนไม่เกินวันนี้ ; GROUP BY sign ให้ Dr/Cr เป็นยอดรวมแต่ละข้าง
const TB_SQL = `SELECT CASE WHEN l.entry_date < $1 THEN 'prior' WHEN l.entry_date < $2 THEN 'ytd' ELSE 'month' END AS bucket,
  l.account_code, a.name AS account_name, l.kind, l.source, a.revenue_code, a.diff_under_code, a.diff_over_code,
  cb.clear_code, cb.clear_short_code, COALESCE(l.kind = 'diff' AND l.source IN ('stm', 'manual') AND l.ref_date < (date_trunc('year', l.entry_date + interval '3 months') - interval '3 months')::date, false) AS prior_year, count(*)::int AS n, SUM(l.amount) AS amount
FROM ar_ledger l LEFT JOIN ar_account a ON a.code = l.account_code LEFT JOIN ar_capitation_batch cb ON cb.id = l.capitation_batch_id
WHERE l.entry_date <= $3
GROUP BY 1, l.account_code, a.name, l.kind, l.source, a.revenue_code, a.diff_under_code, a.diff_over_code, cb.clear_code, cb.clear_short_code, prior_year, sign(l.amount)`;
// เงินโอนที่ได้รับ (ar_transfer ไม่ยกเลิก ลงรับแล้ว) ตามวันที่ใบเสร็จ receipt_date ; รอออกใบเสร็จ (NULL) ยังไม่ลงบัญชี ; ส่ง amount ติดลบ = เครดิต account_code (journalLines kind transfer, ข้ามบัญชี settles_by_stm)
const TB_TRANSFER_SQL = `SELECT CASE WHEN t.receipt_date < $1 THEN 'prior' WHEN t.receipt_date < $2 THEN 'ytd' ELSE 'month' END AS bucket,
  t.account_code, a.name AS account_name, 'transfer' AS kind, 'transfer' AS source, NULL AS revenue_code, NULL AS diff_under_code, NULL AS diff_over_code,
  COALESCE(a.settles_by_stm, false) AS settles_by_stm, count(*)::int AS n, -SUM(t.amount) AS amount
FROM ar_transfer t LEFT JOIN ar_account a ON a.code = t.account_code
WHERE t.cancelled_at IS NULL AND t.receipt_date <= $3
GROUP BY 1, t.account_code, a.name, a.settles_by_stm, sign(t.amount)`;

/** งบทดลองของเดือน YYYY-MM ถึงวันที่ to ; query = insightQuery หรือ tx ของ insightTransaction */
export async function loadTrialBalance(query: Query, month: string, to: string): Promise<TrialBalance> {
  const params = [fiscalStart(month), `${month}-01`, to];
  const [ledger, transfers] = await Promise.all([query<TbGroup>(TB_SQL, params), ignoreMissingTable(query<TbGroup>(TB_TRANSFER_SQL, params), [])]);
  return trialBalance([...ledger, ...transfers]);
}

/** ar_period_close ยังไม่มี (ก่อนรัน migration) = ยังไม่ปิดงวด หน้า ar-ledger จะได้ไม่พังระหว่าง deploy */
export async function ignoreMissingTable<T>(p: Promise<T>, fallback: T): Promise<T> {
  return p.catch((e) => {
    if ((e as { code?: string }).code === "42P01") return fallback;
    throw e;
  });
}

/** เดือนล่าสุดที่ปิดงวดอยู่ YYYY-MM (null = ยังไม่ปิด) */
export async function closedThrough(query: Query): Promise<string | null> {
  const rows = await ignoreMissingTable(
    query<{ through: string | null }>("SELECT to_char(max(month), 'YYYY-MM') AS through FROM ar_period_close WHERE unlocked_at IS NULL", []),
    [],
  );
  return rows[0]?.through ?? null;
}
