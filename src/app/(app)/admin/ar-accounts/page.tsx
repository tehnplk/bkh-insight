import { ArAccounts } from "./ar-accounts";

export const metadata = { title: "บัญชีลูกหนี้ตามสิทธิ" };

// admin เท่านั้น (proxy.ts และ ../layout.tsx) ส่วน /api/admin/ar-accounts และ backfill ของ /api/fund/ar-sync เช็ค role ซ้ำ
export default function Page() {
  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <h1 className="text-title text-balance">บัญชีลูกหนี้ตามสิทธิ</h1>
      <ArAccounts />
    </div>
  );
}
