import type { ClaimStatus } from "@/app/api/fund/types";

// สีสถานะ: ตรวจด้วย dataviz validator แล้ว (accent / warning / danger-line แยกกันได้ทั้งตาบอดสีและสองธีม เพราะต่างความสว่าง)
// ใช้ร่วมกันที่ /fund/claim-overview (กราฟ) และ /fund/claim-status (badge ในตาราง)
export const STATUS: Record<ClaimStatus, { label: string; color: string; badge: string }> = {
  closed: { label: "ปิดสิทธิแล้ว", color: "--accent", badge: "border-success-line bg-success-soft text-success" },
  authen_only: { label: "มี authen ยังไม่ปิด", color: "--warning", badge: "border-warning-line bg-warning-soft text-warning" },
  none: { label: "ไม่มี authen", color: "--danger-line", badge: "border-danger-line bg-danger-soft text-danger" },
};
