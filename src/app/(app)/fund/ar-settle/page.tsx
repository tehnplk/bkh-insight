import { Suspense } from "react";
import { SettleGrid } from "./settle-grid";

const TITLE = "ตัดลูกหนี้";
export const metadata = { title: TITLE };

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">{TITLE}</h1>
      <div className="mt-6">
        {/* DataGrid ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <SettleGrid />
        </Suspense>
      </div>
    </div>
  );
}
