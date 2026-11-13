import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { Clock } from "@/components/clock/clock";
import { todayTh } from "@/app/api/visit/opd-visit/opd-visit";
import { loadPttypeOptions } from "@/app/api/visit/opd-visit/pttype-options";
import { OpdVisitGrid } from "./opd-visit-grid";

export const metadata = { title: "ผู้รับบริการผู้ป่วยนอก" };

async function Grid() {
  await connection(); // อ่าน HIS ตอน request ไม่ใช่ตอน build
  // proxy.ts กั้นหน้าแล้ว แต่ส่วนที่อ่าน HIS เช็ค session เองซ้ำ
  if (!(await auth())) redirect("/login?callbackUrl=/visit/opd-visit");
  const { pttypes, groups } = await loadPttypeOptions();
  // today มาจาก server (เวลาไทยตอน request) ห้ามอ่านนาฬิกาเครื่องผู้ใช้ตอน render: นาฬิกาเครื่องคลาดหรือข้ามเที่ยงคืน = max/href ไม่ตรงกับ HTML จาก server (hydration mismatch)
  return <OpdVisitGrid pttypes={pttypes} groups={groups} today={todayTh()} />;
}

export default function Page() {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-title text-balance">ผู้รับบริการผู้ป่วยนอก</h1>
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
