import { ArFunds } from "./ar-funds";

export const metadata = { title: "กองทุนย่อยลูกหนี้" };

// admin เท่านั้น (proxy.ts และ ../layout.tsx) ส่วน /api/admin/ar-funds เช็ค role ซ้ำ
export default function Page() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-title text-balance">กองทุนย่อยลูกหนี้</h1>
      <ArFunds />
    </div>
  );
}
