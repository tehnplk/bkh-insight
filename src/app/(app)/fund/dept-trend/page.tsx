import { Suspense } from "react";
import { DeptTrend } from "./dept-trend";

const TITLE = "แนวโน้มค่าใช้จ่ายตามแผนก";
export const metadata = { title: TITLE };

const title = <h1 className="text-title text-balance">{TITLE}</h1>;

export default function Page() {
  return (
    <div>
      {/* แถวหัวข้ออยู่ใน DeptTrend เพราะตัวเลือกแผนก/กองทุนมาจาก response (useSearchParams ต้องอยู่ใต้ Suspense) */}
      <Suspense
        fallback={
          <>
            {title}
            <p className="mt-6 text-sm text-muted">กำลังโหลด…</p>
          </>
        }
      >
        <DeptTrend title={title} />
      </Suspense>
    </div>
  );
}
