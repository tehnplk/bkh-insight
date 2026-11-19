"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { focusRing } from "@/app/(app)/fund/_components/ui";
import {
  RIGHT_CHECK_CHUNK, RIGHT_STATUS_LABEL, type RightCheckPage, type RightRow, type RightStatus, type RightStop,
} from "@/app/api/opd/right-check/srm";

// ตรวจสิทธิของ visit ที่เลือกกับ สปสช. ทีละชุด RIGHT_CHECK_CHUNK (route ยิงทีละราย เว้น SRM_DELAY_MS ต่อครั้งต่อเนื่องข้ามชุด) ; 401/429 หยุดทั้งหมด
// route บันทึกผลต่อ HN (srm_right_check) ผลไม่เกิน 24 ชั่วโมงใช้ซ้ำไม่ยิงใหม่ และ /api/opd/admissions ส่งมากับแถว (row.right)
// ผลจากปุ่มในรอบนี้ (state ของหน้า ตาม VN) ทับค่าของแถว

const TONE: Record<RightStatus, string> = {
  ok: "border-success-line bg-success-soft text-success",
  mismatch_right: "border-danger-line bg-danger-soft text-danger",
  mismatch_hcode: "border-warning-line bg-warning-soft text-warning",
  not_found: "border-danger-line bg-danger-soft text-danger",
  error: "border-line bg-surface-sunken text-muted",
};
const ORDER = Object.keys(TONE) as RightStatus[];
/** สถานะที่กดดูรายละเอียดเทียบ HOSxP กับ สปสช. ได้ */
const DETAIL = new Set<RightStatus>(["mismatch_right", "mismatch_hcode", "not_found"]);
const chip = "rounded border px-1.5 py-0.5 whitespace-nowrap";
const dash = <span className="text-muted">–</span>;
const rightBad = "rounded bg-danger-soft px-1 font-semibold text-danger";
const hcodeBad = "rounded bg-warning-soft px-1 font-semibold text-warning";

function Badge({ status, title, children }: { status: RightStatus; title?: string; children?: ReactNode }) {
  return (
    <span title={title} className={`${chip} ${TONE[status]}`}>
      {RIGHT_STATUS_LABEL[status]}
      {children}
    </span>
  );
}

type Run = { vns: string[]; rows: RightRow[]; stop: RightStop | null; error: string | null; running: boolean };
type RightCheck = { results: Map<string, RightRow>; run: Run | null; start: (vns: string[]) => void };
export const RightCheckContext = createContext<RightCheck>({ results: new Map(), run: null, start: () => {} });

export function useRightCheck(): RightCheck {
  const [results, setResults] = useState<Map<string, RightRow>>(() => new Map());
  const [run, setRun] = useState<Run | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  useEffect(() => () => ctrlRef.current?.abort(), []);

  const start = (ids: string[]) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setRun({ vns: ids, rows: [], stop: null, error: null, running: true });
    (async () => {
      for (let i = 0; i < ids.length; i += RIGHT_CHECK_CHUNK) {
        const res = await fetch("/api/opd/right-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vns: ids.slice(i, i + RIGHT_CHECK_CHUNK) }),
          signal: ctrl.signal,
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `ตรวจสิทธิไม่สำเร็จ (HTTP ${res.status})`);
        const page = body as RightCheckPage;
        setResults((prev) => {
          const next = new Map(prev);
          for (const r of page.rows) next.set(r.vn, r);
          return next;
        });
        setRun((p) => p && { ...p, rows: [...p.rows, ...page.rows], stop: page.stop });
        if (page.stop) break;
      }
    })()
      .catch((e: Error) => {
        if (!ctrl.signal.aborted) setRun((p) => p && { ...p, error: e.message });
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setRun((p) => p && { ...p, running: false });
      });
  };
  return { results, run, start };
}

