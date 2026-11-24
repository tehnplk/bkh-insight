import { Suspense } from "react";
import { StmTrend } from "./stm-trend";

const TITLE = "แนวโน้ม STM";
export const metadata = { title: TITLE };

const title = <h1 className="text-title text-balance">{TITLE}</h1>;

export default function Page() {
  return (
    <div>
      {/* แถวหัวข้ออยู่ใน StmTrend เพราะตัวกรองใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
      <Suspense
        fallback={
          <>
            {title}
            <p className="mt-6 text-sm text-muted">กำลังโหลด…</p>
          </>
        }
      >
        <StmTrend title={title} />
      </Suspense>
    </div>
  );
}
