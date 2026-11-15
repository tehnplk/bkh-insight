"use client";

import { useState } from "react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { Money, focusRing, num, useUrlParams } from "../_components/ui";
import { DebtorItems, Fact, Facts } from "../uc-debtor/uc-debtor-detail";
import { CaseResync } from "../_components/case-resync";
import {
  STATUS_LABEL, lockLabel,
  type PrecheckPage, type PrecheckRow, type PrecheckStatus, type PrecheckTotals, type PrecheckType,
} from "@/app/api/fund/ar-precheck/precheck";

const FILTER_KEYS = ["type", "only"] as const;
const nowrap = { className: "whitespace-nowrap" };
const dash = <span className="text-muted">–</span>;
const badge = "inline-block rounded border px-1.5 py-0.5 whitespace-nowrap";
const TONE = {
  danger: "border-danger-line bg-danger-soft text-danger",
  warning: "border-warning-line bg-warning-soft text-warning",
  success: "border-success-line bg-success-soft text-success",
  muted: "border-line bg-surface-sunken text-muted",
};
// รอขั้นตอนปกติของ HOSxP = muted, ต้องตามแต่ไม่ใช่ใบลูกหนี้ผิด = warning, ต้องแก้ใบลูกหนี้/รายการ = danger
const STATUS_TONE: Record<PrecheckStatus, keyof typeof TONE> = {
  no_stat: "danger", stale_slip: "danger", admitted: "muted", overdue_lock: "warning", pending_lock: "muted",
  total: "danger", stale_stat: "warning", split: "danger", keyed_after: "danger", debt: "danger",
  unlocked: "warning", unpaid: "warning", ok: "success",
};
/** วิธีแก้ แสดงใน modal รายละเอียดของแถว */
const STATUS_HINT: Partial<Record<PrecheckStatus, string>> = {
  stale_slip: "ยกเลิกใบลูกหนี้ผู้ป่วยนอกใน HOSxP แล้วกดดึงใหม่",
  admitted: "รายการย้ายไป AN แล้ว ตรวจยอดที่ผู้ป่วยใน",
  overdue_lock: "เกิน 3 วันทำการหลังวันรับบริการแล้วยังไม่ล็อกรายการใน HOSxP",
  pending_lock: "HOSxP ล็อกรายการทุกวันราว 16.00 น. ตรวจอีกครั้งหลังล็อก",
  stale_stat: "ใบลูกหนี้ตรงกับรายการลูกหนี้แล้ว ยอดสรุปของ HOSxP ยังเป็นค่าเดิม ไม่ต้องแก้ใบลูกหนี้",
  keyed_after: "ออกใบลูกหนี้เพิ่มสำหรับรายการที่คีย์หลังออกใบ แล้วกดดึงใหม่",
};
const TYPES = [
  { value: "opd", label: "ผู้ป่วยนอก", date: "วันที่รับบริการ" },
  { value: "ipd", label: "ผู้ป่วยใน", date: "วันจำหน่าย" },
] as const satisfies readonly { value: PrecheckType; label: string; date: string }[];

const Status = ({ status }: { status: PrecheckStatus }) => <span className={`${badge} ${TONE[STATUS_TONE[status]]}`}>{STATUS_LABEL[status]}</span>;
/** ส่วนต่างที่ไม่เป็นศูนย์เน้นสีให้เห็นในตาราง */
const Diff = ({ value }: { value: number | null }) => <span className={value ? "font-medium text-danger" : undefined}><Money value={value} /></span>;

type MoneyKey = "rx_total" | "rx_pay" | "income" | "paid_money" | "rcpt_money" | "uc_money" | "debt" | "booked";
const col = gridColumnHelper<PrecheckRow>();
const money = (key: MoneyKey, header: string) =>
  col.accessor(key, { header: `${header} (บาท)`, cell: (c) => <Money value={c.getValue()} />, meta: { className: num } });
const diff = (key: "diff_total" | "diff_debt", header: string) =>
  col.accessor(key, { header: `${header} (บาท)`, cell: (c) => <Diff value={c.getValue()} />, meta: { className: num } });
const text = (key: "vn" | "an" | "hn" | "patient_name", header: string) =>
  col.accessor(key, { header, cell: (c) => c.getValue() || dash, meta: key === "patient_name" ? nowrap : { ...nowrap, filter: true } });
const dateCol = (header: string) =>
  col.accessor("date", { header, cell: (c) => formatThaiDate(c.getValue()), meta: { className: "whitespace-nowrap tabular-nums" } });
