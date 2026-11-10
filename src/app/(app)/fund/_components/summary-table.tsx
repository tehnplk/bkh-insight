"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatCount } from "@/lib/number-format";
import { Money, ShareBar, focusRing, formatPct, num, pct } from "./ui";

export type SummaryChild = { code: string; name: string; visits: number; amount: number; queued?: number; queuedAmount?: number };
export type SummaryRow = SummaryChild & { patients: number; children: SummaryChild[] };

type Props = {
  rows: SummaryRow[];
  totals: { visits: number; patients: number; amount: number };
  /** หัวคอลัมน์ชื่อ เช่น "กองทุน", "แผนก" */
  header: string;
  /** ชื่อปุ่มกางแถวย่อย เช่น "แยกตามสิทธิ" (ต่อด้วยชื่อแถว) */
  expandLabel: string;
  /** แถวย่อยแสดงรหัสหน้าชื่อ (เช่น pttype "89 บัตรทอง") แทนหลังชื่อ */
  childCodeFirst?: boolean;
  /** ไม่แสดงรหัสหลังชื่อแถวหลัก (เมื่อชื่อมีรหัสอยู่แล้ว เช่นแผนก "054-คลินิกรักษ์ตับ") */
  hideRowCode?: boolean;
  /** หัวคอลัมน์ `queued` ถัดจากผู้ป่วย (ไม่ส่ง = ไม่แสดง) แถวรวมแสดง "–" เพราะรวมข้ามแถวไม่ได้ แถวย่อยที่ไม่มีค่าก็แสดง "–" */
  queuedHeader?: string;
  /** หัวคอลัมน์ `queuedAmount` ถัดจาก queued (เงื่อนไขเดียวกับ queuedHeader) */
  queuedAmountHeader?: string;
  selected: string;
  selectedChild: string;
  /** "" = ยกเลิกการเลือก */
  onSelect: (code: string) => void;
  onSelectChild: (parentCode: string, code: string) => void;
  /** ส่ง = ตัวเลข queued (> 0) เป็นปุ่ม childCode "" = แถวหลัก */
  onSelectQueued?: (code: string, childCode: string) => void;
};

// "UNKNOWN" = ไม่ระบุ ไม่ต้องแสดงรหัส (ชื่อจาก API บอกแล้ว)
const Code = ({ code, className }: { code: string; className: string }) =>
  code === "UNKNOWN" ? null : <span className={className}>{code}</span>;

