"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import type { GridPage } from "@/lib/grid-query";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { CatalogFileInfo, DrugNhsoImportResult, DrugNhsoItem } from "@/app/api/catalog/drug-nhso/drug-nhso";
import { Money, Notice, btn, num, useUrlParams } from "@/app/(app)/fund/_components/ui";
import { Segmented } from "@/app/(app)/quality/pending/segmented";

const TABS = [
  { value: "drug-nhso", label: "Drug catalog สปสช." },
  { value: "drug-chi", label: "Drug catalog สกส." },
  { value: "lab-chi", label: "Lab catalog สกส." },
] as const;
type Tab = (typeof TABS)[number]["value"];
const isTab = (v: string): v is Tab => TABS.some((t) => t.value === v);

const dash = <span className="text-muted">–</span>;
const nowrap = { className: "whitespace-nowrap" };
const dateCell = { className: "whitespace-nowrap tabular-nums" };
const textOr = (v: string | null) => v || dash;

const col = gridColumnHelper<DrugNhsoItem>();
// ตัวกรองหัวคอลัมน์จาก /api/catalog/drug-nhso?facet=<id> (ยกเว้นราคา)
const filterable = { ...nowrap, filter: true } as const;
const codeFilter = { ...dateCell, filter: true } as const;
const dateFilter = { ...dateCell, filter: { format: (v: string) => formatThaiDate(v) || v } } as const;
const columns = col.columns([
  col.accessor("hosp_drug_code", { header: "HOSPDRUGCODE", meta: codeFilter }),
  col.accessor("tmt_id", { header: "TMTID", cell: (c) => textOr(c.getValue()), meta: codeFilter }),
  col.accessor("generic_name", { header: "GENERICNAME", cell: (c) => textOr(c.getValue()), meta: { filter: true } }),
  col.accessor("trade_name", { header: "TRADENAME", cell: (c) => textOr(c.getValue()), meta: { filter: true } }),
  col.accessor("dosage_form", { header: "DOSAGEFORM", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: filterable }),
  col.accessor("strength", { header: "STRENGTH", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: filterable }),
  col.accessor("content", { header: "CONTENT", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: filterable }),
  col.accessor("unit_price", { header: "UNITPRICE (บาท)", cell: (c) => (c.getValue() == null ? dash : <Money value={Number(c.getValue())} />), meta: { className: num } }),
  col.accessor("ised", { header: "ISED", cell: (c) => textOr(c.getValue()), meta: filterable }),
  col.accessor("ised_approved", { header: "ISED_APPROVED", cell: (c) => textOr(c.getValue()), meta: filterable }),
  col.accessor("update_flag", { header: "UPDATEFLAG", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: filterable }),
  col.accessor("date_effective", { header: "DATEEFFECTIVE", cell: (c) => formatThaiDate(c.getValue()) || dash, meta: dateFilter }),
  col.accessor("date_approved", { header: "DATE_APPROVED", cell: (c) => formatThaiDate(c.getValue()) || dash, meta: dateFilter }),
  col.accessor("ised_status", { header: "ISED_STATUS", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: filterable }),
  col.accessor("versions", { header: "แถวในไฟล์", cell: (c) => formatCount(c.getValue()), meta: { className: num, filter: true } }),
]);

type DrugPage = GridPage<DrugNhsoItem> & { file: CatalogFileInfo };
const renderSummary = ({ total, file }: DrugPage) => (
  <p className="text-muted tabular-nums">
    <span className="font-semibold text-foreground">{formatCount(total)}</span> รายการยา
    {file && (
      <>
        <span aria-hidden="true"> · </span>
        ไฟล์ {file.file_name} ({formatCount(file.row_count)} แถว) นำเข้า {formatThaiDate(file.imported_at)} {file.imported_at.slice(11, 16)} น.
        {file.imported_by && ` โดย ${file.imported_by}`}
      </>
    )}
  </p>
);

