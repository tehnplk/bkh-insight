"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FilterDataGrid, gridColumnHelper } from "@/components/filter-data-grid/filter-data-grid";
import { formatThaiDate, ThaiDateStepper } from "@/components/thai-date-stepper/thai-date-stepper";
import { addDaysIso, isIsoDate, MAX_SPAN_DAYS } from "@/app/api/visit/opd-visit/opd-visit";
import { isWardCode, type IpdVisit, type IpdVisitSummary, type WardOption } from "@/app/api/visit/ipd-visit/ipd-visit";
import type { GridPage } from "@/lib/grid-query";

const FILTER_KEYS = ["from", "to", "ward"] as const;
type IpdVisitPage = GridPage<IpdVisit> & { summary: IpdVisitSummary };
const SELECT_CLASS =
  "h-9 min-w-0 max-w-72 rounded-md border border-line bg-surface pr-8 pl-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring";
const muted = <span className="text-muted">–</span>;
const dash = (v: string | null) => v || muted;
const num = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 });

const col = gridColumnHelper<IpdVisit>();
const columns = col.columns([
  col.accessor("an", { header: "AN", meta: { className: "tabular-nums" } }),
  col.accessor("hn", { header: "HN", meta: { className: "tabular-nums" } }),
  col.accessor("name", { header: "ชื่อ-นามสกุล", meta: { className: "whitespace-nowrap" } }),
  col.accessor("age", {
    header: "อายุ/เพศ",
    cell: (c) => {
      const { age, sex } = c.row.original;
      if (age == null && !sex) return muted;
      return [age == null ? null : `${age} ปี`, sex].filter(Boolean).join(" ");
    },
    meta: { className: "whitespace-nowrap tabular-nums" },
  }),
  col.accessor("pttype", { header: "สิทธิ", cell: (c) => dash(c.getValue()) }),
  col.accessor("ward", { header: "ward", cell: (c) => dash(c.getValue()), meta: { className: "whitespace-nowrap" } }),
  col.accessor("regdate", {
    header: "วันรับ",
    cell: (c) => formatThaiDate(c.getValue()),
    meta: { className: "whitespace-nowrap tabular-nums" },
  }),
  col.accessor("dchdate", {
    header: "วันจำหน่าย",
    cell: (c) => {
      const v = c.getValue();
      return v ? formatThaiDate(v) : <span className="font-medium text-accent-text">ยังนอนอยู่</span>;
    },
    meta: { className: "whitespace-nowrap tabular-nums" },
  }),
  col.accessor("los", {
    header: "วันนอน",
    cell: (c) => c.getValue() ?? muted,
    meta: { className: "text-right tabular-nums" },
  }),
  col.accessor("doctor", { header: "แพทย์", cell: (c) => dash(c.getValue()), meta: { className: "whitespace-nowrap" } }),
  col.accessor("dxCode", {
    header: "การวินิจฉัยหลัก",
    enableSorting: false,
    cell: (c) => <PrincipalDx row={c.row.original} />,
  }),
]);

// มีรหัสแล้วแสดงรหัส + ชื่อโรค ยังไม่ลงรหัสแสดงการวินิจฉัยแรกรับแบบจาง ข้อความเต็มอยู่ใน title
function PrincipalDx({ row }: { row: IpdVisit }) {
  if (row.dxCode) {
    const name = row.dxName ?? "";
    return (
      <span title={`${row.dxCode} ${name}`} className="flex w-72 max-w-72 gap-2">
        <span className="w-11 shrink-0 font-semibold tabular-nums">{row.dxCode}</span>
        <span className="truncate font-medium">{name}</span>
      </span>
    );
  }
  if (row.prediag)
    return (
      <span title={`แรกรับ: ${row.prediag}`} className="block w-72 max-w-72 truncate text-muted">
        {row.prediag}
      </span>
    );
  return muted;
}

export function IpdVisitGrid({ wards, today }: { wards: WardOption[]; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const param = (k: string) => {
    const v = sp.get(k) ?? "";
    return isIsoDate(v) ? v : today;
  };
  const from = param("from");
  const to = param("to");
  const wardParam = sp.get("ward") ?? "";
  const ward = isWardCode(wardParam) ? wardParam : "";
  // ward จาก link ที่ปิดใช้แล้ว ยังแสดงเป็นตัวเลือกเพื่อให้ select ตรงกับที่กรองอยู่
  const orphanWard = ward && !wards.some((w) => w.code === ward) ? ward : "";
  const lastPickable = (start: string) => {
    const cap = addDaysIso(start, MAX_SPAN_DAYS - 1);
    return cap < today ? cap : today;
  };

  function replace(next: URLSearchParams) {
    next.delete("page");
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  function setRange(nextFrom: string, nextTo: string) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of [["from", nextFrom], ["to", nextTo]] as const) {
      if (v === today) next.delete(k);
      else next.set(k, v);
    }
    replace(next);
  }

  function setWard(v: string) {
    const next = new URLSearchParams(sp.toString());
    if (isWardCode(v)) next.set("ward", v);
    else next.delete("ward");
    replace(next);
  }

  // เลื่อนวันเริ่มเกินวันสิ้นสุด หรือทำให้ช่วงยาวเกิน ให้ดึงวันสิ้นสุดตามมา
  function setFrom(v: string) {
    if (!isIsoDate(v)) return;
    const cap = lastPickable(v);
    setRange(v, to < v ? v : to > cap ? cap : to);
  }

  return (
    <FilterDataGrid<IpdVisit, IpdVisitPage>
      endpoint="/api/visit/ipd-visit"
      filterKeys={FILTER_KEYS}
      liveSearch
      exportPlacement="summary"
      toolbar={
        <>
          <div role="group" aria-label="ช่วงวันที่รับเข้า" className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ThaiDateStepper label="รับตั้งแต่" value={from} max={today} stepper={false} onChange={setFrom} />
            <ThaiDateStepper
              label="ถึง"
              value={to}
              min={from}
              max={lastPickable(from)}
              stepper={false}
              onChange={(v) => isIsoDate(v) && setRange(from, v)}
            />
          </div>
          <label className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-muted">ward</span>
            <select value={ward} onChange={(e) => setWard(e.target.value)} className={SELECT_CLASS}>
              <option value="">ทุก ward</option>
              {orphanWard && <option value={orphanWard}>{orphanWard}</option>}
              {wards.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </>
      }
      columns={columns}
      getRowId={(r) => r.an}
      renderSummary={({ summary: s }) => (
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-muted tabular-nums">
          <Stat label="รับใหม่" value={s.admitted.toLocaleString("th-TH")} unit="ราย" />
          <Stat label="ยังนอนอยู่ขณะนี้" value={s.inHouse.toLocaleString("th-TH")} unit="ราย" />
          <Stat label="จำหน่าย" value={s.discharged.toLocaleString("th-TH")} unit="ราย" />
          <Stat label="วันนอนเฉลี่ย (ผู้จำหน่าย)" value={s.avgLos == null ? "–" : num.format(s.avgLos)} unit="วัน" />
        </dl>
      )}
    />
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className="text-base font-semibold text-foreground">{value}</dd>
      <span>{unit}</span>
    </div>
  );
}
