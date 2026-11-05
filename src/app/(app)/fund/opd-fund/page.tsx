import { Suspense } from "react";
import { DateRangeFilter } from "@/components/date-range-filter/date-range-filter";
import { OpdFund } from "./opd-fund";

export const metadata = { title: "มูลค่าตามกองทุน" };

export default function Page() {
  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title text-balance">มูลค่าตามกองทุน</h1>
        {/* useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={null}>
          <DateRangeFilter />
        </Suspense>
      </div>
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <OpdFund />
        </Suspense>
      </div>
    </div>
  );
}
