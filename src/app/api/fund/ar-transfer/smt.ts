import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { hisQuery } from "@/lib/db";
import type { SmtDetailRow } from "./transfer";

// API สาธารณะของ SMT ตัวเดียวกับ /api/fund/smt-reconcile (ไม่ต้อง login) ; UC (เหมาจ่าย/STM) และ LGO (อปท. โอนทีละ REP ใช้ตัดหนี้ .801/.802 ด้วย REP)
export const SMT_SOURCES = ["UC", "LGO"] as const;
export type SmtSource = (typeof SMT_SOURCES)[number];
const SMT_URL = "https://smt.nhso.go.th/smtf/api/budgetreport/budgetSummaryByVendorReport/search";
const SMT_TIMEOUT_MS = 20_000;
/** "2026-11-19" -> "19/11/2569" */
const beDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${+iso.slice(0, 4) + 543}`;

/** รายการโอนของ budgetSource ตามวันที่โอนของปีงบ fy (ถึงสิ้นปีงบหรือวันนี้) สดจาก SMT ; throw เมื่อ SMT ล่ม/หมดเวลา/ตอบผิดรูปแบบ */
export async function fetchSmt(fy: number, today: string, source: SmtSource = "UC"): Promise<SmtDetailRow[]> {
  const [cfg] = await hisQuery<{ hospitalcode: string | null }>("SELECT hospitalcode FROM opdconfig LIMIT 1");
  const hcode = String(cfg?.hospitalcode ?? "").trim();
  if (!/^\d{5}$/.test(hcode)) throw new Error("ไม่พบรหัสหน่วยบริการ (opdconfig.hospitalcode)");
  const fyEnd = `${fy - 543}-09-30`;
  const res = await fetch(SMT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vendorSearchConditionCode: "2", vendorId5Digit: hcode, budgetSource: source, budgetYear: "",
      transferStartDate: `01/10/${fy - 1}`, transferEndDate: beDate(fyEnd < today ? fyEnd : today), hospType: "", isTest: "",
    }),
    signal: AbortSignal.timeout(SMT_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`SMT ตอบ HTTP ${res.status}`);
  const body = (await res.json()) as { status?: string; datas?: SmtDetailRow[] };
  if (body.status !== "success" || !Array.isArray(body.datas)) throw new Error("SMT ตอบรูปแบบที่ไม่รู้จัก");
  return body.datas.filter((r) => typeof r.postingDate === "string" && /^\d{8}$/.test(r.postingDate) && typeof r.total === "number");
}

/** fetchSmt ที่ cache สั้นต่อ (ปีงบ, วันนี้) ให้เปิด modal รายละเอียดกองทุนซ้ำไม่ยิง SMT ทุกครั้ง ; error ไม่ถูก cache */
export async function cachedSmt(fy: number, today: string, source: SmtSource = "UC"): Promise<SmtDetailRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`ar-transfer-smt:${fy}`);
  return fetchSmt(fy, today, source);
}

export const smtErrorText = (e: Error) => `ดึงข้อมูล SMT ไม่สำเร็จ: ${e.name === "TimeoutError" ? "หมดเวลารอ" : e.message}`;
