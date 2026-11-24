import { Suspense } from "react";
import { auth } from "@/auth";
import { FwfCard } from "./fwf-card";

const TITLE = "บัตรประกันสุขภาพต่างด้าว";
export const metadata = { title: TITLE };

// แท็บชนิดบัตรแสดงเฉพาะ admin และ /api/fund/fwf-card/card-type เช็ค role ซ้ำ
async function Content() {
  const session = await auth();
  return <FwfCard isAdmin={session?.user.role === "admin"} />;
}

export default function Page() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-title text-balance">{TITLE}</h1>
      {/* แท็บอยู่ใน URL และ DataGrid ใช้ useSearchParams ต้องอยู่ใต้ Suspense */}
      <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
        <Content />
      </Suspense>
    </div>
  );
}
