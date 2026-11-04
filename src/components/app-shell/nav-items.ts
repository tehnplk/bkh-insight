import type { IconName } from "./icons";

/*
 * Sidebar menu. Add your module here:
 *   - a single page:  { label: "ชื่อเมนู", href: "/{dev_name}/{module}", icon: "chart" }
 *   - a section with sub-pages (collapsible; a flyout when the sidebar is collapsed):
 *       { label: "ชื่อหมวด", icon: "folder", children: [{ label: "...", href: "/{dev_name}/{module}" }] }
 * Icon names come from icons.tsx (add a new SVG there if none fits).
 */

export type NavSubLink = { label: string; href: string };
export type NavLink = NavSubLink & { icon: IconName };
export type NavSection = { label: string; icon: IconName; children: NavSubLink[] };
export type NavItem = NavLink | NavSection;

export const navItems: NavItem[] = [
  { label: "หน้าแรก", href: "/", icon: "home" },
  {
    label: "ผู้รับบริการ",
    icon: "users",
    children: [{ label: "ผู้ป่วยนอกรายวัน", href: "/visit/opd-visit" }],
  },
  {
    label: "ตัวอย่าง",
    icon: "components",
    children: [{ label: "Shared components", href: "/example/components-demo" }],
  },
];
