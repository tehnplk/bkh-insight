"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { CategoryAmount, VisitItem, VisitItemsResponse } from "@/app/api/fund/types";
import { Money, focusRing, num, useJson } from "./ui";

/** รายการค่าใช้จ่ายของ visit แยกตามหมวด (เนื้อหาใน modal ของ DataGrid) */
export function VisitItems({ vn }: { vn: string }) {
  const { loading, data, error, retry } = useJson<VisitItemsResponse>(`/api/fund/opd-fund/visit-items?${new URLSearchParams({ vn })}`);

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-hover" style={{ width: `${90 - (i % 3) * 15}%` }} />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="py-6 text-center text-sm">
        <p className="font-medium text-danger">โหลดรายการไม่สำเร็จ</p>
        <p className="mt-1 text-muted">{error}</p>
        <button
          type="button"
          onClick={retry}
          className={`mt-4 inline-flex h-9 items-center rounded-md border border-line bg-surface px-3 font-medium hover:bg-hover ${focusRing}`}
        >
          ลองอีกครั้ง
        </button>
      </div>
    );
  }

  const d = data;
  return (
    <div className="text-sm">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className="text-muted">วันที่รับบริการ</dt>
        <dd>{formatThaiDate(d.vstdate)}</dd>
        <dt className="text-muted">สิทธิ</dt>
        <dd>{d.pttype_name || <span className="text-muted">–</span>}</dd>
        <dt className="text-muted">กองทุน</dt>
        <dd>{d.fund_name}</dd>
        <dt className="text-muted">VN</dt>
        <dd className="tabular-nums">{d.vn}</dd>
      </dl>

      <div className="mt-5">
        <ItemCategories categories={d.categories}>
          <div className="flex items-center justify-between border-t-2 border-line px-3 py-2.5 font-semibold">
            <span>รวมทั้งหมด (บาท)</span>
            <span className={num}><Money value={d.total} /></span>
          </div>
        </ItemCategories>
      </div>
    </div>
  );
}

type ItemCategory<T extends VisitItem> = CategoryAmount & { items: T[] };

/**
 * ตารางรายการค่าใช้จ่ายแยกหมวด income พับได้ (ใช้ทั้ง /fund/opd-fund และ /fund/uc-debtor)
 * `open` = กางทุกหมวดตอนเริ่ม, `tag` = ป้ายต่อท้ายชื่อรายการ, `children` = แถวรวมท้ายกรอบ
 */
export function ItemCategories<T extends VisitItem>({
  categories,
  open = true,
  tag,
  children,
}: {
  categories: ItemCategory<T>[];
  open?: boolean;
  tag?: (item: T) => ReactNode;
  children?: ReactNode;
}) {
  if (categories.length === 0) {
    return <p className="rounded-lg border border-line px-4 py-8 text-center text-muted">ไม่มีรายการค่าใช้จ่าย</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      {categories.map((c) => (
        <details key={c.income_code} open={open} className="group border-b border-line last:border-b-0">
          <summary
            className={`flex cursor-pointer list-none items-center gap-2 bg-surface-sunken px-3 py-2 hover:bg-hover [&::-webkit-details-marker]:hidden ${focusRing}`}
          >
            <ChevronRight className="size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-90" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium">{c.income_name}</span>
            <span className="text-xs whitespace-nowrap text-muted">{formatCount(c.items.length)} รายการ</span>
            <span className={`w-25 font-semibold ${num}`}><Money value={c.amount} /></span>
          </summary>
          {/* จอแคบ: ตารางเลื่อนแนวนอนในกรอบของหมวด หัวหมวดไม่เลื่อนตาม */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-120 table-fixed border-collapse tabular-nums">
              <colgroup>
                <col />
                <col className="w-20" />
                <col className="w-32" />
                <col className="w-28" />
              </colgroup>
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1.5 pr-3 pl-9 font-medium">รายการ</th>
                  <th className={`px-3 py-1.5 font-medium ${num}`}>จำนวน</th>
                  <th className={`px-3 py-1.5 font-medium ${num}`}>ราคาต่อหน่วย (บาท)</th>
                  <th className={`py-1.5 pr-3 pl-3 font-medium ${num}`}>มูลค่า (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {c.items.map((it, i) => (
                  <tr key={`${it.icode}-${i}`} className="border-t border-line">
                    <td className="py-1.5 pr-3 pl-9 break-words">{it.name}{tag?.(it)}</td>
                    <td className={`px-3 py-1.5 ${num}`}>{it.qty.toLocaleString("th-TH")}</td>
                    <td className={`px-3 py-1.5 ${num}`}><Money value={it.unitprice} /></td>
                    <td className={`py-1.5 pr-3 pl-3 ${num}`}><Money value={it.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
      {children}
    </div>
  );
}
