import { Suspense } from "react";
import { auth } from "@/auth";
import { hisQuery } from "@/lib/db";
import { OpdVisitGrid, type PttypeOption } from "./opd-visit-grid";

export const metadata = { title: "ผู้ป่วยนอกรายวัน" };

// รายการสิทธิสำหรับตัวกรอง อ่าน his ฝั่ง server จึงเช็ค session เองซ้ำ
async function OpdVisit() {
  const pttypes = (await auth())
    ? await hisQuery<PttypeOption>("SELECT pttype, name FROM pttype WHERE isuse = 'Y' ORDER BY pttype")
    : [];
  return <OpdVisitGrid pttypes={pttypes} />;
}

export default function Page() {
  return (
    <div className="max-w-6xl">
      <h1 className="text-title text-balance">ผู้ป่วยนอกรายวัน</h1>
      <div className="mt-6">
        {/* อ่าน cookie และ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <OpdVisit />
        </Suspense>
      </div>
    </div>
  );
}