/** ตารางสรุป 2 ชั้น (แถวหลัก + แถวย่อยกางได้) พร้อมสัดส่วนและแถวรวม แถวหลักเรียงมาจาก API แล้ว */
export function SummaryTable({ rows, totals, header, expandLabel, childCodeFirst, hideRowCode, queuedHeader, queuedAmountHeader, selected, selectedChild, onSelect, onSelectChild, onSelectQueued }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(selected ? [selected] : []));
  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const dash = queuedHeader && <td className={`px-3 text-muted ${num}`}>–</td>;
  const amountDash = queuedAmountHeader && <td className={`px-3 text-muted ${num}`}>–</td>;
  const queuedValue = (n: number, label: string, code: string, childCode: string) =>
    onSelectQueued && n > 0 ? (
      <button
        type="button"
        aria-label={`รายการที่ส่งเข้าแผนก ${label} ${formatCount(n)} visit`}
        onClick={() => onSelectQueued(code, childCode)}
        className={`-mx-1 rounded px-1 py-0.5 underline decoration-line underline-offset-2 hover:text-foreground hover:decoration-current ${focusRing}`}
      >
        {formatCount(n)}
      </button>
    ) : (
      formatCount(n)
    );

  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead className="bg-surface text-left text-grid-head text-muted">
          <tr>
            <th className="w-0 pl-2">
              <span className="sr-only">{expandLabel}</span>
            </th>
            <th className="px-3 py-2.5 font-medium">{header}</th>
            <th className={`px-3 py-2.5 font-medium ${num}`}>visit</th>
            <th className={`px-3 py-2.5 font-medium ${num}`}>ผู้ป่วย</th>
            {queuedHeader && <th className={`px-3 py-2.5 font-medium ${num}`}>{queuedHeader}</th>}
            {queuedAmountHeader && <th className={`px-3 py-2.5 font-medium ${num}`}>{queuedAmountHeader}</th>}
            <th className={`px-3 py-2.5 font-medium ${num}`}>มูลค่า (บาท)</th>
            <th className="w-1/5 px-3 py-2.5 font-medium">สัดส่วน</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = expanded.has(r.code);
            const isSelected = r.code === selected;
            const share = pct(r.amount, totals.amount);
            return (
              <Fragment key={r.code}>
                <tr className={`border-t border-line ${isSelected ? "bg-accent-soft" : "hover:bg-surface-sunken"}`}>
                  <td className="w-0 py-1 pr-0 pl-2">
                    <button
                      type="button"
                      aria-label={`${expandLabel} ${r.name}`}
                      aria-expanded={isOpen}
                      disabled={r.children.length === 0}
                      onClick={() => toggle(r.code)}
                      className={`grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-foreground disabled:opacity-30 ${focusRing}`}
                    >
                      <ChevronRight className={`size-4 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} aria-hidden="true" />
                    </button>
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onSelect(isSelected ? "" : r.code)}
                      className={`-mx-1 rounded px-1 py-0.5 text-left hover:underline ${isSelected ? "font-semibold text-accent-text" : "font-medium"} ${focusRing}`}
                    >
                      {r.name}
                      {!hideRowCode && (
                        <>
                          {" "}
                          <Code code={r.code} className="ml-0.5 text-xs font-normal text-muted" />
                        </>
                      )}
                    </button>
                  </td>
                  <td className={`px-3 py-1.5 ${num}`}>{formatCount(r.visits)}</td>
                  <td className={`px-3 py-1.5 ${num}`}>{formatCount(r.patients)}</td>
                  {queuedHeader && <td className={`px-3 py-1.5 ${num}`}>{queuedValue(r.queued ?? 0, r.name, r.code, "")}</td>}
                  {queuedAmountHeader && <td className={`px-3 py-1.5 ${num}`}><Money value={r.queuedAmount ?? 0} /></td>}
                  <td className={`px-3 py-1.5 font-medium ${num}`}><Money value={r.amount} /></td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <ShareBar value={share} />
                      <span className="w-12 shrink-0 text-right text-xs text-muted">{formatPct(share)}</span>
                    </div>
                  </td>
                </tr>
                {isOpen &&
                  r.children.map((c) => {
                    const childSelected = isSelected && c.code === selectedChild;
                    return (
                      <tr key={c.code} className={`text-muted ${childSelected ? "bg-accent-soft" : "bg-surface-sunken/60 hover:bg-surface-sunken"}`}>
                        <td />
                        <td className="py-1 pr-3 pl-7">
                          <button
                            type="button"
                            aria-pressed={childSelected}
                            onClick={() => onSelectChild(r.code, childSelected ? "" : c.code)}
                            className={`-mx-1 rounded px-1 py-0.5 text-left hover:text-foreground hover:underline ${childSelected ? "font-semibold text-accent-text" : ""} ${focusRing}`}
                          >
                            {childCodeFirst ? (
                              <>
                                <Code code={c.code} className="mr-0.5 text-xs" /> {c.name}
                              </>
                            ) : (
                              <>
                                {c.name} <Code code={c.code} className="ml-0.5 text-xs" />
                              </>
                            )}
                          </button>
                        </td>
                        <td className={`px-3 py-1 ${num}`}>{formatCount(c.visits)}</td>
                        <td />
                        {queuedHeader && (c.queued == null ? dash : <td className={`px-3 py-1 ${num}`}>{queuedValue(c.queued, `${r.name} ${c.name}`, r.code, c.code)}</td>)}
                        {queuedAmountHeader && (c.queuedAmount == null ? amountDash : <td className={`px-3 py-1 ${num}`}><Money value={c.queuedAmount} /></td>)}
                        <td className={`px-3 py-1 ${num}`}><Money value={c.amount} /></td>
                        <td className="px-3 py-1 text-right text-xs">
                          <span className="inline-block w-12">{formatPct(pct(c.amount, r.amount))}</span>
                        </td>
                      </tr>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line font-semibold">
            <td />
            <td className="px-3 py-2">รวม</td>
            <td className={`px-3 py-2 ${num}`}>{formatCount(totals.visits)}</td>
            <td className={`px-3 py-2 ${num}`}>{formatCount(totals.patients)}</td>
            {dash}
            {amountDash}
            <td className={`px-3 py-2 ${num}`}><Money value={totals.amount} /></td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
