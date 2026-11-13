"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  columnFilteringFeature,
  createColumnHelper,
  createExpandedRowModel,
  globalFilteringFeature,
  metaHelper,
  rowExpandingFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { DetailModal, type DetailModalProps } from "@/components/detail-modal/detail-modal";
import { STORAGE_USER_EVENT, storageUser } from "@/lib/persisted-filter";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, type GridPage } from "@/lib/grid-query";

const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  /** className ใส่ให้ทั้ง th และ td เช่น "text-right" สำหรับตัวเลข */
  columnMeta: metaHelper<{ className?: string }>(),
  /** cell เรียก info.table.options.meta?.reload() ให้โหลดหน้าปัจจุบันใหม่ เช่น หลังปุ่มในแถวแก้ข้อมูล */
  tableMeta: metaHelper<{ reload: () => void }>(),
});

/** ใช้สร้าง columns ให้ DataGrid: const col = gridColumnHelper<Row>(); col.columns([col.accessor("hn", { header: "HN" })]) */
export const gridColumnHelper = <T extends RowData>() => createColumnHelper<typeof features, T>();

/** R = ชนิดของ response ทั้งก้อน ใช้เมื่อ endpoint ส่ง field เพิ่มจาก { rows, total } (เช่น summary) ให้ renderSummary */
export type DataGridProps<T extends RowData, R extends GridPage<T> = GridPage<T>> = {
  /** API ตามสัญญาใน src/lib/grid-query.ts */
  endpoint: string;
  /** id (หรือ accessor key) ของคอลัมน์ = ชื่อที่ส่งเป็น sort ถ้า server ไม่ให้ sort ให้ใส่ enableSorting: false
   *  ต้องเป็นค่าคงที่ (ประกาศนอก component) ไม่สร้างใหม่ทุก render */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- แต่ละคอลัมน์มีชนิดค่าต่างกัน เหมือน helper.columns() ของ TanStack
  columns: ColumnDef<typeof features, T, any>[];
  getRowId: (row: T) => string;
  /** ค่าที่ส่งไป endpoint เพิ่ม เช่น filter ของหน้า { vstdate: "2026-11-04" } ใช้ทั้งตอนโหลดและส่งออก Excel ค่าว่างไม่ส่ง */
  params?: Record<string, string>;
  /** control ของหน้า (เช่น วันที่ สิทธิ) วางในแถวเดียวกับช่องค้นหา ก่อนช่องค้นหา ใช้ h-9 ให้สูงเท่ากัน */
  filters?: ReactNode;
  renderDetail?: (row: T) => ReactNode;
  detailMode?: "modal" | "expand";
  /** หัวข้อของ modal */
  detailTitle?: (row: T) => ReactNode;
  /** ขนาดของ modal (detailMode="modal") ค่าเริ่มต้นเหมือน DetailModal */
  detailSize?: DetailModalProps["size"];
  /** param อื่นใน URL ที่ส่งต่อให้ endpoint และไฟล์ Excel ด้วย (filter ของหน้า เช่น ["date"]) route ต้อง validate เอง
   *  ตัวที่เปลี่ยน filter ควรลบ page ออกจาก URL เพื่อกลับไปหน้าแรก */
  filterKeys?: readonly string[];
  /** control ของหน้า (เช่น ตัวเลือกวันที่) แสดงในแถวเดียวกับช่องค้นหา ขึ้นบรรทัดใหม่เองบนจอแคบ */
  toolbar?: ReactNode;
  /** ค้นหาทันทีระหว่างพิมพ์ (หน่วง SEARCH_DEBOUNCE_MS) แทนการกดปุ่มค้นหา ข้อความสั้นกว่า LIVE_MIN_CHARS ยังไม่ยิง request
   *  (กด Enter เพื่อค้นทันที) Esc หรือลบจนว่างเป็นการล้างการค้นหา */
  liveSearch?: boolean;
  /** แถบสรุประหว่าง toolbar กับตาราง รับ response ล่าสุดทั้งก้อน (ระหว่างโหลดแสดงค่าเดิมแบบจาง) ไม่ส่ง = ไม่มีแถบ */
  renderSummary?: (data: R) => ReactNode;
  /** ตำแหน่งปุ่มส่งออก Excel: "toolbar" (ค่าเริ่มต้น ชิดขวาแถวช่องค้นหา) หรือ "summary" (ชิดขวาแถบสรุป ใช้ได้เมื่อมี renderSummary ไม่มีจะกลับไปอยู่ toolbar) */
  exportPlacement?: "toolbar" | "summary";
  /** ปุ่มเพิ่มเติมวางหน้าปุ่มส่งออก Excel ในแถบสรุป (ใช้เมื่อ exportPlacement="summary" และมี renderSummary) */
  summaryActions?: ReactNode;
  /** "compact" = ช่องค้นหาแคบลง (เมื่อแถวตัวกรองแน่น) ค่าเริ่มต้น "default" */
  searchSize?: "default" | "compact";
  /** ไอคอนของปุ่มเปิดรายละเอียดหน้าแถว (detailMode="modal") ไม่ส่ง = ไอคอนเปิดหน้าต่าง */
  detailIcon?: ReactNode;
  /** ผู้ใช้ลากหัวคอลัมน์ (หรือ Alt+←/→ บนหัวคอลัมน์) เพื่อย้ายลำดับได้ จำไว้ใน localStorage ต่อหน้า */
  reorderable?: boolean;
};

