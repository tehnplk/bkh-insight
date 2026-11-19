import { CupUnits } from "./cup-units";

export const metadata = { title: "หน่วยบริการใน CUP" };

// admin เท่านั้น (proxy.ts และ ../layout.tsx) ส่วน /api/admin/cup เช็ค role ซ้ำ
export default function Page() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title text-balance">หน่วยบริการใน CUP</h1>
      <CupUnits />
    </div>
  );
}
