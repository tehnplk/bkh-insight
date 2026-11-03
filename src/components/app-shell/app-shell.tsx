"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Suspense,
  useId,
  useRef,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Icon } from "./icons";
import { navGroups, type NavLink, type NavParent } from "./nav-items";

const APP_NAME = "BKH Insight";

// Desktop collapsed state, persisted in localStorage. In-memory value wins once set,
// so toggling still works when storage is blocked.
const STORAGE_KEY = "bkh-insight:sidebar-collapsed";
let collapsedMemo: boolean | null = null;
const listeners = new Set<() => void>();

function getCollapsed() {
  if (collapsedMemo !== null) return collapsedMemo;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setCollapsed(value: boolean) {
  collapsedMemo = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isActive(href: string, pathname: string | null) {
  if (pathname === null) return false;
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

const iconButton = `inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground ${focusRing}`;

export function AppShell({ children }: { children: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribe, getCollapsed, () => false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const closeDrawer = () => drawerRef.current?.close();

  return (
    <>
      <a
        href="#main"
        className={`sr-only z-50 rounded-md bg-accent text-sm font-medium text-white shadow-lg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:px-4 focus:py-2 ${focusRing}`}
      >
        ข้ามไปยังเนื้อหาหลัก
      </a>

      <div className="flex min-h-dvh">
        <aside
          className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex ${
            collapsed ? "w-16" : "w-64"
          }`}
        >
          <Brand collapsed={collapsed} />
          <SidebarNav collapsed={collapsed} onExpand={() => setCollapsed(false)} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur-sm md:px-4">
            <button
              type="button"
              className={`${iconButton} md:hidden`}
              aria-label="เปิดเมนู"
              aria-haspopup="dialog"
              onClick={() => drawerRef.current?.showModal()}
            >
              <Icon name="menu" />
            </button>
            <button
              type="button"
              className={`${iconButton} hidden md:inline-flex`}
              aria-label={collapsed ? "ขยายเมนู" : "ย่อเมนู"}
              title={collapsed ? "ขยายเมนู" : "ย่อเมนู"}
              onClick={() => setCollapsed(!collapsed)}
            >
              <Icon name="sidebar" />
            </button>
            <span className="font-semibold tracking-tight md:hidden">{APP_NAME}</span>
          </header>

          <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-8 md:py-8">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile drawer: native modal dialog gives Esc, focus trap, inert page and focus return. */}
      <dialog
        ref={drawerRef}
        aria-label="เมนู"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDrawer();
        }}
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-72 max-w-[85vw] border-0 border-r border-line bg-surface p-0 text-foreground shadow-[4px_0_24px_rgb(0_0_0/0.12)] transition-transform duration-200 ease-out backdrop:bg-black/40 starting:-translate-x-full motion-reduce:transition-none"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center pr-2">
            <div className="min-w-0 flex-1">
              <Brand collapsed={false} onNavigate={closeDrawer} />
            </div>
            <button type="button" className={iconButton} aria-label="ปิดเมนู" onClick={closeDrawer}>
              <Icon name="close" />
            </button>
          </div>
          <SidebarNav collapsed={false} onNavigate={closeDrawer} />
        </div>
      </dialog>
    </>
  );
}

function Brand({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      title={collapsed ? APP_NAME : undefined}
      className={`flex h-14 min-w-0 shrink-0 items-center gap-3 rounded-md ${collapsed ? "justify-center" : "px-4"} ${focusRing}`}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-white">
        <Icon name="pulse" className="size-5" />
      </span>
      <span className={collapsed ? "sr-only" : "min-w-0 leading-tight"}>
        <span className="block truncate font-semibold tracking-tight">{APP_NAME}</span>
        <span className="block truncate text-xs text-muted">ระบบข้อมูลและรายงาน</span>
      </span>
    </Link>
  );
}

type NavProps = { collapsed: boolean; onExpand?: () => void; onNavigate?: () => void };

// usePathname may suspend under cacheComponents on routes with unknown dynamic params,
// so the active-state read sits in its own Suspense boundary.
function SidebarNav(props: NavProps) {
  return (
    <Suspense fallback={<NavTree {...props} pathname={null} />}>
      <ActiveNavTree {...props} />
    </Suspense>
  );
}

function ActiveNavTree(props: NavProps) {
  return <NavTree {...props} pathname={usePathname()} />;
}

const tones = {
  active: "bg-accent-soft font-medium text-accent-strong",
  // Parent of the current page while its submenu is visible.
  parent: "font-medium text-foreground hover:bg-hover",
  idle: "text-muted hover:bg-hover hover:text-foreground",
};

function itemClass(tone: keyof typeof tones, collapsed: boolean) {
  return `flex h-9 w-full items-center gap-3 rounded-md text-sm transition-colors ${focusRing} ${
    collapsed ? "justify-center" : "px-3"
  } ${tones[tone]}`;
}

function NavTree({ collapsed, pathname, onExpand, onNavigate }: NavProps & { pathname: string | null }) {
  const id = useId();
  return (
    <nav aria-label="เมนูหลัก" className="flex-1 overflow-y-auto overscroll-contain px-2 pt-2 pb-6">
      {navGroups.map((group, gi) => {
        const headingId = `${id}-g${gi}`;
        return (
          <div key={group.title ?? gi} className={gi ? (collapsed ? "mt-3 border-t border-line pt-3" : "mt-6") : ""}>
            {group.title && (
              <h2
                id={headingId}
                className={collapsed ? "sr-only" : "px-3 pb-2 text-xs font-medium text-muted"}
              >
                {group.title}
              </h2>
            )}
            <ul className="space-y-0.5" aria-labelledby={group.title ? headingId : undefined}>
              {group.items.map((item) => (
                <li key={item.label}>
                  {"children" in item ? (
                    <SubMenu item={item} collapsed={collapsed} pathname={pathname} onExpand={onExpand} onNavigate={onNavigate} />
                  ) : (
                    <NavItemLink item={item} collapsed={collapsed} pathname={pathname} onNavigate={onNavigate} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function NavItemLink({ item, collapsed, pathname, onNavigate }: NavProps & { item: NavLink; pathname: string | null }) {
  const active = isActive(item.href, pathname);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={itemClass(active ? "active" : "idle", collapsed)}
    >
      <Icon name={item.icon} className="size-5 shrink-0" />
      <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
    </Link>
  );
}

function SubMenu({
  item,
  collapsed,
  pathname,
  onExpand,
  onNavigate,
}: NavProps & { item: NavParent; pathname: string | null }) {
  const hasActive = item.children.some((c) => isActive(c.href, pathname));

  // Collapsed rail has no room for children: expand the sidebar and open this submenu instead.
  const onSummaryClick = (e: MouseEvent<HTMLElement>) => {
    if (!collapsed) return;
    e.preventDefault();
    (e.currentTarget.parentElement as HTMLDetailsElement).open = true;
    onExpand?.();
  };

  return (
    <details open={hasActive || undefined} className="group/sub">
      <summary
        title={collapsed ? item.label : undefined}
        onClick={onSummaryClick}
        className={`${itemClass(hasActive ? (collapsed ? "active" : "parent") : "idle", collapsed)} cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden`}
      >
        <Icon name={item.icon} className="size-5 shrink-0" />
        <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
        {!collapsed && (
          <Icon
            name="chevron"
            className="ml-auto size-4 shrink-0 transition-transform duration-150 group-open/sub:rotate-90 motion-reduce:transition-none"
          />
        )}
      </summary>
      {!collapsed && (
        <ul className="mt-0.5 ml-[1.375rem] space-y-0.5 border-l border-line pl-2">
          {item.children.map((child) => {
            const active = isActive(child.href, pathname);
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={itemClass(active ? "active" : "idle", false)}
                >
                  <span className="truncate">{child.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
