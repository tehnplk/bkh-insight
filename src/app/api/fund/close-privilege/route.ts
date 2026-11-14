import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { hisQuery, insightQuery, insightTransaction } from "@/lib/db";
import { badRequest, inList, loadDepartments, loadLookups, pttypeName, unauthorized } from "../_lib/fund";
import { PID, VN, buildClaimBody, isClosableNow, postClaim, readConfig, thaiDate, type Zone } from "./nhso";

// ปิดสิทธิผ่าน NHSO ENDPOINT ทีละราย (เจ้าหน้าที่เลือกเอง ไม่มีการปิดอัตโนมัติ) ผลไม่ย้อนเข้า HOSxP จึงบันทึกที่ nhso_close_log
// ห้ามส่งเลขบัตร (pid/recorderPid) ไป client ห้าม log และห้ามเก็บลงฐาน

export type CloseRow = {
  vn: string;
  hn: string;
  vsttime: string;
  pttype_name: string;
  main_dep: string;
  cur_dep: string;
  auth_code: string | null;
  privilege_amount: number;
};
export type ClosePage = {
  date: string;
  zone: Zone;
  /** ชื่อ env ที่ยังไม่ตั้ง (ว่าง = พร้อม) */
  missing: string[];
  /** null = ผู้ใช้นี้กดปิดได้ ; ข้อความ = เหตุที่กดไม่ได้ */
  recorderError: string | null;
  rows: CloseRow[];
};
export type CloseResult = { vn: string; ok: boolean; authenCode?: string; error?: string };

const MAX_VNS = 100;

// รายการยังไม่ปิดสิทธิวันนี้ (prove-query ผ่าน) params: vstdate, vstdate, pttype…
const LIST_SQL = (n: number) => `SELECT o.vn, o.hn, o.vsttime, o.pttype, o.main_dep, o.ovstost, o.cur_dep, vp.auth_code, IFNULL(x.privilege,0) AS privilege_amount
FROM ovst o
JOIN visit_pttype vp ON vp.vn = o.vn AND vp.pttype = o.pttype
LEFT JOIN (SELECT vn, SUM(sum_price) AS privilege FROM opitemrece FORCE INDEX (ix_vstdate)
           WHERE vstdate = ? AND vn IS NOT NULL AND paidst = '02' GROUP BY vn) x ON x.vn = o.vn
WHERE o.vstdate = ? AND ${inList("o.pttype", n)} AND (o.an IS NULL OR o.an = '')
  AND (o.cur_dep = '999' OR o.ovstost = '99')
  AND NOT EXISTS (SELECT 1 FROM nhso_confirm_privilege c WHERE c.vn = o.vn AND c.nhso_status = 'Y')
ORDER BY o.vsttime`;

// ข้อมูลสร้างคำขอต่อ visit (prove-query ผ่าน) params: vn… สองรอบ ; closed_status 'Y' = HOSxP ปิดแล้ว
const VISIT_SQL = (n: number) => `SELECT o.vn, o.vstdate, o.vsttime, o.pttype, t.hipdata_code AS main_inscl, p.cid AS person_id,
  IFNULL(x.total, 0) AS total_amount, IFNULL(x.privilege, 0) AS privilege_amount, IFNULL(x.cash, 0) AS cash_amount,
  (SELECT c.nhso_status FROM nhso_confirm_privilege c WHERE c.vn = o.vn) AS closed_status
FROM ovst o
JOIN patient p ON p.hn = o.hn
LEFT JOIN pttype t ON t.pttype = o.pttype
LEFT JOIN (SELECT vn, SUM(sum_price) AS total, SUM(IF(paidst='02', sum_price, 0)) AS privilege, SUM(IF(paidst='03', sum_price, 0)) AS cash
           FROM opitemrece WHERE ${inList("vn", n)} GROUP BY vn) x ON x.vn = o.vn
WHERE ${inList("o.vn", n)}`;
type Visit = {
  vn: string;
  vstdate: string;
  vsttime: string;
  main_inscl: string | null;
  person_id: string | null;
  total_amount: string;
  privilege_amount: string;
  cash_amount: string;
  closed_status: string | null;
};

type Recorder = { ok: true; userId: string; doctorCode: string; pid: string } | { ok: false; error: string };

