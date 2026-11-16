import { Suspense } from "react";
import { SummaryView } from "./summary-view";

export const metadata = { title: "สรุปค่ารักษาก่อนตั้งหนี้" };

export default function Page() {
  return (
    <div>
      {/* DateRangeFilter ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
      <Suspense fallback={<h1 className="text-title text-balance">สรุปค่ารักษาก่อนตั้งหนี้</h1>}>
        <SummaryView />
      </Suspense>
    </div>
  );
}
