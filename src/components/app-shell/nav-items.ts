import type { IconName } from "./icons";

/*
 * Sidebar menu. Add your module here:
 *   - a single page:  { label: "ชื่อเมนู", href: "/{dev_name}/{module}", icon: "chart" }
 *   - a section with sub-pages (collapsible; a flyout when the sidebar is collapsed):
 *       { label: "ชื่อหมวด", icon: "folder", children: [{ label: "...", href: "/{dev_name}/{module}" }] }
 * Icon names come from icons.tsx (add a new SVG there if none fits).
 * adminOnly: true hides the item from non-admins (the pages themselves are guarded by proxy.ts and the admin layout).
 */

export type NavSubLink = { label: string; href: string };
export type NavLink = NavSubLink & { icon: IconName; adminOnly?: boolean };
export type NavSection = { label: string; icon: IconName; children: NavSubLink[]; adminOnly?: boolean };
export type NavItem = NavLink | NavSection;

export const navItems: NavItem[] = [
  { label: "หน้าแรก", href: "/", icon: "home" },
  {
    label: "การรับบริการ",
    icon: "stethoscope",
    children: [
      { label: "ผู้รับบริการผู้ป่วยนอก", href: "/visit/opd-visit" },
      { label: "ผู้ป่วยในรายวัน", href: "/visit/ipd-visit" },
    ],
  },
  {
    label: "คุณภาพข้อมูล",
    icon: "clipboardCheck",
    children: [{ label: "รายการค้างใน HIS", href: "/quality/pending" }],
  },
  {
    label: "กองทุน",
    icon: "wallet",
    children: [
      { label: "มูลค่าตามกองทุน", href: "/fund/opd-fund" },
      { label: "มูลค่าตามแผนก", href: "/fund/opd-department" },
      { label: "ภาพรวมกองทุน", href: "/fund/dashboard" },
      { label: "ภาพรวมการเคลม", href: "/fund/claim-overview" },
    ],
  },
  {
    label: "ผู้ดูแลระบบ",
    icon: "shield",
    adminOnly: true,
    children: [{ label: "ผู้ใช้งาน", href: "/admin/users" }],
  },
  {
    label: "ตัวอย่าง",
    icon: "components",
    children: [{ label: "Shared components", href: "/example/components-demo" }],
  },
];
