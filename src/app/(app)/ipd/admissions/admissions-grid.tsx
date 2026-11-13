"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { ChevronRight, ReceiptText } from "lucide-react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import {
  DateRangeFilter,
  useDateRange,
} from "@/components/date-range-filter/date-range-filter";
import { MultiSelect } from "@/components/multi-select/multi-select";
import { FdhPreviewModal } from "@/components/fdh-preview/fdh-preview";
import { usePersistedFilter } from "@/lib/persisted-filter";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { CodeOptionGroup } from "@/app/api/fund/types";
import {
  ADJRW_RATES,
  IPD_MAX_DAYS,
  MAX_EXPORT_ANS,
  type AdmissionDetail,
  type AdmissionRow,
  type AdmissionsPage,
  type RepStatus,
} from "@/app/api/ipd/admissions/admissions";
import {
  Money,
  Skeleton,
  btn,
  focusRing,
  num,
  useJson,
  useUrlParams,
} from "@/app/(app)/fund/_components/ui";
import {
  DebtorItems,
  Fact,
  Facts,
  LoadError,
  Section,
} from "@/app/(app)/fund/uc-debtor/uc-debtor-detail";

const FILTERS = ["pttypes", "wards"] as const;
/** ข้อความอัตรา เช่น "จำหน่ายตั้งแต่ 1 ต.ค. 2569: 5,119.00 บาท/AdjRW · ..." */
const RATE_NOTE = `AdjRW × อัตราตามวันจำหน่าย: ${ADJRW_RATES.map((r) => `ตั้งแต่ ${formatThaiDate(r.from)} ${formatBaht(r.rate)} บาท`).join(" · ")}`;
const dash = <span className="text-muted">–</span>;
const nowrap = { className: "whitespace-nowrap" };
const dateCell = { className: "whitespace-nowrap tabular-nums" };
const chip = "rounded border px-1.5 py-0.5 whitespace-nowrap";
const th = "px-3 py-1.5 font-medium";
const td = "px-3 py-1.5 align-top";
const REP: Record<RepStatus | "none", { label: string; tone: string }> = {
  pass: {
    label: "ผ่าน",
    tone: "border-success-line bg-success-soft text-success",
  },
  c: { label: "ติด C", tone: "border-danger-line bg-danger-soft text-danger" },
  deny: {
    label: "Deny",
    tone: "border-danger-line bg-danger-soft text-danger",
  },
  none: {
    label: "ยังไม่มี REP",
    tone: "border-warning-line bg-warning-soft text-warning",
  },
};


function RepStatusBadge({
  rep,
}: {
  rep?: { rep_no: string | null; rep_date: string | null; status: RepStatus; codes: string[] } | null;
}) {
  if (rep === undefined) return dash; // กองทุนนี้ไม่มี REP หรือโหลด insight ไม่ได้ (บอกในแถบสรุปแล้ว)
  const s = REP[rep?.status ?? "none"];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      title={
        rep?.rep_no
          ? `REP ${rep.rep_no} ${formatThaiDate(rep.rep_date)}`.trim()
          : undefined
      }
    >
      <span className={`${chip} ${s.tone}`}>{s.label}</span>
      {!!rep?.codes.length && (
        <span className="text-muted tabular-nums">{rep.codes.join(", ")}</span>
      )}
    </span>
  );
}

/** Authen Code / Claim Code คั่นด้วย "/" ไม่มีค่าฝั่งไหนแสดงขีด */
function Codes({ row }: { row: AdmissionRow }) {
  if (!row.auth_code && !row.claim_code) return dash;
  return (
    <span className="tabular-nums whitespace-nowrap">
      {row.auth_code ?? <span className="text-muted">–</span>}
      <span className="mx-1 text-muted">/</span>
      {row.claim_code ?? <span className="text-muted">–</span>}
    </span>
  );
}

/** รหัส PDx พร้อมชื่อโรค (ชื่อยาวตัดด้วย title) ไม่มี PDx = ขาด */
function Pdx({ row }: { row: AdmissionRow }) {
  if (!row.pdx) return <span className="font-medium text-danger">ขาด</span>;
  return (
    <span
      className="flex max-w-64 items-baseline gap-1.5"
      title={row.pdx_name ?? undefined}
    >
      <span className="font-medium tabular-nums">{row.pdx}</span>
      {row.pdx_name && (
        <span className="truncate text-muted">{row.pdx_name}</span>
      )}
    </span>
  );
}

