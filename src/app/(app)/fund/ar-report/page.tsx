import { Suspense } from "react";
import { ArReportView } from "./ar-report";

const TITLE = "รายงานลูกหนี้";
export const metadata = { title: TITLE };

export default function Page() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-title text-balance print:hidden">{TITLE}</h1>
      {/* ตัวเลือกรายงานอยู่ใน URL (useSearchParams) จึงต้องอยู่ใต้ Suspense */}
      <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
        <ArReportView />
      </Suspense>
    </div>
  );
}
