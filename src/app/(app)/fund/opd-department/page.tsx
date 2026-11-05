import { Suspense } from "react";
import { OpdDepartment } from "./opd-department";

export const metadata = { title: "มูลค่าตามแผนก" };

const title = <h1 className="text-title text-balance">มูลค่าตามแผนก</h1>;

export default function Page() {
  return (
    <div className="max-w-6xl">
      {/* แถวหัวข้ออยู่ใน OpdDepartment เพราะตัวเลือกแผนก/สิทธิมาจาก response เดียวกับตาราง (useSearchParams ต้องอยู่ใต้ Suspense) */}
      <Suspense
        fallback={
          <>
            {title}
            <p className="mt-6 text-sm text-muted">กำลังโหลด…</p>
          </>
        }
      >
        <OpdDepartment title={title} />
      </Suspense>
    </div>
  );
}
