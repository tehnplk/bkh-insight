import type { NextRequest } from "next/server";
import { hisQuery, insightQuery } from "@/lib/db";
import { todayIso } from "@/lib/thai-date";
import { xlsxResponse } from "@/lib/xlsx";
import { OPI_BY_DATE, inList, isAuthed, unauthorized } from "@/app/api/fund/_lib/fund";
import { addDays } from "@/app/api/fund/ar-sync/ledger";
import { KIND_SCOPE, PROBLEM_TEXT, assess, type ClaimKind, type HisItem, type ItemRow, type RefCode, type Usage } from "./readiness";

/** response ของ GET /api/fdh/claim-codes?kind=INST|PP (format=xlsx&part=fix|missing|ok ส่งไฟล์) */
export type ClaimCodesData = {
  kind: ClaimKind;
  /** ที่มาของรายการอ้างอิง */
  source: string;
  usageFrom: string;
  usageTo: string;
  refTotal: number;
  mappedCodes: number;
  fix: ItemRow[];
  ok: ItemRow[];
  missing: RefCode[];
};

const SOURCE: Record<ClaimKind, string> = {
  INST: "ประกาศ สปสช. อุปกรณ์และอวัยวะเทียมในการบำบัดรักษาโรค พ.ศ. 2568 (เอกสารแนบ 1–2)",
  PP: "รหัสประเภท 4 ค่าส่งเสริมป้องกัน และรหัสวางแผนครอบครัว (FP) / คัดกรองมะเร็งปากมดลูก (1B0) ในตาราง nhso_adp_code ของ HOSxP",
};
// รหัสใน nhso_adp_code ซ้ำได้ (9,620 แถว 9,573 รหัส) จึงรวมต่อรหัสก่อน join ; ~0.5 วินาที
const MASTER = `(SELECT nhso_adp_code, MIN(nhso_adp_type_id) AS t, MIN(nhso_adp_code_name) AS nm, MAX(UCS) AS ucs FROM nhso_adp_code GROUP BY nhso_adp_code)`;
// PP fee schedule ที่ HOSxP จัดไว้ประเภท 3 (ค่าบริการอื่นๆ): วางแผนครอบครัว FP* และคัดกรองมะเร็งปากมดลูก 1B0*
const PP_EXTRA = "OR (nhso_adp_type_id = 3 AND (nhso_adp_code LIKE 'FP%' OR nhso_adp_code LIKE '1B0%'))";
const ITEMS_SQL = (refs: number) => `SELECT s.icode, CONCAT_WS(' ', s.name, NULLIF(TRIM(s.strength), '')) AS name, s.income, NULLIF(TRIM(s.nhso_adp_code), '') AS adp,
  s.unitprice, a.t AS adp_type, a.nm AS adp_name
FROM s_drugitems s LEFT JOIN ${MASTER} a ON a.nhso_adp_code = s.nhso_adp_code
WHERE s.istatus = 'Y' AND (s.income = ? OR a.t = ?${refs ? ` OR ${inList("s.nhso_adp_code", refs)}` : ""})
ORDER BY s.icode`;
// การใช้ 30 วันล่าสุด (OPD+IPD: แถว IPD ก็มี vstdate = rxdate) ช่วง ≤ 31 วัน FORCE INDEX ตามกฎ opitemrece ; ~1.5 วินาที
const USAGE_SQL = (n: number) => `SELECT o.icode, COUNT(*) AS n, SUM(o.qty) AS qty, SUM(o.sum_price) AS amount
FROM ${OPI_BY_DATE} WHERE o.vstdate BETWEEN ? AND ? AND ${inList("o.icode", n)} GROUP BY o.icode`;

const ITEM_COLS = [
  { key: "icode", header: "รหัสรายการ HOSxP", width: 14 },
  { key: "name", header: "ชื่อรายการ", width: 40 },
  { key: "income", header: "หมวดรายรับ", width: 10 },
  { key: "adp", header: "รหัส สปสช. ปัจจุบัน", width: 16 },
  { key: "problem_text", header: "ปัญหา", width: 30 },
  { key: "fix_text", header: "วิธีแก้", width: 44 },
  { key: "used", header: "ใช้ 30 วัน (ครั้ง)", width: 14, type: "count" },
  { key: "amount", header: "มูลค่า 30 วัน (บาท)", width: 16, type: "money" },
] as const;

