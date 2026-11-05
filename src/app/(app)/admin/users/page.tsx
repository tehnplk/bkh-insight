import { Suspense } from "react";
import { UsersGrid } from "./users-grid";

export const metadata = { title: "ผู้ใช้งาน" };

// Admin-only via proxy.ts and ../layout.tsx; /api/admin/users checks the role again.
export default function Page() {
  return (
    <div className="max-w-6xl">
      <h1 className="text-title text-balance">ผู้ใช้งาน</h1>
      <div className="mt-6">
        {/* useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <UsersGrid />
        </Suspense>
      </div>
    </div>
  );
}
