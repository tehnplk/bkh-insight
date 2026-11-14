"use client";

import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { formatBaht, formatCompactBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { Segmented } from "@/app/(app)/quality/pending/segmented";
import type { ClaimPipelinePage } from "@/app/api/fund/claim-pipeline/route";
import {
  REASONS_AT, REASON_LABEL, STEPS, STEP_LABEL, SUBMIT_DEADLINE_DAYS, viewOf,
  type Group, type PipelineRow, type PipelineType, type Reason, type View,
} from "@/app/api/fund/claim-pipeline/pipeline";
import { Money, ShareBar, focusRing, formatPct, num, pct, useUrlParams } from "../_components/ui";

const FILTER_KEYS = ["type", "fund", "stage"] as const;
const TYPES = [
  { value: "op", label: "ผู้ป่วยนอก" },
  { value: "ip", label: "ผู้ป่วยใน" },
] as const satisfies readonly { value: PipelineType; label: string }[];
const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium ${focusRing}`;
const dash = <span className="text-muted">–</span>;
// รอ = ยังไม่ต้องแก้ ; ตกหล่นที่ต้องตามแก้ = danger
const TONE: Record<Reason, string> = {
  authen_only: "border-warning-line bg-warning-soft text-warning",
  none: "border-danger-line bg-danger-soft text-danger",
  no_approve: "border-danger-line bg-danger-soft text-danger",
  unlocked: "border-warning-line bg-warning-soft text-warning",
  rep_wait: "border-warning-line bg-warning-soft text-warning",
  rep_missing: "border-danger-line bg-danger-soft text-danger",
  c: "border-danger-line bg-danger-soft text-danger",
  deny: "border-danger-line bg-danger-soft text-danger",
  stm_wait: "border-warning-line bg-warning-soft text-warning",
};

/* ---------- funnel ---------- */

function Funnel({ data, type, view, stage, select }: { data: ClaimPipelinePage; type: PipelineType; view: View; stage: string; select: (g: Group | null) => void }) {
  const f = data.summary;
  const served = f.steps.served.count;
  const toggle = (g: Group) => select(stage === g || (g === "served" && !stage) ? null : g);
  const on = (g: Group) => stage === g || (g === "served" && !stage);
  const deadline = SUBMIT_DEADLINE_DAYS[type];
  return (
    // แถบสรุปของ DataGrid กว้างตามเนื้อหา: w-screen ให้ขยายเต็มแถว แล้ว max-w-full ตัดให้พอดี
    <div className="w-screen max-w-full">
      {/* flex-wrap ให้แถวสุดท้ายยืดเต็ม ไม่เหลือช่องว่างเมื่อจอแคบ */}
      <ol aria-label="ขั้นตอนการเคลม" className="flex flex-wrap gap-px overflow-hidden rounded-lg border border-line bg-line">
        {STEPS.map((s, i) => {
          const t = f.steps[s];
          const prev = i > 0 ? f.steps[STEPS[i - 1]].count : null;
          return (
            <li key={s} className="flex min-w-0 flex-1 basis-48 flex-col bg-surface">
              <button
                type="button"
                aria-pressed={on(s)}
                onClick={() => toggle(s)}
                className={`flex flex-col gap-1 px-3 pt-2.5 pb-2 text-left ${focusRing} ${on(s) ? "bg-accent-soft" : "hover:bg-hover"}`}
              >
                <span className={`flex items-baseline justify-between gap-2 ${on(s) ? "text-accent-text" : "text-muted"}`}>
                  <span className="font-medium">{STEP_LABEL[view][s]}</span>
                  {prev !== null && <span className="text-xs tabular-nums">{formatPct(pct(t.count, prev))} ของขั้นก่อน</span>}
                </span>
                <span className="text-title tabular-nums">
                  {formatCount(t.count)} <span className="text-sm font-normal text-muted">ราย</span>
                </span>
                <span className="text-sm text-muted tabular-nums" title={`${formatBaht(t.amount)} บาท`}>
                  {formatCompactBaht(t.amount)}
                </span>
                <ShareBar value={pct(t.count, served)} />
              </button>
              {REASONS_AT[view][s] && (
                <ul aria-label={`ไม่ถึงขั้น ${STEP_LABEL[view][s]}`} className="flex flex-col border-t border-line px-1.5 py-1">
                  {REASONS_AT[view][s].map((r) => (
                    <li key={r}>
                      <ReasonButton label={REASON_LABEL[r]} count={f.reasons[r].count} amount={f.reasons[r].amount} pressed={on(r)} onClick={() => toggle(r)} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-2 max-w-sm">
        <ReasonButton
          label={`ยังไม่มี REP เกิน ${deadline} วันหลัง${type === "op" ? "รับบริการ" : "จำหน่าย"}`}
          count={f.overdue.count}
          amount={f.overdue.amount}
          pressed={on("overdue")}
          onClick={() => toggle("overdue")}
          danger
        />
      </div>
    </div>
  );
}

function ReasonButton({ label, count, amount, pressed, onClick, danger }: { label: string; count: number; amount: number; pressed: boolean; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      disabled={count === 0 && !pressed}
      title={`${formatBaht(amount)} บาท`}
      className={`flex w-full items-baseline justify-between gap-3 rounded-md px-1.5 py-1 text-left disabled:cursor-default disabled:text-muted ${focusRing} ${
        pressed ? "bg-accent-soft text-accent-text" : "enabled:hover:bg-hover"
      }`}
    >
      <span>{label}</span>
      <span className={`font-semibold tabular-nums ${count > 0 && danger && !pressed ? "text-danger" : ""}`}>{formatCount(count)}</span>
    </button>
  );
}

/* ---------- ตาราง ---------- */

function Stage({ row, type }: { row: PipelineRow; type: PipelineType }) {
  if (!row.reason) return <span className="rounded border border-success-line bg-success-soft px-1.5 py-0.5 whitespace-nowrap text-success">{STEP_LABEL[type][row.step]}</span>;
  return <span className={`rounded border px-1.5 py-0.5 whitespace-nowrap ${TONE[row.reason]}`}>{REASON_LABEL[row.reason]}</span>;
}

function Days({ row, type }: { row: PipelineRow; type: PipelineType }) {
  if (!row.overdue) return formatCount(row.days);
  return (
    <span className="font-semibold text-danger" title={`ยังไม่มี REP เกินกำหนดส่ง ${SUBMIT_DEADLINE_DAYS[type]} วัน`}>
      {formatCount(row.days)}
      <span className="sr-only"> เกินกำหนดส่ง</span>
    </span>
  );
}

const col = gridColumnHelper<PipelineRow>();
const nowrap = { className: "whitespace-nowrap" };
const money = (key: "debtor" | "compensation" | "stm_paid", header: string) =>
  col.accessor(key, { header, cell: (c) => <Money value={c.getValue()} />, meta: { className: num } });
const columns = (type: PipelineType) =>
  col.columns([
    col.accessor("key", { header: type === "op" ? "VN" : "AN", meta: nowrap }),
    col.accessor("hn", { header: "HN", meta: nowrap }),
    col.accessor("date", { header: type === "op" ? "วันที่รับบริการ" : "วันจำหน่าย", cell: (c) => formatThaiDate(c.getValue()), meta: { className: "whitespace-nowrap tabular-nums" } }),
    col.accessor("pttype_name", { header: "สิทธิ", cell: (c) => c.getValue() || dash, meta: { ...nowrap, filter: true } }),
    money("debtor", "ลูกหนี้สิทธิ (บาท)"),
    col.accessor("step", { header: "ขั้นที่ไปถึง/สาเหตุ", cell: (c) => <Stage row={c.row.original} type={type} /> }),
    col.accessor("codes", { header: "รหัส C/Deny", cell: (c) => c.getValue() || dash, meta: { className: "whitespace-nowrap tabular-nums", filter: true } }),
    money("compensation", "REP ชดเชยสุทธิ (บาท)"),
    money("stm_paid", "เงินเข้า STM (บาท)"),
    col.accessor("days", { header: "วันนับจากบริการ", cell: (c) => <Days row={c.row.original} type={type} />, meta: { className: num } }),
  ]);
const COLUMNS = { op: columns("op"), ip: columns("ip") };

export function ClaimPipeline({ funds }: { funds: { code: string; name: string }[] }) {
  const { start, end } = useDateRange();
  const { type: typeRaw, fund: fundRaw, stage, set } = useUrlParams(["type", "fund", "stage", "sort", "dir"]);
  const type: PipelineType = typeRaw === "ip" ? "ip" : "op";
  const fund = fundRaw || "UCS";
  const dateLabel = type === "op" ? "วันที่รับบริการ" : "วันจำหน่าย";

  return (
    <DataGrid<PipelineRow, ClaimPipelinePage>
      endpoint="/api/fund/claim-pipeline"
      params={{ start, end }}
      filterKeys={FILTER_KEYS}
      toolbar={
        <>
          {/* สาเหตุของ OP/IP ต่างกัน จึงล้างกลุ่มที่เลือกไปด้วย */}
          <Segmented label="ประเภทผู้ป่วย" options={TYPES} value={type} onChange={(t) => set({ type: t === "op" ? null : t, stage: null })} />
          <label className="flex items-center gap-2">
            <span className="text-muted">กองทุน</span>
            {/* สาเหตุขั้น 2 ของ OFC (Approval Code) ต่างจากกองทุนอื่น เปลี่ยนมุมมองจึงล้างกลุ่มที่เลือก */}
            <select
              value={fund}
              onChange={(e) => {
                const next = e.target.value;
                set({ fund: next === "UCS" ? null : next, stage: viewOf(type, next) === viewOf(type, fund) ? stage : null });
              }}
              className={SELECT_CLASS}
            >
              {funds.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.name === f.code ? f.code : `${f.code} ${f.name}`}
                </option>
              ))}
            </select>
          </label>
          <DateRangeFilter labels={{ preset: `ช่วง${dateLabel}`, start: `${dateLabel} ตั้งแต่`, end: `${dateLabel} ถึง` }} hideLabels />
        </>
      }
      columns={COLUMNS[type]}
      getRowId={(r) => r.key}
      renderSummary={(data) => <Funnel data={data} type={type} view={viewOf(type, fund)} stage={stage} select={(g) => set({ stage: g })} />}
    />
  );
}
