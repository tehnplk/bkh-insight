"use client";

import { ReceiptText } from "lucide-react";
import { useState, type ReactNode } from "react";
import { copyable } from "@/components/copy-button/copy-button";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { DateRangeFilter, useDateRange } from "@/components/date-range-filter/date-range-filter";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { PatientName } from "@/components/patient-name/patient-name";
import { formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import {
  MAX_DAYS, SOURCE_LABEL,
  type Amounts, type ArCollectGroup, type ArCollectSummary, type Counts, type DebtPage, type DebtRow, type GroupRow, type HospRow, type PatientType, type SendMode,
} from "@/app/api/fund/ar-collect/collect";
import { DebtorItems, Fact, Facts } from "../uc-debtor/uc-debtor-detail";
import { Money, Notice, Skeleton, btn, focusRing, num, useJson, useUrlParams } from "../_components/ui";

const TYPES: { key: PatientType; label: string }[] = [
  { key: "OP", label: "ผู้ป่วยนอก" },
  { key: "IP", label: "ผู้ป่วยใน" },
];
const MONEY: [keyof Amounts, string][] = [
  ["cost", "ค่ารักษา"],
  ["debt", "ลูกหนี้สุทธิ"],
  ["diff", "ส่วนต่าง"],
  ["received", "รับแล้ว"],
  ["balance", "คงเหลือ"],
];
const SENT_HINT: Record<SendMode, string> = {
  auto: "ส่งและตัดหนี้ตอนตั้งหนี้ นับทุกราย",
  claim: "นับรายที่สถานะเคลมตั้งแต่ส่งออกแล้วขึ้นไป",
  book: "ยังไม่มีบันทึกส่งหนังสือ",
  none: "ค้างชำระ ไม่ได้ส่งเรียกเก็บ",
};
const dash = <span className="text-muted">–</span>;
const th = "px-3 py-2 font-medium";
const td = "px-3 py-1.5";

function Count({ value, title }: { value: number | null; title?: string }) {
  return <span title={title}>{value == null ? dash : value === 0 ? <span className="text-muted">0</span> : formatCount(value)}</span>;
}
const sentTitle = (mode: SendMode | null, value: number | null) =>
  value == null ? "โหลดสถานะเคลมไม่สำเร็จ" : mode ? SENT_HINT[mode] : undefined;

function MoneyCells({ r, bold }: { r: Amounts; bold?: boolean }) {
  return MONEY.map(([k]) => (
    <td key={k} className={`${td} ${num} ${bold || k === "balance" ? "font-medium" : ""}`}>
      <Money value={r[k]} />
    </td>
  ));
}

function GroupTable({ data, selected, onSelect }: { data: ArCollectSummary; selected: string; onSelect: (grp: string) => void }) {
  const pair = (c: (t: PatientType) => ReactNode) => TYPES.map((t) => <td key={t.key} className={`${td} ${num}`}>{c(t.key)}</td>);
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">ลูกหนี้ตามกลุ่มเรียกเก็บ</caption>
        <thead className="bg-surface text-left text-grid-head text-muted">
          <tr>
            <th scope="col" rowSpan={2} className={th}>กลุ่ม</th>
            <th scope="col" rowSpan={2} className={th}>ชื่อกลุ่มเรียกเก็บ</th>
            {["จำนวน (ราย)", "เรียกเก็บ (ราย)", "รับเงิน (ราย)"].map((h) => (
              <th key={h} scope="colgroup" colSpan={2} className={`${th} border-l border-line text-center whitespace-nowrap`}>{h}</th>
            ))}
            {MONEY.map(([k, label]) => (
              <th key={k} scope="col" rowSpan={2} className={`${th} ${num} ${k === "cost" ? "border-l border-line" : ""}`}>{label} (บาท)</th>
            ))}
          </tr>
          <tr>
            {[0, 1, 2].map((i) => TYPES.map((t, j) => (
              <th key={`${i}${t.key}`} scope="col" className={`px-3 pb-2 font-medium ${num} ${j === 0 ? "border-l border-line" : ""}`}>{t.key === "OP" ? "OPD" : "IPD"}</th>
            )))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((g) => {
            const key = String(g.grp ?? "");
            const isSelected = g.grp != null && key === selected;
            return (
              <tr key={key || "none"} className={`border-t border-line ${isSelected ? "bg-accent-soft" : "hover:bg-surface-sunken"}`}>
                <td className={`${td} whitespace-nowrap`}>{g.grp ?? dash}</td>
                <th scope="row" className={`${td} text-left font-normal whitespace-nowrap`}>
                  {g.grp == null ? (
                    <span className="font-medium text-warning" title="บัญชีที่ยังไม่กำหนดกลุ่มเรียกเก็บ (ตั้งที่บัญชีลูกหนี้ตามสิทธิ)">ไม่ระบุกลุ่ม</span>
                  ) : (
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onSelect(isSelected ? "" : key)}
                      className={`-mx-1 rounded px-1 py-0.5 text-left hover:underline ${focusRing} ${isSelected ? "font-semibold text-accent-text" : "font-medium"}`}
                    >
                      {g.name}
                    </button>
                  )}
                </th>
                {pair((t) => <Count value={g[t].visits} />)}
                {pair((t) => <Count value={g[t].sent} title={sentTitle(g.send_mode, g[t].sent)} />)}
                {pair((t) => <Count value={g[t].closed} title="คงเหลือ ≤ 0" />)}
                <MoneyCells r={g} />
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line font-semibold">
            <th scope="row" colSpan={2} className="px-3 py-2 text-left">รวม</th>
            {(["visits", "sent", "closed"] as const).map((k) =>
              TYPES.map((t) => (
                <td key={k + t.key} className={`px-3 py-2 ${num}`}>
                  <Count value={data.totals[t.key][k]} />
                </td>
              )),
            )}
            <MoneyCells r={data.totals} bold />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function sumRows(rows: HospRow[]): Amounts & Counts {
  const t = { visits: 0, closed: 0, sent: 0 as number | null, cost: 0, debt: 0, diff: 0, received: 0, balance: 0 };
  for (const r of rows) {
    t.visits += r.visits;
    t.closed += r.closed;
    t.sent = t.sent == null || r.sent == null ? null : t.sent + r.sent;
    for (const [k] of MONEY) t[k] = Math.round((t[k] + r[k]) * 100) / 100;
  }
  return t;
}

const hospLabel = (r: HospRow) => (r.hospmain ? `${r.hospmain} ${r.hosp_name ?? ""}`.trim() : "ไม่ระบุ");

function HospTable({ rows, mode, onOpen }: { rows: HospRow[]; mode: SendMode; onOpen: (r: HospRow) => void }) {
  const total = sumRows(rows);
  const cells = (r: Amounts & Counts, bold?: boolean) => {
    const c = `${bold ? "px-3 py-2" : td} ${num}`;
    return (
      <>
        <td className={c}><Count value={r.visits} /></td>
        <td className={c}><Money value={r.cost} /></td>
        <td className={c}><Money value={r.diff} /></td>
        <td className={c}><Money value={r.debt} /></td>
        <td className={c}><Count value={r.sent} title={sentTitle(mode, r.sent)} /></td>
        <td className={c}><Count value={r.closed} title="คงเหลือ ≤ 0" /></td>
        <td className={c}><Money value={r.received} /></td>
        <td className={`${c} font-medium`}><Money value={r.balance} /></td>
      </>
    );
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead className="bg-surface text-left text-grid-head text-muted">
          <tr>
            <th scope="col" className={th}>ร.พ.เจ้าของบัตร</th>
            <th scope="col" className={th}>กองทุน</th>
            <th scope="col" className={`${th} ${num}`}>จำนวน (ราย)</th>
            <th scope="col" className={`${th} ${num}`}>ค่ารักษา (บาท)</th>
            <th scope="col" className={`${th} ${num}`}>ส่วนต่าง (บาท)</th>
            <th scope="col" className={`${th} ${num}`}>ลูกหนี้สุทธิ (บาท)</th>
            <th scope="col" className={`${th} ${num}`}>เรียกเก็บ (ราย)</th>
            <th scope="col" className={`${th} ${num}`}>รับเงิน (ราย)</th>
            <th scope="col" className={`${th} ${num}`}>รับแล้ว (บาท)</th>
            <th scope="col" className={`${th} ${num}`}>คงเหลือ (บาท)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.hospmain}|${r.fund}`} className="border-t border-line hover:bg-surface-sunken">
              <th scope="row" className={`${td} text-left font-normal whitespace-nowrap`}>
                <button type="button" aria-haspopup="dialog" aria-label={`${hospLabel(r)} ${r.fund ?? "ไม่ระบุกองทุน"}`} onClick={() => onOpen(r)} className={`-mx-1 rounded px-1 py-0.5 text-left hover:underline ${focusRing}`}>
                  {r.hospmain ? (
                    <>
                      <span className="font-medium">{r.hospmain}</span> <span className="text-muted">{r.hosp_name}</span>
                    </>
                  ) : (
                    <span className="text-muted">ไม่ระบุ</span>
                  )}
                </button>
              </th>
              <td className={td}>{r.fund ?? <span className="text-muted">ไม่ระบุ</span>}</td>
              {cells(r)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line font-semibold">
            <th scope="row" colSpan={2} className="px-3 py-2 text-left">รวม</th>
            {cells(total, true)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const col = gridColumnHelper<DebtRow>();
// ลำดับเงินของรายหนี้: ลูกหนี้สุทธิ = ค่ารักษา + ส่วนต่าง จึงวางต่อกัน
const DEBT_MONEY = (["cost", "diff", "debt", "received", "balance"] as const).map((k) => MONEY.find(([m]) => m === k)!);
const off = { enableSorting: false } as const;
const nowrap = { className: "whitespace-nowrap" };
const debtColumns = (type: PatientType) =>
  col.columns([
    col.accessor("ref_date", { ...off, header: type === "OP" ? "วันที่รับบริการ" : "วันที่จำหน่าย", cell: (c) => formatThaiDate(c.getValue()), meta: { className: "whitespace-nowrap tabular-nums" } }),
    col.display({ id: "key", header: type === "OP" ? "VN" : "AN", cell: (c) => copyable(c.row.original.vn ?? c.row.original.an ?? c.row.original.ref, type === "OP" ? "VN" : "AN"), meta: nowrap }),
    col.accessor("hn", { ...off, header: "HN", cell: (c) => copyable(c.getValue(), "HN") ?? dash, meta: nowrap }),
    col.accessor("patient_name", { ...off, header: "ชื่อ-สกุล", cell: (c) => <PatientName name={c.getValue()} />, meta: nowrap }),
    col.accessor("pttype", {
      ...off,
      header: "สิทธิ",
      cell: (c) => (c.getValue() ? <>{c.getValue()} <span className="text-muted">{c.row.original.pttype_name}</span></> : dash),
      meta: nowrap,
    }),
    ...DEBT_MONEY.map(([k, label]) => col.accessor(k, { ...off, header: `${label} (บาท)`, cell: (c) => <Money value={c.getValue()} />, meta: { className: num } })),
    col.accessor("settle_date", { ...off, header: "วันที่รับล่าสุด", cell: (c) => (c.getValue() ? formatThaiDate(c.getValue()) : dash), meta: { className: "whitespace-nowrap tabular-nums" } }),
    col.accessor("settle_source", { ...off, header: "ที่มา", cell: (c) => { const v = c.getValue(); return v ? (SOURCE_LABEL[v] ?? v) : dash; }, meta: nowrap }),
    col.accessor("settle_ref", { ...off, header: "เลขใบเสร็จ/หมายเหตุ", cell: (c) => c.getValue() ?? dash }),
  ]);
const DEBT_COLUMNS = { OP: debtColumns("OP"), IP: debtColumns("IP") };

const debtDetailTitle = (r: DebtRow) => (
  <>
    {r.patient_name || "–"}{" "}
    <span className="font-normal text-muted tabular-nums">{r.an ? <>AN {copyable(r.an, "AN")}</> : <>VN {copyable(r.vn ?? r.ref, "VN")}</>}</span>
  </>
);
// แถว OP มีแต่ vn แถว IP มีแต่ an (ar-sync) ; ค่ารักษาของหนี้ (set + ปรับปรุง) เทียบกับลูกหนี้สิทธิจากรายการ
const renderDebtDetail = (r: DebtRow) => (
  <div className="text-sm">
    <Facts>
      <Fact label="HN">{copyable(r.hn, "HN")}</Fact>
      <Fact label={r.an ? "วันที่จำหน่าย" : "วันที่รับบริการ"}>{formatThaiDate(r.ref_date)}</Fact>
      <Fact label="สิทธิ">{r.pttype && `${r.pttype} ${r.pttype_name ?? ""}`.trim()}</Fact>
      <Fact label="ค่ารักษา (บาท)"><Money value={r.cost} /></Fact>
      <Fact label="ลูกหนี้สุทธิ (บาท)"><Money value={r.debt} /></Fact>
      <Fact label="คงเหลือ (บาท)"><span className="font-semibold"><Money value={r.balance} /></span></Fact>
    </Facts>
    <DebtorItems vn={r.vn} an={r.an} debtor={r.cost} />
  </div>
);

type PanelProps = { start: string; end: string; grp: string; name: string; mode: SendMode; type: PatientType; setType: (t: PatientType) => void };

function GroupPanel({ start, end, grp, name, mode, type, setType }: PanelProps) {
  const { data, error, loading, retry } = useJson<ArCollectGroup>(`/api/fund/ar-collect?${new URLSearchParams({ start, end, group: grp })}`);
  const [open, setOpen] = useState<HospRow | null>(null);
  const label = TYPES.find((t) => t.key === type)!.label;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="group-title">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <h2 id="group-title" className="text-title">
          {grp} {name}
        </h2>
        <div role="tablist" aria-label="ประเภทผู้ป่วย" className="inline-flex rounded-md border border-line p-0.5">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.key === type}
              onClick={() => setType(t.key)}
              className={`h-8 rounded px-3 text-sm font-medium ${focusRing} ${t.key === type ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-hover"}`}
            >
              {t.label}
              {data && <span className="ml-1.5 tabular-nums">{formatCount(sumRows(data[t.key]).visits)}</span>}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <Notice title={`โหลดข้อมูลไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
      ) : !data ? (
        <Skeleton rows={4} />
      ) : (
        <div role="tabpanel" aria-label={label} aria-busy={loading}>
          {data.claim_error && <p role="alert" className="mb-2 text-sm text-danger">โหลดสถานะเคลมไม่สำเร็จ คอลัมน์เรียกเก็บแสดงขีด</p>}
          {data[type].length ? (
            <HospTable rows={data[type]} mode={mode} onOpen={setOpen} />
          ) : (
            <Notice title={`ไม่มีหนี้${label}ของกลุ่มนี้ในช่วงที่เลือก`} />
          )}
        </div>
      )}
      <DetailModal
        open={!!open}
        onClose={() => setOpen(null)}
        size="wide"
        title={open ? `${hospLabel(open)} · ${open.fund ?? "ไม่ระบุกองทุน"} · ${label} · ${formatThaiDate(start)} – ${formatThaiDate(end)}` : ""}
      >
        {open && (
          <div className="flex min-h-0 flex-1 flex-col">
            <DataGrid<DebtRow, DebtPage>
              key={`${grp}:${type}:${open.hospmain}:${open.fund}:${start}:${end}`}
              endpoint="/api/fund/ar-collect/debts"
              params={{ start, end, type, group: grp, hospmain: open.hospmain ?? "", fund: open.fund ?? "" }}
              localState={{ pageSize: "50" }}
              columns={DEBT_COLUMNS[type]}
              getRowId={(r) => r.ref}
              renderDetail={renderDebtDetail}
              detailTitle={debtDetailTitle}
              detailSize="medium"
              detailIcon={<ReceiptText aria-hidden className="size-4" />}
              detailInColumn="patient_name"
              searchable={false}
              fitScreen
              pinColumns={2}
            />
          </div>
        )}
      </DetailModal>
    </section>
  );
}

export function ArCollect() {
  const { start, end } = useDateRange(MAX_DAYS);
  const { group, type, set } = useUrlParams(["group", "type"] as const);
  const { data, error, loading, retry } = useJson<ArCollectSummary>(`/api/fund/ar-collect?${new URLSearchParams({ start, end })}`);
  const selected: GroupRow | undefined = data?.rows.find((g) => g.grp != null && String(g.grp) === group);
  const pt: PatientType = type === "IP" ? "IP" : "OP";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title text-balance">สถานที่เรียกเก็บ</h1>
        <DateRangeFilter
          maxDays={MAX_DAYS}
          hideLabels
          labels={{ preset: "ช่วงวันที่รับบริการ/จำหน่าย", start: "วันที่รับบริการ/จำหน่าย ตั้งแต่", end: "วันที่รับบริการ/จำหน่าย ถึง" }}
        />
      </div>
      {error ? (
        <Notice title={`โหลดข้อมูลไม่สำเร็จ: ${error}`} action={<button type="button" className={btn} onClick={retry}>ลองอีกครั้ง</button>} />
      ) : !data ? (
        <Skeleton rows={8} />
      ) : (
        <div aria-busy={loading} className={`flex flex-col gap-5 transition-opacity duration-200 ${loading ? "opacity-60" : ""}`}>
          {data.claim_error && <p role="alert" className="text-sm text-danger">โหลดสถานะเคลมไม่สำเร็จ คอลัมน์เรียกเก็บของกลุ่ม eclaim แสดงขีด</p>}
          {data.rows.length ? (
            <GroupTable data={data} selected={group} onSelect={(g) => set({ group: g || null })} />
          ) : (
            <Notice title="ไม่มีหนี้ในช่วงที่เลือก" />
          )}
          {selected && (
            <GroupPanel key={`${group}:${start}:${end}`} start={start} end={end} grp={group} name={selected.name ?? ""} mode={selected.send_mode ?? "book"} type={pt} setType={(t) => set({ type: t === "OP" ? null : t })} />
          )}
        </div>
      )}
    </div>
  );
}
