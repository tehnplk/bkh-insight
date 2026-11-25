import { Suspense } from "react";
import { ArCapitation } from "./ar-capitation";

const TITLE = "ตัดหนี้เหมาจ่าย";
export const metadata = { title: TITLE };

export default function Page() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-title text-balance">{TITLE}</h1>
      {/* เดือนอยู่ใน URL (useSearchParams) และ DataGrid ต้องอยู่ใต้ Suspense */}
      <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
        <ArCapitation />
      </Suspense>
    </div>
  );
}
