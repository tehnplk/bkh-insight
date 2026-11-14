import { Suspense } from "react";
import { auth } from "@/auth";
import { ServiceCatalog } from "./service-catalog";

export const metadata = { title: "Service catalog" };

// ทุกคนที่ login ดูได้ ส่วนนำเข้า/ดึงข้อมูลแสดงเฉพาะ admin และ POST ของ /api/catalog/service-catalog/* เช็ค role ซ้ำ
async function Catalog() {
  const session = await auth();
  return <ServiceCatalog canImport={session?.user.role === "admin"} />;
}

export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title text-balance">Service catalog</h1>
      {/* แท็บอยู่ใน URL และ DataGrid ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
      <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
        <Catalog />
      </Suspense>
    </div>
  );
}