const rights = [
  col.accessor("pttype_name", { header: "สิทธิ", cell: (c) => c.getValue() || dash, meta: { ...nowrap, filter: true } }),
  col.accessor("fund", { header: "กองทุน", cell: (c) => <span title={c.row.original.fund_name}>{c.getValue()}</span>, meta: { ...nowrap, filter: true } }),
];
const amounts = [
  money("rx_total", "ค่าใช้จ่าย ใบสั่งยา"),
  money("rx_pay", "ต้องชำระ ใบสั่งยา"),
  money("income", "ค่าใช้จ่าย สรุป"),
  diff("diff_total", "ส่วนต่างค่าใช้จ่าย"),
  money("paid_money", "ต้องชำระ สรุป"),
  money("rcpt_money", "ชำระแล้ว"),
  money("uc_money", "ลูกหนี้ สรุป"),
  money("debt", "ตั้งหนี้แล้ว"),
  diff("diff_debt", "ส่วนต่างลูกหนี้"),
  money("booked", "ลงสมุดแล้ว"),
  col.accessor("finance_lock", {
    header: "ล็อกรายการ",
    enableSorting: false,
    cell: (c) => <span className={c.getValue() === "Y" ? undefined : "text-muted"}>{lockLabel(c.getValue())}</span>,
    meta: nowrap,
  }),
  col.accessor("status", { header: "สถานะ", cell: (c) => <Status status={c.getValue()} />, meta: { filter: true } }),
];

const COLUMNS = {
  opd: col.columns([
    dateCol("วันที่รับบริการ"), text("vn", "VN"), text("hn", "HN"), text("patient_name", "ชื่อ-สกุล"),
    // id admit = ตัวกรอง "admit แล้ว/ไม่ admit" ส่วนค่าที่แสดงคือ AN
    col.accessor("an", { id: "admit", header: "AN", cell: (c) => c.getValue() || dash, meta: { className: "whitespace-nowrap tabular-nums", filter: true } }),
    ...rights, ...amounts,
  ]),
  ipd: col.columns([
    dateCol("วันจำหน่าย"), text("an", "AN"), text("hn", "HN"), text("patient_name", "ชื่อ-สกุล"),
    col.accessor("regdate", { header: "วันรับไว้", cell: (c) => formatThaiDate(c.getValue() ?? "") || dash, meta: { className: "whitespace-nowrap tabular-nums" } }),
    ...rights, ...amounts,
  ]),
};

const renderDetail = (r: PrecheckRow) => {
  // HOSxP ย้ายรายการของ visit ไปที่ AN ตอน admit (opitemrece.vn เป็น NULL) แต่ vn_stat ยังเป็นยอดเดิม จึงต้องดูที่ AN
  const moved = r.vn != null && r.an != null && r.n_items === 0;
  return (
    <div className="text-sm">
      <Facts>
        <Fact label="สถานะ"><Status status={r.status} /></Fact>
        <Fact label="ส่วนต่างค่าใช้จ่าย (บาท)"><Diff value={r.diff_total} /></Fact>
        <Fact label="ส่วนต่างลูกหนี้ (บาท)"><Diff value={r.diff_debt} /></Fact>
        <Fact label="ลงสมุดแล้ว (บาท)"><Money value={r.booked} /></Fact>
        <Fact label="ล็อกรายการ">{lockLabel(r.finance_lock)}</Fact>
      </Facts>
      {STATUS_HINT[r.status] && <p className="mt-2">{STATUS_HINT[r.status]}</p>}
      {/* แถว IPD ไม่มี vn ; OPD ที่ admit แล้วดึงตาม vn ของ visit */}
      <CaseResync vn={r.vn} an={r.vn ? null : r.an} />
      {/* visit ที่ admit แล้วดูรายการของ vn (OPD) ถ้ายังอยู่ที่ vn ; IPD ไม่มี vn จึงใช้ an */}
      {moved ? (
        <>
          {/* ยอดทั้ง AN เทียบกับลูกหนี้ของ visit ไม่ได้ จึงไม่ส่ง debtor */}
          <DebtorItems vn={null} an={r.an} />
          <p className="mt-2 text-xs text-muted">รายการของ visit นี้ย้ายไป AN {r.an} ตอน admit จึงแสดงรายการทั้งหมดของ AN</p>
        </>
      ) : (
        <DebtorItems vn={r.vn} an={r.vn ? null : r.an} debtor={r.uc_money ?? undefined} />
      )}
    </div>
  );
};
const detailTitle = (r: PrecheckRow) => (
  <>
    {r.patient_name} <span className="font-normal text-muted tabular-nums">{r.vn ? `VN ${r.vn}` : `AN ${r.an}`}</span>
  </>
);

const th = "px-3 py-1.5 font-medium whitespace-nowrap";
const td = "px-3 py-1.5";
const box = "max-w-full overflow-x-auto rounded-lg border border-line";

/** รายที่เปิดดูใน modal: fund ว่าง = ทุกกองทุน, mismatch = เฉพาะสถานะที่ไม่ใช่ "ตรง" */
type Scope = { fund: string; mismatch: boolean };

