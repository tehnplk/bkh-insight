import { Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@/auth";
import { loadDepartments, loadLookups, pttypeOptionGroups } from "@/app/api/fund/_lib/fund";
import { VisitsGrid } from "./visits-grid";

export const metadata = { title: "OPD แยกรายสิทธิ" };

// ตัวเลือกสิทธิ/แผนกอ่านจาก HIS ตอน request (ไม่ใช่ตอน build) แล้วส่งให้ grid ฝั่ง client
async function Grid() {
  await connection();
  if (!(await auth())) return null;
  const [lk, deps] = await Promise.all([loadLookups(), loadDepartments()]);
  const depOptions = deps.filter((d) => d.active).map((d) => ({ value: d.code, label: d.name, hint: d.code }));
  return <VisitsGrid pttypeOptions={pttypeOptionGroups(lk)} depOptions={[{ value: "deps", label: "แผนก", options: depOptions }]} />;
}

export default function Page() {
  return (
    // เหมือน /ipd/admissions: ชื่อหน้าอยู่ใน breadcrumb แล้ว h1 แบบ sr-only ไว้ให้ screen reader
    <div>
      <h1 className="sr-only">OPD แยกรายสิทธิ</h1>
      {/* DataGrid, DateRangeFilter และ MultiSelect ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
      <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
        <Grid />
      </Suspense>
    </div>
  );
}
