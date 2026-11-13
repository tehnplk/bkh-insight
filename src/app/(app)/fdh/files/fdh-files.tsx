"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { formatCount } from "@/lib/number-format";
import { THAI_MONTHS, todayIso } from "@/lib/thai-date";
// ชิ้นส่วนของโมดูลอื่นที่ยังไม่ได้ย้ายไป src/components (ใช้ซ้ำแบบเดียวกับ /fdh/c-check)
import { Notice, Skeleton, btn, focusRing, useJson, useUrlParams } from "@/app/(app)/fund/_components/ui";
import { Segmented } from "@/app/(app)/quality/pending/segmented";
import { DATE_LABEL, FDH_TYPES, FILE_ORDER, TYPE_LABEL, type FdhType } from "@/app/api/fdh/c-check/files";
import type { FilePage, FilesSummary } from "@/app/api/fdh/files/sql";

const TYPE_OPTIONS = FDH_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }));
const PAGE_SIZE = 100;
const pad = (n: number) => String(n).padStart(2, "0");

/** 12 เดือนล่าสุด (เดือนนี้ถึงวันนี้) เป็นช่วง start/end */
function months(today: string) {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const yy = d.getUTCFullYear();
    const mm = d.getUTCMonth() + 1;
    const ym = `${yy}-${pad(mm)}`;
    const last = `${ym}-${pad(new Date(Date.UTC(yy, mm, 0)).getUTCDate())}`;
    return { id: ym, label: `${THAI_MONTHS[mm - 1]} ${yy + 543}`, start: `${ym}-01`, end: last < today ? last : today };
  });
}

