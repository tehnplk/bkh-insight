"use client";

import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { LabComparePage } from "@/app/api/catalog/lab-fdh/compare/route";
import { PROBLEMS, type CompareRow, type Level, type Problem } from "@/app/api/catalog/lab-fdh/compare/compare";
import { Money, focusRing, num, useUrlParams } from "@/app/(app)/fund/_components/ui";

const API = "/api/catalog/lab-fdh/compare";
const dash = <span className="text-muted">–</span>;
const textOr = (v: string | null) => v || dash;
const nowrap = { className: "whitespace-nowrap" };
const codeCell = { className: "whitespace-nowrap tabular-nums" };
const wrapCell = { className: "min-w-56" };
const problemLabel = (v: string) => PROBLEMS[v as Problem]?.label ?? v;
// ชื่อปัญหาบอกความหมายอยู่แล้ว สีแค่ช่วยไล่ดูระดับ
const TONE: Record<Level, string> = { error: "text-danger", warn: "text-warning", info: "" };

const cc = gridColumnHelper<CompareRow>();
const columns = cc.columns([
  cc.accessor("code", { header: "Lab Code", meta: codeCell }),
  cc.accessor("name", { header: "ชื่อรายการ", meta: wrapCell }),
  cc.accessor("problem", {
    header: "ปัญหา",
    cell: (c) => <span className={TONE[c.row.original.level]}>{problemLabel(c.getValue())}</span>,
    meta: { ...nowrap, filter: { format: problemLabel } },
  }),
  cc.accessor("detail", { header: "รายละเอียด", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: wrapCell }),
  cc.accessor((r) => PROBLEMS[r.problem].fix, { id: "fix", header: "วิธีแก้", enableSorting: false, meta: { className: "min-w-72 text-muted" } }),
  cc.accessor("plans", { header: "สิทธิประโยชน์", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: { ...nowrap, filter: true } }),
  cc.accessor("tmlt_his", { header: "TMLT HOSxP", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: codeCell }),
  cc.accessor("tmlt_cat", { header: "TMLT catalog", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: codeCell }),
  cc.accessor("cgd_his", { header: "รหัส ADP HOSxP", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: codeCell }),
  cc.accessor("cgd_cat", { header: "รหัสกรมบัญชีกลาง catalog", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: codeCell }),
  cc.accessor("cat_price", { header: "ราคากลาง (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
  cc.accessor("ofc_price", { header: "ราคาข้าราชการ HOSxP (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
]);

/** ปัญหาของ Lab Catalog FDH เทียบ HOSxP (คลิกจำนวนของปัญหา = กรองหัวคอลัมน์ "ปัญหา" เหมือน /catalog/service-catalog) */
export function LabCompare() {
  const { cf, set } = useUrlParams(["cf"] as const);
  const selected = (() => {
    try {
      const v = JSON.parse(cf || "{}").problem;
      return Array.isArray(v) && v.length === 1 ? (v[0] as string) : null;
    } catch {
      return null;
    }
  })();
  // คลิกซ้ำ = ล้าง ; คงตัวกรองคอลัมน์อื่นไว้
  function pick(p: Problem) {
    let other: Record<string, unknown> = {};
    try {
      other = JSON.parse(cf || "{}");
    } catch {}
    const json = JSON.stringify({ ...other, problem: selected === p ? undefined : [p] });
    set({ cf: json === "{}" ? null : json });
  }
  const renderSummary = ({ total, summary: s }: LabComparePage) =>
    !s.file ? (
      <p className="text-warning">ยังไม่ได้นำเข้า Lab Catalog จึงยังเทียบกับ HOSxP ไม่ได้</p>
    ) : (
      <div className="flex flex-col gap-2 text-muted">
        <p className="tabular-nums">
          <span className="font-semibold text-foreground">{formatCount(total)}</span> ปัญหา ใน {formatCount(s.affected)} รหัส
          <span aria-hidden="true"> · </span>
          รายการ Lab ใน HOSxP {formatCount(s.his)}
          <span aria-hidden="true"> · </span>
          Lab Code ใน catalog {formatCount(s.catalog)}
        </p>
        <p className="text-xs">
          ไฟล์ {s.file.file_name} นำเข้า {formatThaiDate(s.file.imported_at)} {s.file.imported_at.slice(11, 16)} น.
        </p>
        <div role="group" aria-label="กรองตามปัญหา" className="flex flex-wrap gap-1.5">
          {(Object.keys(PROBLEMS) as Problem[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={selected === p}
              onClick={() => pick(p)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-sm ${focusRing} ${
                selected === p ? "border-accent-line bg-accent-soft text-accent-text" : "border-line bg-surface hover:bg-hover"
              }`}
            >
              <span className={selected === p ? "" : TONE[PROBLEMS[p].level]}>{PROBLEMS[p].label}</span>
              <span className="font-semibold tabular-nums text-foreground">{formatCount(s.counts[p])}</span>
            </button>
          ))}
        </div>
      </div>
    );
  return (
    <DataGrid<CompareRow, LabComparePage>
      endpoint={API}
      columns={columns}
      getRowId={(r) => r.key}
      renderSummary={renderSummary}
      exportPlacement="summary"
      fitScreen
      pinColumns={2}
      reorderable
      hideable
    />
  );
}
