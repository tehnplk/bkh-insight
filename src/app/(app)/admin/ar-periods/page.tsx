import { ArPeriods } from "./ar-periods";

export const metadata = { title: "ปิดงวดลูกหนี้" };

// admin เท่านั้น (proxy.ts และ ../layout.tsx) ส่วน /api/admin/ar-periods เช็ค role ซ้ำ
export default function Page() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-title text-balance">ปิดงวดลูกหนี้</h1>
      <ArPeriods />
    </div>
  );
}
