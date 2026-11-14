import { Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@/auth";
import { UNKNOWN_FUND, loadLookups } from "@/app/api/fund/_lib/fund";
import { DataFreshness } from "../_components/freshness";
import { ClaimPipeline } from "./claim-pipeline";

export const metadata = { title: "เส้นทางเคลม" };

// ตัวเลือกกองทุนอ่านจาก HIS ตอน request (ไม่ใช่ตอน build) แล้วส่งให้ฝั่ง client
async function Pipeline() {
  await connection();
  if (!(await auth())) return null;
  const lk = await loadLookups();
  const funds = [...new Set([...lk.pttype.values()].map((p) => p.fund))]
    .filter((f) => f !== UNKNOWN_FUND)
    .sort()
    .map((code) => ({ code, name: lk.fundName(code) }));
  return <ClaimPipeline funds={funds} />;
}

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">เส้นทางเคลม</h1>
      {/* ช่วงที่ยังไม่มี REP/STM ไม่ได้แปลว่าไม่ได้เงิน */}
      <div className="mt-2">
        <DataFreshness />
      </div>
      <div className="mt-5">
        {/* DataGrid และ DateRangeFilter ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <Pipeline />
        </Suspense>
      </div>
    </div>
  );
}
