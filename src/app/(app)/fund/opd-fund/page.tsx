import { Suspense } from "react";
import { OpdFund } from "./opd-fund";

export const metadata = { title: "มูลค่าตามกองทุน" };

const title = <h1 className="text-title text-balance">มูลค่าตามกองทุน</h1>;

export default function Page() {
  return (
    <div className="max-w-6xl">
      {/* แถวหัวข้ออยู่ใน OpdFund เพราะตัวเลือกสิทธิมาจาก response เดียวกับตาราง (useSearchParams ต้องอยู่ใต้ Suspense) */}
      <Suspense
        fallback={
          <>
            {title}
            <p className="mt-6 text-sm text-muted">กำลังโหลด…</p>
          </>
        }
      >
        <OpdFund title={title} />
      </Suspense>
    </div>
  );
}
