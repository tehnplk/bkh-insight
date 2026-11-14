"use client";

import { useRef, useState } from "react";
import { RefreshCw, Upload } from "lucide-react";
import { DataGrid, gridColumnHelper, type DataGridProps } from "@/components/data-grid/data-grid";
import type { GridPage } from "@/lib/grid-query";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { ComparePage } from "@/app/api/catalog/service-catalog/route";
import { PROBLEMS, type CompareRow, type Problem } from "@/app/api/catalog/service-catalog/_lib/compare";
import type { DatasetInfo, ImportResult } from "@/app/api/catalog/service-catalog/_lib/server";
import type { UcItem } from "@/app/api/catalog/service-catalog/uc/route";
import type { OfcItem } from "@/app/api/catalog/service-catalog/ofc/route";
import type { StpItem } from "@/app/api/catalog/service-catalog/stp/route";
import { Money, btn, focusRing, num, useUrlParams } from "@/app/(app)/fund/_components/ui";
import { Segmented } from "@/app/(app)/quality/pending/segmented";

const API = "/api/catalog/service-catalog";
const TABS = [
  { value: "compare", label: "เทียบกับ HOSxP" },
  { value: "uc", label: "รายการ UC" },
  { value: "ofc", label: "อัตรา OFC" },
  { value: "stp", label: "รายการเคลม STP" },
] as const;
type Tab = (typeof TABS)[number]["value"];
const isTab = (v: string): v is Tab => TABS.some((t) => t.value === v);

const dash = <span className="text-muted">–</span>;
const noRate = <span className="text-muted">ไม่มีอัตรา</span>;
const textOr = (v: string | null) => v || dash;
const nowrap = { className: "whitespace-nowrap" };
const codeCell = { className: "whitespace-nowrap tabular-nums" };
const wrapCell = { className: "min-w-56" };
const dateFilter = { ...codeCell, filter: { format: (v: string) => formatThaiDate(v) || v } } as const;
const problemLabel = (v: string) => PROBLEMS[v as Problem]?.label ?? v;
const yesNo = (v: boolean | null) => (v == null ? dash : v ? "ใช้ได้" : <span className="text-muted">ไม่ได้</span>);
// รหัสต้นทางที่ไม่ใช่ตัวอักษร/ตัวเลขล้วน (เช่น "ต่อ 47050" ของกรมบัญชีกลาง) เทียบกับ HOSxP ไม่ได้
const isStdCode = (c: string) => /^[0-9A-Za-z.\-]+$/.test(c);

// ---------- columns (ประกาศนอก component ตามสัญญา DataGrid) ----------

