"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import type { Patient } from "@/app/api/example/components-demo/patients";

const STATUS_STYLE: Record<Patient["status"], string> = {
  รักษาอยู่: "bg-success-soft text-success border border-success-line",
  จำหน่าย: "bg-surface-sunken text-muted border border-line",
  ส่งต่อ: "bg-warning-soft text-warning border border-warning-line",
};

const dateTh = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });

const col = gridColumnHelper<Patient>();
const columns = col.columns([
  // meta.filter = ตัวกรองบนหัวคอลัมน์ (ติ๊กเลือก/ค้นหาค่า) endpoint ต้องรองรับ cf/facet ดู route ของ demo นี้
  col.accessor("hn", { header: "HN", meta: { filter: true } }),
  col.accessor("name", { header: "ชื่อ-สกุล", meta: { className: "whitespace-nowrap", filter: true } }),
  col.accessor("age", { header: "อายุ", meta: { className: "text-right", filter: true } }),
  col.accessor("ward", { header: "หอผู้ป่วย", meta: { className: "whitespace-nowrap", filter: true } }),
  col.accessor("admitDate", { header: "วันที่รับไว้", cell: (c) => dateTh(c.getValue()), meta: { className: "whitespace-nowrap", filter: { format: dateTh } } }),
  col.accessor("diagnosis", { header: "การวินิจฉัย", enableSorting: false, meta: { filter: true } }),
  col.accessor("status", {
    header: "สถานะ",
    cell: (c) => {
      const s = c.getValue();
      return <span className={`inline-block rounded-full px-2 font-medium whitespace-nowrap ${STATUS_STYLE[s]}`}>{s}</span>;
    },
    meta: { filter: true },
  }),
]);

function PatientDetail({ p }: { p: Patient }) {
  const items: [string, string][] = [
    ["HN", p.hn],
    ["เพศ / อายุ", `${p.sex} ${p.age} ปี`],
    ["หอผู้ป่วย", p.ward],
    ["วันที่รับไว้", dateTh(p.admitDate)],
    ["การวินิจฉัย", p.diagnosis],
    ["แพทย์เจ้าของไข้", p.doctor],
    ["โทรศัพท์", p.phone],
    ["สถานะ", p.status],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-muted">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PatientGrid() {
  const sp = useSearchParams();
  const mode = sp.get("view") === "expand" ? "expand" : "modal";
  const hrefFor = (v: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set("view", v);
    return `?${next}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="รูปแบบการแสดงรายละเอียด" className="inline-flex self-start rounded-lg bg-surface-sunken p-1 text-sm">
        {(["modal", "expand"] as const).map((v) => (
          <Link
            key={v}
            href={hrefFor(v)}
            replace
            scroll={false}
            aria-current={mode === v ? "page" : undefined}
            className="rounded-md px-3 py-1.5 font-medium text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-surface aria-[current=page]:text-foreground aria-[current=page]:shadow-sm"
          >
            {v === "modal" ? "เปิดเป็นหน้าต่าง" : "กางในแถว"}
          </Link>
        ))}
      </nav>
      <DataGrid<Patient>
        key={mode}
        endpoint="/api/example/components-demo"
        columns={columns}
        getRowId={(p) => p.hn}
        detailMode={mode}
        renderDetail={(p) => <PatientDetail p={p} />}
        detailTitle={(p) => `${p.name} · ${p.hn}`}
      />
    </div>
  );
}