const API_KEYS = ["page", "pageSize", "sort", "dir", "q"] as const;
const NO_ROWS: never[] = [];
const NO_KEYS: readonly string[] = [];
const SEARCH_DEBOUNCE_MS = 300;
// 1 ตัวอักษร (เช่น "ก" หรือ "1") ตรงเกือบทุกแถว ได้ผลไม่ต่างจากไม่ค้นหาแต่ทำให้ฐานทำงานหนัก
const LIVE_MIN_CHARS = 2;
const fmt = (n: number) => n.toLocaleString("th-TH");
const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const btnBase = `inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium disabled:pointer-events-none disabled:opacity-40 ${focusRing}`;
const btn = `${btnBase} border-line bg-surface text-foreground hover:bg-hover`;
const btnPrimary = `${btnBase} border-transparent bg-accent text-accent-fg hover:bg-accent/90`;

// ลำดับคอลัมน์เก็บใน localStorage อ่านผ่าน useSyncExternalStore (server/hydration = ลำดับตั้งต้น)
const ORDER_EVENT = "bkh-grid-cols";
function subscribeOrder(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(ORDER_EVENT, onChange);
  window.addEventListener(STORAGE_USER_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(ORDER_EVENT, onChange);
    window.removeEventListener(STORAGE_USER_EVENT, onChange);
  };
}
function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function parseOrder(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** id ของคอลัมน์ (display ใช้ id, accessor ใช้ accessorKey) ใช้จัดลำดับ */
const columnId = (c: { id?: string }) => c.id ?? String((c as { accessorKey?: unknown }).accessorKey ?? "");

function Icon({ d, className = "size-4" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function DataGrid<T extends RowData, R extends GridPage<T> = GridPage<T>>({
  endpoint,
  columns,
  getRowId,
  params,
  filters,
  renderDetail,
  detailMode = "modal",
  detailTitle,
  detailSize,
  filterKeys = NO_KEYS,
  toolbar,
  liveSearch = false,
  renderSummary,
  exportPlacement = "toolbar",
  summaryActions,
  searchSize = "default",
  detailIcon,
  reorderable = false,
}: DataGridProps<T, R>) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // state ของ grid อยู่ใน URL ทั้งหมด (refresh/แชร์ link ได้หน้าเดิม) server เป็นคน validate
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Number(sp.get("pageSize")) || DEFAULT_PAGE_SIZE;
  const sort = sp.get("sort");
  const dir = sp.get("dir") === "desc" ? "desc" : "asc";
  const q = sp.get("q") ?? "";

  const apiParams = new URLSearchParams();
  for (const k of [...API_KEYS, ...filterKeys]) {
    const v = sp.get(k);
    if (v) apiParams.set(k, v);
  }
  for (const [k, v] of Object.entries(params ?? {})) if (v) apiParams.set(k, v);
  const apiQuery = apiParams.toString();
  apiParams.delete("page");
  apiParams.delete("pageSize");
  apiParams.set("format", "xlsx");
  const exportHref = `${endpoint}?${apiParams}`;

  const [reload, setReload] = useState(0);
  const requestKey = `${endpoint}?${apiQuery}#${reload}`;
  const [result, setResult] = useState<{ key: string; data?: R; error?: string }>({ key: "" });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${endpoint}?${apiQuery}`, { signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `โหลดข้อมูลไม่สำเร็จ (HTTP ${res.status})`);
        return body as R;
      })
      .then(
        (data) => setResult({ key: requestKey, data }),
        (e: Error) => {
          if (!ctrl.signal.aborted) setResult((prev) => ({ key: requestKey, data: prev.data, error: e.message }));
        },
      );
    return () => ctrl.abort();
  }, [endpoint, apiQuery, requestKey]);

  const loading = result.key !== requestKey;
  const error = loading ? undefined : result.error;
  const data = result.data;
  const total = data?.total ?? 0;

  const [selected, setSelected] = useState<T | null>(null);

  // ช่องค้นหาเป็น controlled ไม่ remount ตาม URL (เคอร์เซอร์และข้อความที่พิมพ์ค้างอยู่ไม่หาย)
  // sync จาก URL เฉพาะเมื่อ q เปลี่ยนจากภายนอก เช่น ปุ่มล้างการค้นหา หรือ back/forward
  const [text, setText] = useState(q);
  const [seenQ, setSeenQ] = useState(q);
  const [sentQ, setSentQ] = useState(q);
  if (q !== seenQ) {
    setSeenQ(q);
    if (q !== sentQ) {
      setSentQ(q);
      setText(q);
    }
  }

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const t = timer;
    return () => clearTimeout(t.current);
  }, []);

  // history.replaceState แทน router.replace: ไม่ต้องรอ server round-trip และไม่เพิ่ม history ทุกครั้งที่พิมพ์
  // อ่าน param ล่าสุดจาก location เพราะ callback ที่หน่วงไว้อาจถือ sp ของ render ก่อน
  function commitSearch(v: string) {
    clearTimeout(timer.current);
    const next = new URLSearchParams(window.location.search);
    if ((next.get("q") ?? "") === v) return;
    if (v) next.set("q", v);
    else next.delete("q");
    next.delete("page");
    setSentQ(v);
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }

  function onSearchInput(value: string) {
    setText(value);
    clearTimeout(timer.current);
    const v = value.trim();
    // ลบจนว่าง (พิมพ์ลบ, ปุ่ม ×) ล้างการค้นหาทันทีทั้งสองโหมด เพราะโหมดปกติจะไม่มีการกดค้นหาตามมา
    if (!v) commitSearch("");
    else if (liveSearch && v.length >= LIVE_MIN_CHARS) timer.current = setTimeout(() => commitSearch(v), SEARCH_DEBOUNCE_MS);
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (liveSearch && e.key === "Escape" && text) {
      e.preventDefault();
      setText("");
      commitSearch("");
    }
  }

  function setParams(changes: Record<string, string | number | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  const goToPage = (p: number) => setParams({ page: p > 1 ? p : null });

  // ลำดับคอลัมน์ที่ผู้ใช้จัดเอง (id) ว่าง = ตามที่หน้ากำหนด ; จำต่อผู้ใช้ต่อหน้า (ผู้ใช้จาก ProfileMenu)
  const orderKey = () => `bkh:grid-cols:${storageUser()}:${pathname}`;
  const orderRaw = useSyncExternalStore(subscribeOrder, () => (reorderable ? readStorage(orderKey()) : null), () => null);
  const order = useMemo(() => parseOrder(orderRaw), [orderRaw]);
  const [dragId, setDragId] = useState<string | null>(null);
  const orderedColumns = useMemo(() => {
    if (!order.length) return columns;
    const rank = (c: (typeof columns)[number]) => {
      const i = order.indexOf(columnId(c));
      return i < 0 ? order.length : i; // คอลัมน์ใหม่ที่ยังไม่เคยจัด ต่อท้าย
    };
    return [...columns].sort((a, b) => rank(a) - rank(b));
  }, [columns, order]);
  function saveOrder(next: string[]) {
    try {
      if (next.length) localStorage.setItem(orderKey(), JSON.stringify(next));
      else localStorage.removeItem(orderKey());
      window.dispatchEvent(new Event(ORDER_EVENT));
    } catch {
      // shortcut: storage ใช้ไม่ได้ (private mode) = ย้ายคอลัมน์ไม่ได้ ถ้าต้องการให้เก็บใน state แทน
    }
  }
  /** ย้ายคอลัมน์ id ไปที่ตำแหน่งของ targetId */
  function moveColumn(id: string, targetId: string) {
    const ids = orderedColumns.map(columnId);
    const from = ids.indexOf(id);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    saveOrder(ids);
  }

  const sorting: SortingState = sort ? [{ id: sort, desc: dir === "desc" }] : [];
  const table = useTable({
    features,
    data: data?.rows ?? NO_ROWS,
    columns: orderedColumns,
    getRowId,
    state: { sorting, globalFilter: q, pagination: { pageIndex: page - 1, pageSize } },
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount: total,
    enableMultiSort: false,
    sortDescFirst: false,
    onSortingChange: (updater) => {
      const s = (typeof updater === "function" ? updater(sorting) : updater)[0];
      setParams({ sort: s?.id ?? null, dir: s?.desc ? "desc" : null, page: null });
    },
    onGlobalFilterChange: (updater) => {
      const v = typeof updater === "function" ? updater(q) : updater;
      setParams({ q: String(v ?? "").trim() || null, page: null });
    },
    getRowCanExpand: () => detailMode === "expand" && !!renderDetail,
    meta: { reload: () => setReload((n) => n + 1) },
  });

  const pageCount = Math.max(1, table.getPageCount());
  const rows = table.getRowModel().rows;
  const hasDetail = !!renderDetail;
  const colSpan = table.getAllLeafColumns().length + (hasDetail ? 1 : 0);
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    commitSearch(text.trim());
  }

  const exportInSummary = exportPlacement === "summary" && !!renderSummary;
  const exportLink = (
    <a href={exportHref} download className={`${btn} aria-disabled:pointer-events-none aria-disabled:opacity-40`} aria-disabled={!total || undefined}>
      <Icon d="M10 3v10M6 9l4 4 4-4M4 16h12" />
      ส่งออก Excel
    </a>
  );

  let body: ReactNode;
  if (error) {
    body = (
      <tr>
        <td colSpan={colSpan} className="px-4 py-12 text-center">
          <p className="font-medium text-danger">โหลดข้อมูลไม่สำเร็จ</p>
          <p className="mt-1 text-sm text-muted">{error}</p>
          <button type="button" className={`${btn} mt-4`} onClick={() => setReload((n) => n + 1)}>
            ลองอีกครั้ง
          </button>
        </td>
      </tr>
    );
  } else if (!data) {
    body = Array.from({ length: Math.min(pageSize, 8) }, (_, i) => (
      <tr key={i} className="border-t border-line">
        <td colSpan={colSpan} className="px-4 py-3">
          <div className="h-4 animate-pulse rounded bg-hover"style={{ width: `${90 - (i % 3) * 15}%` }} />
        </td>
      </tr>
    ));
  } else if (rows.length === 0) {
    body = (
      <tr>
        <td colSpan={colSpan} className="px-4 py-12 text-center">
          <p className="font-medium">
            {total > 0 ? "หน้านี้ไม่มีข้อมูล" : q ? `ไม่พบรายการที่ตรงกับ “${q}”` : "ยังไม่มีข้อมูล"}
          </p>
          {total > 0 ? (
            <button type="button" className={`${btn} mt-4`} onClick={() => goToPage(1)}>
              ไปหน้าแรก
            </button>
          ) : (
            q && (
              <button type="button" className={`${btn} mt-4`} onClick={() => setParams({ q: null, page: null })}>
                ล้างการค้นหา
              </button>
            )
          )}
        </td>
      </tr>
    );
  } else {
    body = rows.map((row) => {
      const isOpen = row.getIsExpanded();
      return (
        <Fragment key={row.id}>
          <tr className={`border-t border-line ${isOpen ? "bg-accent-soft text-accent-text" : "hover:bg-surface-sunken"}`}>
            {hasDetail && (
              <td className="w-0 py-1 pr-0 pl-2">
                <button
                  type="button"
                  aria-label="รายละเอียด"
                  aria-expanded={detailMode === "expand" ? isOpen : undefined}
                  aria-haspopup={detailMode === "modal" ? "dialog" : undefined}
                  onClick={detailMode === "expand" ? row.getToggleExpandedHandler() : () => setSelected(row.original)}
                  className={`grid size-7 place-items-center rounded-md hover:bg-hover hover:text-foreground ${isOpen ? "" : "text-muted"} ${focusRing}`}
                >
                  {detailMode === "expand" ? (
                    <Icon d="M8 5l5 5-5 5" className={`size-4 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
                  ) : (
                    (detailIcon ?? <Icon d="M11 4h5v5M16 4l-7 7M14 12v3a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h3" />)
                  )}
                </button>
              </td>
            )}
            {row.getAllCells().map((cell) => (
              <td key={cell.id} className={`px-3 py-2 text-grid-cell ${cell.column.columnDef.meta?.className ?? ""}`}>
                <table.FlexRender cell={cell} />
              </td>
            ))}
          </tr>
          {isOpen && renderDetail && (
            <tr className="bg-accent-soft">
              <td colSpan={colSpan} className="px-4 pt-1 pb-5 pl-12">
                <div className="max-w-3xl">{renderDetail(row.original)}</div>
              </td>
            </tr>
          )}
        </Fragment>
      );
    });
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          {toolbar}
          {filters}
          <form role="search" onSubmit={onSearch} className={`flex min-w-0 flex-1 gap-2 ${searchSize === "compact" ? "basis-40 sm:max-w-52" : "basis-60 sm:max-w-md"}`}>
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3 focus-within:ring-2 focus-within:ring-ring">
              <Icon d="M9 15a6 6 0 100-12 6 6 0 000 12zM17 17l-3.5-3.5" className="size-4 shrink-0 text-muted" />
              <input
                name="q"
                type="search"
                aria-label="ค้นหา"
                value={text}
                onChange={(e) => onSearchInput(e.target.value)}
                onKeyDown={onSearchKeyDown}
                maxLength={100}
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>
            {!liveSearch && (
              <button type="submit" className={btnPrimary}>
                <Icon d="M9 15a6 6 0 100-12 6 6 0 000 12zM17 17l-3.5-3.5" />
                ค้นหา
              </button>
            )}
          </form>
        </div>
        {!exportInSummary && exportLink}
      </div>

      {renderSummary && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className={`flex min-h-5 min-w-0 flex-wrap items-center gap-x-4 gap-y-1 transition-opacity ${data && (loading || error) ? "opacity-50" : ""}`}>
            {data ? renderSummary(data) : <div className="h-4 w-56 animate-pulse rounded bg-hover" />}
          </div>
          {exportInSummary && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {summaryActions}
              {exportLink}
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table aria-busy={loading} className="w-full border-collapse tabular-nums">
          <thead className="bg-surface text-left text-grid-head text-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hasDetail && (
                  <th className="w-0 pl-2">
                    <span className="sr-only">รายละเอียด</span>
                  </th>
                )}
                {hg.headers.map((h, i) => {
                  const dirNow = h.column.getIsSorted();
                  const cls = h.column.columnDef.meta?.className ?? "";
                  const id = h.column.id;
                  const drag = reorderable
                    ? {
                        draggable: true,
                        title: "ลากเพื่อย้ายคอลัมน์ (Alt+← / Alt+→)",
                        // หัวที่ไม่มีปุ่ม sort ต้องโฟกัสได้เพื่อย้ายด้วยคีย์บอร์ด
                        tabIndex: h.column.getCanSort() ? undefined : 0,
                        onDragStart: (e: DragEvent) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", id);
                          setDragId(id);
                        },
                        onDragOver: (e: DragEvent) => {
                          if (dragId) e.preventDefault();
                        },
                        onDrop: (e: DragEvent) => {
                          e.preventDefault();
                          if (dragId) moveColumn(dragId, id);
                          setDragId(null);
                        },
                        onDragEnd: () => setDragId(null),
                        onKeyDown: (e: KeyboardEvent) => {
                          if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
                          const target = hg.headers[i + (e.key === "ArrowLeft" ? -1 : 1)];
                          if (!target) return;
                          e.preventDefault();
                          moveColumn(id, target.column.id);
                        },
                      }
                    : {};
                  return (
                    <th
                      key={h.id}
                      {...drag}
                      aria-sort={dirNow === "asc" ? "ascending" : dirNow === "desc" ? "descending" : undefined}
                      className={`px-3 py-2.5 font-medium whitespace-nowrap ${reorderable ? `cursor-grab ${focusRing}` : ""} ${dragId === id ? "opacity-40" : ""} ${cls}`}
                    >
                      {h.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className={`-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground ${dirNow ? "text-foreground" : ""} ${focusRing}`}
                        >
                          <table.FlexRender header={h} />
                          <Icon
                            d={dirNow === "asc" ? "M10 15V5M6 9l4-4 4 4" : dirNow === "desc" ? "M10 5v10M6 11l4 4 4-4" : "M7 8l3-3 3 3M7 12l3 3 3-3"}
                            className={`size-3.5 ${dirNow ? "text-accent-text" : "opacity-50"}`}
                          />
                        </button>
                      ) : (
                        <table.FlexRender header={h} />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className={`transition-opacity ${loading && data ? "opacity-50" : ""}`}>{body}</tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-muted">
        <p role="status" className="tabular-nums">
          {loading ? "กำลังโหลด…" : `แสดง ${fmt(from)}–${fmt(to)} จาก ${fmt(total)} รายการ`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {reorderable && order.length > 0 && (
            <button type="button" onClick={() => saveOrder([])} className={`rounded px-1.5 underline-offset-2 hover:text-foreground hover:underline ${focusRing}`}>
              เรียงคอลัมน์ตามเดิม
            </button>
          )}
          <label className="flex items-center gap-2">
            แถวต่อหน้า
            <select
              value={pageSize}
              onChange={(e) => setParams({ pageSize: Number(e.target.value) === DEFAULT_PAGE_SIZE ? null : e.target.value, page: null })}
              className={`h-9 rounded-md border border-line bg-surface px-2 text-foreground ${focusRing}`}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <nav aria-label="เลือกหน้า" className="flex items-center gap-1">
            <button type="button" className={btn} aria-label="หน้าแรก" disabled={page <= 1} onClick={() => goToPage(1)}>
              <Icon d="M10 5l-5 5 5 5M15 5l-5 5 5 5" />
            </button>
            <button type="button" className={btn} aria-label="หน้าก่อน" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
              <Icon d="M12 5l-5 5 5 5" />
            </button>
            <span className="px-2 tabular-nums text-foreground">
              หน้า {fmt(page)} / {fmt(pageCount)}
            </span>
            <button type="button" className={btn} aria-label="หน้าถัดไป" disabled={page >= pageCount} onClick={() => goToPage(page + 1)}>
              <Icon d="M8 5l5 5-5 5" />
            </button>
            <button type="button" className={btn} aria-label="หน้าสุดท้าย" disabled={page >= pageCount} onClick={() => goToPage(pageCount)}>
              <Icon d="M5 5l5 5-5 5M10 5l5 5-5 5" />
            </button>
          </nav>
        </div>
      </div>

      {detailMode === "modal" && renderDetail && (
        <DetailModal
          open={selected !== null}
          onClose={() => setSelected(null)}
          title={selected && detailTitle ? detailTitle(selected) : "รายละเอียด"}
          size={detailSize}
        >
          {selected && renderDetail(selected)}
        </DetailModal>
      )}
    </div>
  );
}