/** เลขบัตรผู้บันทึกจากรหัสแพทย์ HOSxP ที่ผู้ดูแลตั้งให้ผู้ใช้ (users.his_doctor_code) */
async function loadRecorder(userId: string | undefined): Promise<Recorder> {
  if (!userId) return { ok: false, error: "super user ไม่มีบัญชีผู้ใช้ จึงปิดสิทธิไม่ได้ ให้เข้าระบบด้วย Provider ID" };
  const [u] = await insightQuery<{ his_doctor_code: string | null }>("SELECT his_doctor_code FROM users WHERE id = $1", [userId]);
  if (!u?.his_doctor_code) return { ok: false, error: "ยังไม่ได้ตั้งรหัสแพทย์ HOSxP ให้บัญชีนี้ แจ้งผู้ดูแลระบบให้ตั้งที่หน้าผู้ใช้งาน" };
  const [d] = await hisQuery<{ recorder_person_id: string | null }>("SELECT cid AS recorder_person_id FROM doctor WHERE code = ? LIMIT 1", [
    u.his_doctor_code,
  ]);
  if (!d) return { ok: false, error: `ไม่พบรหัสแพทย์ ${u.his_doctor_code} ใน HOSxP` };
  const pid = String(d.recorder_person_id ?? "").trim();
  if (!PID.test(pid)) return { ok: false, error: `รหัสแพทย์ ${u.his_doctor_code} ใน HOSxP ไม่มีเลขบัตร 13 หลัก` };
  return { ok: true, userId, doctorCode: u.his_doctor_code, pid };
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return unauthorized();
  const fund = request.nextUrl.searchParams.get("fund") || "UCS";
  const date = thaiDate(Date.now());
  const config = readConfig(process.env);

  const [lk, deps, recorder] = await Promise.all([loadLookups(), loadDepartments(), loadRecorder(session.user.userId)]);
  // fund ใช้เลือก pttype ในโค้ดเท่านั้น ไม่เข้า SQL ; ไม่มี pttype ของกองทุนนี้ = ค่าไม่ถูกต้อง (และกัน IN ว่าง)
  const codes = [...lk.pttype].filter(([, p]) => p.fund === fund).map(([c]) => c);
  if (!codes.length) return badRequest("ไม่พบกองทุนนี้");

  const list = await hisQuery<{ vn: string; hn: string; vsttime: string; pttype: string | null; main_dep: string | null; cur_dep: string | null; auth_code: string | null; privilege_amount: string }>(
    LIST_SQL(codes.length),
    [date, date, ...codes],
  );
  const done = list.length
    ? new Set(
        (await insightQuery<{ vn: string }>("SELECT vn FROM nhso_close_log WHERE ok AND zone = $1 AND vn = ANY($2::text[])", [config.zone, list.map((r) => r.vn)])).map(
          (r) => r.vn,
        ),
      )
    : new Set<string>();
  const depName = new Map(deps.map((d) => [d.code, d.name]));
  const dep = (c: string | null) => (c ? (depName.get(c) ?? c) : "–");

  const body: ClosePage = {
    date,
    zone: config.zone,
    missing: config.missing,
    recorderError: recorder.ok ? null : recorder.error,
    rows: list
      .filter((r) => !done.has(r.vn))
      .map((r) => ({
        vn: r.vn,
        hn: r.hn,
        vsttime: String(r.vsttime).slice(0, 5),
        pttype_name: pttypeName(lk, r.pttype),
        main_dep: dep(r.main_dep),
        cur_dep: dep(r.cur_dep),
        auth_code: r.auth_code || null,
        privilege_amount: Number(r.privilege_amount),
      })),
  };
  return Response.json(body);
}

