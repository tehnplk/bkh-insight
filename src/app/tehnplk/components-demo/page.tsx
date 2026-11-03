import { Suspense } from "react";
import { PatientGrid } from "./patient-grid";

export const metadata = { title: "ตัวอย่าง DataGrid" };

export default function Page() {
  return (
    <div className="max-w-6xl">
      <h1 className="text-title text-balance">รายชื่อผู้ป่วยใน</h1>
      <p className="mt-1.5 max-w-[65ch] text-sm text-muted">
        ข้อมูลสมมติ 500 รายการ สำหรับทดลอง DataGrid และ DetailModal ค้นหา เรียงลำดับ และแบ่งหน้าทำที่ server ส่วนปุ่มส่งออก Excel
        ได้ทุกแถวตามเงื่อนไขที่เลือกอยู่
      </p>
      <div className="mt-6">
        {/* useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <PatientGrid />
        </Suspense>
      </div>
    </div>
  );
}
