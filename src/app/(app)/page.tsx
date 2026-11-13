import { Suspense } from "react";
import { DateRangeFilter } from "@/components/date-range-filter/date-range-filter";
import { HomeDashboard, HomeDashboardSkeleton } from "./_home/home-dashboard";

export const metadata = { title: "ภาพรวมโรงพยาบาล" };

export default function Home() {
  return (
    // พื้นหน้าเต็มพื้นที่ <main> (หักล้าง padding ของ AppShell: px-8 py-7, จอแคบ px-4 py-5) ให้การ์ด bg-surface ลอยขึ้นมา
    <div className="-mx-8 -my-7 min-h-[calc(100%+3.5rem)] bg-background px-8 py-7 max-md:-mx-4 max-md:-my-5 max-md:min-h-[calc(100%+2.5rem)] max-md:px-4 max-md:py-5">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-title text-balance">ภาพรวมโรงพยาบาล</h1>
          {/* useSearchParams ต้องอยู่ใต้ Suspense */}
          <Suspense fallback={null}>
            <DateRangeFilter />
          </Suspense>
        </div>
        <div className="mt-5">
          <Suspense fallback={<HomeDashboardSkeleton />}>
            <HomeDashboard />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
