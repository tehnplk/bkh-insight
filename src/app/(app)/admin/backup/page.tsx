import { Backups } from "./backups";

export const metadata = { title: "สำรองข้อมูล" };

// admin เท่านั้น (proxy.ts และ ../layout.tsx) ส่วน /api/admin/backup เช็ค role ซ้ำ
export default function Page() {
  return <Backups />;
}