/** อัปโหลดไฟล์ APPROVED ของ สปสช. (ไฟล์ใหม่แทนที่ชุดเดิมทั้งหมด) */
function DrugNhsoUpload({ onImported }: { onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ busy: boolean; result?: DrugNhsoImportResult }>({ busy: false });

  async function upload(file: File) {
    setState({ busy: true });
    const form = new FormData();
    form.set("file", file);
    const res = await fetch("/api/catalog/drug-nhso", { method: "POST", body: form }).catch(() => null);
    const result: DrugNhsoImportResult = (await res?.json().catch(() => null)) ?? { status: "error", file: file.name, errors: [`นำเข้าไม่สำเร็จ${res ? ` (HTTP ${res.status})` : ""}`] };
    setState({ busy: false, result });
    if (result.status === "imported") onImported();
    if (input.current) input.current.value = "";
  }

  const r = state.result;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          accept=".xls,.xlsx"
          aria-label="ไฟล์ Drug catalog ที่อนุมัติแล้วของ สปสช."
          className="sr-only"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        <button type="button" disabled={state.busy} onClick={() => input.current?.click()} className={`${btn} gap-1.5 disabled:cursor-wait disabled:opacity-60`}>
          <Upload aria-hidden className="size-4" />
          {state.busy ? "กำลังนำเข้า…" : "นำเข้าไฟล์ APPROVED (.xls)"}
        </button>
        <span className="text-xs text-muted">ไฟล์จาก drug.nhso.go.th นำเข้าใหม่จะแทนที่รายการเดิมทั้งหมด</span>
      </div>
      {r?.status === "imported" && (
        <p role="status" className="text-sm text-success">
          นำเข้า {r.file} แล้ว {formatCount(r.rows ?? 0)} แถว ({formatCount(r.items ?? 0)} รายการยา)
        </p>
      )}
      {r && r.status !== "imported" && (
        <div role="alert" className={`text-sm ${r.status === "duplicate" ? "text-warning" : "text-danger"}`}>
          <p>
            {r.file ? `${r.file}: ` : ""}
            {r.status === "duplicate" ? "ไฟล์นี้นำเข้าแล้ว" : "นำเข้าไม่สำเร็จ"}
          </p>
          {r.status === "error" && !!r.errors?.length && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {r.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function DrugNhsoTab({ canImport }: { canImport: boolean }) {
  const [gridKey, setGridKey] = useState(0);
  return (
    <div className="flex flex-col gap-4">
      {canImport && <DrugNhsoUpload onImported={() => setGridKey((k) => k + 1)} />}
      <DataGrid<DrugNhsoItem, DrugPage>
        key={gridKey}
        endpoint="/api/catalog/drug-nhso"
        columns={columns}
        getRowId={(r) => r.hosp_drug_code}
        renderSummary={renderSummary}
        exportPlacement="summary"
        reorderable
        hideable
        fitScreen
        pinColumns={3}
      />
    </div>
  );
}

/** canImport: ผู้ดูแลระบบนำเข้าไฟล์ได้ (API เช็ค role ซ้ำ) ผู้ใช้อื่นดูอย่างเดียว */
export function Mapcode({ canImport }: { canImport: boolean }) {
  const { tab, set } = useUrlParams(["tab", "q", "sort", "dir"] as const);
  const current: Tab = isTab(tab) ? tab : "drug-nhso";
  return (
    <div className="flex flex-col gap-5">
      {/* เปลี่ยนแท็บ = ล้างคำค้นและ sort ของ DataGrid (set ล้าง page ให้แล้ว) เพราะคนละตาราง */}
      <Segmented label="ชนิดรหัสมาตรฐาน" options={TABS} value={current} onChange={(t) => set({ tab: t === "drug-nhso" ? null : t, q: null, sort: null, dir: null })} />
      {current === "drug-nhso" ? (
        <DrugNhsoTab canImport={canImport} />
      ) : (
        <Notice title="ยังไม่รองรับการนำเข้า" detail="รอไฟล์ตัวอย่างจริงเพื่อตรวจหัวคอลัมน์ก่อนเขียนตัวนำเข้า" />
      )}
    </div>
  );
}