const cc = gridColumnHelper<CompareRow>();
const compareColumns = cc.columns([
  cc.accessor("icode", { header: "icode", meta: codeCell }),
  cc.accessor("name", { header: "ชื่อรายการ", meta: wrapCell }),
  cc.accessor("adp_code", { header: "รหัส ADP", cell: (c) => textOr(c.getValue()), meta: codeCell }),
  cc.accessor("adp_type", { header: "ประเภท ADP", cell: (c) => c.getValue() ?? dash, enableSorting: false, meta: { ...codeCell, filter: true } }),
  cc.accessor("problem", { header: "ปัญหา", cell: (c) => problemLabel(c.getValue()), meta: { ...nowrap, filter: { format: problemLabel } } }),
  cc.accessor("detail", { header: "รายละเอียด", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: wrapCell }),
  cc.accessor((r) => PROBLEMS[r.problem].fix, { id: "fix", header: "วิธีแก้", enableSorting: false, meta: { className: "min-w-72 text-muted" } }),
  cc.accessor("uc_rate", { header: "อัตรา UC (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
  cc.accessor("ofc_rate", { header: "อัตรา OFC (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
]);

const uc = gridColumnHelper<UcItem>();
const ucColumns = uc.columns([
  uc.accessor("chrgitem_group", { header: "หมวด", cell: (c) => <span title={c.row.original.group_name ?? undefined}>{textOr(c.getValue())}</span>, meta: { ...codeCell, filter: true } }),
  uc.accessor("code", { header: "รหัสมาตรฐาน", cell: (c) => textOr(c.getValue()), meta: codeCell }),
  uc.accessor("name", { header: "ชื่อ", meta: wrapCell }),
  uc.accessor("price", { header: "อัตรา (บาท)", cell: (c) => (c.getValue() == null ? noRate : <Money value={c.getValue()} />), meta: { className: num } }),
  uc.accessor("unit", { header: "หน่วยนับ", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: { ...nowrap, filter: true } }),
  uc.accessor("start_date", { header: "วันที่เริ่มต้น", cell: (c) => formatThaiDate(c.getValue()) || dash, meta: dateFilter }),
  uc.accessor("end_date", { header: "วันที่สิ้นสุด", cell: (c) => formatThaiDate(c.getValue()) || dash, meta: dateFilter }),
  uc.accessor("fs_status", { header: "สถานะ", cell: (c) => textOr(c.row.original.fs_label), enableSorting: false, meta: { ...nowrap, filter: true } }),
]);

const oc = gridColumnHelper<OfcItem>();
const ofcColumns = oc.columns([
  oc.accessor("line_no", { header: "ลำดับ", meta: { className: num } }),
  oc.accessor("code", {
    header: "รหัส",
    cell: (c) => (isStdCode(c.getValue()) ? c.getValue() : <span title="รหัสไม่ใช่รูปแบบมาตรฐาน ใช้เทียบกับ HOSxP ไม่ได้" className="text-warning">{c.getValue()}</span>),
    meta: codeCell,
  }),
  oc.accessor("name", { header: "รายการ", cell: (c) => textOr(c.getValue()), meta: wrapCell }),
  oc.accessor("unit", { header: "หน่วย", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: { ...nowrap, filter: true } }),
  oc.accessor("price", { header: "อัตรา (บาท)", cell: (c) => (c.getValue() == null ? noRate : <Money value={c.getValue()} />), meta: { className: num } }),
  oc.accessor("remark", { header: "หมายเหตุ", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: { className: "min-w-80 text-muted" } }),
]);

const sc = gridColumnHelper<StpItem>();
const stpColumns = sc.columns([
  sc.accessor("sheet", { header: "กลุ่ม", meta: { ...nowrap, filter: true } }),
  sc.accessor("code", { header: "CODE", cell: (c) => textOr(c.getValue()), meta: codeCell }),
  sc.accessor("tmt_id", { header: "TMT_ID", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: codeCell }),
  sc.accessor("name", { header: "รายการ", meta: wrapCell }),
  sc.accessor("qty", { header: "QTY", cell: (c) => textOr(c.getValue()), enableSorting: false }),
  sc.accessor("rate", { header: "RATE (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
  sc.accessor("chrgitem_group", { header: "หมวด", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: { ...nowrap, filter: true } }),
  sc.accessor("adp_type", { header: "ADP TYPE/แฟ้ม", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: { ...codeCell, filter: true } }),
  sc.accessor("opd", { header: "OPD", cell: (c) => yesNo(c.getValue()), enableSorting: false, meta: { ...nowrap, filter: true } }),
  sc.accessor("ipd", { header: "IPD", cell: (c) => yesNo(c.getValue()), enableSorting: false, meta: { ...nowrap, filter: true } }),
  sc.accessor("use_status", { header: "USE_STATUS", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: codeCell }),
  sc.accessor("note", { header: "หมายเหตุ", cell: (c) => textOr(c.getValue()), enableSorting: false, meta: { className: "min-w-56 text-muted" } }),
]);

// ---------- ข้อมูลชุดที่นำเข้า ----------

function Dataset({ label, info }: { label?: string; info: DatasetInfo }) {
  return (
    <span>
      {label && `${label}: `}
      {info ? (
        <>
          {info.file_name} ({formatCount(info.row_count)} แถว) นำเข้า {formatThaiDate(info.imported_at)} {info.imported_at.slice(11, 16)} น.
          {info.imported_by && ` โดย ${info.imported_by}`}
        </>
      ) : (
        <span className="text-warning">ยังไม่ได้นำเข้า</span>
      )}
    </span>
  );
}

type ListPage<T> = GridPage<T> & { file: DatasetInfo };
const listSummary = ({ total, file }: ListPage<unknown>) => (
  <p className="text-muted tabular-nums">
    <span className="font-semibold text-foreground">{formatCount(total)}</span> รายการ
    <span aria-hidden="true"> · </span>
    <Dataset info={file} />
  </p>
);

// ---------- นำเข้า (admin) ----------

/** upload = เลือกไฟล์ Excel แล้ว POST multipart ; ไม่มี accept = ปุ่มให้ server ดึงข้อมูลเอง (POST ว่าง) */
function Importer({ endpoint, label, busyLabel, accept, fileLabel, hint, onDone }: {
  endpoint: string;
  label: string;
  busyLabel: string;
  accept?: string;
  fileLabel?: string;
  hint: string;
  onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ busy: boolean; result?: ImportResult }>({ busy: false });

  async function run(file?: File) {
    setState({ busy: true });
    let body: FormData | undefined;
    if (file) {
      body = new FormData();
      body.set("file", file);
    }
    const res = await fetch(endpoint, { method: "POST", body }).catch(() => null);
    const result: ImportResult = (await res?.json().catch(() => null)) ?? { status: "error", file: file?.name ?? "", errors: [`ไม่สำเร็จ${res ? ` (HTTP ${res.status})` : " (เชื่อมต่อไม่ได้)"}`] };
    setState({ busy: false, result });
    if (result.status === "imported") onDone();
    if (input.current) input.current.value = "";
  }

  const r = state.result;
  const Icon = accept ? Upload : RefreshCw;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {accept && (
          <input ref={input} type="file" accept={accept} aria-label={fileLabel} className="sr-only" onChange={(e) => e.target.files?.[0] && run(e.target.files[0])} />
        )}
        <button
          type="button"
          disabled={state.busy}
          onClick={() => (accept ? input.current?.click() : run())}
          className={`${btn} gap-1.5 disabled:cursor-wait disabled:opacity-60`}
        >
          <Icon aria-hidden className={`size-4 ${state.busy && !accept ? "animate-spin motion-reduce:animate-none" : ""}`} />
          {state.busy ? busyLabel : label}
        </button>
        <span className="text-xs text-muted">{hint}</span>
      </div>
      {r?.status === "imported" && (
        <p role="status" className="text-sm text-success">
          นำเข้า {r.file} แล้ว {formatCount(r.rows ?? 0)} แถว
        </p>
      )}
      {r && r.status !== "imported" && (
        <div role="alert" className={`text-sm ${r.status === "duplicate" ? "text-warning" : "text-danger"}`}>
          <p>
            {r.file ? `${r.file}: ` : ""}
            {r.errors?.[0] ?? "ไม่สำเร็จ"}
          </p>
          {r.status === "error" && (r.errors?.length ?? 0) > 1 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {r.errors!.slice(1).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- แท็บ ----------

function CompareTab() {
  const { cf, set } = useUrlParams(["cf"] as const);
  const selected = (() => {
    try {
      const v = JSON.parse(cf || "{}").problem;
      return Array.isArray(v) && v.length === 1 ? (v[0] as string) : null;
    } catch {
      return null;
    }
  })();
  // คลิกจำนวนของกฎ = ตัวกรองหัวคอลัมน์ "ปัญหา" ค่าเดียว (คลิกซ้ำ = ล้าง) คงตัวกรองคอลัมน์อื่นไว้
  function pick(p: Problem) {
    let other: Record<string, unknown> = {};
    try {
      other = JSON.parse(cf || "{}");
    } catch {}
    const next = { ...other, problem: selected === p ? undefined : [p] };
    const json = JSON.stringify(next);
    set({ cf: json === "{}" ? null : json });
  }
  const renderSummary = ({ total, summary: s }: ComparePage) => (
    <div className="flex flex-col gap-2 text-muted">
      <p className="tabular-nums">
        <span className="font-semibold text-foreground">{formatCount(total)}</span> ปัญหา ใน {formatCount(s.affected)} จาก {formatCount(s.items)} รายการค่าบริการที่ใช้งาน
      </p>
      <p className="text-xs">
        <Dataset label="UC" info={s.uc} />
        <span aria-hidden="true"> · </span>
        <Dataset label="OFC" info={s.ofc} />
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
            {PROBLEMS[p].label}
            <span className="font-semibold tabular-nums text-foreground">{formatCount(s.counts[p])}</span>
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <DataGrid<CompareRow, ComparePage>
      endpoint={API}
      columns={compareColumns}
      getRowId={(r) => r.key}
      renderSummary={renderSummary}
      exportPlacement="summary"
      hideable
    />
  );
}

type ImporterProps = Parameters<typeof Importer>[0];

/** ตารางรายการอ้างอิงหนึ่งชุด + ส่วนนำเข้า (admin) นำเข้าสำเร็จแล้วโหลดตารางใหม่ */
function ListTab<T extends object>({ endpoint, columns, getRowId, importer }: {
  endpoint: string;
  columns: DataGridProps<T, ListPage<T>>["columns"];
  getRowId: (row: T) => string;
  importer?: Omit<ImporterProps, "endpoint" | "onDone">;
}) {
  const [key, setKey] = useState(0);
  return (
    <div className="flex flex-col gap-4">
      {importer && <Importer endpoint={endpoint} {...importer} onDone={() => setKey((k) => k + 1)} />}
      <DataGrid<T, ListPage<T>> key={key} endpoint={endpoint} columns={columns} getRowId={getRowId} renderSummary={listSummary} exportPlacement="summary" hideable />
    </div>
  );
}

/** canImport: ผู้ดูแลระบบนำเข้า/ดึงข้อมูลได้ (API เช็ค role ซ้ำ) ผู้ใช้อื่นดูอย่างเดียว */
export function ServiceCatalog({ canImport }: { canImport: boolean }) {
  const { tab, set } = useUrlParams(["tab", "q", "sort", "dir", "cf"] as const);
  const current: Tab = isTab(tab) ? tab : "compare";
  const upload = { accept: ".xls,.xlsx", busyLabel: "กำลังนำเข้า…" };
  return (
    <div className="flex flex-col gap-5">
      {/* เปลี่ยนแท็บ = ล้างคำค้น sort และตัวกรองคอลัมน์ของ DataGrid (set ล้าง page ให้แล้ว) เพราะคนละตาราง */}
      <Segmented label="ชุดข้อมูล" options={TABS} value={current} onChange={(t) => set({ tab: t === "compare" ? null : t, q: null, sort: null, dir: null, cf: null })} />
      {current === "compare" && <CompareTab />}
      {current === "uc" && (
        <ListTab<UcItem>
          endpoint={`${API}/uc`}
          columns={ucColumns}
          getRowId={(r) => String(r.line_no)}
          importer={canImport ? { ...upload, fileLabel: "ไฟล์ Service catalog ที่ export จากระบบของ สปสช.", label: "นำเข้าไฟล์ Service catalog (.xlsx)", hint: "ไฟล์ export จากระบบของ สปสช. นำเข้าใหม่จะแทนที่รายการเดิมทั้งหมด" } : undefined}
        />
      )}
      {current === "ofc" && (
        <ListTab<OfcItem>
          endpoint={`${API}/ofc`}
          columns={ofcColumns}
          getRowId={(r) => String(r.line_no)}
          importer={canImport ? { label: "ดึงจากกรมบัญชีกลาง", busyLabel: "กำลังดึงข้อมูล…", hint: "ดึงอัตราทั้งหมดจาก mbdb.cgd.go.th แทนที่รายการเดิม" } : undefined}
        />
      )}
      {current === "stp" && (
        <ListTab<StpItem>
          endpoint={`${API}/stp`}
          columns={stpColumns}
          getRowId={(r) => `${r.sheet}:${r.line_no}`}
          importer={canImport ? { ...upload, fileLabel: "ไฟล์หมวดรายการเบิกจ่าย 19 หมวด กองทุนบุคคลที่มีปัญหาสถานะและสิทธิ", label: "นำเข้าไฟล์หมวดรายการเบิกจ่าย (.xlsx)", hint: "ไฟล์หมวดรายการเบิกจ่าย 19 หมวด ของกองทุน STP นำเข้าใหม่จะแทนที่รายการเดิมทั้งหมด" } : undefined}
        />
      )}
    </div>
  );
}
