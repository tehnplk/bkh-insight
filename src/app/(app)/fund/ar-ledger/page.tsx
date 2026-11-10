import { Suspense } from "react";
import { ArLedger } from "./ar-ledger";

export const metadata = { title: "ลูกหนี้ตามผังบัญชี" };

export default function Page() {
  return (
    // useUrlParams และ DataGrid ใช้ useSearchParams ต้องอยู่ใต้ Suspense
    <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
      <ArLedger />
    </Suspense>
  );
}
