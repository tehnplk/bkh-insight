"use client";

import { useId, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { formatThaiDate, ThaiDatePicker } from "@/components/thai-date-picker/thai-date-picker";
import {
  addDaysIso,
  CLOSE_STATUSES,
  DIAG_TYPE_LABEL,
  isCloseStatus,
  isIsoDate,
  isPttypeCode,
  isHipdataGroup,
  hipdataLabel,
  MAX_SPAN_DAYS,
  type Diagnosis,
  type OpdVisit,
  type HipdataOption,
  type OpdVisitSummary,
  type PttypeOption,
} from "@/app/api/visit/opd-visit/opd-visit";
import type { GridPage } from "@/lib/grid-query";

const FILTER_KEYS = ["from", "to", "group", "pttype", "closed"] as const;
type OpdVisitPage = GridPage<OpdVisit> & { summary: OpdVisitSummary };
const SELECT_CLASS =
  "h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring";
const dash = (v: string | null) => v || <span className="text-muted">–</span>;
const baht = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const col = gridColumnHelper<OpdVisit>();
const columns = col.columns([
  col.accessor("vstdate", {
    header: "วันที่รับบริการ",
    cell: (c) => formatThaiDate(c.getValue()),
    meta: { className: "whitespace-nowrap tabular-nums" },
  }),
  col.accessor("hn", { header: "HN" }),
  col.accessor("name", { header: "ชื่อ-นามสกุล", meta: { className: "whitespace-nowrap" } }),
  col.accessor("sex", { header: "เพศ", cell: (c) => <SexCell sex={c.getValue()} />, meta: { className: "whitespace-nowrap" } }),
  col.accessor("age", {
    header: "อายุ (ปี)",
    cell: (c) => c.getValue() ?? <span className="text-muted">–</span>,
    meta: { className: "text-right tabular-nums" },
  }),
  col.accessor("pttypeCode", { header: "รหัสสิทธิ", cell: (c) => dash(c.getValue()), meta: { className: "tabular-nums" } }),
  col.accessor("pttype", { header: "สิทธิ", cell: (c) => dash(c.getValue()) }),
  col.accessor("authen", { header: "เลข authen", cell: (c) => dash(c.getValue()), meta: { className: "whitespace-nowrap" } }),
  col.accessor("closeCode", { header: "เลขปิดสิทธิ", cell: (c) => dash(c.getValue()), meta: { className: "whitespace-nowrap" } }),
  col.accessor("diagnoses", {
    header: "การวินิจฉัย",
    enableSorting: false,
    cell: (c) => <DiagnosisList items={c.getValue()} />,
  }),
  col.accessor("income", {
    header: "ค่าใช้จ่าย",
    cell: (c) => {
      const v = c.getValue();
      return v == null ? <span className="text-muted">–</span> : baht.format(v);
    },
    meta: { className: "text-right tabular-nums whitespace-nowrap" },
  }),
]);

// สัญลักษณ์ ♂/♀ วาดเป็น SVG ข้อความเพศยังอยู่ ไอคอนจึง aria-hidden
const SEX_ICON: Record<string, string> = {
  ชาย: "M10 19a5 5 0 110-10 5 5 0 010 10zM13.5 10.5L20 4M15 4h5v5",
  หญิง: "M12 13a5 5 0 110-10 5 5 0 010 10zM12 13v8M9 18h6",
};

function SexCell({ sex }: { sex: string | null }) {
  if (!sex) return <span className="text-muted">–</span>;
  const d = SEX_ICON[sex];
  return (
    <span className="inline-flex items-center gap-1">
      {d && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-3 shrink-0 text-muted">
          <path d={d} />
        </svg>
      )}
      {sex}
    </span>
  );
}

