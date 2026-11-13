import { Suspense } from "react";
import { DmRemissionGrid } from "./dm-remission-grid";

export const metadata = { title: "ผู้รับบริการที่เข้าเกณฑ์ DM Type-2" };

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">ผู้รับบริการที่เข้าเกณฑ์ DM Type-2</h1>
      <div className="mt-6">
        {/* DataGrid และ DateRangeFilter ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <DmRemissionGrid />
        </Suspense>
      </div>
    </div>
  );
}
