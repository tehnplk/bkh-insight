"use client";

import type { ReactNode } from "react";
import { DataGrid, gridColumnHelper } from "@/components/data-grid/data-grid";
import { copyable } from "@/components/copy-button/copy-button";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { RepFileDetail } from "@/app/api/fund/rep-import/detail/file-detail";
import type { RepLineRow } from "@/app/api/fund/rep-import/rows/route";
import { Money, Skeleton, btn, num, useJson } from "../_components/ui";
import { DebtorItems, RepDetail } from "../uc-debtor/uc-debtor-detail";

const dash = <span className="text-muted">–</span>;
const th = "px-3 py-1.5 font-medium whitespace-nowrap";
const td = "px-3 py-1.5 align-top";
const tableBox = "overflow-x-auto rounded-lg border border-line";
const join = (a: string[]) => a.filter(Boolean).join(", ") || dash;
const dateTime = (v: string | null) => (v ? `${formatThaiDate(v)} ${v.slice(11, 16)}` : null);

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-xs text-muted">{label}</dt>
    <dd className="mt-0.5 break-words tabular-nums">{children || dash}</dd>
  </div>
);

const Kpi = ({ label, value, tone = "" }: { label: string; value: string; tone?: string }) => (
  <div className="min-w-0 px-3 py-2">
    <dt className="text-xs text-muted">{label}</dt>
    <dd className={`mt-0.5 text-base font-semibold tabular-nums ${tone}`}>{value}</dd>
  </div>
);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 border-t border-line pt-5">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// ---- รายการในไฟล์ (DataGrid แบบ localState ใน modal) ----
const STATUS: Record<RepLineRow["status"], { label: string; tone: string }> = {
  pass: { label: "ผ่าน", tone: "border-success-line bg-success-soft text-success" },
  c: { label: "ติด C", tone: "border-danger-line bg-danger-soft text-danger" },
  deny: { label: "Deny", tone: "border-danger-line bg-danger-soft text-danger" },
};
const StatusChip = ({ s }: { s: RepLineRow["status"] }) => (
  <span className={`rounded border px-1.5 py-0.5 whitespace-nowrap ${STATUS[s].tone}`}>{STATUS[s].label}</span>
);
const money = (v: string | null) => <Money value={v == null ? null : Number(v)} />;
const nowrap = "whitespace-nowrap tabular-nums";
const date = (v: string | null) => (v ? formatThaiDate(v) : dash);

const col = gridColumnHelper<RepLineRow>();
const lineColumns = (ip: boolean) =>
  col.columns([
    col.accessor("status", {
      header: "สถานะ",
      enableSorting: false,
      cell: (c) => {
        // DENY ซ้ำกับป้าย รหัส Deny รายตัวอยู่ในรายละเอียด
        const codes = c.row.original.error_codes.filter((e) => e !== "DENY").join(", ");
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <StatusChip s={c.getValue()} />
            {codes && <span className="text-muted tabular-nums">{codes}</span>}
          </span>
        );
      },
      meta: { filter: { format: (v) => STATUS[v as RepLineRow["status"]]?.label ?? v } },
    }),
    col.accessor("ref", { header: ip ? "AN" : "VN", cell: (c) => c.getValue() ?? dash, meta: { className: nowrap } }),
    col.accessor("hn", { header: "HN", cell: (c) => c.getValue() ?? dash, meta: { className: nowrap } }),
    col.accessor("tran_id", { header: "TRAN_ID", meta: { className: nowrap } }),
    col.accessor("rep_no", { header: "REP No.", meta:{ className: nowrap, filter: true } }),
    col.accessor("admit_at", { header: ip ? "วันเข้ารักษา" : "วันที่รับบริการ", cell: (c) => date(c.getValue()), meta: { className: nowrap } }),
    ...(ip ? [col.accessor("discharge_at", { header: "วันจำหน่าย", cell: (c) => date(c.getValue()), meta: { className: nowrap } })] : []),
    col.accessor("main_inscl", { header: "สิทธิ", cell: (c) => c.getValue() ?? dash, meta: { className: nowrap, filter: true } }),
    ...(ip ? [col.accessor("adjrw", { header: "AdjRW", cell: (c) => c.getValue() ?? dash, meta: { className: num } })] : []),
    col.accessor("claim_total", { header: "เรียกเก็บ (บาท)", cell: (c) => money(c.getValue()), meta: { className: num } }),
    col.accessor("compensation", { header: "ชดเชยสุทธิ (บาท)", cell: (c) => money(c.getValue()), meta: { className: num } }),
    col.accessor("stm_paid", {
      header: "STM จ่าย (บาท)",
      enableSorting: false,
      cell: (c) => <span title={c.row.original.stm_docs ?? undefined}>{money(c.getValue())}</span>,
      meta: { className: num },
    }),
  ]);