export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const kind = (params.get("kind") ?? "INST") as ClaimKind;
  if (!(kind in KIND_SCOPE)) return Response.json({ error: "kind ต้องเป็น INST หรือ PP" }, { status: 400 });
  const scope = KIND_SCOPE[kind];

  const refs: RefCode[] =
    kind === "INST"
      ? (await insightQuery<{ code: string; name: string | null; rate: string | null }>("SELECT code, name, rate FROM claim_code WHERE kind = 'INST' ORDER BY code")).map(
          (r) => ({ code: r.code, name: r.name, rate: r.rate == null ? null : Number(r.rate) }),
        )
      : [];
  const refCodes = refs.map((r) => r.code);
  const [items, master] = await Promise.all([
    hisQuery<HisItem>(ITEMS_SQL(refCodes.length), [scope.income, scope.adpType, ...refCodes]),
    // ชื่อไทยและอัตรา UCS ของรหัสอ้างอิงจาก HOSxP (INST: ไฟล์ประกาศอ่านชื่อไทยไม่ได้ ; PP: ใช้เป็นรายการอ้างอิงเลย)
    hisQuery<{ code: string; name: string; ucs: number | null }>(
      `SELECT nhso_adp_code AS code, MIN(nhso_adp_code_name) AS name, MAX(UCS) AS ucs FROM nhso_adp_code
WHERE nhso_adp_type_id = ? ${kind === "PP" ? PP_EXTRA : ""} GROUP BY nhso_adp_code ORDER BY nhso_adp_code`,
      [scope.adpType],
    ),
  ]);
  const masterBy = new Map(master.map((m) => [m.code, m]));
  const reference: RefCode[] =
    kind === "INST"
      ? refs.map((r) => ({ code: r.code, name: masterBy.get(r.code)?.name ?? r.name, rate: r.rate ?? masterBy.get(r.code)?.ucs ?? null }))
      : master.filter((m) => !m.name.includes("ยกเลิก")).map((m) => ({ code: m.code, name: m.name, rate: m.ucs ? Number(m.ucs) : null }));

  const usageTo = todayIso();
  const usageFrom = addDays(usageTo, -29);
  const usage = new Map<string, Usage>();
  if (items.length)
    for (const u of await hisQuery<{ icode: string; n: number; qty: number | null; amount: number | null }>(USAGE_SQL(items.length), [usageFrom, usageTo, ...items.map((i) => i.icode)]))
      usage.set(u.icode, { n: Number(u.n), qty: Number(u.qty ?? 0), amount: Number(u.amount ?? 0) });

  const r = assess(kind, reference, items, usage);

  if (params.get("format") === "xlsx") {
    const part = params.get("part");
    if (part === "missing")
      return xlsxResponse<RefCode>(`claim-codes-${kind}-missing.xlsx`, [
        { key: "code", header: "รหัส สปสช.", width: 12 },
        { key: "name", header: "ชื่อ", width: 60 },
        { key: "rate", header: "อัตราจ่าย (บาท)", width: 16, type: "money" },
      ], r.missing);
    const rows = (part === "ok" ? r.ok : r.fix).map((x) => ({
      ...x, problem_text: x.problem ? PROBLEM_TEXT[x.problem].label : "ถูกต้อง", fix_text: x.problem ? PROBLEM_TEXT[x.problem].fix : "", used: x.usage.n, amount: x.usage.amount,
    }));
    return xlsxResponse<(typeof rows)[number]>(`claim-codes-${kind}-${part === "ok" ? "ok" : "fix"}.xlsx`, [...ITEM_COLS], rows);
  }
  const body: ClaimCodesData = { kind, source: SOURCE[kind], usageFrom, usageTo, refTotal: reference.length, mappedCodes: r.mappedCodes, fix: r.fix, ok: r.ok, missing: r.missing };
  return Response.json(body);
}
