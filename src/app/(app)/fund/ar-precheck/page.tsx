import { Suspense } from "react";
import { PrecheckGrid } from "./precheck-grid";

export const metadata = { title: "ตรวจค่ารักษาก่อนตั้งหนี้" };

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">ตรวจค่ารักษาก่อนตั้งหนี้</h1>
      <div className="mt-6">
        {/* DataGrid และ DateRangeFilter ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <PrecheckGrid />
        </Suspense>
      </div>
    </div>
  );
}
