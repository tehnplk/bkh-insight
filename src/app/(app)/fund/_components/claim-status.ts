import type { ClaimStatus } from "@/app/api/fund/types";

// สีสถานะ: ตรวจด้วย dataviz validator แล้ว (accent / warning / danger-line แยกกันได้ทั้งตาบอดสีและสองธีม เพราะต่างความสว่าง)
// ใช้ที่กราฟของ /fund/claim-overview
export const STATUS: Record<ClaimStatus, { label: string; color: string }> = {
  closed: { label: "ปิดสิทธิแล้ว", color: "--accent" },
  authen_only: { label: "มี authen ยังไม่ปิด", color: "--warning" },
  none: { label: "ไม่มี authen", color: "--danger-line" },
};