/** ความคืบหน้า/ผลสรุป/เหตุที่หยุด ของการตรวจรอบล่าสุด วางข้างปุ่มตรวจสอบสิทธิ */
export function RightCheckStatus() {
  const { run } = useContext(RightCheckContext);
  if (!run) return null;
  const { vns, rows, stop, error, running } = run;
  const counts = ORDER.map((s) => [s, rows.filter((r) => r.status === s).length] as const).filter(([, n]) => n > 0);
  const cached = rows.filter((r) => r.cached).length;
  const banner = !running && (stop?.message ?? error);
  const left = vns.length - rows.length;
  return (
    <span role="status" className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="tabular-nums">
        {running ? "กำลังตรวจ " : "ตรวจแล้ว "}
        <span className="font-semibold">{formatCount(rows.length)}</span>/{formatCount(vns.length)} visit
      </span>
      {running && (
        <span className="h-1.5 w-32 overflow-hidden rounded bg-surface-sunken" aria-hidden>
          <span className="block h-full bg-accent transition-[width]" style={{ width: `${(rows.length / Math.max(vns.length, 1)) * 100}%` }} />
        </span>
      )}
      {counts.map(([s, n]) => (
        <Badge key={s} status={s}>
          <span className="ml-1.5 font-semibold tabular-nums">{formatCount(n)}</span>
        </Badge>
      ))}
      {cached > 0 && <span className="text-muted tabular-nums">ใช้ผลที่ตรวจไว้ใน 24 ชม. {formatCount(cached)} visit</span>}
      {banner && (
        <span className="text-danger">
          {banner}
          {left > 0 && <span className="ml-1">ยังไม่ได้ตรวจ {formatCount(left)} visit</span>}
        </span>
      )}
    </span>
  );
}

/** แถวของ grid: ผลที่บันทึกไว้มากับแถว (right) */
type Row = { vn: string; right?: RightRow };
const useResult = (row: Row) => useContext(RightCheckContext).results.get(row.vn) ?? row.right;

/** HCODE ของ HOSxP (visit_pttype.hospmain) ; ตรวจแล้วไม่ตรงกับ สปสช. = เน้นสีเตือน */
export function HisHcode({ row, value }: { row: Row; value: string | null }) {
  const r = useResult(row);
  if (!value) return dash;
  return r?.hcode_ok === false ? <span className={hcodeBad}>{value}</span> : <>{value}</>;
}

/** สิทธิหลักของ สปสช. (mainInscl.id) ชื่อสิทธิย่อยจางต่อท้าย */
export function SrmRight({ row }: { row: Row }) {
  const r = useResult(row);
  const s = r?.srm;
  if (!s?.fund) return dash;
  const name = s.sub_name ?? s.fund_name;
  return (
    <span className="flex max-w-64 items-baseline gap-1.5" title={name ?? undefined}>
      <span className={r?.right_ok === false ? rightBad : "font-medium"}>{s.fund}</span>
      {name && <span className="truncate text-muted">{name}</span>}
    </span>
  );
}

/** หน่วยบริการ "หลัก,รอง" ของ สปสช. แสดงทั้งคู่เสมอแม้ซ้ำกัน (ชื่อตอนชี้) ; หลักไม่ตรงกับ HCODE(HIS) = เน้นสีเตือน */
export function SrmHcode({ row }: { row: Row }) {
  const r = useResult(row);
  const s = r?.srm;
  if (!s?.hospmain && !s?.hospsub) return dash;
  const title = [s.hospmain_name && `หลัก: ${s.hospmain_name}`, s.hospsub_name && `รอง: ${s.hospsub_name}`].filter(Boolean).join(", ");
  return (
    <span title={title || undefined}>
      {s.hospmain && <span className={r?.hcode_ok === false ? hcodeBad : undefined}>{s.hospmain}</span>}
      {s.hospmain && s.hospsub && ","}
      {s.hospsub}
    </span>
  );
}

