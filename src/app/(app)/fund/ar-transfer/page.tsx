import { Suspense } from "react";
import { ArTransfer } from "./ar-transfer";

export const metadata = { title: "เงินโอนที่ได้รับ" };

export default function Page() {
  return (
    // useSearchParams (ปีงบ, DataGrid) ต้องอยู่ใต้ Suspense
    <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
      <ArTransfer />
    </Suspense>
  );
}
