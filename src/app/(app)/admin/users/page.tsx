import { Suspense } from "react";
import { auth } from "@/auth";
import { UsersGrid } from "./users-grid";

export const metadata = { title: "ผู้ใช้งาน" };

// The grid hides the role control on the admin's own row; the API refuses that change too.
async function Grid() {
  const session = await auth();
  return <UsersGrid selfId={session?.user.userId} />;
}

// Admin-only via proxy.ts and ../layout.tsx; /api/admin/users checks the role again.
export default function Page() {
  return (
    <div className="max-w-6xl">
      <h1 className="text-title text-balance">ผู้ใช้งาน</h1>
      <div className="mt-6">
        {/* อ่าน cookie และ useSearchParams ต้องอยู่ใต้ Suspense */}
        <Suspense fallback={<p className="text-sm text-muted">กำลังโหลด…</p>}>
          <Grid />
        </Suspense>
      </div>
    </div>
  );
}
