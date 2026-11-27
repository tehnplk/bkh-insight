import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { journalLines, type JournalLine } from "../../ar-journal/journal";
import type { LedgerKind } from "../../ar-sync/ledger";
import { fiscalYearOf } from "../../uc-dashboard/dashboard";
import { REP_DISABLED_MSG, REP_NO_RE, REP_SETTLE_ENABLED, debtKey, debtPlans, lineKey, previewRows, type DebtPlan, type PreviewRow } from "../settle";
import { loadFile, loadMissing, loadRep, repNotMigrated } from "../sql";

// รายละเอียดของหนึ่งแถวในตัวอย่างการตัด (GET ?id=<stm_file_id>|rep=<rep_no>&key=<PreviewRow.key>) อ่านอย่างเดียว
// โหลดไฟล์/REP ด้วยตัวเดียวกับ preview แล้วคัดเฉพาะ key นี้ แผนจาก planSettle (debtPlans) บัญชีส่วนต่างจาก journalLines (ไม่เขียนกติกาซ้ำ)

/** บรรทัดในเอกสารของรายนี้ (stm_row หรือ rep_row) ; section null = REP */
export type DetailLine = {
  id: string; section: string | null; rep_no: string; tran_id: string | null; adjrw: string | null;
  claim_total: string | null; paid_total: string; fund_amounts: Record<string, number> | null; error_codes?: string[];
};
export type DetailEntry = {
  id: string; ref: string; entry_date: string; orig_entry_date: string | null; kind: LedgerKind; source: string; amount: string; note: string | null;
  /** คงเหลือสะสมของหนี้ถึงแถวนี้ (บาท) ; this_doc = แถวที่ตัดด้วยเอกสารนี้ */
  running: number; this_doc: boolean;
  batch_id: string | null; receipt_no: string | null; receipt_date: string | null; settled_by: string | null; settled_at: string | null;
};
export type DetailDebt = DebtPlan & {
  account_code: string | null; account_name: string | null; settles: boolean; ref_date: string | null;
  /** บัญชีคู่ของส่วนต่างถ้าปิด (diff ≠ 0) ; prior_year = หนี้บริการปีงบก่อนปีงบของวันนี้ */
  diff_line: JournalLine | null; prior_year: boolean;
  entries: DetailEntry[];
};
export type SettleDetail = {
  row: PreviewRow;
  /** stm = บรรทัดจากไฟล์ STM ; rep = บรรทัดจาก REP (doc rep หรือกลุ่ม REP งวดนี้ STM ไม่จ่าย) */
  line_doc: "stm" | "rep";
  lines: DetailLine[];
  /** ค่าพาหนะ (AE) ที่ STM UC IP จ่ายให้หนี้ CR ก่อน (บาท) */
  cr_paid: number;
  debts: DetailDebt[];
  entry_date: string;
};

const KEY_RE = /^(OP:\d{12}|IP:\d{1,12}|row:\d{1,15})$/;
const STM_ROWS_SQL = `SELECT id::text AS id, section, rep_no, tran_id, adjrw, claim_total, paid_total, fund_amounts
FROM stm_row WHERE stm_file_id = $1 AND id = ANY($2::bigint[]) ORDER BY id`;
const REP_ROWS_SQL = `SELECT tran_id AS id, NULL::text AS section, rep_no, tran_id, adjrw, claim_total,
  COALESCE(net_nhso, 0) + COALESCE(net_affiliation, 0) AS paid_total, fund_amounts, error_codes
FROM rep_row WHERE tran_id = ANY($1::text[]) ORDER BY tran_id`;
// ทุกแถวของหนี้ (ทุก source = ยอดคงเหลือทางบัญชี) ใช้ index ar_ledger_debt_idx (patient_type, ref)
const LEDGER_SQL = `SELECT l.id::text AS id, l.ref, l.entry_date::text AS entry_date, l.orig_entry_date::text AS orig_entry_date, l.kind, l.source,
  l.amount, l.note, l.stm_row_id::text AS stm_row_id, l.rep_tran_id,
  b.id::text AS batch_id, b.receipt_no, b.receipt_date::text AS receipt_date, b.settled_by, to_char(b.settled_at, 'YYYY-MM-DD HH24:MI') AS settled_at
FROM ar_ledger l LEFT JOIN ar_settle_batch b ON b.id = l.settle_batch_id
WHERE l.patient_type = $1 AND l.ref = ANY($2::text[])
ORDER BY l.ref, l.entry_date, l.id`;
const ACCOUNTS_SQL = "SELECT code, name, revenue_code, diff_under_code, diff_over_code FROM ar_account WHERE code = ANY($1::text[])";
type Account = { code: string; name: string | null; revenue_code: string | null; diff_under_code: string | null; diff_over_code: string | null };
type LedgerRow = Omit<DetailEntry, "running" | "this_doc"> & { stm_row_id: string | null; rep_tran_id: string | null };

