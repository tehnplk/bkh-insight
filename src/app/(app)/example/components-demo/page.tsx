import { Suspense } from "react";
import { PatientGrid } from "./patient-grid";

export const metadata = { title: "ตัวอย่าง DataGrid" };

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">รายชื่อผู้ป่วยใน</h1>
      <div className="mt-6">
        {/* useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <PatientGrid />
        </Suspense>
      </div>
    </div>
  );
}
