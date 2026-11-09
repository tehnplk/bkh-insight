"use client";

import { useState, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { RepFileRow, RepImportResult } from "@/app/api/fund/rep-import/route";
import { num } from "../_components/ui";
import { RepFileDetailView } from "./rep-file-detail";

type Status = RepImportResult["status"] | "pending";
type Item = Omit<RepImportResult, "status"> & { status: Status };

const chip = "rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";
const STATUS: Record<Status, { label: string; className: string }> = {
  pending: { label: "รอ", className: "border-line bg-surface-sunken text-muted" },
  imported: { label: "สำเร็จ", className: "border-success-line bg-success-soft text-success" },
  duplicate: { label: "นำเข้าแล้ว", className: "border-warning-line bg-warning-soft text-warning" },
  unsupported: { label: "ยังไม่รองรับ", className: "border-warning-line bg-warning-soft text-warning" },
  error: { label: "ไม่สำเร็จ", className: "border-danger-line bg-danger-soft text-danger" },
};
const SUMMARY_ORDER: Status[] = ["imported", "duplicate", "unsupported", "error"];

const dash = <span className="text-muted">–</span>;
const col = gridColumnHelper<RepFileRow>();
const columns = col.columns([
  col.accessor("file_date", { header: "วันที่ไฟล์", cell: (c) => (c.getValue() ? formatThaiDate(c.getValue()!) : dash), meta: { className: "whitespace-nowrap" } }),
  col.accessor("file_name", { header: "ชื่อไฟล์", meta: { className: "whitespace-nowrap" } }),
  col.accessor("rep_type", { header: "ประเภท", meta: { className: "whitespace-nowrap" } }),
  col.accessor("row_count", { header: "จำนวนแถว", cell: (c) => formatCount(c.getValue()), meta: { className: num } }),
  col.accessor("passed", { header: "ผ่าน", cell: (c) => (c.getValue() === null ? dash : formatCount(c.getValue()!)), meta: { className: num } }),
  col.accessor("failed", { header: "ไม่ผ่าน", cell: (c) => (c.getValue() === null ? dash : formatCount(c.getValue()!)), meta: { className: num } }),
  col.accessor("paid_total", { header: "ชดเชยรวม (บาท)", cell: (c) => (c.getValue() === null ? dash : formatBaht(Number(c.getValue()))), meta: { className: num } }),
  col.accessor("imported_at", {
    header: "นำเข้าเมื่อ",
    cell: (c) => `${formatThaiDate(c.getValue())} ${c.getValue().slice(11, 16)}`,
    meta: { className: "whitespace-nowrap tabular-nums" },
  }),
  col.accessor("imported_by", { header: "ผู้นำเข้า", cell: (c) => c.getValue() ?? dash, meta: { className: "whitespace-nowrap" } }),
]);

const renderDetail = (r: RepFileRow) => <RepFileDetailView id={r.id} />;
const detailTitle = (r: RepFileRow) => <span className="break-all">{r.file_name}</span>;

async function upload(file: File): Promise<RepImportResult> {
  const form = new FormData();
  form.append("file", file);
  const failed = (error: string): RepImportResult => ({ file: file.name, type: null, status: "error", rows: 0, reps: [], error });
  try {
    const res = await fetch("/api/fund/rep-import", { method: "POST", body: form });
    const body = await res.json().catch(() => null);
    return body?.status ? body : failed(body?.error ?? `นำเข้าไม่สำเร็จ (HTTP ${res.status})`);
  } catch {
    return failed("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  }
}

export function RepImport() {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [gridKey, setGridKey] = useState(0);

  // ส่งทีละไฟล์ตามลำดับ ให้เห็นผลรายไฟล์และ request ไม่ใหญ่
  async function importFiles(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length || busy) return;
    setBusy(true);
    setItems(files.map((f) => ({ file: f.name, type: null, status: "pending", rows: 0, reps: [] })));
    for (let i = 0; i < files.length; i++) {
      const r = await upload(files[i]);
      setItems((prev) => prev.map((it, j) => (j === i ? r : it)));
    }
    setBusy(false);
    setGridKey((k) => k + 1);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    importFiles(e.dataTransfer.files);
  }

  const done = items.filter((it) => it.status !== "pending").length;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="นำเข้าไฟล์ REP" className="flex flex-col gap-3 text-sm">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-5 transition-colors ${
            dragging ? "border-accent bg-accent-soft" : "border-line bg-surface"
          }`}
        >
          <label
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-accent px-3 font-medium text-accent-fg hover:bg-accent/90 has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:pointer-events-none has-disabled:opacity-40"
          >
            <Upload className="size-4" aria-hidden="true" />
            เลือกไฟล์ REP
            <input
              type="file"
              multiple
              accept=".xls"
              aria-label="เลือกไฟล์ REP"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                importFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <span className="text-muted">หรือลากไฟล์ .xls มาวางที่นี่</span>
        </div>

        {items.length > 0 && (
          <>
            <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
              <span className="font-semibold">
                {busy ? "กำลังนำเข้า" : "นำเข้าเสร็จ"} {formatCount(done)}/{formatCount(items.length)} ไฟล์
              </span>
              {SUMMARY_ORDER.map((s) => {
                const n = items.filter((it) => it.status === s).length;
                return n ? (
                  <span key={s} className="text-muted">
                    {/* ช่องว่างนำหน้าให้ screen reader อ่านแยกคำ (flex ตัดทิ้งตอนแสดง) */}
                    {" "}
                    {STATUS[s].label}<span className="font-semibold text-foreground">{formatCount(n)}</span>
                  </span>
                ) : null;
              })}
            </p>
            <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface">
              {items.map((it, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className={`${chip} ${STATUS[it.status].className}`}>
                    {it.status === "pending" && busy && i === done ? "กำลังนำเข้า" : STATUS[it.status].label}
                  </span>
                  <span className="min-w-0 truncate font-medium">{it.file}</span>
                  {it.status === "imported" && <span className="text-muted tabular-nums">{formatCount(it.rows)} แถว</span>}
                  {it.reps.length > 0 && (
                    <span className="min-w-0 truncate text-muted tabular-nums" title={it.reps.join(", ")}>
                      REP {it.reps.join(", ")}
                    </span>
                  )}
                  {it.status === "error" && <span className="text-danger">{it.error}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <DataGrid<RepFileRow> key={gridKey} endpoint="/api/fund/rep-import" columns={columns}
        getRowId={(r) => r.id}
        renderDetail={renderDetail}
        detailTitle={detailTitle}
        detailSize="medium"
      />
    </div>
  );
}
