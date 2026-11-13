import { Suspense } from "react";
import { RepImport } from "./rep-import";

export const metadata = { title: "นำเข้า REP" };

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">นำเข้า REP</h1>
      <div className="mt-6">
        {/* DataGrid ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <RepImport />
        </Suspense>
      </div>
    </div>
  );
}
