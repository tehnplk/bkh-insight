import { Suspense } from "react";
import { StpClaimGrid } from "./stp-claim-grid";

export const metadata = { title: "ติดตามเคลม STP" };

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">ติดตามเคลม STP</h1>
      <div className="mt-6">
        {/* DataGrid และ DateRangeFilter ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <StpClaimGrid />
        </Suspense>
      </div>
    </div>
  );
}
