import type { IconName } from "./icons";

/*
 * Sidebar menu. Sections are work steps, not URL modules: put a new page in the step it serves.
 *   - a single page:  { label: "ชื่อเมนู", href: "/{module}/{task}", icon: "chart" }
 *   - a section with sub-pages (collapsible; a flyout when the sidebar is collapsed):
 *       { label: "ชื่อหมวด", icon: "folder", children: [{ label: "...", href: "/{module}/{task}" }] }
 * Icon names come from icons.tsx (add a new SVG there if none fits).
 * Admin pages (/admin/*) are not listed here: they live in the profile menu (profile-menu.tsx), shown to admins only.
 */

export type NavSubLink = { label: string; href: string };
/** hidden: ซ่อนจากเมนู (และการค้นหาเมนู) ชั่วคราว หน้ายังเปิดด้วย URL ได้และ breadcrumb ยังใช้ชื่อนี้ */
export type NavLink = NavSubLink & { icon: IconName; hidden?: boolean };
export type NavSection = { label: string; icon: IconName; children: NavSubLink[]; hidden?: boolean };
export type NavItem = NavLink | NavSection;

export const navItems: NavItem[] = [
  { label: "ภาพรวม", href: "/", icon: "home" },
  { label: "OPD แยกรายสิทธิ", href: "/opd/admissions", icon: "stethoscope" },
  { label: "IPD แยกรายสิทธิ", href: "/ipd/admissions", icon: "bed" },
  { label: "เส้นทางเคลม", href: "/fund/claim-pipeline", icon: "pulse" },
  // Sections follow the revenue-cycle steps (not the URL module), since users look for a page by the step they are on.
  {
    label: "เตรียมข้อมูลมาตรฐาน",
    icon: "folder",
    children: [
      { label: "ความพร้อมรหัสเบิก", href: "/catalog/claim-codes" },
      { label: "รหัสมาตรฐาน", href: "/catalog/standard-codes" },
    ],
  },
  {
    label: "บริการและมูลค่า",
    icon: "chart",
    children: [
      { label: "มูลค่าตามกองทุน", href: "/fund/opd-fund" },
      { label: "มูลค่าตามแผนก", href: "/fund/opd-department" },
      { label: "ภาพรวมกองทุน", href: "/fund/dashboard" },
    ],
  },
  {
    label: "ก่อนส่งเคลม",
    icon: "alert",
    children: [
      { label: "สถานะปิดสิทธิ", href: "/fund/claim-status" },
      { label: "ตรวจสอบ C ก่อนส่ง", href: "/fdh/c-check" },
      { label: "16 แฟ้มมาตรฐาน", href: "/fdh/files" },
    ],
  },
  {
    label: "ผลการเคลม",
    icon: "document",
    children: [
      { label: "นำเข้า REP", href: "/fund/rep-import" },
      { label: "ภาพรวมการเคลม", href: "/fund/claim-overview" },
      { label: "คิวแก้ C/Deny", href: "/fund/claim-errors" },
    ],
  },
  {
    label: "ลูกหนี้",
    icon: "table",
    children: [
      { label: "ภาพรวมลูกหนี้ UC", href: "/fund/uc-dashboard" },
      { label: "ลูกหนี้สิทธิ UC", href: "/fund/uc-debtor" },
      { label: "ลูกหนี้ตามผังบัญชี", href: "/fund/ar-ledger" },
    ],
  },
  {
    label: "รับเงิน",
    icon: "wallet",
    children: [{ label: "นำเข้า STM", href: "/fund/stm-import" }],
  },
  {
    label: "ตรวจสอบข้อมูล",
    icon: "stethoscope",
    children: [
      { label: "ผู้รับบริการผู้ป่วยนอก", href: "/visit/opd-visit" },
      { label: "ผู้ป่วยในรายวัน", href: "/visit/ipd-visit" },
      { label: "ผู้รับบริการที่เข้าเกณฑ์ DM Type-2", href: "/visit/dm-remission" },
    ],
  },
];

// Admin pages: shown in the profile menu to role "admin" only (not in the sidebar or its search), and used by the
// topbar breadcrumb. Access itself is enforced by proxy.ts and the admin layout, not by hiding the link.
export const adminSection: NavSection = {
  label: "ผู้ดูแลระบบ",
  icon: "shield",
  children: [
    { label: "ผู้ใช้งาน", href: "/admin/users" },
    { label: "บัญชีลูกหนี้ตามสิทธิ", href: "/admin/ar-accounts" },
    { label: "กองทุนย่อยลูกหนี้", href: "/admin/ar-funds" },
    { label: "บันทึกการเข้าถึง", href: "/admin/access-log" },
  ],
};