const col = gridColumnHelper<AdmissionRow>();
const text = (
  key:
    | "an"
    | "hn"
    | "patient_name"
    | "ward_name"
    | "drg"
    | "pttype_name"
    | "dchstts_name"
    | "dch_reason",
  header: string,
  sortable = true,
) =>
  col.accessor(key, {
    header,
    cell: (c) => c.getValue() || dash,
    meta: nowrap,
    enableSorting: sortable,
  });
const date = (key: "regdate" | "dchdate", header: string) =>
  col.accessor(key, {
    header,
    cell: (c) => formatThaiDate(c.getValue()) || dash,
    meta: dateCell,
  });
const count = (key: "los_days", header: string) =>
  col.accessor(key, {
    header,
    cell: (c) => (c.getValue() == null ? dash : formatCount(c.getValue()!)),
    meta: { className: num },
  });
const decimal = (key: "rw" | "adjrw", header: string) =>
  col.accessor(key, {
    header,
    cell: (c) => c.getValue()?.toFixed(4) ?? dash,
    meta: { className: num },
  });
const money = (key: "income" | "uc_money", header: string) =>
  col.accessor(key, {
    header,
    cell: (c) => <Money value={c.getValue()} />,
    meta: { className: num },
  });

/** รายการที่เลือกส่ง FDH: AN -> ชื่อ (คงอยู่ข้ามหน้าและข้ามตัวกรอง จนกว่าจะล้าง) */
type Selection = {
  picked: Map<string, string>;
  toggle: (rows: AdmissionRow[], on: boolean) => void;
};
const SelectionContext = createContext<Selection>({
  picked: new Map(),
  toggle: () => {},
});
const checkbox = `size-4 cursor-pointer accent-[var(--accent)] ${focusRing}`;

function SelectRow({ row }: { row: AdmissionRow }) {
  const { picked, toggle } = useContext(SelectionContext);
  return (
    <input
      type="checkbox"
      aria-label={`เลือก AN ${row.an} ส่ง FDH`}
      checked={picked.has(row.an)}
      onChange={(e) => toggle([row], e.target.checked)}
      className={checkbox}
    />
  );
}

/** เลือก/ยกเลิกทุกแถวของหน้านี้ */
function SelectPage({ rows }: { rows: AdmissionRow[] }) {
  const { picked, toggle } = useContext(SelectionContext);
  const n = rows.filter((r) => picked.has(r.an)).length;
  return (
    <input
      type="checkbox"
      aria-label="เลือกทุกแถวในหน้านี้"
      checked={rows.length > 0 && n === rows.length}
      ref={(el) => {
        if (el) el.indeterminate = n > 0 && n < rows.length;
      }}
      onChange={(e) => toggle(rows, e.target.checked)}
      className={checkbox}
    />
  );
}