// แสดงเฉพาะวินิจฉัยหลัก (ไม่มีใช้รายการแรก) ที่เหลือกดขยายดูใต้แถว: รหัสแสดงเต็มเสมอ ชื่อโรคตัดได้ (ชื่อเต็มใน title)
function DiagnosisList({ items }: { items: Diagnosis[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!items.length) return <span className="text-muted">–</span>;
  const main = items.find((d) => d.type === "1") ?? items[0];
  const rest = items.filter((d) => d !== main);
  const label = (d: Diagnosis) => DIAG_TYPE_LABEL[d.type] ?? d.type;
  return (
    <div className="w-72 max-w-72">
      <div className="flex items-center gap-2">
        <span title={`${main.code} ${main.name} (${label(main)})`} className="flex min-w-0 flex-1 gap-2">
          <span className="w-11 shrink-0 font-semibold tabular-nums">{main.code}</span>
          <span className="truncate font-medium">{main.name}</span>
        </span>
        {rest.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={open ? "ย่อการวินิจฉัย" : `แสดงการวินิจฉัยอื่นอีก ${rest.length} รายการ`}
            title={open ? "ย่อ" : `อื่นอีก ${rest.length} รายการ`}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            className="grid size-5 shrink-0 place-items-center rounded text-muted outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true" className="size-3">
              <path d={open ? "M5 12h14" : "M5 12h14M12 5v14"} />
            </svg>
          </button>
        )}
      </div>
      {rest.length > 0 && (
        <ul id={listId} hidden={!open} className="mt-1 space-y-0.5 text-muted">
          {rest.map((d) => (
            <li key={d.code} title={`${d.code} ${d.name} (${label(d)})`} className="flex gap-2">
              <span className="w-11 shrink-0 tabular-nums">{d.code}</span>
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="shrink-0">{label(d)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const pttypeOption = (p: PttypeOption) => (
  <option key={p.code} value={p.code}>
    {p.code} {p.name}
  </option>
);

export function OpdVisitGrid({
  pttypes,
  groups,
  today,
}: {
  pttypes: PttypeOption[];
  groups: HipdataOption[];
  /** วันนี้ (ISO) จาก server */
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const param = (k: string) => {
    const v = sp.get(k) ?? "";
    return isIsoDate(v) ? v : today;
  };
  const from = param("from");
  const to = param("to");
  const groupParam = sp.get("group") ?? "";
  const group = isHipdataGroup(groupParam) ? groupParam : "";
  const closedParam = sp.get("closed") ?? "";
  const closed = isCloseStatus(closedParam) ? closedParam : "";
  const pttypeParam = sp.get("pttype") ?? "";
  const pttype = isPttypeCode(pttypeParam) ? pttypeParam : "";
  // เลือกกลุ่มแล้วเหลือเฉพาะสิทธิในกลุ่มนั้น
  const pttypeOptions = group ? pttypes.filter((p) => p.group === group) : pttypes;
  // สิทธิจาก link ที่ไม่อยู่ในรายการ (ปิดใช้แล้ว) ยังแสดงเป็นตัวเลือกเพื่อให้ select ตรงกับที่กรองอยู่
  const orphanPttype = pttype && !pttypeOptions.some((p) => p.code === pttype) ? pttype : "";
  // กลุ่มจาก link ที่ไม่มีสิทธิเปิดใช้อยู่ (เช่น ลิงก์จากหน้าแรกของสิทธิที่ปิดใช้แล้ว) แสดงเป็นรหัส ("none" เป็น "ไม่ระบุ")
  const orphanGroup = group && !groups.some((g) => g.value === group) ? group : "";
  // วันสุดท้ายที่เลือกได้: ไม่เกินวันนี้ และไม่เกินช่วงสูงสุดที่ API รับ
  const lastPickable = (start: string) => {
    const cap = addDaysIso(start, MAX_SPAN_DAYS - 1);
    return cap < today ? cap : today;
  };

  function setRange(nextFrom: string, nextTo: string) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of [["from", nextFrom], ["to", nextTo]] as const) {
      if (v === today) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  // ค่านอก allowlist (เช่น "" = ทั้งหมด) ลบ param ออก
  function setFilter(key: "group" | "closed" | "pttype", v: string, valid: boolean) {
    const next = new URLSearchParams(sp.toString());
    if (valid) next.set(key, v);
    else next.delete(key);
    // เปลี่ยนกลุ่มแล้วสิทธิที่เลือกไว้ไม่อยู่ในกลุ่มใหม่ ล้างสิทธิทิ้ง
    if (key === "group" && valid && pttype && pttypes.find((p) => p.code === pttype)?.group !== v) next.delete("pttype");
    next.delete("page");
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  // เลื่อนวันเริ่มเกินวันสิ้นสุด หรือทำให้ช่วงยาวเกิน ให้ดึงวันสิ้นสุดตามมา
  function setFrom(v: string) {
    if (!isIsoDate(v)) return;
    const cap = lastPickable(v);
    setRange(v, to < v ? v : to > cap ? cap : to);
  }

  function setTo(v: string) {
    if (isIsoDate(v)) setRange(from, v);
  }

  return (
    <DataGrid<OpdVisit, OpdVisitPage>
      endpoint="/api/visit/opd-visit"
      filterKeys={FILTER_KEYS}
      liveSearch
      exportPlacement="summary"
      toolbar={
        <>
          <div role="group" aria-label="ช่วงวันที่รับบริการ" className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ThaiDatePicker label="ตั้งแต่" value={from} max={today} stepper={false} onChange={setFrom} />
            <ThaiDatePicker label="ถึง" value={to} min={from} max={lastPickable(from)} stepper={false} onChange={setTo} />
          </div>
          <label className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-muted">กลุ่มสิทธิ</span>
            <select
              value={group}
              onChange={(e) => setFilter("group", e.target.value, isHipdataGroup(e.target.value))}
              className={`${SELECT_CLASS} min-w-0 max-w-72`}
            >
              <option value="">ทุกกลุ่ม</option>
              {orphanGroup && <option value={orphanGroup}>{hipdataLabel(orphanGroup, null)}</option>}
              {groups.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-muted">สิทธิ</span>
            <select
              value={pttype}
              onChange={(e) => setFilter("pttype", e.target.value, isPttypeCode(e.target.value))}
              className={`${SELECT_CLASS} min-w-0 max-w-72`}
            >
              <option value="">ทุกสิทธิ</option>
              {orphanPttype && <option value={orphanPttype}>{orphanPttype}</option>}
              {group
                ? pttypeOptions.map(pttypeOption)
                : groups.map((g) => {
                    const items = pttypes.filter((p) => p.group === g.value);
                    return (
                      items.length > 0 && (
                        <optgroup key={g.value} label={g.label}>
                          {items.map(pttypeOption)}
                        </optgroup>
                      )
                    );
                  })}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted">สถานะปิดสิทธิ</span>
            <select
              value={closed}
              onChange={(e) => setFilter("closed", e.target.value, isCloseStatus(e.target.value))}
              className={SELECT_CLASS}
            >
              <option value="">ทั้งหมด</option>
              {CLOSE_STATUSES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </>
      }
      columns={columns}
      getRowId={(r) => r.vn}
      renderSummary={(d) => (
        <p className="text-muted tabular-nums">
          ค่าใช้จ่ายรวม <span className="text-base font-semibold text-foreground">{baht.format(d.summary.income)}</span> บาท
          <span aria-hidden="true"> · </span>
          {d.total.toLocaleString("th-TH")} รายการ
        </p>
      )}
    />
  );
}
