"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { ChevronRight, ReceiptText } from "lucide-react";
import { DataGrid, gridColumnHelper, type SummaryGrid } from "@/components/data-grid/data-grid";
import { copyable } from "@/components/copy-button/copy-button";
import { PatientName } from "@/components/patient-name/patient-name";
import {
  DateRangeFilter,
  useDateRange,
} from "@/components/date-range-filter/date-range-filter";
import { MultiSelect } from "@/components/multi-select/multi-select";
import { FdhPreviewModal } from "@/components/fdh-preview/fdh-preview";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { usePersistedFilter } from "@/lib/persisted-filter";
import { DX_GROUPS, DX_POSITIONS } from "@/lib/dx-groups";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { CodeOptionGroup } from "@/app/api/fund/types";
import {
  ADJRW_RATES,
  IPD_MAX_DAYS,
  MAX_EXPORT_ANS,
  MAX_SELECT_ANS,
  PDX_SUMMARY_DAYS,
  parseAdjrw,
  pdxMissing,
  type AdmissionDetail,
  type AdmissionRow,
  type AdmissionsPage,
  type RepInfo,
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
  RepDetail,
  Section,
} from "@/app/(app)/fund/uc-debtor/uc-debtor-detail";
import { SubfundBadges } from "@/app/(app)/fund/_components/subfund-badges";
import { ClaimBadge } from "@/app/(app)/fund/_components/claim-badge";
import { OVERDUE_VALUES, UNSENT_VALUES } from "@/app/api/fdh/claim-batch/claim";

const FILTERS = ["pttypes", "wards", "dx", "dxpos", "adjrw_min", "adjrw_max"] as const;
const DX_OPTIONS = [{ value: "dx", label: "กลุ่มโรค", options: DX_GROUPS.map((g) => ({ value: g.key, label: g.label })) }];
/** ข้อความอัตรา เช่น "จำหน่ายตั้งแต่ 1 ต.ค. 2569: 5,119.00 บาท/AdjRW · ..." */
const RATE_NOTE = `AdjRW × อัตราตามวันจำหน่าย: ${ADJRW_RATES.map((r) => `ตั้งแต่ ${formatThaiDate(r.from)} ${formatBaht(r.rate)} บาท`).join(" · ")}`;
const dash = <span className="text-muted">–</span>;
const nowrap = { className: "whitespace-nowrap" };
const dateCell = { className: "whitespace-nowrap tabular-nums" };
// ตัวกรองหัวคอลัมน์ (ค่าจาก /api/ipd/admissions?facet=<id>) ทุกคอลัมน์ยกเว้น RW/AdjRW/เงิน/สถานะ REP
const filterable = { ...nowrap, filter: true } as const;
const dateFilter = { ...dateCell, filter: { format: (v: string) => formatThaiDate(v) || v } } as const;
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


/**
 * สถานะ REP ของแถว: พบ REP = ปุ่มเลขที่ REP (เขียวผ่าน / แดงติด C หรือ Deny) กดเปิดรายละเอียด REP
 * null = ยังไม่มี REP, undefined = ไม่มีสถานะ (กองทุนที่ไม่ได้เบิกผ่าน REP หรือโหลด insight ไม่ได้ บอกในแถบสรุปแล้ว)
 */
