"use client";

import { useRef, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isIsoDate } from "@/app/api/visit/opd-visit/opd-visit";
import { homeQuery, panelId, parseBy, TABS, tabId, toDayRange, type HomeTab } from "./home-params";

/**
 * แท็บของหน้าแรก (ARIA tabs, เลือกทันทีเมื่อกดลูกศร) state อยู่ใน ?tab= จึง refresh/แชร์ link ได้
 * ตัวกรองร่วม (from, to, pttype) และ by/metric ติดไปด้วย ยกเว้นช่วงที่ยาวกว่าที่แท็บสรุปรับได้ (รายเดือน) ตัดเหลือ 31 วันสุดท้าย
 */
export function HomeTabs({ active, today }: { active: HomeTab; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);

  function href(tab: HomeTab) {
    const patch: Record<string, string | null> = { tab };
    if (tab === "summary" && parseBy(searchParams.get("by")) === "month") {
      const pick = (k: string) => {
        const v = searchParams.get(k) ?? "";
        return isIsoDate(v) ? v : today;
      };
      Object.assign(patch, toDayRange(pick("from"), pick("to")));
    }
    return `${pathname}${homeQuery(searchParams, patch, today)}`;
  }

  function onKeyDown(e: KeyboardEvent, i: number) {
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const j = (next + TABS.length) % TABS.length;
    refs.current[j]?.focus();
    router.replace(href(TABS[j].value), { scroll: false });
  }

  return (
    <div role="tablist" aria-label="มุมมอง" className="flex gap-1 border-b border-line">
      {TABS.map((t, i) => {
        const on = t.value === active;
        return (
          <Link
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={tabId(t.value)}
            role="tab"
            aria-selected={on}
            aria-controls={panelId(t.value)}
            tabIndex={on ? 0 : -1}
            href={href(t.value)}
            replace
            scroll={false}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`-mb-px border-b-2 px-3 py-2 outline-none focus-visible:rounded-t-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
              on ? "border-accent font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
