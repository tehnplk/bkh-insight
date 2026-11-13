import { Suspense } from "react";
import { DateRangeFilter } from "@/components/date-range-filter/date-range-filter";
import { ClaimStatusGrid } from "./claim-status";

export const metadata = { title: "สถานะปิดสิทธิ" };

export default function Page() {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title text-balance">สถานะปิดสิทธิ</h1>
        {/* useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={null}>
          <DateRangeFilter />
        </Suspense>
      </div>
      <div className="mt-6">
        <Suspense fallback={null}>
          <ClaimStatusGrid />
        </Suspense>
      </div>
    </div>
  );
}