const LINE_COLUMNS = { op: lineColumns(false), ip: lineColumns(true) };

const lineTitle = (r: RepLineRow) => {
  const label = r.patient_type === "IP" ? "AN" : "VN";
  return r.ref ? <>{label} {copyable(r.ref, label)}</> : `TRAN_ID ${r.tran_id}`;
};

/** รายละเอียดแถว REP หนึ่งแถว: ข้อมูลแถว + REP ของแถวนั้นและประวัติของ VN/AN (RepDetail) + รายการค่าใช้จ่ายใน HOSxP */
function LineDetail({ r }: { r: RepLineRow }) {
  const ip = r.patient_type === "IP";
  return (
    <div className="text-sm">
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-6 gap-y-3">
        <Fact label="สถานะ"><StatusChip s={r.status} /></Fact>
        <Fact label="TRAN_ID">{copyable(r.tran_id, "TRAN_ID")}</Fact>
        <Fact label="HN">{copyable(r.hn, "HN")}</Fact>
        <Fact label="สิทธิ (REP)">{[r.scheme, r.main_inscl].filter(Boolean).join(" · ")}</Fact>
        <Fact label={ip ? "วันเข้ารักษา" : "วันที่รับบริการ"}>{r.admit_at && formatThaiDate(r.admit_at)}</Fact>
        {ip && <Fact label="วันจำหน่าย">{r.discharge_at && formatThaiDate(r.discharge_at)}</Fact>}
        <Fact label="STM จ่าย (บาท)">
          {r.stm_paid == null ? (
            <span className="text-muted">ยังไม่พบใน STM</span>
          ) : (
            <>
              {formatBaht(Number(r.stm_paid))}
              <span className="block text-xs break-all text-muted">{r.stm_docs}</span>
            </>
          )}
        </Fact>
      </dl>
      <RepDetail type={ip ? "ipd" : "opd"} tranId={r.tran_id} />
      {r.ref && <DebtorItems vn={ip ? null : r.ref} an={ip ? r.ref : null} />}
    </div>
  );
}