function Match({ t, onOpen }: { t: PrecheckTotals; onOpen: () => void }) {
  if (!t.mismatch) return <span className={`${badge} ${TONE.success}`}>ตรง</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`ส่วนต่างค่าใช้จ่าย ${formatBaht(t.diff_total)} บาท · ส่วนต่างลูกหนี้ ${formatBaht(t.diff_debt)} บาท`}
      className={`${badge} ${TONE.danger} underline-offset-2 hover:underline ${focusRing}`}
    >
      ไม่ตรง {formatCount(t.mismatch)} ราย
    </button>
  );
}

function Summary({ data, onOpen }: { data: PrecheckPage; onOpen: (p: Scope) => void }) {
  const { total: t, funds } = data.summary;
  const fundCells = (f: PrecheckTotals, fund: string) => (
    <>
      <td className={`${td} ${num}`}>{formatCount(f.count)}</td>
      <td className={`${td} ${num}`}>{formatBaht(f.income)}</td>
      <td className={`${td} ${num}`}>{formatBaht(f.paid_money)}</td>
      <td className={`${td} ${num}`}>{formatBaht(f.rcpt_money)}</td>
      <td className={`${td} ${num}`}>{formatBaht(f.uc_money)}</td>
      <td className={`${td} ${num}`}>{formatBaht(f.debt)}</td>
      <td className={td}><Match t={f} onOpen={() => onOpen({ fund, mismatch: true })} /></td>
    </>
  );
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {data.ledger_error && <p className="text-danger">{data.ledger_error} คอลัมน์ลงสมุดแล้วจึงว่าง</p>}
      <div className="flex min-w-0 flex-wrap items-start gap-4">
        <div className={box}>
          <table className="border-collapse tabular-nums">
            <caption className="sr-only">ยอดรวมทั้งช่วง</caption>
            <thead className="bg-surface-sunken text-left text-xs text-muted">
              <tr>
                <th className={`${th} ${num}`}>ราย</th>
                <th className={`${th} ${num}`}>ค่าใช้จ่าย ใบสั่งยา (บาท)</th>
                <th className={`${th} ${num}`}>ต้องชำระ ใบสั่งยา (บาท)</th>
                <th className={`${th} ${num}`}>ค่าใช้จ่าย สรุป (บาท)</th>
                <th className={`${th} ${num}`}>ต้องชำระ สรุป (บาท)</th>
                <th className={`${th} ${num}`}>ชำระแล้ว (บาท)</th>
                <th className={`${th} ${num}`}>ลูกหนี้ (บาท)</th>
                <th className={`${th} ${num}`}>ตั้งหนี้แล้ว (บาท)</th>
                <th className={`${th} ${num}`}>ลงสมุดแล้ว (บาท)</th>
                <th className={th}>สถานะ</th>
              </tr>
            </thead>
            <tbody className="font-semibold">
              <tr className="border-t border-line">
                <td className={`${td} ${num}`}>{formatCount(t.count)}</td>
                <td className={`${td} ${num}`}>{formatBaht(t.rx_total)}</td>
                <td className={`${td} ${num}`}>{formatBaht(t.rx_pay)}</td>
                <td className={`${td} ${num}`}>{formatBaht(t.income)}</td>
                <td className={`${td} ${num}`}>{formatBaht(t.paid_money)}</td>
                <td className={`${td} ${num}`}>{formatBaht(t.rcpt_money)}</td>
                <td className={`${td} ${num}`}>{formatBaht(t.uc_money)}</td>
                <td className={`${td} ${num}`}>{formatBaht(t.debt)}</td>
                <td className={`${td} ${num}`}><Money value={t.booked} /></td>
                <td className={`${td} font-normal`}><Match t={t} onOpen={() => onOpen({ fund: "", mismatch: true })} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        {funds.length > 0 && (
          <div className={box}>
            <table className="border-collapse tabular-nums">
              <caption className="sr-only">แยกตามกองทุน</caption>
              <thead className="bg-surface-sunken text-left text-xs text-muted">
                <tr>
                  <th className={th}>กองทุน</th>
                  <th className={`${th} ${num}`}>ราย</th>
                  <th className={`${th} ${num}`}>ค่าใช้จ่าย (บาท)</th>
                  <th className={`${th} ${num}`}>ต้องชำระ (บาท)</th>
                  <th className={`${th} ${num}`}>ชำระแล้ว (บาท)</th>
                  <th className={`${th} ${num}`}>ลูกหนี้ (บาท)</th>
                  <th className={`${th} ${num}`}>ตั้งหนี้แล้ว (บาท)</th>
                  <th className={th}>สถานะ</th>
                  <th className={th}><span className="sr-only">ดูรายตัว</span></th>
                </tr>
              </thead>
              <tbody>
                {funds.map((f) => (
                  <tr key={f.fund} className="border-t border-line">
                    <th scope="row" className={`${td} text-left font-normal whitespace-nowrap`}>
                      {f.fund} {f.fund_name !== f.fund && <span className="text-muted">{f.fund_name}</span>}
                    </th>
                    {fundCells(f, f.fund)}
                    <td className={td}>
                      <button
                        type="button"
                        onClick={() => onOpen({ fund: f.fund, mismatch: false })}
                        aria-label={`รายตัว กองทุน ${f.fund}`}
                        className={`rounded-sm px-1 whitespace-nowrap text-accent-text underline-offset-2 hover:underline ${focusRing}`}
                      >
                        รายตัว
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line font-semibold">
                  <th scope="row" className={`${td} text-left`}>รวม</th>
                  {fundCells(t, "")}
                  <td className={td} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** รายของกองทุน/สถานะที่เลือกจากแถบสรุป: DataGrid แบบ localState จึงไม่ใช้ state ใน URL ร่วมกับตารางหลัก */
function PickRows({ type, start, end, pick }: { type: PrecheckType; start: string; end: string; pick: Scope }) {
  return (
    <DataGrid<PrecheckRow>
      endpoint="/api/fund/ar-precheck"
      params={{ type, start, end, only: pick.mismatch ? "mismatch" : "" }}
      localState={pick.fund ? { pageSize: "100", cf: JSON.stringify({ fund: [pick.fund] }) } : { pageSize: "100" }}
      columns={COLUMNS[type]}
      getRowId={(r) => r.key}
      renderDetail={renderDetail}
      detailTitle={detailTitle}
      detailSize="medium"
      fitScreen
      pinColumns={3}
    />
  );
}

export function PrecheckGrid() {
  const { start, end } = useDateRange();
  const { type: typeRaw, only, set } = useUrlParams(["type", "only", "sort", "dir", "cf"]);
  const type: PrecheckType = typeRaw === "ipd" ? "ipd" : "opd";
  const t = TYPES.find((x) => x.value === type)!;
  const [pick, setPick] = useState<Scope | null>(null);

  return (
    <>
      <DataGrid<PrecheckRow, PrecheckPage>
        endpoint="/api/fund/ar-precheck"
        params={{ start, end }}
        filterKeys={FILTER_KEYS}
        toolbar={
          <>
            <div role="radiogroup" aria-label="ประเภทผู้ป่วย" className="flex h-9 items-center gap-0.5 rounded-md border border-line bg-surface px-0.5">
              {TYPES.map((x) => (
                <button
                  key={x.value}
                  type="button"
                  role="radio"
                  aria-checked={type === x.value}
                  // คอลัมน์ที่ sort/กรองได้ต่างกันระหว่าง OPD/IPD จึงล้าง sort และตัวกรองหัวคอลัมน์ไปด้วย
                  onClick={() => type !== x.value && set({ type: x.value === "opd" ? null : x.value, sort: null, dir: null, cf: null })}
                  className={`h-8 rounded-md px-3 ${focusRing} ${type === x.value ? "bg-accent-soft font-medium text-accent-text" : "text-muted hover:bg-hover hover:text-foreground"}`}
                >
                  {x.label}
                </button>
              ))}
            </div>
            <DateRangeFilter hideLabels labels={{ preset: `ช่วง${t.date}`, start: `${t.date} ตั้งแต่`, end: `${t.date} ถึง` }} />
            <label className="flex h-9 items-center gap-2 whitespace-nowrap">
              <input
                type="checkbox"
                checked={only === "mismatch"}
                onChange={(e) => set({ only: e.target.checked ? "mismatch" : null })}
                className={`size-4 accent-accent ${focusRing}`}
              />
              เฉพาะไม่ตรง
            </label>
          </>
        }
        columns={COLUMNS[type]}
        getRowId={(r) => r.key}
        renderDetail={renderDetail}
        detailTitle={detailTitle}
        detailSize="medium"
        renderSummary={(data) => <Summary data={data} onOpen={setPick} />}
        exportPlacement="summary"
        fitScreen
        pinColumns={3}
        reorderable
        hideable
      />
      <DetailModal
        open={!!pick}
        onClose={() => setPick(null)}
        size="wide"
        draggable
        title={
          pick && (
            <>
              {pick.mismatch ? "รายที่ไม่ตรง" : "รายตัว"} {pick.fund ? `กองทุน ${pick.fund}` : "ทุกกองทุน"}{" "}
              <span className="font-normal text-muted">{t.label}</span>
            </>
          )
        }
      >
        {pick && <PickRows type={type} start={start} end={end} pick={pick} />}
      </DetailModal>
    </>
  );
}