/** เลือกทั้งเดือน: เขียน start = วันที่ 1, end = วันสุดท้าย (ไม่เกินวันนี้) ลง URL แบบเดียวกับ DateRangeFilter */
function MonthSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { start, end } = useDateRange();
  const options = months(todayIso());
  const current = options.find((o) => o.start === start && o.end === end)?.id ?? "";

  return (
    <select
      aria-label="เดือน"
      value={current}
      onChange={(e) => {
        const o = options.find((x) => x.id === e.target.value);
        if (!o) return;
        const next = new URLSearchParams(sp.toString());
        next.set("start", o.start);
        next.set("end", o.end);
        next.delete("page");
        router.replace(`${pathname}?${next}`, { scroll: false });
      }}
      className={`h-9 rounded-md border border-line bg-surface px-2 text-sm text-foreground hover:bg-hover ${focusRing}`}
    >
      {!current && (
        <option value="" disabled>
          เดือน
        </option>
      )}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function RowBadge({ rows, loading }: { rows?: number; loading: boolean }) {
  if (loading) return <span className="h-4 w-8 animate-pulse rounded bg-hover" aria-hidden="true" />;
  if (rows === undefined) return null;
  return <span className={`text-xs tabular-nums ${rows ? "text-foreground" : "text-muted"}`}>{formatCount(rows)}</span>;
}

function FileList({ type, file, summary, loading, onSelect }: {
  type: FdhType; file: string; summary?: FilesSummary; loading: boolean; onSelect: (f: string) => void;
}) {
  const rows = (f: string) => summary?.files.find((x) => x.file === f)?.rows;
  return (
    <>
      {/* จอแคบ: select แทนรายการแนวตั้ง */}
      <select
        aria-label="แฟ้ม"
        value={file}
        onChange={(e) => onSelect(e.target.value)}
        className={`h-9 w-full rounded-md border border-line bg-surface px-2 text-sm font-medium md:hidden ${focusRing}`}
      >
        {FILE_ORDER[type].map((f) => {
          const n = rows(f);
          return (
            <option key={f} value={f}>
              {n === undefined ? f : `${f} (${formatCount(n)} แถว)`}
            </option>
          );
        })}
      </select>
      <nav aria-label="แฟ้ม" className="hidden md:block">
        <ul className="flex flex-col gap-0.5 rounded-lg border border-line p-1.5 text-sm">
          {FILE_ORDER[type].map((f) => {
            const on = f === file;
            return (
              <li key={f}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(f)}
                  className={`flex h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left ${
                    on ? "bg-accent-soft font-semibold text-accent-text" : "hover:bg-hover"
                  } ${focusRing}`}
                >
                  {f}
                  <RowBadge rows={rows(f)} loading={loading} />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

function DataTable({ data, file, offset }: { data: FilePage; file: string; offset: number }) {
  return (
    <div className="max-h-[36rem] overflow-auto rounded-lg border border-line">
      <table className="w-full border-collapse tabular-nums">
        <caption className="sr-only">ข้อมูลแฟ้ม {file}</caption>
        <thead className="sticky top-0 bg-surface text-left text-grid-head text-muted">
          <tr>
            {data.columns.map((c) => (
              <th key={c} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-grid-cell">
          {data.rows.map((r, i) => (
            <tr key={offset + i} className="border-t border-line hover:bg-surface-sunken">
              {data.columns.map((c) => (
                <td key={c} className="px-3 py-1.5 whitespace-nowrap">
                  {r[c] == null ? "" : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** ข้อมูลของแฟ้มที่เลือก key ตามหมวด/แฟ้ม/ช่วงวันที่ หน้าจึงกลับไปหน้าแรกเอง */
function FileData({ type, file, start, end, summaryRows }: { type: FdhType; file: string; start: string; end: string; summaryRows?: number }) {
  const [page, setPage] = useState(1);
  const base = { type, file, start, end };
  const result = useJson<FilePage>(`/api/fdh/files?${new URLSearchParams({ ...base, page: String(page), pageSize: String(PAGE_SIZE) })}`);
  const d = result.data;
  const total = d?.total ?? summaryRows;
  const pages = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE));
  const from = (page - 1) * PAGE_SIZE;

  return (
    <section aria-labelledby="fdh-file" aria-busy={result.loading} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="fdh-file" className="text-title">
            แฟ้ม {file}
          </h2>
          {total !== undefined && (
            <p className="text-sm text-muted tabular-nums">
              <span className="font-semibold text-foreground">{formatCount(total)}</span> แถว
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* ผู้ใช้สั่ง: เอาป้ายออกได้หลังทดสอบอัปโหลด UAT ผ่าน */}
          <span className="rounded-md border border-warning-line bg-warning-soft px-1.5 py-0.5 text-xs text-warning">ยังไม่ได้ทดสอบกับ FDH</span>
          <a
            href={`/api/fdh/files?${new URLSearchParams({ ...base, format: "txt" })}`}
            download={`${file}.txt`}
            aria-disabled={total === 0 || undefined}
            className={`${btn} gap-1.5 aria-disabled:pointer-events-none aria-disabled:opacity-40`}
          >
            <Download className="size-4" aria-hidden="true" />
            ส่งออก {file}.txt
          </a>
        </div>
      </div>

      {result.loading ? (
        <Skeleton rows={8} />
      ) : result.error ? (
        <div role="alert">
          <Notice
            title="โหลดข้อมูลไม่สำเร็จ"
            detail={result.error}
            action={
              <button type="button" onClick={result.retry} className={btn}>
                ลองใหม่
              </button>
            }
          />
        </div>
      ) : d && d.total === 0 ? (
        <Notice title="ไม่มีข้อมูลในช่วงนี้" />
      ) : (
        d && <DataTable data={d} file={file} offset={from} />
      )}

      {pages > 1 && (
        <nav aria-label="หน้า" className="flex flex-wrap items-center justify-end gap-2 text-sm tabular-nums">
          <span className="text-muted">
            แถว {formatCount(from + 1)}–{formatCount(Math.min(page * PAGE_SIZE, total ?? 0))} · หน้า {formatCount(page)} จาก {formatCount(pages)}
          </span>
          <button type="button" aria-label="หน้าก่อน" disabled={page <= 1} onClick={() => setPage(page - 1)} className={`${btn} disabled:pointer-events-none disabled:opacity-40`}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button type="button" aria-label="หน้าถัดไป" disabled={page >= pages} onClick={() => setPage(page + 1)} className={`${btn} disabled:pointer-events-none disabled:opacity-40`}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </nav>
      )}
    </section>
  );
}

export function FdhFiles() {
  const url = useUrlParams(["type", "file"]);
  const type: FdhType = url.type === "ip" ? "ip" : "op";
  // แฟ้มที่ไม่มีในหมวดนี้ (เช่น เพิ่งสลับหมวด) ใช้แฟ้มแรกของหมวด
  const file = (FILE_ORDER[type] as readonly string[]).includes(url.file) ? url.file : FILE_ORDER[type][0];
  const { start, end } = useDateRange();
  const dateLabel = DATE_LABEL[type];

  // FileData (ลูก) ยิงก่อน: effect ของลูกรันก่อนแม่ แฟ้มที่เปิดอยู่จึงได้คิว his ก่อน statement นับแถวทุกแฟ้ม
  const summary = useJson<FilesSummary>(`/api/fdh/files/summary?${new URLSearchParams({ type, start, end })}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented label="หมวด" options={TYPE_OPTIONS} value={type} onChange={(t) => url.set({ type: t, file: (FILE_ORDER[t] as readonly string[]).includes(file) ? file : null })} />
        <div role="group" aria-label={dateLabel} className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{dateLabel}</span>
          <MonthSelect />
          <DateRangeFilter />
        </div>
      </div>

      {summary.error && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          นับจำนวนแถวของแต่ละแฟ้มไม่สำเร็จ: {summary.error}
          <button type="button" onClick={summary.retry} className={btn}>
            ลองใหม่
          </button>
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-[10rem_minmax(0,1fr)] md:items-start">
        <FileList type={type} file={file} summary={summary.data} loading={summary.loading} onSelect={(f) => url.set({ file: f })} />
        <FileData
          key={`${type}|${file}|${start}|${end}`}
          type={type}
          file={file}
          start={start}
          end={end}
          summaryRows={summary.data?.files.find((f) => f.file === file)?.rows}
        />
      </div>
    </div>
  );
}
