import { Suspense } from "react";
import { DateRangeFilter } from "@/components/date-range-filter/date-range-filter";
import { ClaimOverview, SummarySkeleton } from "./claim-overview";

export const metadata = { title: "ภาพรวมการเคลม" };

export default function Page() {
  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title text-balance">ภาพรวมการเคลม</h1>
        {/* useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={null}>
          <DateRangeFilter />
        </Suspense>
      </div>
      <div className="mt-6">
        <Suspense fallback={<SummarySkeleton />}>
          <ClaimOverview />
        </Suspense>
      </div>
    </div>
  );
}
