import { Suspense } from "react";
import { FdhFiles } from "./fdh-files";

const TITLE = "16 แฟ้มมาตรฐาน";
export const metadata = { title: TITLE };

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">{TITLE}</h1>
      <div className="mt-4">
        {/* หมวด แฟ้ม และช่วงวันที่อยู่ใน URL (useSearchParams) ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <FdhFiles />
        </Suspense>
      </div>
    </div>
  );
}
