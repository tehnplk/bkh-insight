import { Suspense } from "react";
import { Mapcode } from "./mapcode";

export const metadata = { title: "ตั้งค่ารหัสมาตรฐาน" };

// admin เท่านั้น (proxy.ts และ ../layout.tsx) ส่วน /api/admin/mapcode/* เช็ค role ซ้ำ
export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title text-balance">ตั้งค่ารหัสมาตรฐาน</h1>
      {/* แท็บอยู่ใน URL และ DataGrid ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
      <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
        <Mapcode />
      </Suspense>
    </div>
  );
}
