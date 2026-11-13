import { Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@/auth";
import { loadLookups, pttypeOptionGroups } from "@/app/api/fund/_lib/fund";
import { loadWardOptions } from "@/app/api/visit/ipd-visit/ward-options";
import { AdmissionsGrid } from "./admissions-grid";

export const metadata = { title: "IPD แยกรายสิทธิ" };

// ตัวเลือกสิทธิอ่านจาก HIS ตอน request (ไม่ใช่ตอน build) แล้วส่งให้ grid ฝั่ง client
async function Grid() {
  await connection();
  if (!(await auth())) return null;
  const [lk, wards] = await Promise.all([loadLookups(), loadWardOptions()]);
  return <AdmissionsGrid pttypeOptions={pttypeOptionGroups(lk)} wardOptions={[{ value: "wards", label: "หอผู้ป่วย", options: wards.map((w) => ({ value: w.code, label: w.name, hint: w.code })) }]} />;
}

export default function Page() {
  return (
    // ไม่มี h1 ซ้ำ: ชื่อหน้าแสดงใน breadcrumb ของ topbar แล้ว (ผู้ใช้ขอเอาออก) h1 แบบ sr-only คงไว้ให้ screen reader
    <div>
      <h1 className="sr-only">IPD แยกรายสิทธิ</h1>
      {/* DataGrid, DateRangeFilter และ MultiSelect ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
      <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
        <Grid />
      </Suspense>
    </div>
  );
}
