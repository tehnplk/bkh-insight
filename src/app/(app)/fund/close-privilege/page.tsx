import { Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@/auth";
import { UNKNOWN_FUND, loadLookups } from "@/app/api/fund/_lib/fund";
import { ClosePrivilege } from "./close-privilege";

export const metadata = { title: "ปิดสิทธิ" };

// ตัวเลือกกองทุนอ่านจาก HIS ตอน request (ไม่ใช่ตอน build) แล้วส่งให้ฝั่ง client
async function Content() {
  await connection();
  if (!(await auth())) return null;
  const lk = await loadLookups();
  const funds = [...new Set([...lk.pttype.values()].map((p) => p.fund))]
    .filter((f) => f !== UNKNOWN_FUND)
    .sort()
    .map((code) => ({ code, name: lk.fundName(code) }));
  return <ClosePrivilege funds={funds} />;
}

export default function Page() {
  return (
    <div>
      <h1 className="text-title text-balance">ปิดสิทธิ</h1>
      <div className="mt-5">
        {/* useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <Content />
        </Suspense>
      </div>
    </div>
  );
}
