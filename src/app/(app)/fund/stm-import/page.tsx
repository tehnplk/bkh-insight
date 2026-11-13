import { Suspense } from "react";
import { auth } from "@/auth";
import { StmImport } from "./stm-import";

export const metadata = { title: "นำเข้า STM" };

// ปุ่มลบไฟล์แสดงเฉพาะ admin ส่วน DELETE /api/fund/stm-import เช็ค role ซ้ำ
async function Content() {
  const session = await auth();
  return <StmImport admin={session?.user.role === "admin"} />;
}

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">นำเข้า STM</h1>
      <div className="mt-6">
        {/* อ่าน cookie และ DataGrid ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <Content />
        </Suspense>
      </div>
    </div>
  );
}
