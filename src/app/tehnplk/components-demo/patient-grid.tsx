"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import type { Patient } from "@/app/api/tehnplk/components-demo/patients";

const STATUS_STYLE: Record<Patient["status"], string> = {
  รักษาอยู่: "bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  จำหน่าย: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  ส่งต่อ: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

const dateTh = (iso: string) => new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });

const col = gridColumnHelper<Patient>();
const columns = col.columns([
  col.accessor("hn", { header: "HN" }),
  col.accessor("name", { header: "ชื่อ-สกุล", meta: { className: "whitespace-nowrap" } }),
  col.accessor("age", { header: "อายุ", meta: { className: "text-right" } }),
  col.accessor("ward", { header: "หอผู้ป่วย", meta: { className: "whitespace-nowrap" } }),
  col.accessor("admitDate", { header: "วันที่รับไว้", cell: (c) => dateTh(c.getValue()), meta: { className: "whitespace-nowrap" } }),
  col.accessor("diagnosis", { header: "การวินิจฉัย", enableSorting: false }),
  col.accessor("status", {
    header: "สถานะ",
    cell: (c) => {
      const s = c.getValue();
      return <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_STYLE[s]}`}>{s}</span>;
    },
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
          <dt className="text-zinc-500 dark:text-zinc-400">{k}</dt>
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
      <nav aria-label="รูปแบบการแสดงรายละเอียด" className="inline-flex self-start rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
        {(["modal", "expand"] as const).map((v) => (
          <Link
            key={v}
            href={hrefFor(v)}
            replace
            scroll={false}
            aria-current={mode === v ? "page" : undefined}
            className="rounded-md px-3 py-1.5 font-medium text-zinc-600 aria-[current=page]:bg-white aria-[current=page]:text-zinc-900 aria-[current=page]:shadow-sm focus-visible:outline-2 focus-visible:outline-teal-600 dark:text-zinc-400 dark:aria-[current=page]:bg-zinc-950 dark:aria-[current=page]:text-zinc-100"
          >
            {v === "modal" ? "เปิดเป็นหน้าต่าง" : "กางในแถว"}
          </Link>
        ))}
      </nav>
      <DataGrid<Patient>
        key={mode}
        endpoint="/api/tehnplk/components-demo"
        columns={columns}
        getRowId={(p) => p.hn}
        detailMode={mode}
        renderDetail={(p) => <PatientDetail p={p} />}
        detailTitle={(p) => `${p.name} · ${p.hn}`}
        searchPlaceholder="ค้นหา HN ชื่อ หอผู้ป่วย หรือการวินิจฉัย"
      />
    </div>
  );
}
