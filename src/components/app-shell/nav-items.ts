import type { IconName } from "./icons";

/*
 * Sidebar menu. Add your module here:
 *   - a single page:  { label: "ชื่อเมนู", href: "/{dev_name}/{module}", icon: "chart" }
 *   - a section with sub-pages (collapsible; a flyout when the sidebar is collapsed):
 *       { label: "ชื่อหมวด", icon: "folder", children: [{ label: "...", href: "/{dev_name}/{module}" }] }
 * Icon names come from icons.tsx (add a new SVG there if none fits).
 * Admin pages (/admin/*) are not listed here: they live in the profile menu (profile-menu.tsx), shown to admins only.
 */

export type NavSubLink = { label: string; href: string };
export type NavLink = NavSubLink & { icon: IconName };
export type NavSection = { label: string; icon: IconName; children: NavSubLink[] };
export type NavItem = NavLink | NavSection;

export const navItems: NavItem[] = [
  { label: "ภาพรวม", href: "/", icon: "home" },
  {
    label: "จัดเก็บรายได้",
    icon: "wallet",
    children: [
      { label: "มูลค่าตามกองทุน", href: "/fund/opd-fund" },
      { label: "มูลค่าตามแผนก", href: "/fund/opd-department" },
      { label: "ภาพรวมกองทุน", href: "/fund/dashboard" },
      { label: "ภาพรวมการเคลม", href: "/fund/claim-overview" },
      { label: "คนไข้เข้าเกณฑ์ DM Type-2", href: "/fund/dm-remission" },
    ],
  },
  {
    label: "ตรวจสอบข้อมูล",
    icon: "stethoscope",
    children: [
      { label: "ผู้รับบริการผู้ป่วยนอก", href: "/visit/opd-visit" },
      { label: "ผู้ป่วยในรายวัน", href: "/visit/ipd-visit" },
    ],
  },
];

// Admin pages: shown in the profile menu to role "admin" only (not in the sidebar or its search), and used by the
// topbar breadcrumb. Access itself is enforced by proxy.ts and the admin layout, not by hiding the link.
export const adminSection: NavSection = {
  label: "ผู้ดูแลระบบ",
  icon: "shield",
  children: [{ label: "ผู้ใช้งาน", href: "/admin/users" }],
};