const columns = col.columns([
  col.display({
    id: "select",
    header: (h) => (
      <SelectPage rows={h.table.getRowModel().rows.map((r) => r.original)} />
    ),
    cell: (c) => <SelectRow row={c.row.original} />,
  }),
  text("an", "AN"),
  text("hn", "HN"),
  text("patient_name", "ชื่อ-สกุล", false),
  col.accessor("fund", { header: "กองทุน", meta: nowrap, enableSorting: false }),
  text("pttype_name", "สิทธิ"),
  col.display({
    id: "codes",
    header: "Authen Code/Claim Code",
    cell: (c) => <Codes row={c.row.original} />,
  }),
  date("regdate", "วันที่ admit"),
  date("dchdate", "วันที่จำหน่าย"),
  text("dchstts_name", "สถานะการจำหน่าย"),
  text("dch_reason", "เหตุผลการจำหน่าย"),
  text("ward_name", "หอผู้ป่วย"),
  count("los_days", "วันนอน"),
  col.accessor("days_since_dch", {
    header: "หลังจำหน่าย (วัน)",
    cell: (c) => {
      const v = c.getValue();
      if (v == null) return dash;
      // ตัวชี้ให้ตาม: เกิน 30 วันและยังไม่มี REP (กองทุนที่ไม่มี REP ดูจากจำนวนวันอย่างเดียว)
      return c.row.original.overdue ? (
        <span
          className="font-medium text-warning"
          title="เกิน 30 วันและยังไม่มี REP"
        >
          {formatCount(v)}
        </span>
      ) : (
        formatCount(v)
      );
    },
    meta: { className: num },
  }),
  col.accessor("summary_status_name", {
    id: "ipt_summary_status_id",
    header: "สรุปชาร์ต",
    cell: (c) => c.getValue() || dash,
    meta: nowrap,
  }),
  col.accessor("pdx", {
    header: "PDx",
    cell: (c) => <Pdx row={c.row.original} />,
  }),
  text("drg", "DRG", false),
  decimal("rw", "RW"),
  decimal("adjrw", "AdjRW"),
  // ช่วงคร่อมวันเปลี่ยนอัตรา ลำดับยอดไม่เท่ากับลำดับ AdjRW จึงไม่ให้ sort (เรียงตาม AdjRW แทนได้)
  col.accessor("adjrw_amount", {
    header: "ยอดคำนวณเงิน (บาท)",
    cell: (c) => (c.getValue() == null ? dash : <Money value={c.getValue()} />),
    meta: { className: num },
    enableSorting: false,
  }),
  col.accessor("finance_lock", {
    header: "ปิดสิทธิการเงิน",
    cell: (c) =>
      c.getValue() ? "ปิดแล้ว" : <span className="text-muted">ยังไม่ปิด</span>,
    meta: nowrap,
  }),
  // สถานะ REP มีเฉพาะ UCS แถวกองทุนอื่นแสดงขีด
  col.display({
    id: "rep",
    header: "สถานะ REP",
    cell: (c) => <RepStatusBadge rep={c.row.original.rep} />,
  }),
  money("income", "มูลค่า (บาท)"),
  money("uc_money", "ลูกหนี้สิทธิ (บาท)"),
]);

