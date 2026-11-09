import { Suspense } from "react";
import { TITLE, UcDashboard, UcDashboardSkeleton } from "./uc-dashboard";

export const metadata = { title: TITLE };

export default function Page() {
  return (
    // พื้นหน้าเต็มพื้นที่ <main> แบบหน้าแรก (หักล้าง padding ของ AppShell) ให้การ์ด bg-surface ลอยขึ้นมา
    <div className="-mx-8 -my-7 min-h-[calc(100%+3.5rem)] bg-background px-8 py-7 max-md:-mx-4 max-md:-my-5 max-md:min-h-[calc(100%+2.5rem)] max-md:px-4 max-md:py-5">
      <div className="max-w-7xl">
        {/* useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<UcDashboardSkeleton />}>
          <UcDashboard />
        </Suspense>
      </div>
    </div>
  );
}
