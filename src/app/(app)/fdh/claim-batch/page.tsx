import { Suspense } from "react";
import { ClaimBatchGrid } from "./claim-batch-grid";

const TITLE = "ประวัติส่งออกเคลม";
export const metadata = { title: TITLE };

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">{TITLE}</h1>
      <div className="mt-6">
        {/* DataGrid และ DateRangeFilter ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <ClaimBatchGrid />
        </Suspense>
      </div>
    </div>
  );
}
