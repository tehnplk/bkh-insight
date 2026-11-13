"use client";

import { createContext, useContext, useState, useTransition, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { ThaiDatePicker } from "@/components/thai-date-picker/thai-date-picker";
import { formatBaht, formatCount } from "@/lib/number-format";
import { THAI_MONTHS_SHORT, formatThaiDate, todayIso } from "@/lib/thai-date";
import type { StmFileRow, StmImportResult } from "@/app/api/fund/stm-import/route";
import type { StmPeriod } from "@/app/api/fund/stm-import/periods/route";
import { Skeleton, num, useJson } from "../_components/ui";
import { SCHEMES, periodLabel } from "./labels";
import { StmFileDetailView } from "./stm-file-detail";

type Status = StmImportResult["status"] | "pending";
type Item = Omit<StmImportResult, "status"> & { status: Status };

const chip = "rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";
const STATUS: Record<Status, { label: string; className: string }> = {
  pending: { label: "รอ", className: "border-line bg-surface-sunken text-muted" },
  imported: { label: "นำเข้าแล้ว", className: "border-success-line bg-success-soft text-success" },
  duplicate: { label: "ซ้ำ", className: "border-warning-line bg-warning-soft text-warning" },
  unsupported: { label: "ไม่รองรับ", className: "border-warning-line bg-warning-soft text-warning" },
  error: { label: "ไม่สำเร็จ", className: "border-danger-line bg-danger-soft text-danger" },
};
const SUMMARY_ORDER: Status[] = ["imported", "duplicate", "unsupported", "error"];

const dash = <span className="text-muted">–</span>;
const money = (v: string) => formatBaht(Number(v));

// ลบแล้วให้ตารางไฟล์และงวดที่นำเข้าโหลดใหม่ (ค่าจาก StmImport)
const Changed = createContext<() => void>(() => {});

const col = gridColumnHelper<StmFileRow>();
const baseColumns = [
  col.accessor("period_month", {
    header: "งวด",
    cell: (c) => (
      <>
        {periodLabel(c.getValue())}
        <span className="text-muted"> ครั้งที่ {c.row.original.run_no}</span>
      </>
    ),
    meta: { className: "whitespace-nowrap tabular-nums", filter: { format: periodLabel } },
  }),
  col.accessor("scheme", { header: "สิทธิ", cell: (c) => SCHEMES[c.getValue()] ?? c.getValue(), meta: { filter: { format: (v) => SCHEMES[v] ?? v } } }),
  col.accessor("patient_type", { header: "OP/IP", meta: { filter: true } }),
  col.accessor("doc_no", { header: "เลขที่เอกสาร", meta: { className: "whitespace-nowrap", filter: true } }),
  col.accessor("transfer_date", { header: "วันที่โอน", cell: (c) => formatThaiDate(c.getValue()), meta: { className: "whitespace-nowrap tabular-nums", filter: { format: (v) => formatThaiDate(v) || v } } }),
  col.accessor("row_count", { header: "จำนวนรายการ", cell: (c) => formatCount(c.getValue()), meta: { className: num, filter: true } }),
  col.accessor("paid_total", { header: "ยอดชดเชย (บาท)", cell: (c) => money(c.getValue()), meta: { className: num } }),
  col.accessor("deduction", { header: "หัก (บาท)", cell: (c) => money(c.getValue()), meta: { className: num } }),
  col.accessor("net_total", { header: "ยอดโอนสุทธิ (บาท)", cell: (c) => money(c.getValue()), meta: { className: `${num} font-semibold` } }),
  col.accessor("imported_by", { header: "ผู้นำเข้า", cell: (c) => c.getValue() ?? dash, meta: { className: "whitespace-nowrap", filter: true } }),
  col.accessor("imported_at", {
    header: "เวลา",
    cell: (c) => `${formatThaiDate(c.getValue())} ${c.getValue().slice(11, 16)}`,
    meta: { className: "whitespace-nowrap tabular-nums", filter: { format: (v) => formatThaiDate(v) || v } },
  }),
];
const columns = col.columns(baseColumns);
const adminColumns = col.columns([
  ...baseColumns,
  col.display({
    id: "delete",
    // relative: sr-only เป็น absolute ถ้าไม่มี containing block ในกรอบเลื่อนของตาราง จะหลุดออกไปทำให้ทั้งหน้าเลื่อนแนวนอนบนจอแคบ
    header: () => <span className="relative"><span className="sr-only">ลบไฟล์</span></span>,
    cell: (c) => <DeleteFile row={c.row.original} />,
    meta: { className: "text-right" },
  }),
]);

const renderDetail = (r: StmFileRow) => <StmFileDetailView id={r.id} />;
const detailTitle = (r: StmFileRow) => <span className="break-all">{r.doc_no}</span>;

const smallBtn = "inline-flex h-7 items-center rounded-md border px-2.5 font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50";

// ลบสองจังหวะ: กดลบแล้วต้องกดยืนยันอีกครั้ง เพราะลบรายการทั้งไฟล์และกู้คืนไม่ได้ (นำเข้าใหม่ได้)
function DeleteFile({ row }: { row: StmFileRow }) {
  const changed = useContext(Changed);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/fund/stm-import?${new URLSearchParams({ id: row.id })}`, { method: "DELETE" }).catch(() => null);
      if (!res?.ok) {
        const body = await res?.json().catch(() => null);
        setError(body?.error ?? (res ? `ลบไม่สำเร็จ (HTTP ${res.status})` : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"));
        setConfirming(false);
        return;
      }
      changed();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span role="alert" className="text-danger">{error}</span>}
      {confirming ? (
        <>
          <button type="button" disabled={pending} onClick={remove} aria-label={`ยืนยันลบ ${row.doc_no}`} className={`${smallBtn} border-transparent bg-danger text-accent-fg hover:bg-danger/90`}>
            ยืนยันลบ
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={`${smallBtn} border-line bg-surface text-foreground hover:bg-hover`}>
            ยกเลิก
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} aria-label={`ลบ ${row.doc_no}`} className={`${smallBtn} border-line bg-surface text-danger hover:bg-hover`}>
          ลบ
        </button>
      )}
    </span>
  );
}

// ---------- งวดที่นำเข้าแล้ว ----------

const FY_MONTHS = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const BASE_ROWS = ["UCS|OP", "UCS|IP", "OFC|OP", "OFC|IP"];
const fiscalYear = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return m >= 10 ? y + 1 : y; // ค.ศ. ของปีงบ (ต.ค.–ก.ย.)
};

/** ตารางเล็กต่อปีงบ: แถว = สิทธิ × OP/IP, คอลัมน์ = เดือน, ช่อง = ครั้งที่ที่นำเข้าแล้ว เดือนที่ผ่านไปแล้วแต่ยังไม่มีไฟล์ = ขาด */
function StmPeriods() {
  const { loading, data, error } = useJson<StmPeriod[]>("/api/fund/stm-import/periods");
  if (loading) return <Skeleton rows={3} />;
  if (error || !data) return <p role="alert" className="text-sm text-danger">โหลดงวดที่นำเข้าไม่สำเร็จ {error}</p>;
  if (!data.length) return null;

  const thisMonth = todayIso().slice(0, 7);
  const runs = new Map(data.map((p) => [`${p.scheme}|${p.patient_type}|${p.period_month.slice(0, 7)}`, p.runs]));
  const kinds = [...new Set([...BASE_ROWS, ...data.map((p) => `${p.scheme}|${p.patient_type}`)])];
  const years = [...new Set(data.map((p) => fiscalYear(p.period_month)))].sort((a, b) => b - a);

  return (
    <section aria-labelledby="stm-periods" className="flex flex-col gap-3 text-sm">
      <h2 id="stm-periods" className="text-title">งวดที่นำเข้าแล้ว</h2>
      {years.map((fy) => (
        <div key={fy} className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse tabular-nums">
            <caption className="px-3 pt-2 text-left font-semibold">ปีงบประมาณ {fy + 543}</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-left font-medium whitespace-nowrap">สิทธิ</th>
                {FY_MONTHS.map((m) => (
                  <th key={m} scope="col" className="px-2 py-1.5 text-center font-medium whitespace-nowrap">{THAI_MONTHS_SHORT[m - 1]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {kinds.map((k) => {
                const [scheme, type] = k.split("|");
                return (
                  <tr key={k} className="border-t border-line">
                    <th scope="row" className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{SCHEMES[scheme] ?? scheme} {type}</th>
                    {FY_MONTHS.map((m) => {
                      const ym = `${m >= 10 ? fy - 1 : fy}-${String(m).padStart(2, "0")}`;
                      const got = runs.get(`${k}|${ym}`);
                      const label = `${SCHEMES[scheme] ?? scheme} ${type} ${periodLabel(`${ym}-01`)}`;
                      if (got)
                        return (
                          <td key={m} className="px-2 py-1.5 text-center whitespace-nowrap" aria-label={`${label} ครั้งที่ ${got.join(", ")}`}>
                            {got.join(" ")}
                          </td>
                        );
                      const missing = ym < thisMonth;
                      return (
                        <td key={m} className={`px-2 py-1.5 text-center ${missing ? "bg-warning-soft text-warning" : "text-muted"}`} aria-label={`${label} ${missing ? "ยังไม่มีไฟล์" : "ยังไม่ถึงงวด"}`}>
                          {missing ? "ขาด" : ""}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

// ---------- นำเข้า ----------

async function upload(file: File, transferDate: string): Promise<StmImportResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("transfer_date", transferDate);
  const failed = (error: string): StmImportResult => ({ file: file.name, docNo: null, status: "error", rows: 0, netTotal: null, error });
  try {
    const res = await fetch("/api/fund/stm-import", { method: "POST", body: form });
    const body = await res.json().catch(() => null);
    return body?.status ? body : failed(body?.error ?? `นำเข้าไม่สำเร็จ (HTTP ${res.status})`);
  } catch {
    return failed("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  }
}

export function StmImport({ admin }: { admin: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [key, setKey] = useState(0);
  const [today] = useState(todayIso);
  const [transferDate, setTransferDate] = useState(today);
  // วันที่โอนต้องเลือกเองทุกรอบ ค่าเริ่มต้น (วันนี้) ยังไม่นับ กันลืมแล้วบันทึกวันผิดทั้งรอบ
  const [dateChosen, setDateChosen] = useState(false);
  const [needDate, setNeedDate] = useState(false);

  // ส่งทีละไฟล์ตามลำดับ ให้เห็นผลรายไฟล์และ request ไม่ใหญ่
  async function importFiles(list: FileList | null) {
    const files = [...(list ?? [])];
    if (!files.length || busy) return;
    if (!dateChosen) {
      setNeedDate(true);
      return;
    }
    setBusy(true);
    setItems(files.map((f) => ({ file: f.name, docNo: null, status: "pending", rows: 0, netTotal: null })));
    for (let i = 0; i < files.length; i++) {
      const r = await upload(files[i], transferDate);
      setItems((prev) => prev.map((it, j) => (j === i ? r : it)));
    }
    setBusy(false);
    setDateChosen(false);
    setKey((k) => k + 1);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    importFiles(e.dataTransfer.files);
  }

  const done = items.filter((it) => it.status !== "pending").length;

  return (
    <Changed value={() => setKey((k) => k + 1)}>
      <div className="flex flex-col gap-8">
        <section aria-label="นำเข้าไฟล์ STM" className="flex flex-col gap-3 text-sm">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-dashed px-4 py-5 transition-colors ${
              dragging ? "border-accent bg-accent-soft" : "border-line bg-surface"
            }`}
          >
            <ThaiDatePicker
              label="วันที่โอน"
              value={transferDate}
              max={today}
              onChange={(v) => {
                setTransferDate(v);
                setDateChosen(true);
                setNeedDate(false);
              }}
            />
            <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-accent px-3 font-medium text-accent-fg hover:bg-accent/90 has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:pointer-events-none has-disabled:opacity-40">
              <Upload className="size-4" aria-hidden="true" />
              เลือกไฟล์ STM
              <input
                type="file"
                multiple
                accept=".xls"
                aria-label="เลือกไฟล์ STM"
                aria-describedby={dateChosen ? undefined : "stm-date-hint"}
                className="sr-only"
                disabled={busy || !dateChosen}
                onChange={(e) => {
                  importFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {dateChosen ? (
              <span className="text-muted">หรือลากไฟล์ .xls มาวางที่นี่</span>
            ) : (
              <span id="stm-date-hint" role={needDate ? "alert" : undefined} className={needDate ? "text-danger" : "text-warning"}>
                เลือกวันที่โอนก่อนนำเข้า
              </span>
            )}
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
                      {STATUS[s].label} <span className="font-semibold text-foreground">{formatCount(n)}</span>
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
                    {it.docNo && <span className="text-muted">{it.docNo}</span>}
                    {it.status === "imported" && (
                      <span className="text-muted tabular-nums">
                        {formatCount(it.rows)} รายการ ยอดโอนสุทธิ {formatBaht(it.netTotal ?? 0)} บาท
                      </span>
                    )}
                    {it.error && it.status !== "imported" && <span className={it.status === "error" ? "text-danger" : "text-muted"}>{it.error}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <StmPeriods key={`p${key}`} />

        <DataGrid<StmFileRow>
          key={`g${key}`}
          endpoint="/api/fund/stm-import"
          columns={admin ? adminColumns : columns}
          getRowId={(r) => r.id}
          renderDetail={renderDetail}
          detailTitle={detailTitle}
          detailSize="medium"
        />
      </div>
    </Changed>
  );
}
