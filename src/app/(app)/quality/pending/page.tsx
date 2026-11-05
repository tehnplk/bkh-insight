import { Suspense } from "react";
import { connection } from "next/server";
import { Clock } from "@/components/clock/clock";
import { todayTh } from "@/app/api/visit/opd-visit/opd-visit";
import { PendingGrid } from "./pending-grid";

export const metadata = { title: "รายการค้างใน HIS" };

// today จาก server ไม่ใช่นาฬิกาเครื่องผู้ใช้ (กัน hydration mismatch ดู visit/opd-visit/page.tsx)
async function Grid() {
  await connection(); // วันนี้ต้องเป็นของ request ไม่ใช่ของตอน build
  return <PendingGrid today={todayTh()} />;
}

// ข้อมูลอ่านผ่าน /api/quality/pending ซึ่งเช็ค session เอง หน้านี้จึงไม่อ่าน HIS ตรง
export default function Page() {
  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-title text-balance">รายการค้างใน HIS</h1>
        <Clock />
      </div>
      <div className="mt-6">
        {/* useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <Grid />
        </Suspense>
      </div>
    </div>
  );
}
