import { Suspense } from "react";
import { ClaimType } from "./claim-type";

const TITLE = "แยกประเภทการเรียกเก็บ";
export const metadata = { title: TITLE };

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">{TITLE}</h1>
      <div className="mt-6">
        {/* DateRangeFilter และ DataGrid ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <ClaimType />
        </Suspense>
      </div>
    </div>
  );
}
