import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { Clock } from "@/components/clock/clock";
import { loadWardOptions } from "@/app/api/visit/ipd-visit/ward-options";
import { todayTh } from "@/app/api/visit/opd-visit/opd-visit";
import { IpdVisitGrid } from "./ipd-visit-grid";

export const metadata = { title: "ผู้ป่วยในรายวัน" };

async function Grid() {
  await connection(); // อ่าน HIS ตอน request ไม่ใช่ตอน build
  // proxy.ts กั้นหน้าแล้ว แต่ส่วนที่อ่าน HIS เช็ค session เองซ้ำ
  if (!(await auth())) redirect("/login?callbackUrl=/visit/ipd-visit");
  // today จาก server ไม่ใช่นาฬิกาเครื่องผู้ใช้ (กัน hydration mismatch ดู opd-visit/page.tsx)
  return <IpdVisitGrid wards={await loadWardOptions()} today={todayTh()} />;
}

export default function Page() {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-title text-balance">ผู้ป่วยในรายวัน</h1>
        <Clock />
      </div>
      <div className="mt-6">
        {/* useSearchParams, cookie และ HIS ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <Grid />
        </Suspense>
      </div>
    </div>
  );
}