/** ปิดสิทธิ { vns: string[] } (≤ 100 ราย) ส่งทีละรายตามลำดับ คืนผลรายต่อราย */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  const raw = (await request.json().catch(() => null))?.vns;
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_VNS) return badRequest(`vns ต้องเป็นรายการ VN 1–${MAX_VNS} ราย`);
  if (!raw.every((v) => typeof v === "string" && VN.test(v))) return badRequest("VN ต้องเป็นตัวเลข 12 หลัก");
  const vns = [...new Set(raw as string[])];

  const config = readConfig(process.env);
  if (config.missing.length || !config.endpoint) return Response.json({ error: `ยังไม่ได้ตั้งค่า ${config.missing.join(", ")}` }, { status: 503 });
  const recorder = await loadRecorder(session.user.userId);
  if (!recorder.ok) return Response.json({ error: recorder.error }, { status: 403 });
  const [cfg] = await hisQuery<{ hospitalcode: string | null }>("SELECT hospitalcode FROM opdconfig LIMIT 1");
  const hcode = String(cfg?.hospitalcode ?? "").trim();
  if (!hcode) return Response.json({ error: "ไม่พบรหัสหน่วยบริการใน HOSxP (opdconfig)" }, { status: 500 });

  const target = { ...config, endpoint: config.endpoint };
  const results: CloseResult[] = [];
  for (const vn of vns) {
    try {
      results.push(await closeOne(vn, hcode, target, recorder, session.user.name ?? "ไม่ทราบชื่อ"));
    } catch (e) {
      // เช่น บันทึก log ไม่สำเร็จหลังยิงแล้ว: ผลที่ สปสช. อาจสำเร็จไปแล้ว ต้องตรวจก่อนกดซ้ำ
      results.push({ vn, ok: false, error: `เกิดข้อผิดพลาด (ตรวจสอบก่อนกดซ้ำ): ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return Response.json({ results });
}

async function closeOne(
  vn: string,
  hcode: string,
  config: ReturnType<typeof readConfig> & { endpoint: string },
  recorder: Extract<Recorder, { ok: true }>,
  requestedBy: string,
): Promise<CloseResult> {
  const fail = (error: string): CloseResult => ({ vn, ok: false, error });
  // lock ต่อ vn จนจบ transaction (รวมเวลารอ สปสช.) สองคนกดรายเดียวกันพร้อมกัน คนที่สองถูกปฏิเสธ ไม่ยิงซ้ำ
  return insightTransaction(async (tx) => {
    const [{ locked }] = await tx<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('nhso_close'), hashtext($1)) AS locked", [vn]);
    if (!locked) return fail("มีผู้ใช้อื่นกำลังปิดสิทธิรายนี้อยู่");
    const [prev] = await tx("SELECT 1 FROM nhso_close_log WHERE ok AND zone = $1 AND vn = $2", [config.zone, vn]);
    if (prev) return fail("ปิดสิทธิผ่านระบบนี้แล้ว");
    // ตรวจกับ HOSxP ทันทีก่อนยิง (อาจปิดใน HOSxP ระหว่างที่หน้าเปิดค้างไว้)
    const [v] = await hisQuery<Visit>(VISIT_SQL(1), [vn, vn]);
    if (!v) return fail("ไม่พบ visit นี้ใน HOSxP");
    if (v.closed_status === "Y") return fail("HOSxP ปิดสิทธิรายนี้แล้ว");
    const nowMs = Date.now();
    if (!isClosableNow(v.vstdate, nowMs)) return fail("ปิดสิทธิได้เฉพาะ visit ของวันนี้ก่อน 24.00 น.");

    const amounts = { total: Number(v.total_amount), privilege: Number(v.privilege_amount), cash: Number(v.cash_amount) };
    const log = async (r: { ok: boolean; httpStatus: number | null; seq?: string; authenCode?: string; error?: string }, requestAt: Date) => {
      await tx(
        `INSERT INTO nhso_close_log (vn, transaction_id, zone, request_at, response_at, ok, http_status, seq, authen_code, error,
           requested_by, user_id, doctor_code, total_amount, privilege_amount, cash_amount)
         VALUES ($1, $2, $3, $4, now(), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [vn, `${hcode}${vn}`, config.zone, requestAt, r.ok, r.httpStatus, r.seq ?? null, r.authenCode ?? null, r.error ?? null,
          requestedBy, recorder.userId, recorder.doctorCode, amounts.total, amounts.privilege, amounts.cash],
      );
    };

    const pid = String(v.person_id ?? "").trim();
    if (!PID.test(pid)) {
      const error = "เลขบัตรผู้ป่วยใน HOSxP ไม่ใช่ตัวเลข 13 หลัก จึงไม่ส่ง";
      await log({ ok: false, httpStatus: null, error }, new Date(nowMs));
      return fail(error);
    }
    const body = buildClaimBody({
      hcode, vn, pid, vstdate: v.vstdate, vsttime: v.vsttime, mainInscl: v.main_inscl ?? "", ...amounts,
      sourceId: config.sourceId, recorderPid: recorder.pid, nowMs,
    });
    const r = await postClaim(fetch, config.endpoint, config.token, body);
    await log(r, new Date(nowMs));
    return r.ok ? { vn, ok: true, authenCode: r.authenCode } : fail(r.error);
  });
}
