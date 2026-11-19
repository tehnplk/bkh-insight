import { Suspense } from "react";
import { AutoImport } from "./auto-import";
import { RepImport } from "./rep-import";

export const metadata = { title: "นำเข้า REP" };

export default function Page() {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title text-balance">นำเข้า REP</h1>
        <AutoImport />
      </div>
      <div className="mt-6">
        {/* DataGrid ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <RepImport />
        </Suspense>
      </div>
    </div>
  );
}
