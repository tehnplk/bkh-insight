import { Suspense } from "react";
import { auth } from "@/auth";
import { Mapcode } from "./mapcode";

export const metadata = { title: "รหัสมาตรฐาน" };

// ทุกคนที่ login ดูได้ ปุ่มนำเข้าแสดงเฉพาะ admin และ /api/catalog/drug-nhso (POST) เช็ค role ซ้ำ
async function Catalog() {
  const session = await auth();
  return <Mapcode canImport={session?.user.role === "admin"} />;
}

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title text-balance">รหัสมาตรฐาน</h1>
      {/* แท็บอยู่ใน URL และ DataGrid ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
      <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
        <Catalog />
      </Suspense>
    </div>
  );
}
