"use client";

import type { ReactNode } from "react";
import { formatBaht, formatCount } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { RepFileDetail } from "@/app/api/fund/rep-import/detail/file-detail";
import { Skeleton, btn, num, useJson } from "../_components/ui";

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
