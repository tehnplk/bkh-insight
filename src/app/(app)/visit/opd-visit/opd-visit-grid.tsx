"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { ThaiDatePicker } from "@/components/thai-date-picker/thai-date-picker";
import type { OpdVisit } from "@/app/api/visit/opd-visit/route";

const col = gridColumnHelper<OpdVisit>();
const columns = col.columns([
  col.accessor("hn", { header: "HN" }),
  col.accessor("name", { header: "ชื่อ-นามสกุล", meta: { className: "whitespace-nowrap" } }),
  col.accessor("pttype", { header: "รหัสสิทธิ" }),
  col.accessor("pttypeName", { header: "สิทธิ" }),
  col.accessor("authCode", { header: "เลข Authen", meta: { className: "whitespace-nowrap" } }),
  col.accessor("closeCode", { header: "เลขปิดสิทธิ", meta: { className: "whitespace-nowrap" } }),
]);

// วันนี้ตามเวลาไทย ในรูป YYYY-MM-DD (sv-SE ให้รูปแบบ ISO)
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
const control = "h-9 rounded-md border border-line bg-surface px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type PttypeOption = { pttype: string; name: string };

export function OpdVisitGrid({ pttypes }: { pttypes: PttypeOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const vstdate = sp.get("vstdate") || today();
  const pttype = sp.get("pttype") ?? "";

  // เปลี่ยน filter แล้วกลับหน้า 1 ค่าว่าง = ลบออกจาก URL
  function setFilter(key: string, v: string) {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(key, v);
    else next.delete(key);
    next.delete("page");
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  const filters = (
    <>
      {/* div ไม่ใช่ label: popover อยู่ข้างใน คลิกพื้นที่ว่างจะไม่ไปกดปุ่มเปิดซ้ำ */}
      <div className="flex items-center gap-2 text-muted">
        <span aria-hidden="true">วันที่</span>
        <ThaiDatePicker aria-label="วันที่รับบริการ" value={vstdate} onChange={(v) => setFilter("vstdate", v)} />
      </div>
      <label className="flex min-w-0 items-center gap-2 text-muted">
        สิทธิ
        <select aria-label="สิทธิ" value={pttype} onChange={(e) => setFilter("pttype", e.target.value)} className={`${control} min-w-0 max-w-56`}>
          <option value="">ทุกสิทธิ</option>
          {pttypes.map((t) => (
            <option key={t.pttype} value={t.pttype}>
              {t.pttype} {t.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );

  return (
    <DataGrid<OpdVisit>
      endpoint="/api/visit/opd-visit"
      params={{ vstdate, pttype }}
      filters={filters}
      columns={columns}
      getRowId={(r) => r.vn}
    />
  );
}
