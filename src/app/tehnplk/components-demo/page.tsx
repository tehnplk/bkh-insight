import { Suspense } from "react";
import { PatientGrid } from "./patient-grid";

export const metadata = { title: "ตัวอย่าง DataGrid" };

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">รายชื่อผู้ป่วยใน</h1>
      <p className="mt-2 max-w-[65ch] text-zinc-600 dark:text-zinc-400">
        ข้อมูลสมมติ 500 รายการ สำหรับทดลอง DataGrid และ DetailModal ค้นหา เรียงลำดับ และแบ่งหน้าทำที่ server ส่วนปุ่มส่งออก Excel
        ได้ทุกแถวตามเงื่อนไขที่เลือกอยู่
      </p>
      <div className="mt-8">
        {/* useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-zinc-500">กำลังโหลด…</p>}>
          <PatientGrid />
        </Suspense>
      </div>
    </main>
  );
}
