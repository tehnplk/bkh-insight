import { Suspense } from "react";
import { StpCheckGrid } from "./stp-check-grid";

export const metadata = { title: "ตรวจรายการเบิก STP" };

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">ตรวจรายการเบิก STP</h1>
      <div className="mt-6">
        {/* DataGrid และ DateRangeFilter ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <StpCheckGrid />
        </Suspense>
      </div>
    </div>
  );
}