/** รหัสโรคและหัตถการทั้งหมดของ admission โหลดเมื่อเปิด modal */
function CodingDetail({ an }: { an: string }) {
  const { loading, data, error, retry } = useJson<AdmissionDetail>(
    `/api/ipd/admission-detail?${new URLSearchParams({ an })}`,
  );
  if (loading)
    return (
      <Section title="รหัสโรคและหัตถการ">
        <Skeleton rows={4} />
      </Section>
    );
  if (error || !data)
    return (
      <Section title="รหัสโรคและหัตถการ">
        <LoadError what="รหัสโรคและหัตถการ" error={error} retry={retry} />
      </Section>
    );
  return (
    <>
      <Section title={`รหัสโรค (${formatCount(data.diags.length)})`}>
        {data.diags.length ? (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th scope="col" className={th}>
                    ประเภท
                  </th>
                  <th scope="col" className={th}>
                    ICD-10
                  </th>
                  <th scope="col" className={th}>
                    ชื่อโรค
                  </th>
                  <th scope="col" className={th}>
                    แพทย์
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.diags.map((d, i) => (
                  <tr
                    key={i}
                    className={`border-t border-line ${d.diagtype === "1" ? "font-medium" : ""}`}
                  >
                    <td className={`${td} whitespace-nowrap`}>
                      {d.diagtype_name ?? d.diagtype}
                    </td>
                    <td className={`${td} tabular-nums`}>{d.icd10}</td>
                    <td className={td}>{d.icd_name || dash}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      {d.doctor_name || dash}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="font-medium text-danger">ยังไม่มีรหัสโรค</p>
        )}
      </Section>
      {/* หัตถการยาวได้หลายสิบแถว จึงหุบได้ (native details: คีย์บอร์ด/screen reader ใช้ได้เอง) */}
      <details open className="group mt-6 border-t border-line pt-5">
        <summary
          className={`flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-base font-semibold [&::-webkit-details-marker]:hidden ${focusRing}`}
        >
          <ChevronRight
            className="size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-90"
            aria-hidden="true"
          />
          หัตถการ ({formatCount(data.opers.length)})
        </summary>
        <div className="mt-3">
          {data.opers.length ? (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th scope="col" className={th}>
                      ICD-9-CM
                    </th>
                    <th scope="col" className={th}>
                      ชื่อหัตถการ
                    </th>
                    <th scope="col" className={th}>
                      เริ่ม
                    </th>
                    <th scope="col" className={th}>
                      สิ้นสุด
                    </th>
                    <th scope="col" className={th}>
                      แพทย์
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.opers.map((o, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className={`${td} tabular-nums`}>{o.icd9}</td>
                      <td className={td}>{o.icd_name || dash}</td>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>
                        {formatThaiDate(o.opdate) || dash}{" "}
                        {o.optime?.slice(0, 5)}
                      </td>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>
                        {formatThaiDate(o.enddate) || dash}{" "}
                        {o.endtime?.slice(0, 5)}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        {o.doctor_name || dash}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted">ไม่มีหัตถการ</p>
          )}
        </div>
      </details>
    </>
  );
}

const renderDetail = (r: AdmissionRow) => (
  <div className="text-sm">
    <Facts>
      <Fact label="HN">{r.hn}</Fact>
      <Fact label="สิทธิ">
        {r.pttype_name ? `${r.pttype_name} (${r.fund})` : r.fund}
      </Fact>
      <Fact label="หอผู้ป่วย">{r.ward_name}</Fact>
      <Fact label="วันที่ admit">{formatThaiDate(r.regdate)}</Fact>
      <Fact label="วันที่จำหน่าย">{formatThaiDate(r.dchdate)}</Fact>
      <Fact label="สถานะการจำหน่าย">{r.dchstts_name}</Fact>
      <Fact label="เหตุผลการจำหน่าย">{r.dch_reason}</Fact>
      <Fact label="Authen Code">{r.auth_code}</Fact>
      <Fact label="Claim Code">{r.claim_code}</Fact>
      <Fact label="วันนอน">
        {r.los_days == null ? null : formatCount(r.los_days)}
      </Fact>
      <Fact label="DRG">{r.drg}</Fact>
      <Fact label="RW / AdjRW">{`${r.rw?.toFixed(4) ?? "–"} / ${r.adjrw?.toFixed(4) ?? "–"}`}</Fact>
      <Fact label="สรุปชาร์ต">{r.summary_status_name}</Fact>
      <Fact label="มูลค่า (บาท)">
        <span className="font-semibold">{formatBaht(r.income)}</span>
      </Fact>
      <Fact label="ลูกหนี้สิทธิ (บาท)">
        <span className="font-semibold">{formatBaht(r.uc_money)}</span>
      </Fact>
    </Facts>
    <CodingDetail an={r.an} />
    <DebtorItems vn={null} an={r.an} debtor={r.uc_money} />
  </div>
);
const detailTitle = (r: AdmissionRow) => (
  <>
    {r.patient_name || "–"}{" "}
    <span className="font-normal text-muted tabular-nums">AN {r.an}</span>
  </>
);

/** ตัวเลขสรุปหนึ่งค่าในกรอบ: ป้ายจาง + ค่าเด่น + หน่วย/รายละเอียดจาง */
/** สีของ badge: พื้น + เส้น + สีตัวอักษรที่ token ออกแบบให้อ่านบนพื้นนั้น (ป้าย ค่า หน่วย ใช้สีเดียวกันทั้งกรอบ) */
const STAT_TONE = {
  neutral: "border-line bg-surface-sunken text-foreground",
  soft: "border-accent-line bg-accent-soft text-accent-text",
  strong: "border-accent bg-accent text-accent-fg",
} as const;

/** ตัวเลขสรุปหนึ่งค่าในกรอบ: ป้าย + ค่าตัวหนา + หน่วย ทุกส่วนใช้สีของกรอบ */
function Stat({
  label,
  title,
  tone = "neutral",
  children,
}: {
  label: string;
  title?: string;
  tone?: keyof typeof STAT_TONE;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-baseline gap-1.5 rounded-md border px-2.5 py-1 ${STAT_TONE[tone]}`}
    >
      <span className="text-sm">{label}</span>
      {children}
    </span>
  );
}

// CMI ของทั้งชุดที่ตรงตัวกรอง (ไม่ใช่แค่หน้าปัจจุบัน) = ผลรวม AdjRW / จำนวนรายที่มี AdjRW
const renderSummary = (d: AdmissionsPage) => (
  <div className="flex flex-col gap-1.5">
    <p className="flex flex-wrap items-center gap-2 tabular-nums">
      <Stat label="จำนวน">
        <span className="font-semibold">{formatCount(d.total)}</span> ราย
      </Stat>
      <Stat
        label="CMI"
        title="CMI = ผลรวม AdjRW ÷ จำนวนรายที่มี AdjRW"
        tone="soft"
      >
        <span className="font-semibold">
          {d.cmi == null ? "–" : d.cmi.toFixed(4)}
        </span>
      </Stat>
      <Stat label="AdjRW รวม">
        <span className="font-semibold">{d.adjrw_sum.toFixed(4)}</span> จาก{" "}
        {formatCount(d.adjrw_n)} ราย
      </Stat>
      {/* ยอดเงินเด่นสุดในแถบ: พื้นเขียวสด (--accent) ตัวอักษร --accent-fg ที่ออกแบบให้อ่านบนพื้นนี้ */}
      <Stat label="ยอดคำนวณเงิน" title={RATE_NOTE} tone="strong">
        <span className="font-semibold">{formatBaht(d.adjrw_amount)}</span> บาท
      </Stat>
    </p>
    {d.adjrw_amount_n < d.adjrw_n && (
      <p role="status" className="text-xs text-warning">
        {formatCount(d.adjrw_n - d.adjrw_amount_n)} รายจำหน่ายก่อน{" "}
        {formatThaiDate(ADJRW_RATES[ADJRW_RATES.length - 1].from)}{" "}
        ยังไม่มีอัตราบาทต่อ AdjRW จึงไม่รวมในยอด
      </p>
    )}
    {d.rep_error && (
      <p role="status" className="text-xs text-warning">
        โหลดสถานะ REP ไม่ได้ คอลัมน์สถานะ REP จึงว่าง
      </p>
    )}
  </div>
);

const split = (v: string) => (v ? v.split(",") : []);
const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 text-sm font-medium ${focusRing}`;
const CUSTOM = "custom";

/** เลือกกองทุน = ตั้ง pttypes เป็นทุกสิทธิของกองทุนนั้น (ใช้ตัวกรองเดียวกับ MultiSelect) เลือกบางสิทธิเองจะแสดง "กำหนดเอง" */
export function FundSelect({
  groups,
  value,
  onChange,
}: {
  groups: CodeOptionGroup[];
  value: string[];
  onChange: (codes: string[]) => void;
}) {
  const key = [...value].sort().join(",");
  const current = !value.length
    ? ""
    : (groups.find(
        (g) =>
          g.options
            .map((o) => o.value)
            .sort()
            .join(",") === key,
      )?.value ?? CUSTOM);
  return (
    <label className="flex items-center gap-2 text-sm" title="กรองตามกองทุน">
      <span className="sr-only">กรองตามกองทุน</span>
      <select
        value={current}
        onChange={(e) =>
          onChange(
            e.target.value
              ? (groups
                  .find((g) => g.value === e.target.value)
                  ?.options.map((o) => o.value) ?? [])
              : [],
          )
        }
        className={SELECT_CLASS}
      >
        <option value="">ทั้งหมด</option>
        {groups.map((g) => (
          <option key={g.value} value={g.value}>
            {g.value} {g.label !== g.value ? g.label : ""}
          </option>
        ))}
        {current === CUSTOM && (
          <option value={CUSTOM} disabled>
            กำหนดเอง
          </option>
        )}
      </select>
    </label>
  );
}

/** ปุ่มเปิดดู 16 แฟ้มของรายที่เลือก วางหน้าปุ่มส่งออก Excel ในแถบสรุปของ DataGrid */
function PreviewButton({ onOpen }: { onOpen: () => void }) {
  const { picked } = useContext(SelectionContext);
  const n = picked.size;
  return (
    <button
      type="button"
      disabled={!n || n > MAX_EXPORT_ANS}
      onClick={onOpen}
      title={n ? undefined : "ติ๊กเลือกรายที่จะส่ง FDH ในตารางก่อน"}
      className={`${btn} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {`ดู 16 แฟ้ม${n ? ` ${formatCount(n)} ราย` : ""}`}
    </button>
  );
}

/** แถบรายการที่เลือกเหนือตาราง: จำนวนและล้าง */
function SelectionBar({ onClear }: { onClear: () => void }) {
  const { picked } = useContext(SelectionContext);
  const n = picked.size;
  if (!n) return null;
  return (
    <div className="mb-3 flex flex-col gap-1.5 rounded-lg border border-accent-line bg-accent-soft px-3 py-2 text-sm text-accent-text">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span>
          เลือกส่ง FDH{" "}
          <span className="font-semibold tabular-nums">{formatCount(n)}</span>{" "}
          ราย
        </span>
        <button
          type="button"
          onClick={onClear}
          className={`rounded px-1.5 underline-offset-2 hover:underline ${focusRing}`}
        >
          ล้างที่เลือก
        </button>
      </div>
      {n > MAX_EXPORT_ANS && (
        <p role="alert" className="text-xs text-danger">
          เลือกได้ไม่เกิน {formatCount(MAX_EXPORT_ANS)} รายต่อครั้ง
        </p>
      )}
    </div>
  );
}

export function AdmissionsGrid({
  pttypeOptions,
  wardOptions,
}: {
  pttypeOptions: CodeOptionGroup[];
  wardOptions: CodeOptionGroup[];
}) {
  usePersistedFilter("ipd/admissions", FILTERS);
  const { start, end } = useDateRange(IPD_MAX_DAYS);
  const { pttypes, wards, set } = useUrlParams(FILTERS);
  const [picked, setPicked] = useState<Map<string, string>>(() => new Map());
  const toggle = (rows: AdmissionRow[], on: boolean) =>
    setPicked((prev) => {
      const next = new Map(prev);
      for (const r of rows) {
        if (on) next.set(r.an, r.patient_name);
        else next.delete(r.an);
      }
      return next;
    });
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <SelectionContext.Provider value={{ picked, toggle }}>
      <SelectionBar onClear={() => setPicked(new Map())} />
      <FdhPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        ids={[...picked.keys()]}
        idField="ans"
        previewUrl="/api/ipd/fdh-export"
        checkUrl="/api/ipd/fdh-check"
        zipPrefix="ip"
        unit="ราย"
      />
      <DataGrid<AdmissionRow, AdmissionsPage>
        endpoint="/api/ipd/admissions"
        params={{ start, end, pttypes, wards }}
        liveSearch
        // fragment: ตัวกรองทุกตัวอยู่แถวเดียวกับช่องค้นหาของ DataGrid (จอแคบขึ้นบรรทัดใหม่เอง) ห้ามห่อด้วย div ที่ wrap แยก
        toolbar={
          <>
            <FundSelect
              groups={pttypeOptions}
              value={split(pttypes)}
              onChange={(v) => set({ pttypes: v.join(",") })}
            />
            <MultiSelect
              label="กรองตามสิทธิการรักษา"
              hideLabel
              groups={pttypeOptions}
              value={split(pttypes)}
              onChange={(v) => set({ pttypes: v.join(",") })}
            />
            <MultiSelect
              label="กรองตามหอผู้ป่วย"
              hideLabel
              groups={wardOptions}
              value={split(wards)}
              onChange={(v) => set({ wards: v.join(",") })}
            />
            <div
              role="group"
              aria-label="วันที่จำหน่าย"
              className="flex items-center gap-2"
            >
              <DateRangeFilter
                maxDays={IPD_MAX_DAYS}
                hideLabels
                labels={{
                  preset: "ช่วงวันที่จำหน่าย",
                  start: "วันที่จำหน่าย ตั้งแต่",
                  end: "วันที่จำหน่าย ถึง",
                }}
              />
            </div>
          </>
        }
        columns={columns}
        getRowId={(r) => r.an}
        renderDetail={renderDetail}
        detailTitle={detailTitle}
        detailSize="medium"
        renderSummary={renderSummary}
        exportPlacement="summary"
        summaryActions={<PreviewButton onOpen={() => setPreviewOpen(true)} />}
        searchSize="compact"
        detailIcon={<ReceiptText aria-hidden className="size-4" />}
      />
    </SelectionContext.Provider>
  );
}
