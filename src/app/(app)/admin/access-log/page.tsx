import { Suspense } from "react";
import { AccessGrid } from "./access-grid";

export const metadata = { title: "บันทึกการเข้าถึง" };

// admin เท่านั้น (proxy.ts และ ../layout.tsx) ส่วน /api/admin/access-log เช็ค role ซ้ำ ; บันทึกเขียนโดย src/proxy.ts
export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title text-balance">บันทึกการเข้าถึง</h1>
      {/* DataGrid และ DateRangeFilter ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
      <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
        <AccessGrid />
      </Suspense>
    </div>
  );
}
