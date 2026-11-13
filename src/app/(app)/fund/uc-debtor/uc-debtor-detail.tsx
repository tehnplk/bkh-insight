"use client";

import { Fragment, type ReactNode } from "react";
import { formatBaht } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import type { UcDebtorRow } from "@/app/api/fund/uc-debtor/debtor";
import type { RepDetailResponse } from "@/app/api/fund/uc-debtor/detail/rep-detail";
import { DEBTOR_PAIDST, PAIDST_LABEL, type DebtorItem, type DebtorItemsResponse } from "@/app/api/fund/uc-debtor/items/items";
import { ItemCategories } from "../_components/visit-items";
import { Money, Skeleton, btn, num, useJson } from "../_components/ui";

const dash = <span className="text-muted">–</span>;
const th = "px-3 py-1.5 font-medium";
const td = "px-3 py-1.5 align-top";
const tableBox = "mt-2 overflow-x-auto rounded-lg border border-line";
const join = (a: string[] | null) => a?.filter(Boolean).join(", ") || null;
const pair = (a: string | null, b: string | null) => (a || b ? `${a || "–"} / ${b || "–"}` : null);
const fileOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);

export const Facts = ({ children }: { children: ReactNode }) => (
  <dl className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-6 gap-y-3">{children}</dl>
);

export const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-xs text-muted">{label}</dt>
    <dd className="mt-0.5 break-words tabular-nums">{children || dash}</dd>
  </div>
);

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 border-t border-line pt-5">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function LoadError({ what, error, retry }: { what: string; error?: string; retry: () => void }) {
  return (
    <div className="py-6 text-center">
      <p className="font-medium text-danger">โหลด{what}ไม่สำเร็จ</p>
      <p className="mt-1 text-muted">{error}</p>
      <button type="button" onClick={retry} className={`${btn} mt-4`}>ลองอีกครั้ง</button>
    </div>
  );
}

const Codes = ({ codes }: { codes: string[] }) =>
  codes.length ? (
    <span className="flex flex-wrap gap-1">
      {codes.map((c) => (
        <span key={c} className="rounded border border-danger-line bg-danger-soft px-1.5 text-xs text-danger">{c}</span>
      ))}
    </span>
  ) : (
    dash
  );

/** เนื้อหา modal ของลูกหนี้หนึ่งราย: ยอดจากแถวของ grid แสดงทันที ส่วน REP โหลดเมื่อเปิด */
export function UcDebtorDetail({ row, status }: { row: UcDebtorRow; status: ReactNode }) {
  const type = row.an ? "ipd" : "opd";
  const { loading, data, error, retry } = useJson<RepDetailResponse>(
    `/api/fund/uc-debtor/detail?${new URLSearchParams({ type, key: row.key })}`,
  );

  return (
    <div className="text-sm">
      <Facts>
        <Fact label="ลูกหนี้ (บาท)"><span className="font-semibold">{formatBaht(row.debtor)}</span></Fact>
        <Fact label="ชดเชยสุทธิ (บาท)"><span className="font-semibold"><Money value={row.compensation} /></span></Fact>
        <Fact label="ส่วนต่าง (บาท)"><span className="font-semibold"><Money value={row.diff} /></span></Fact>
        <Fact label="สถานะ">{status}</Fact>
      </Facts>
      <DebtorItems vn={row.key} an={row.an} debtor={row.debtor} />
      {loading ? (
        <div className="mt-6"><Skeleton rows={6} /></div>
      ) : error || !data ? (
        <div className="mt-6"><LoadError what="ข้อมูล REP" error={error} retry={retry} /></div>
      ) : !data.latest ? (
        <p className="mt-6 rounded-lg border border-line px-4 py-8 text-center text-muted">ยังไม่มี REP</p>
      ) : (
        <RepSections data={data} latest={data.latest} ipd={type === "ipd"} />
      )}
    </div>
  );
}

// รายการเกินนี้ (มักเป็น IPD) เริ่มแบบพับหมวด ให้เห็นยอดต่อหมวดและยอดสรุปก่อน
const OPEN_MAX_ITEMS = 15;

const PaidTag = ({ item }: { item: DebtorItem }) => {
  if (item.paidst === DEBTOR_PAIDST) return null;
  const t = (item.paidst && PAIDST_LABEL[item.paidst]) || { label: "ไม่ใช่ลูกหนี้", title: "ไม่ใช่ลูกหนี้สิทธิ" };
  return (
    <span title={t.title} className="ml-1.5 inline-block rounded border border-line px-1 text-xs whitespace-nowrap text-muted">
      {t.label}
    </span>
  );
};
const paidTag = (item: DebtorItem) => <PaidTag item={item} />;

const SumRow = ({ label, value, strong }: { label: string; value: number; strong?: boolean }) => (
  <div className={`flex items-center justify-between px-3 py-1.5 ${strong ? "font-semibold" : "text-muted"}`}>
    <span>{label}</span>
    <span className={num}><Money value={value} /></span>
  </div>
);

