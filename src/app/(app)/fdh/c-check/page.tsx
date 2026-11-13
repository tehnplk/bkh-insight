import { Suspense } from "react";
import { CCheck } from "./c-check";

const TITLE = "ตรวจสอบ C ก่อนส่ง FDH";
export const metadata = { title: TITLE };

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">{TITLE}</h1>
      <div className="mt-4">
        {/* หมวด แฟ้ม และช่วงวันที่อยู่ใน URL (useSearchParams) ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <CCheck />
        </Suspense>
      </div>
    </div>
  );
}
