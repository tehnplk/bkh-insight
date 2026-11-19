import { Suspense } from "react";
import { SmtReconcile } from "./smt-reconcile";

export const metadata = { title: "เทียบยอดโอน SMT กับ STM" };

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">เทียบยอดโอน SMT กับ STM</h1>
      <div className="mt-6">
        {/* DataGrid ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <SmtReconcile />
        </Suspense>
      </div>
    </div>
  );
}
