"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { MultiSelect } from "@/components/multi-select/multi-select";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate, todayIso } from "@/lib/thai-date";
import { FY_BACK, fiscalYearOf } from "@/app/api/fund/uc-dashboard/dashboard";
import type { RepDetailResponse } from "@/app/api/fund/uc-debtor/detail/rep-detail";
import {
  AGE_BUCKETS, STATUS_LABEL,
  type ClaimErrorRow, type ClaimErrorsResponse, type ClaimStatus,
} from "@/app/api/fund/claim-errors/claim-errors";
import { FilterChip, Money, Panel, Skeleton, btn, focusRing, num, useJson, useUrlParams } from "../_components/ui";
import { DebtorItems, Fact, Facts } from "../uc-debtor/uc-debtor-detail";

const FILTER_KEYS = ["type", "status", "code", "fy", "funds"] as const;
const SELECT_CLASS = `h-9 rounded-md border border-line bg-surface pr-8 pl-3 font-medium ${focusRing}`;
const dash = <span className="text-muted">–</span>;
const UNKNOWN = "UNKNOWN";
const fundCode = (code: string) => (code === UNKNOWN ? "ไม่ระบุ" : code);
const CHIP: Record<ClaimStatus, string> = {
  c: "border-warning-line bg-warning-soft text-warning",
  deny: "border-danger-line bg-danger-soft text-danger",
};
const KIND_LABEL = { C: "C", DENY: "Deny" } as const;

const Status = ({ status }: { status: ClaimStatus }) => (
  <span className={`rounded border px-1.5 py-0.5 whitespace-nowrap ${CHIP[status]}`}>{STATUS_LABEL[status]}</span>
);
const serviceDate = (r: ClaimErrorRow) => formatThaiDate(r.service_at);

const col = gridColumnHelper<ClaimErrorRow>();
const nowrap = { className: "whitespace-nowrap" };
const COLUMNS = col.columns([
  col.accessor("type", { header: "OP/IP", meta: nowrap }),
  col.accessor("key", { header: "VN/AN", meta: nowrap }),
  col.accessor("hn", { header: "HN", cell: (c) => c.getValue() || dash, meta: nowrap }),
  // ชื่ออยู่ his คนละฐานกับคิว (insight) จึง sort ไม่ได้
  col.accessor("full_name", { header: "ชื่อ-สกุล", enableSorting: false, cell: (c) => c.getValue() || dash, meta: nowrap }),
  col.accessor("service_at", {
    header: "วันรับบริการ/จำหน่าย",
    cell: (c) => serviceDate(c.row.original),
    meta: { className: "whitespace-nowrap tabular-nums" },
  }),
  col.accessor("fund", {
    header: "กองทุน",
    cell: (c) => <span title={c.row.original.fund_name}>{fundCode(c.getValue())}</span>,
    meta: nowrap,
  }),
  col.accessor("status", { header: "สถานะ", cell: (c) => <Status status={c.getValue()} /> }),
  col.accessor("codes", { header: "รหัส", enableSorting: false, cell: (c) => c.getValue().join(", "), meta: { className: "tabular-nums" } }),
  col.accessor("claim_total", { header: "ยอดเรียกเก็บ (บาท)", cell: (c) => <Money value={c.getValue()} />, meta: { className: num } }),
  col.accessor("age_service_days", { header: "ค้าง (วัน)", cell: (c) => formatCount(c.getValue()), meta: { className: num } }),
  col.accessor("age_rep_days", { header: "นับจาก REP (วัน)", cell: (c) => formatCount(c.getValue()), meta: { className: num } }),
  col.accessor("rep_no", { header: "REP", meta: nowrap }),
]);

const detailTitle = (r: ClaimErrorRow) => (
  <>
    {r.type === "IP" ? "AN" : "VN"} {r.key}
    {r.hn && <span className="font-normal text-muted tabular-nums"> HN {r.hn}</span>}
  </>
);
const renderDetail = (r: ClaimErrorRow) => <ClaimErrorDetail row={r} />;

const th = "px-3 py-1.5 font-medium";
const td = "px-3 py-1.5 align-top";