export async function GET(request: NextRequest) {
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const id = params.get("id") ?? "";
  const repNo = params.get("rep");
  const key = params.get("key") ?? "";
  if (repNo !== null && !REP_SETTLE_ENABLED) return Response.json({ error: REP_DISABLED_MSG }, { status: 404 });
  if (repNo !== null ? !REP_NO_RE.test(repNo) : !/^\d{1,15}$/.test(id)) return Response.json({ error: "id ของไฟล์หรือเลขที่ REP ไม่ถูกต้อง" }, { status: 400 });
  if (!KEY_RE.test(key)) return Response.json({ error: "key ไม่ถูกต้อง" }, { status: 400 });

  const data = await (repNo !== null ? loadRep(insightQuery, repNo).catch(repNotMigrated) : loadFile(insightQuery, id));
  if (data instanceof Response) return data;
  if (!data) return Response.json({ error: repNo !== null ? "ไม่พบ REP นี้ในสิทธิที่ตัดด้วย REP ได้" : "ไม่พบไฟล์ STM นี้" }, { status: 404 });
  const pt = data.file.patient_type;
  const lines = data.lines.filter((l) => lineKey(l) === key);
  const debts = data.debts.filter((d) => debtKey(d) === key);
  // ไม่มีบรรทัดในไฟล์ = กลุ่ม "REP งวดนี้ STM ไม่จ่าย" (หนี้มาจาก S4 ไม่อยู่ใน debts ของไฟล์)
  const missing = !lines.length && repNo === null ? (await loadMissing(insightQuery, data.file)).filter((m) => (pt === "OP" ? m.vn : m.an) === key.slice(3)) : [];
  const [row] = previewRows(lines, debts, missing, pt);
  if (!row) return Response.json({ error: "ไม่พบรายการนี้ในเอกสาร" }, { status: 404 });

  const today = todayIso();
  const refs = [...new Set([...debts.map((d) => d.ref), ...missing.map((m) => m.ref)])];
  const codes = [...new Set([...debts.map((d) => d.account_code), ...missing.map((m) => m.account_code)].filter((c): c is string => !!c))];
  const lineDoc = repNo !== null || missing.length ? "rep" : "stm";
  const [docLines, ledger, accounts] = await Promise.all([
    lineDoc === "rep"
      ? insightQuery<DetailLine>(REP_ROWS_SQL, [lines.length ? lines.map((l) => l.id) : missing.map((m) => m.tran_id)])
      : insightQuery<DetailLine>(STM_ROWS_SQL, [id, lines.map((l) => l.id)]),
    refs.length ? insightQuery<LedgerRow>(LEDGER_SQL, [pt, refs]) : [],
    codes.length ? insightQuery<Account>(ACCOUNTS_SQL, [codes]) : [],
  ]);
  const accountOf = new Map(accounts.map((a) => [a.code, a]));
  const lineIds = new Set(lines.map((l) => l.id));
  const plans = new Map(debtPlans(lines, debts, today).map((p) => [p.ref, p]));
  // หนี้ในกลุ่ม STM ไม่จ่าย: ไม่มีแผน คงเหลือตาม S4
  const sources = [
    ...debts.map((d) => ({ ref: d.ref, account_code: d.account_code, ref_date: d.ref_date, settles: d.settles_by_stm, plan: plans.get(d.ref)! })),
    ...missing.map((m) => {
      const b = Number(m.balance);
      return { ref: m.ref, account_code: m.account_code, ref_date: null, settles: true, plan: { ref: m.ref, before: b, settle: 0, after: b, diff: 0 } };
    }),
  ];

  const out: DetailDebt[] = sources.map((s) => {
    const a = s.account_code ? accountOf.get(s.account_code) : undefined;
    // = prior_year ของ SQL สมุดรายวัน (ref_date ก่อนต้นปีงบของ entry_date) โดย entry_date = วันนี้ (ค่าเริ่มต้นวันที่ใบเสร็จ)
    const prior = !!s.ref_date && fiscalYearOf(s.ref_date) < fiscalYearOf(today);
    const diff_line = s.plan.diff
      ? journalLines([{
          account_code: s.account_code, account_name: a?.name ?? null, kind: "diff", source: "stm", prior_year: prior,
          revenue_code: a?.revenue_code ?? null, diff_under_code: a?.diff_under_code ?? null, diff_over_code: a?.diff_over_code ?? null, n: 1, amount: s.plan.diff,
        }])[0]
      : null;
    let running = 0;
    const entries = ledger.filter((e) => e.ref === s.ref).map(({ stm_row_id, rep_tran_id, ...e }): DetailEntry => {
      running = Math.round(running * 100 + Math.round(Number(e.amount) * 100)) / 100;
      return { ...e, running, this_doc: !!(lineDoc === "stm" ? stm_row_id && lineIds.has(stm_row_id) : rep_tran_id && lineIds.has(rep_tran_id)) };
    });
    return { ...s.plan, account_code: s.account_code, account_name: a?.name ?? null, settles: s.settles, ref_date: s.ref_date, diff_line, prior_year: prior, entries };
  });

  const crPaid = lines.filter((l) => !l.done).reduce((t, l) => t + Math.round(Number(l.cr_paid ?? 0) * 100), 0) / 100;
  const body: SettleDetail = { row, line_doc: lineDoc, lines: docLines, cr_paid: crPaid, debts: out, entry_date: today };
  return Response.json(body);
}
