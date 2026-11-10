"use client";

import type { ReactNode } from "react";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { StmFileDetail } from "@/app/api/fund/stm-import/detail/route";
import { Money, Skeleton, btn, num, useJson } from "../_components/ui";
import { FUNDS, SCHEMES, SECTIONS, isCalc, periodLabel } from "./labels";

const dash = <span className="text-muted">–</span>;
const th = "px-3 py-1.5 font-medium whitespace-nowrap";
const td = "px-3 py-1.5 align-top";
const tableBox = "overflow-x-auto rounded-lg border border-line";
const dateTime = (v: string | null) => (v ? `${formatThaiDate(v)} ${v.slice(11, 16)}` : null);

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-xs text-muted">{label}</dt>
    <dd className="mt-0.5 break-words tabular-nums">{children || dash}</dd>
  </div>
);

const Kpi = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 px-3 py-2">
    <dt className="text-xs text-muted">{label}</dt>
    <dd className="mt-0.5 text-base font-semibold tabular-nums">{value}</dd>
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

/** เนื้อหา modal ของไฟล์ STM หนึ่งไฟล์: สรุปราย REP และยอดรายกองทุนจากชีตสรุป */
export function StmFileDetailView({ id }: { id: string }) {
  const { loading, data, error, retry } = useJson<StmFileDetail>(`/api/fund/stm-import/detail?${new URLSearchParams({ id })}`);

  if (loading) return <Skeleton rows={8} />;
  if (error || !data)
    return (
      <div className="py-6 text-center text-sm">
        <p className="font-medium text-danger">โหลดรายละเอียดไฟล์ไม่สำเร็จ</p>
        <p className="mt-1 text-muted">{error}</p>
        <button type="button" onClick={retry} className={`${btn} mt-4`}>ลองอีกครั้ง</button>
      </div>
    );

  const { file: f, reps, funds } = data;
  const showSection = reps.some((r) => r.section !== "normal");
  return (
    <div className="text-sm">
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-6 gap-y-3">
        <Fact label="งวด">{`${periodLabel(f.period_month)} ครั้งที่ ${f.run_no}`}</Fact>
        <Fact label="สิทธิ">{`${SCHEMES[f.scheme] ?? f.scheme} ${f.patient_type}`}</Fact>
        <Fact label="HCODE">{f.hcode}</Fact>
        <Fact label="วันที่โอน">{formatThaiDate(f.transfer_date)}</Fact>
        <Fact label="วันที่ออกรายงาน">{dateTime(f.printed_at)}</Fact>
        <Fact label="นำเข้าเมื่อ">{dateTime(f.imported_at)}</Fact>
        <Fact label="ผู้นำเข้า">{f.imported_by}</Fact>
        <Fact label="ชื่อไฟล์">{f.file_name}</Fact>
      </dl>

      <dl className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] rounded-lg border border-line bg-surface-sunken">
        <Kpi label="จำนวนรายการ" value={formatCount(f.row_count)} />
        <Kpi label="ยอดชดเชย (บาท)" value={formatBaht(Number(f.paid_total))} />
        <Kpi label="หัก (บาท)" value={formatBaht(Number(f.deduction))} />
        <Kpi label="ยอดโอนสุทธิ (บาท)" value={formatBaht(Number(f.net_total))} />
      </dl>

      <Section title="สรุปราย REP">
        <div className={tableBox}>
          <table className="w-full border-collapse tabular-nums">
            <thead className="text-left text-xs text-muted">
              <tr>
                {showSection && <th className={th}>ประเภท</th>}
                <th className={th}>REP</th>
                <th className={`${th} ${num}`}>ราย</th>
                <th className={`${th} ${num}`}>เรียกเก็บ (บาท)</th>
                <th className={`${th} ${num}`}>ชดเชย (บาท)</th>
                {f.scheme === "UCS" && <th className={th}>แหล่งข้อมูล</th>}
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => (
                <tr key={`${r.section}-${r.rep_no}`} className="border-t border-line">
                  {showSection && <td className={`${td} whitespace-nowrap`}>{SECTIONS[r.section]}</td>}
                  <td className={td}>{r.rep_no}</td>
                  <td className={`${td} ${num}`}>{r.passed === null ? dash : formatCount(r.passed)}</td>
                  <td className={`${td} ${num}`}><Money value={r.claim_total === null ? null : Number(r.claim_total)} /></td>
                  <td className={`${td} ${num}`}>{formatBaht(Number(r.paid_total))}</td>
                  {f.scheme === "UCS" && <td className={td}>{r.source ?? dash}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="ยอดรายกองทุน">
        {funds.length ? (
          <div className={tableBox}>
            <table className="w-full border-collapse tabular-nums">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className={th}>กองทุน</th>
                  <th className={`${th} ${num}`}>ยอด (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {funds.map((g) => (
                  // ยอดคำนวณได้แสดงจาง เพราะไม่รวมในยอดชดเชย
                  <tr key={g.fund} className={`border-t border-line ${isCalc(g.fund) ? "text-muted" : ""}`}>
                    <td className={td}>{FUNDS[g.fund] ?? g.fund}</td>
                    <td className={`${td} ${num}`}>{formatBaht(Number(g.amount))}</td>
                  </tr>
                ))}
                <tr className="border-t border-line font-semibold">
                  <td className={td}>รวม</td>
                  <td className={`${td} ${num}`}>{formatBaht(Number(f.paid_total))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">ไม่มียอดชดเชย</p>
        )}
      </Section>
    </div>
  );
}
