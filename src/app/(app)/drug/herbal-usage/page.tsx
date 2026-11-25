import { Suspense } from "react";
import { HerbalUsage } from "./herbal-usage";

const TITLE = "การใช้ยาสมุนไพร";
export const metadata = { title: TITLE };

const title = <h1 className="text-title text-balance">{TITLE}</h1>;

export default function Page() {
  return (
    <div>
      {/* แถวหัวข้ออยู่ใน HerbalUsage เพราะตัวเลือกปีงบใช้ useSearchParams (ต้องอยู่ใต้ Suspense) */}
      <Suspense
        fallback={
          <>
            {title}
            <p className="mt-6 text-sm text-muted">กำลังโหลด…</p>
          </>
        }
      >
        <HerbalUsage title={title} />
      </Suspense>
    </div>
  );
}