/** เนื้อหา modal ของไฟล์ REP หนึ่งไฟล์ โหลดเมื่อเปิด (นับการจับคู่ลูกหนี้กับ HOSxP จึงใช้เวลาตามจำนวนแถว) */
export function RepFileDetailView({ id }: { id: string }) {
  const { loading, data, error, retry } = useJson<RepFileDetail>(`/api/fund/rep-import/detail?${new URLSearchParams({ id })}`);

  if (loading) return <Skeleton rows={8} />;
  if (error || !data)
    return (
      <div className="py-6 text-center text-sm">
        <p className="font-medium text-danger">โหลดรายละเอียดไฟล์ไม่สำเร็จ</p>
        <p className="mt-1 text-muted">{error}</p>
        <button type="button" onClick={retry} className={`${btn} mt-4`}>ลองอีกครั้ง</button>
      </div>
    );

  const { file: f, kpi: k, funds, errors } = data;
  const moved = f.row_count - k.total;
  return (
    <div className="text-sm">
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-6 gap-y-3">
        <Fact label="ประเภท">{f.rep_type}</Fact>
        <Fact label="HCODE">{f.hcode}</Fact>
        <Fact label="วันที่ไฟล์">{f.file_date && formatThaiDate(f.file_date)}</Fact>
        <Fact label="วันที่พิมพ์">{dateTime(f.printed_at)}</Fact>
        <Fact label="นำเข้าเมื่อ">{dateTime(f.imported_at)}</Fact>
        <Fact label="ผู้นำเข้า">{f.imported_by}</Fact>
        <Fact label="จำนวนรายการ">
          {formatCount(f.row_count)}
          {moved > 0 && <span className="block text-xs text-muted">ย้ายไปไฟล์ใหม่กว่า {formatCount(moved)}</span>}
        </Fact>
      </dl>

      <dl className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] rounded-lg border border-line bg-surface-sunken">
        <Kpi label="ทั้งหมด" value={formatCount(k.total)} />
        <Kpi label="ตรงกับลูกหนี้" value={formatCount(k.matched)} />
        <Kpi label="ไม่ตรงลูกหนี้" value={formatCount(k.unmatched)} tone={k.unmatched ? "text-warning" : ""} />
        <Kpi label="มี Error Code" value={formatCount(k.error_rows)} tone={k.error_rows ? "text-danger" : ""} />
        <Kpi label="ยอดเบิกรวม (บาท)" value={formatBaht(k.claim_total)} />
        <Kpi label="ยอดชดเชยรวม (บาท)" value={formatBaht(k.compensation)} />
      </dl>

      <Section title="รายการ">
        <DataGrid<RepLineRow>
          endpoint="/api/fund/rep-import/rows"
          params={{ id }}
          localState={{}}
          columns={LINE_COLUMNS[f.rep_type.startsWith("IP") ? "ip" : "op"]}
          getRowId={(r) => r.tran_id}
          renderDetail={(r) => <LineDetail r={r} />}
          detailTitle={lineTitle}
          detailSize="medium"
          detailInColumn="ref"
          searchSize="compact"
        />
      </Section>

      <Section title="กองทุนที่พบ">
        {funds.length ? (
          <div className={tableBox}>
            <table className="w-full border-collapse tabular-nums">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className={th}>กองทุนหลัก</th>
                  <th className={th}>กองทุนย่อย</th>
                  <th className={`${th} ${num}`}>จำนวน</th>
                  <th className={`${th} ${num}`}>ชดเชย (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {funds.map((g, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className={td}>{join(g.main_fund)}</td>
                    <td className={td}>{join(g.sub_fund)}</td>
                    <td className={`${td} ${num}`}>{formatCount(g.n)}</td>
                    <td className={`${td} ${num}`}>{formatBaht(g.compensation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">ไม่มีรายการ</p>
        )}
      </Section>

      <Section title="Error Code ที่พบ">
        {errors.length ? (
          <div className={tableBox}>
            <table className="w-full border-collapse">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className={`${th} w-0`}>รหัส</th>
                  <th className={th}>ความหมาย</th>
                  {/* แถวหนึ่งมีได้หลายรหัส จึงนับเป็นรายการต่อรหัส และไม่รวมยอดข้ามรหัส */}
                  <th className={`${th} ${num}`}>จำนวนรายการ</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={e.code} className="border-t border-line">
                    <td className={`${td} whitespace-nowrap`}>
                      <span className="rounded border border-danger-line bg-danger-soft px-1.5 text-xs text-danger">{e.code}</span>
                    </td>
                    <td className={`${td} ${e.description ? "" : "text-muted"}`}>{e.description || "ไม่มีคำอธิบาย"}</td>
                    <td className={`${td} ${num}`}>{formatCount(e.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">ไม่มี Error Code</p>
        )}
      </Section>
    </div>
  );
}