export function RepBadge({
  rep,
  type,
  repKey,
  title,
}: {
  rep?: RepInfo | null;
  type: "opd" | "ipd";
  /** VN (opd) หรือ AN (ipd) */
  repKey: string;
  title: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (rep === undefined) return dash;
  if (rep === null) return <span className={`${chip} ${REP.none.tone}`}>{REP.none.label}</span>;
  const s = REP[rep.status];
  const date = formatThaiDate(rep.rep_date);
  const name = rep.rep_no || s.label;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`ดูรายละเอียด REP ${name} ${s.label}`}
        title={`${s.label}${date ? ` · ${date}` : ""}`}
        className={`${chip} ${s.tone} cursor-pointer tabular-nums hover:underline ${focusRing}`}
      >
        {name}
      </button>
      {!!rep.codes.length && (
        <span className="text-muted tabular-nums">{rep.codes.join(", ")}</span>
      )}
      <DetailModal
        open={open}
        onClose={() => setOpen(false)}
        size="medium"
        title={title}
      >
        {/* โหลดรายละเอียดเฉพาะตอนเปิด ไม่ให้ทุกแถวยิง request */}
        {open && (
          <div className="text-sm">
            <Facts>
              <Fact label="เลขที่ REP">{rep.rep_no}</Fact>
              <Fact label="สถานะ">
                <span className={`${chip} ${s.tone}`}>{s.label}</span>
              </Fact>
              <Fact label="วันที่ไฟล์ REP">{date}</Fact>
              <Fact label="รหัส">{rep.codes.join(", ")}</Fact>
            </Facts>
            <RepDetail type={type} repKey={repKey} />
          </div>
        )}
      </DetailModal>
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

/** รหัส PDx พร้อมชื่อโรค (ชื่อยาวตัดด้วย title) ไม่มี PDx: จำหน่ายเกิน 7 วัน = ขาด ไม่งั้น รอสรุป */
function Pdx({ row }: { row: AdmissionRow }) {
  if (!row.pdx) {
    const days = row.days_since_dch;
    const ago = days == null ? "" : `จำหน่ายแล้ว ${formatCount(days)} วัน`;
    return pdxMissing(days) === "pending" ? (
      <span className={`${chip} border-line text-muted`} title={`${ago} (สรุปภายใน ${PDX_SUMMARY_DAYS} วัน)`}>
        รอสรุป
      </span>
    ) : (
      <span
        className={`${chip} border-danger-line bg-danger-soft font-medium text-danger`}
        title={ago ? `${ago} ยังไม่มี PDx` : "ยังไม่มี PDx"}
      >
        ขาด
      </span>
    );
  }
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

/** เหตุผลการจำหน่าย: ส่งต่อ (dchtype 04, ชื่อเป็น fallback) เป็นป้ายเหลือง ค่าอื่นเป็นข้อความ */
function DchReason({ row }: { row: AdmissionRow }) {
  const v = row.dch_reason;
  if (row.dchtype === "04" || v?.toLowerCase() === "by transfer")
    return <span className={`${chip} border-warning-line bg-warning-soft text-warning`}>{v || "By Transfer"}</span>;
  return v || dash;
}

const col = gridColumnHelper<AdmissionRow>();
const text = (
  key:
    | "an"
    | "hn"
    | "drg"
    | "pttype_name"
    | "dchstts_name",
  header: string,
  sortable = true,
) =>
  col.accessor(key, {
    header,
    cell: (c) => c.getValue() || dash,
    meta: filterable,
    enableSorting: sortable,
  });
const date = (key: "regdate" | "dchdate", header: string) =>
  col.accessor(key, {
    header,
    cell: (c) => formatThaiDate(c.getValue()) || dash,
    meta: dateFilter,
  });
const count = (key: "los_days", header: string) =>
  col.accessor(key, {
    header,
    cell: (c) => (c.getValue() == null ? dash : formatCount(c.getValue()!)),
    meta: { className: num, filter: true },
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
  col.accessor("patient_name", {
    header: "ชื่อ-สกุล",
    cell: (c) => <PatientName name={c.getValue()} sexAge={c.row.original.sex_age} />,
    meta: filterable,
    enableSorting: false,
  }),
  col.accessor("ward_name", {
    header: "Ward",
    cell: (c) => <span title={c.row.original.ward ?? undefined}>{c.getValue() || dash}</span>,
    meta: filterable,
  }),
  col.accessor("fund", { header: "กองทุน", meta: filterable, enableSorting: false }),
  text("pttype_name", "สิทธิ"),
  col.display({
    id: "codes",
    header: "Authen Code/Claim Code",
    cell: (c) => <Codes row={c.row.original} />,
    meta: { filter: true },
  }),
  date("regdate", "วันที่ admit"),
  date("dchdate", "วันที่จำหน่าย"),
  text("dchstts_name", "สถานะการจำหน่าย"),
  col.accessor("dch_reason", {
    header: "เหตุผลการจำหน่าย",
    cell: (c) => <DchReason row={c.row.original} />,
    meta: filterable,
  }),
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
    meta: { className: num, filter: true },
  }),
  col.accessor("summary_status_name", {
    id: "ipt_summary_status_id",
    header: "สรุปชาร์ต",
    cell: (c) => c.getValue() || dash,
    meta: filterable,
  }),
  col.accessor("pdx", {
    header: "PDx",
    cell: (c) => <Pdx row={c.row.original} />,
    meta: { filter: true },
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
    meta: filterable,
  }),
  // สถานะเคลมจากหลักฐานที่แรงสุด (STM > REP > ส่งออกจากระบบนี้) คำนวณใน route จึงไม่มี sort ตัวกรองเป็นสถานะ
  col.display({
    id: "claim",
    header: "สถานะเคลม",
    cell: (c) => <ClaimBadge claim={c.row.original.claim} type="IP" />,
    meta: { filter: true },
  }),
  // พบ REP แสดงทุกกองทุน ; "ยังไม่มี REP" เฉพาะ UCS แถวกองทุนอื่นแสดงขีด
  col.display({
    id: "rep",
    header: "REP",
    cell: (c) => (
      <RepBadge
        rep={c.row.original.rep}
        type="ipd"
        repKey={c.row.original.an}
        title={detailTitle(c.row.original)}
      />
    ),
    meta: { filter: true },
  }),
  // กองทุนย่อยตามกติกาของ /admin/ar-funds สีตามผลเทียบ REP ; คำนวณใน route จึงไม่มี sort
  col.display({
    id: "subfund",
    header: "กองทุนย่อย",
    cell: (c) => <SubfundBadges funds={c.row.original.subfunds} title={detailTitle(c.row.original)} />,
    meta: { filter: true },
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
      <Fact label="HN">{copyable(r.hn, "HN")}</Fact>
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
    <span className="font-normal text-muted tabular-nums">AN {copyable(r.an, "AN")}</span>
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

/** ค่าของตัวกรองหัวคอลัมน์ rep ที่แปลว่ามี REP แล้ว (ตรงกับ rep_sent ของ route) เรียงแล้ว */
const REP_SENT = ["c", "deny", "pass"];

/** กล่องสรุปที่กดแล้วตั้งตัวกรองหัวคอลัมน์ col = values (ชุดเดียวกับติ๊กในหัวคอลัมน์) กดอีกครั้ง = ล้าง ; n null = โหลดไม่ได้, undefined = ไม่ได้นับ (แสดงแค่ป้าย) */
export function FilterStat({
  grid,
  col,
  values,
  label,
  n,
  title,
}: {
  grid: SummaryGrid;
  col: string;
  values: string[];
  label: string;
  n?: number | null;
  title: string;
}) {
  const cls = `inline-flex items-baseline gap-1.5 rounded-md border px-2.5 py-1 ${STAT_TONE.neutral}`;
  if (n === null)
    return (
      <span className={cls} title={title}>
        <span className="text-sm">{label}</span>
        <span className="font-semibold text-muted">–</span>
      </span>
    );
  const cur = grid.columnFilters[col] ?? [];
  // เทียบความยาวด้วย: ไม่มีตัวกรอง ([]) กับ [""] join แล้วได้ "" เหมือนกัน
  const on = cur.length === values.length && [...cur].sort().join() === values.join();
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => grid.setColumnFilter(col, on ? [] : values)}
      title={`${title} · ${on ? "กดเพื่อล้างตัวกรอง" : "กดเพื่อกรองตาราง"}`}
      className={`${cls} cursor-pointer hover:bg-hover ${on ? "ring-2 ring-ring" : ""} ${focusRing}`}
    >
      <span className="text-sm">{label}</span>
      {n !== undefined && (
        <>
          <span className="font-semibold">{formatCount(n)}</span> ราย
        </>
      )}
    </button>
  );
}

const pct = (n: number, total: number) => (total ? ` (${((n / total) * 100).toFixed(1)}%)` : "");

// CMI ของทั้งชุดที่ตรงตัวกรอง (ไม่ใช่แค่หน้าปัจจุบัน) = ผลรวม AdjRW / จำนวนรายที่มี AdjRW
const renderSummary = (d: AdmissionsPage, grid: SummaryGrid) => (
  <div className="flex flex-col gap-1.5">
    <p className="flex flex-wrap items-center gap-2 tabular-nums">
      <Stat label="จำนวน">
        <span className="font-semibold">{formatCount(d.total)}</span> ราย
      </Stat>
      <FilterStat
        grid={grid}
        col="rep"
        values={REP_SENT}
        label="เรียกเก็บแล้ว"
        n={d.rep_sent}
        title={d.rep_sent == null ? "โหลด REP ไม่ได้" : `มี REP แล้ว ${formatCount(d.rep_sent)} จาก ${formatCount(d.total)} ราย${pct(d.rep_sent, d.total)}`}
      />
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
      <FilterStat
        grid={grid}
        col="pdx"
        values={[""]}
        label="ไม่มี PDx"
        n={d.no_pdx}
        title={`ไม่มีรหัสโรคหลัก ${formatCount(d.no_pdx)} จาก ${formatCount(d.total)} ราย${pct(d.no_pdx, d.total)}`}
      />
      <ClaimStats grid={grid} counts={d.claim_counts} type="IP" />
    </p>
    {d.rep_error && (
      <p role="status" className="text-xs text-warning">
        โหลดสถานะ REP ไม่ได้ คอลัมน์ REP จึงว่าง
      </p>
    )}
    {d.subfund_error && (
      <p role="status" className="text-xs text-warning">
        โหลดกองทุนย่อยไม่ได้ คอลัมน์กองทุนย่อยจึงว่าง
      </p>
    )}
    {d.claim_error && (
      <p role="status" className="text-xs text-warning">
        โหลดสถานะเคลมไม่ได้ คอลัมน์สถานะเคลมจึงว่าง
      </p>
    )}
  </div>
);

/** ปุ่ม "ยังไม่ส่ง" (รวมรอปิดสิทธิ) และ "เกินกำหนด" ตั้งตัวกรองหัวคอลัมน์ claim ; counts undefined = ไม่ได้นับ, null = โหลดไม่ได้ */
export function ClaimStats({ grid, counts, type }: { grid: SummaryGrid; counts?: { unsent: number; overdue: number } | null; type: "OP" | "IP" }) {
  const unit = type === "OP" ? "visit" : "ราย";
  const n = (k: "unsent" | "overdue") => (counts === undefined ? undefined : (counts?.[k] ?? null));
  const title = (k: "unsent" | "overdue", what: string) =>
    counts === null ? "โหลดสถานะเคลมไม่ได้" : counts ? `${what} ${formatCount(counts[k])} ${unit}` : `กรองตารางเฉพาะ${what}`;
  return (
    <>
      <FilterStat grid={grid} col="claim" values={UNSENT_VALUES} label="ยังไม่ส่ง" n={n("unsent")} title={title("unsent", "ยังไม่มีหลักฐานการส่งเคลม (รวมรอปิดสิทธิ)")} />
      <FilterStat grid={grid} col="claim" values={OVERDUE_VALUES} label="เกินกำหนด" n={n("overdue")} title={title("overdue", "ยังไม่ส่งและเกินกำหนดส่ง")} />
    </>
  );
}

// ยอดเงินใต้ตาราง พื้นเขียวสด (--accent) ตัวอักษร --accent-fg ที่ออกแบบให้อ่านบนพื้นนี้ ; คำเตือนรายที่ไม่รวมในยอดอยู่ข้างยอด
const renderFooter = (d: AdmissionsPage) => (
  <>
    <Stat label="ยอดคำนวณเงิน" title={RATE_NOTE} tone="strong">
      <span className="font-semibold tabular-nums">{formatBaht(d.adjrw_amount)}</span> บาท
    </Stat>
    {d.adjrw_amount_n < d.adjrw_n && (
      <p role="status" className="text-xs text-warning">
        {formatCount(d.adjrw_n - d.adjrw_amount_n)} รายจำหน่ายก่อน{" "}
        {formatThaiDate(ADJRW_RATES[ADJRW_RATES.length - 1].from)}{" "}
        ยังไม่มีอัตราบาทต่อ AdjRW จึงไม่รวมในยอด
      </p>
    )}
  </>
);

const split =(v: string) => (v ? v.split(",") : []);
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

const ADJRW_INPUT = `h-9 w-14 rounded-md border border-line bg-surface px-2 text-right text-sm tabular-nums aria-invalid:border-danger aria-invalid:text-danger ${focusRing}`;
const ADJRW_ERROR = "AdjRW ต้องเป็นตัวเลข 0–100 และค่าตั้งแต่ต้องไม่เกินค่าถึง";

/** ช่วง AdjRW (รวมขอบ ใส่ช่องเดียวได้) เขียน URL ตอน blur/Enter ; ค่าผิดแสดง invalid ที่ช่องและไม่ส่ง */
function AdjrwFilter({ min, max, onChange }: { min: string; max: string; onChange: (min: string, max: string) => void }) {
  const [draft, setDraft] = useState({ min, max });
  const [bad, setBad] = useState(() => parseAdjrw(min, max) === "invalid");
  // URL เปลี่ยนจากที่อื่น (ย้อนกลับ/ล้าง) = ร่างตาม ; ค่าที่ช่องนี้ส่งเองไม่ทับร่าง (ผู้ใช้อาจพิมพ์ต่อก่อน URL เปลี่ยนเสร็จ) และไม่ remount เพื่อไม่ทิ้ง focus
  const [url, setUrl] = useState({ min, max });
  const [sent, setSent] = useState({ min, max });
  if (url.min !== min || url.max !== max) {
    setUrl({ min, max });
    setDraft((d) => ({ min: min !== url.min && min !== sent.min ? min : d.min, max: max !== url.max && max !== sent.max ? max : d.max }));
  }
  const commit = () => {
    const ok = parseAdjrw(draft.min, draft.max) !== "invalid";
    setBad(!ok);
    const next = { min: draft.min.trim(), max: draft.max.trim() };
    if (ok && (next.min !== min || next.max !== max)) {
      setSent(next);
      onChange(next.min, next.max);
    }
  };
  // ช่องเดียวผิด = ช่องนั้น ; ทั้งสองถูกแต่ min > max = ทั้งสองช่อง
  const badMin = bad && (parseAdjrw(draft.min, null) === "invalid" || parseAdjrw(null, draft.max) !== "invalid");
  const badMax = bad && (parseAdjrw(null, draft.max) === "invalid" || parseAdjrw(draft.min, null) !== "invalid");
  const field = (k: "min" | "max", label: string, invalid: boolean) => (
    <input
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? "adjrw-error" : undefined}
      title={invalid ? ADJRW_ERROR : label}
      value={draft[k]}
      onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className={ADJRW_INPUT}
    />
  );
  return (
    <div role="group" aria-label="ช่วง AdjRW" className="flex items-center gap-1 text-sm">
      <span className="font-medium text-muted" aria-hidden>AdjRW</span>
      {field("min", "AdjRW ตั้งแต่", badMin)}
      <span className="text-muted" aria-hidden>–</span>
      {field("max", "AdjRW ถึง", badMax)}
      {bad && (
        <span id="adjrw-error" role="alert" className="sr-only">
          {ADJRW_ERROR}
        </span>
      )}
    </div>
  );
}

/** ปุ่มเปิดดู 16 แฟ้มของรายที่เลือก วางหน้าปุ่มส่งออก Excel ในแถบสรุปของ DataGrid */
function PreviewButton({ onOpen }: { onOpen: () => void }) {
  const { picked } = useContext(SelectionContext);
  const n = picked.size;
  return (
    <button
      type="button"
      disabled={!n || n > MAX_SELECT_ANS}
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
          เลือก{" "}
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
      {n > MAX_SELECT_ANS && (
        <p role="alert" className="text-xs text-danger">
          เลือกได้ไม่เกิน {formatCount(MAX_SELECT_ANS)} รายต่อครั้ง
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
  const { pttypes, wards, dx, dxpos, adjrw_min, adjrw_max, set } = useUrlParams(FILTERS);
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
        chunkSize={MAX_EXPORT_ANS}
        unit="ราย"
      />
      <DataGrid<AdmissionRow, AdmissionsPage>
        endpoint="/api/ipd/admissions"
        // AdjRW ใน URL ที่ผิด (link ที่แก้มือ) ไม่ส่ง API ไม่งั้นทั้งตารางตอบ 400 ; ช่องแสดง invalid แทน
        params={{ start, end, pttypes, wards, dx, dxpos, ...(parseAdjrw(adjrw_min, adjrw_max) !== "invalid" && { adjrw_min, adjrw_max }) }}
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
            <MultiSelect
              label="กรองตามกลุ่มโรค"
              hideLabel
              allLabel="ทุกกลุ่มโรค"
              groups={DX_OPTIONS}
              value={split(dx)}
              // ไม่เลือกกลุ่มโรค = ตำแหน่งรหัสไม่มีความหมาย ล้างไปด้วย
              onChange={(v) => set(v.length ? { dx: v.join(",") } : { dx: null, dxpos: null })}
            />
            {dx && (
              <label className="flex items-center gap-2 text-sm" title="ตำแหน่งรหัสโรค">
                <span className="sr-only">ตำแหน่งรหัสโรค</span>
                <select
                  value={dxpos || "all"}
                  onChange={(e) => set({ dxpos: e.target.value === "all" ? null : e.target.value })}
                  className={SELECT_CLASS}
                >
                  {DX_POSITIONS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <AdjrwFilter
              min={adjrw_min}
              max={adjrw_max}
              onChange={(lo, hi) => set({ adjrw_min: lo, adjrw_max: hi })}
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
        renderFooter={renderFooter}
        searchSize="compact"
        detailIcon={<ReceiptText aria-hidden className="size-4" />}
        detailInColumn="patient_name"
        reorderable
        hideable
        fitScreen
        pinColumns={7}
      />
    </SelectionContext.Provider>
  );
}