function ClaimErrorDetail({ row: r }: { row: ClaimErrorRow }) {
  const ip = r.type === "IP";
  const { loading, data, error, retry } = useJson<RepDetailResponse>(
    `/api/fund/uc-debtor/detail?${new URLSearchParams({ type: ip ? "ipd" : "opd", key: r.key })}`,
  );
  return (
    <div className="text-sm">
      <Facts>
        <Fact label="ชื่อ-สกุล">{r.full_name}</Fact>
        <Fact label="ยอดเรียกเก็บ (บาท)"><span className="font-semibold"><Money value={r.claim_total} /></span></Fact>
        <Fact label="สถานะ"><Status status={r.status} /></Fact>
        <Fact label="ค้าง (วัน)">{formatCount(r.age_service_days)}</Fact>
        <Fact label="นับจาก REP (วัน)">{formatCount(r.age_rep_days)}</Fact>
        <Fact label={ip ? "วันจำหน่าย" : "วันรับบริการ"}>{serviceDate(r)}</Fact>
        <Fact label="ปีงบ">{r.fy}</Fact>
        <Fact label="กองทุน">{r.fund_name === r.fund ? fundCode(r.fund) : `${r.fund_name} (${r.fund})`}</Fact>
        <Fact label="สิทธิย่อย">{r.sub_inscl}</Fact>
        <Fact label="REP">{r.rep_no}</Fact>
        <Fact label="วันที่ REP">{formatThaiDate(r.rep_date)}</Fact>
      </Facts>
      <section className="mt-6 border-t border-line pt-5">
        <h3 className="text-base font-semibold">รหัสที่ติด</h3>
        <div className="mt-3">
          {loading ? (
            <Skeleton rows={3} />
          ) : error || !data ? (
            <div className="py-4 text-center">
              <p className="font-medium text-danger">โหลดคำอธิบายรหัสไม่สำเร็จ</p>
              <p className="mt-1 text-muted">{error}</p>
              <button type="button" onClick={retry} className={`${btn} mt-3`}>ลองอีกครั้ง</button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className={`${th} w-0`}>รหัส</th>
                    <th className={`${th} w-2/5`}>ความหมาย</th>
                    <th className={th}>แนวทางแก้ไข</th>
                  </tr>
                </thead>
                <tbody>
                  {data.errors.map((e) => (
                    <tr key={e.code} className="border-t border-line">
                      <td className={`${td} font-medium whitespace-nowrap tabular-nums`}>{e.code}</td>
                      {e.source == null ? (
                        <td colSpan={2} className={`${td} text-muted`}>ไม่พบคำอธิบาย</td>
                      ) : (
                        <>
                          <td className={td}>{e.description || dash}</td>
                          <td className={`${td} text-muted`}>{e.fix || dash}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <DebtorItems vn={ip ? null : r.key} an={ip ? r.key : null} />
    </div>
  );
}

const Value = ({ children }: { children: ReactNode }) => <span className="font-semibold text-foreground">{children}</span>;
const dot = <span aria-hidden="true"> · </span>;
const bar = <span className="mx-2 text-line" aria-hidden="true">|</span>;

// shortcut: DataGrid ไม่มี callback ส่ง response ออกมา จึงส่งผ่าน effect ใน renderSummary ให้ toolbar (กองทุน) และตารางรหัสใช้ ถ้า DataGrid มี onData ให้เปลี่ยนไปใช้
function Sync({ data, onData }: { data: ClaimErrorsResponse; onData: (d: ClaimErrorsResponse) => void }) {
  useEffect(() => onData(data), [data, onData]);
  return null;
}

function Summary({ data: d }: { data: ClaimErrorsResponse }) {
  const t = d.totals;
  return (
    <>
      <p className="basis-full text-muted tabular-nums">
        <Value>{formatCount(t.n)}</Value> รายการ{dot}ยอดเรียกเก็บ <Value>{formatBaht(t.amount)}</Value> บาท{bar}
        C <Value>{formatCount(t.c)}</Value>{dot}Deny <Value>{formatCount(t.deny)}</Value>{bar}
        OP <Value>{formatCount(t.op)}</Value>{dot}IP <Value>{formatCount(t.ip)}</Value>
      </p>
      <p className="basis-full text-muted tabular-nums">
        ค้าง{" "}
        {d.buckets.map((b, i) => (
          <span key={b.bucket}>
            {i > 0 && dot}
            {AGE_BUCKETS[i].label} <Value>{formatCount(b.n)}</Value> รายการ {formatBaht(b.amount)} บาท
          </span>
        ))}
      </p>
    </>
  );
}

function CodeTable({ data, code, onCode }: { data: ClaimErrorsResponse; code: string; onCode: (c: string) => void }) {
  return (
    <Panel title="สรุปตามรหัส">
      <div className="max-h-96 overflow-auto rounded-lg border border-line text-sm">
        <table className="w-full border-collapse tabular-nums">
          <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
            <tr>
              <th className={th}>รหัส</th>
              <th className={th}>ประเภท</th>
              <th className={th}>คำอธิบาย</th>
              <th className={`${th} ${num}`}>จำนวน</th>
              <th className={`${th} ${num}`}>ยอด (บาท)</th>
              <th className={`${th} ${num}`}>ค้างเฉลี่ย (วัน)</th>
              <th className={`${th} ${num}`}>ค้างสูงสุด (วัน)</th>
            </tr>
          </thead>
          <tbody>
            {data.codes.map((c) => {
              const on = c.code === code;
              return (
                <tr key={c.code} className={`border-t border-line ${on ? "bg-accent-soft" : ""}`}>
                  <td className={td}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onCode(on ? "" : c.code)}
                      className={`-mx-1 cursor-pointer rounded-sm px-1 font-medium whitespace-nowrap text-accent-text underline-offset-2 hover:underline ${focusRing}`}
                    >
                      {c.code}
                    </button>
                  </td>
                  <td className={td}>{c.kind ? KIND_LABEL[c.kind] : dash}</td>
                  <td className={td}>{c.description || dash}</td>
                  <td className={`${td} ${num}`}>{formatCount(c.n)}</td>
                  <td className={`${td} ${num}`}>{formatBaht(c.amount)}</td>
                  <td className={`${td} ${num}`}>{formatCount(c.avg_age)}</td>
                  <td className={`${td} ${num}`}>{formatCount(c.max_age)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">หนึ่งรายการมีได้หลายรหัส จำนวนรวมทุกรหัสจึงมากกว่าจำนวนรายการ</p>
    </Panel>
  );
}

const split = (v: string) => (v ? v.split(",") : []);

export function ClaimErrors() {
  const { type, status, code, fy, funds, set } = useUrlParams(FILTER_KEYS);
  const [data, setData] = useState<ClaimErrorsResponse>();
  const gridTop = useRef<HTMLDivElement>(null);
  const currentFy = fiscalYearOf(todayIso());
  const fyOptions = Array.from({ length: FY_BACK + 1 }, (_, i) => currentFy - i);
  const fundGroups = data
    ? [{ value: "funds", label: "กองทุน", options: data.funds.map((f) => ({ value: f.fund, label: f.name, hint: f.name === f.fund ? undefined : f.fund })) }]
    : [];
  const setCode = (c: string) => {
    set({ code: c });
    if (c) gridTop.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className="flex flex-col gap-8">
      <div ref={gridTop} className="scroll-mt-4">
        <DataGrid<ClaimErrorRow, ClaimErrorsResponse>
          endpoint="/api/fund/claim-errors"
          filterKeys={FILTER_KEYS}
          toolbar={
            <>
              <label className="flex items-center gap-2">
                <span className="text-muted">ประเภท</span>
                <select value={type} onChange={(e) => set({ type: e.target.value })} className={SELECT_CLASS}>
                  <option value="">ทั้งหมด</option>
                  <option value="op">OP</option>
                  <option value="ip">IP</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted">สถานะ</span>
                <select value={status} onChange={(e) => set({ status: e.target.value })} className={SELECT_CLASS}>
                  <option value="">ทั้งหมด</option>
                  <option value="c">C</option>
                  <option value="deny">Deny</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted">ปีงบ</span>
                <select value={fy} onChange={(e) => set({ fy: e.target.value })} className={SELECT_CLASS}>
                  <option value="">ทั้งหมด</option>
                  {fyOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </label>
              <MultiSelect label="กองทุน" groups={fundGroups} value={split(funds)} onChange={(v) => set({ funds: v.join(",") })} />
              {code && <FilterChip label={`รหัส ${code}`} onRemove={() => set({ code: null })} />}
            </>
          }
          columns={COLUMNS}
          getRowId={(r) => `${r.type}:${r.key}`}
          renderDetail={renderDetail}
          detailMode="modal"
          detailTitle={detailTitle}
          detailSize="medium"
          renderSummary={(d) => (
            <>
              <Sync data={d} onData={setData} />
              <Summary data={d} />
            </>
          )}
          exportPlacement="summary"
        />
        {data && data.orphan.n > 0 && (
          <p className="mt-2 text-xs text-muted tabular-nums">
            ไม่รวมแถว REP ที่ไม่มี VN/AN {formatCount(data.orphan.n)} รายการ ยอดเรียกเก็บ {formatBaht(data.orphan.amount)} บาท
          </p>
        )}
      </div>
      {data && data.codes.length > 0 && <CodeTable data={data} code={code} onCode={setCode} />}
    </div>
  );
}