/** รายการค่าใช้จ่ายของ visit/admission (HOSxP opitemrece) มี an ใช้ an ไม่งั้นใช้ vn; ไม่ส่ง debtor = ไม่เทียบส่วนต่าง */
export function DebtorItems({ vn, an, debtor }: { vn: string | null; an: string | null; debtor?: number }) {
  const q: Record<string, string> = an ? { an } : { vn: vn ?? "" };
  const { loading, data, error, retry } = useJson<DebtorItemsResponse>(`/api/fund/uc-debtor/items?${new URLSearchParams(q)}`);
  const count = data?.categories.reduce((n, c) => n + c.items.length, 0) ?? 0;
  const gap = data && debtor != null ? Math.round((data.debtor - debtor) * 100) / 100 : 0;

  return (
    <Section title="รายการค่าใช้จ่าย">
      {loading ? (
        <Skeleton rows={4} />
      ) : error || !data ? (
        <LoadError what="รายการค่าใช้จ่าย" error={error} retry={retry} />
      ) : (
        <>
          <ItemCategories categories={data.categories} open={count <= OPEN_MAX_ITEMS} tag={paidTag}>
            <div className="border-t-2 border-line py-1">
              <SumRow label="ลูกหนี้สิทธิ (บาท)" value={data.debtor} strong />
              <SumRow label="ชำระเอง/อื่นๆ (บาท)" value={data.other} />
              <SumRow label="รวม (บาท)" value={data.total} strong />
            </div>
          </ItemCategories>
          {data.categories.length > 0 && gap !== 0 && (
            <p className="mt-2 text-xs text-muted">
              ลูกหนี้สิทธิจากรายการ{gap > 0 ? "มากกว่า" : "น้อยกว่า"}ยอดลูกหนี้ {formatBaht(Math.abs(gap))} บาท
            </p>
          )}
        </>
      )}
    </Section>
  );
}

function RepSections({ data, latest: l, ipd }: { data: RepDetailResponse; latest: NonNullable<RepDetailResponse["latest"]>; ipd: boolean }) {
  const sources = [...new Set(data.errors.map((e) => e.source).filter((s) => s != null))];
  return (
    <>
      <Section title="ยอดที่ได้รับจัดสรร">
        <Facts>
          <Fact label="เรียกเก็บ (บาท)"><Money value={l.claim_total} /></Fact>
          <Fact label="ชดเชยสุทธิ สปสช. (บาท)"><Money value={l.net_nhso} /></Fact>
          <Fact label="ชดเชยสุทธิ ต้นสังกัด (บาท)"><Money value={l.net_affiliation} /></Fact>
          <Fact label="REP">{data.history[0].rep_no}</Fact>
          <Fact label="กองทุนหลัก / ย่อย">{pair(join(l.main_fund), join(l.sub_fund))}</Fact>
          <Fact label="สิทธิหลัก / ย่อย">{pair(l.main_inscl, l.sub_inscl)}</Fact>
          {ipd && <Fact label="DRG">{l.drg}</Fact>}
          {ipd && <Fact label="RW / AdjRW">{pair(l.rw?.toFixed(4) ?? null, l.adjrw?.toFixed(4) ?? null)}</Fact>}
          <Fact label="การจ่าย">{l.pay_mode}</Fact>
          <Fact label="หมายเหตุ">{l.remark}</Fact>
        </Facts>
        {l.funds.length > 0 && (
          <div className={`${tableBox} mt-4`}>
            <table className="w-full border-collapse tabular-nums">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className={th}>รายการ</th>
                  <th className={`${th} ${num}`}>จำนวนเงิน (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {l.funds.map((g) => (
                  <Fragment key={g.group}>
                    <tr className="border-t border-line bg-surface-sunken">
                      <th scope="colgroup" colSpan={2} className={`${th} text-left`}>{g.group}</th>
                    </tr>
                    {g.items.map((it) => (
                      <tr key={it.label} className="border-t border-line">
                        <td className={`${td} pl-6`}>{it.label}</td>
                        <td className={`${td} ${num}`}><Money value={it.amount} /></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {data.errors.length > 0 && (
        <Section title="Error">
          <div className={tableBox}>
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
                    <td className={td}><Codes codes={[e.code]} /></td>
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
          {sources.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              ที่มา{" "}
              {sources.map((s, i) => (
                <Fragment key={s}>
                  {i > 0 && ", "}
                  <a href={s} target="_blank" rel="noreferrer" className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    {fileOf(s)}
                  </a>
                </Fragment>
              ))}
            </p>
          )}
        </Section>
      )}

      <Section title="ประวัติการส่ง">
        <div className={tableBox}>
          <table className="w-full border-collapse tabular-nums">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className={th}>TRAN_ID</th>
                <th className={th}>REP</th>
                <th className={th}>ไฟล์</th>
                <th className={th}>วันที่ไฟล์</th>
                <th className={`${th} ${num}`}>ชดเชยสุทธิ (บาท)</th>
                <th className={th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h, i) => (
                <tr key={h.tran_id} className="border-t border-line">
                  <td className={`${td} whitespace-nowrap`}>
                    {h.tran_id}
                    {i === 0 && " "}
                    {i === 0 && <span className="ml-1 rounded bg-accent-soft px-1.5 text-xs text-accent-text">ล่าสุด</span>}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{h.rep_no}</td>
                  <td className={`${td} break-all`}>{h.file_name}</td>
                  <td className={`${td} whitespace-nowrap`}>{h.file_date ? formatThaiDate(h.file_date) : dash}</td>
                  <td className={`${td} ${num}`}><Money value={h.compensation} /></td>
                  <td className={td}><Codes codes={h.error_codes} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
