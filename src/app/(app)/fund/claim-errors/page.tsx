import { Suspense } from "react";
import { ClaimErrors } from "./claim-errors";

export const metadata = { title: "คิวแก้ C/Deny" };

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">คิวแก้ C/Deny</h1>
      <div className="mt-6">
        {/* DataGrid และตัวกรองใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <ClaimErrors />
        </Suspense>
      </div>
    </div>
  );
}
