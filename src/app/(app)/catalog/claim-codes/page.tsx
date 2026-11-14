import { Suspense } from "react";
import { ClaimCodes } from "./claim-codes";

export const metadata = { title: "ความพร้อมรหัสเบิก" };

export default function Page() {
  return (
    // useUrlParams ใช้ useSearchParams ต้องอยู่ใต้ Suspense
    <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
      <ClaimCodes />
    </Suspense>
  );
}
