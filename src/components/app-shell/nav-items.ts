import type { IconName } from "./icons";

/*
 * Sidebar menu. Add your module here:
 *   - a single page:  { label: "ชื่อเมนู", href: "/{dev_name}/{module}", icon: "chart" }
 *   - a submenu:      { label: "ชื่อกลุ่ม", icon: "folder", children: [{ label: "...", href: "/{dev_name}/{module}" }] }
 * Put it in an existing group or add a new { title, items } group.
 * Icon names come from icons.tsx (add a new SVG there if none fits).
 */

export type NavSubLink = { label: string; href: string };
export type NavLink = NavSubLink & { icon: IconName };
export type NavParent = { label: string; icon: IconName; children: NavSubLink[] };
export type NavItem = NavLink | NavParent;
export type NavGroup = { title?: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    items: [{ label: "หน้าแรก", href: "/", icon: "home" }],
  },
  {
    title: "ตัวอย่าง",
    items: [
      {
        label: "tehnplk",
        icon: "components",
        children: [{ label: "Shared components", href: "/tehnplk/components-demo" }],
      },
    ],
  },
];
