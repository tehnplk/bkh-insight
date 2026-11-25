import { Suspense } from "react";
import { ArCollect } from "./ar-collect";

export const metadata = { title: "สถานที่เรียกเก็บ" };

export default function Page() {
  return (
    // DateRangeFilter, useUrlParams และ DataGrid ใช้ useSearchParams ต้องอยู่ใต้ Suspense
    <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
      <ArCollect />
    </Suspense>
  );
}