/** เวลาจาก insight ("2026-11-19 10:07:48.12+07") เป็น "19 พ.ย. 2569 10:07" */
const thaiDateTime = (ts: string) => `${formatThaiDate(ts)} ${ts.slice(11, 16)}`.trim();

/** ผลตรวจ ; ไม่ตรง/ไม่พบสิทธิ กดดูเทียบ HOSxP กับ สปสช. */
export function SrmStatus({ row }: { row: Row }) {
  const r = useResult(row);
  const [open, setOpen] = useState(false);
  if (!r) return dash;
  if (!DETAIL.has(r.status)) return <Badge status={r.status} title={r.message} />;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`ดูรายละเอียด ${RIGHT_STATUS_LABEL[r.status]} VN ${r.vn}`}
        className={`${chip} ${TONE[r.status]} cursor-pointer hover:underline ${focusRing}`}
      >
        {RIGHT_STATUS_LABEL[r.status]}
      </button>
      <DetailModal
        open={open}
        onClose={() => setOpen(false)}
        size="medium"
        title={
          <>
            {r.name || "–"} <span className="font-normal text-muted tabular-nums">VN {r.vn}</span>
          </>
        }
      >
        {open && <RightCompare r={r} />}
      </DetailModal>
    </>
  );
}

const or = (v: string | null | undefined) => v || dash;
const withName = (code: string | null | undefined, name: string | null | undefined) =>
  code ? (
    <>
      <span className="tabular-nums">{code}</span>
      {name && <span className="ml-1.5 text-muted">{name}</span>}
    </>
  ) : (
    dash
  );

/** HOSxP กับ สปสช. ทีละหัวข้อ แถวที่เทียบแล้วไม่ตรงเน้นสีตามสถานะ */
function RightCompare({ r }: { r: RightRow }) {
  const s = r.srm;
  const rows: { label: string; his: ReactNode; srm: ReactNode; bad?: string }[] = [
    { label: "สิทธิหลัก", his: or(r.his.fund), srm: withName(s?.fund, s?.fund_name), bad: r.right_ok === false ? TONE.mismatch_right : undefined },
    { label: "สิทธิย่อย", his: or(r.his.pttype_name), srm: or(s?.sub_name) },
    { label: "HCODE หลัก", his: or(r.his.hospmain), srm: withName(s?.hospmain, s?.hospmain_name), bad: r.hcode_ok === false ? TONE.mismatch_hcode : undefined },
    { label: "HCODE รอง", his: or(r.his.hospsub), srm: withName(s?.hospsub, s?.hospsub_name) },
    { label: "วันเริ่มสิทธิ", his: dash, srm: or(formatThaiDate(s?.start)) },
    { label: "วันหมดสิทธิ", his: dash, srm: s ? formatThaiDate(s.expire) || "ไม่มีวันหมดอายุ" : dash },
  ];
  return (
    <div className="flex flex-col gap-3 text-sm">
      {r.status === "not_found" && <p className="text-danger">{r.message}</p>}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th scope="col" className="w-32 py-1.5 pr-3 pl-2 font-medium">
              <span className="sr-only">หัวข้อ</span>
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">HOSxP</th>
            <th scope="col" className="py-1.5 pr-2 font-medium">สปสช. (SRM)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.label} className={x.bad ? `border-b ${x.bad}` : "border-b border-line"}>
              <th scope="row" className="py-1.5 pr-3 pl-2 text-left font-medium">{x.label}</th>
              <td className={`py-1.5 pr-3 ${x.bad ? "font-semibold" : ""}`}>{x.his}</td>
              <td className={`py-1.5 pr-2 ${x.bad ? "font-semibold" : ""}`}>{x.srm}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.checked_at && (
        <p className="text-muted tabular-nums">
          ตรวจเมื่อ {thaiDateTime(r.checked_at)} น.{r.checked_by && ` · ${r.checked_by}`}
          {r.cached && " · ผลที่บันทึกไว้"}
        </p>
      )}
    </div>
  );
}
