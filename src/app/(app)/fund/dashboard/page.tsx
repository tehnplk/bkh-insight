import { Suspense } from "react";
import { DateRangeFilter } from "@/components/date-range-filter/date-range-filter";
import { FundDashboard, FundDashboardSkeleton } from "./fund-dashboard";

export const metadata = { title: "ภาพรวมกองทุน" };

export default function Page() {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title text-balance">ภาพรวมกองทุน</h1>
        {/* useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={null}>
          <DateRangeFilter />
        </Suspense>
      </div>
      <div className="mt-6">
        <Suspense fallback={<FundDashboardSkeleton />}>
          <FundDashboard />
        </Suspense>
      </div>
    </div>
  );
}
