"use client";

import type { ReactNode } from "react";
import { copyable } from "@/components/copy-button/copy-button";
import { formatBaht } from "@/lib/number-format";
import { formatThaiDate } from "@/lib/thai-date";
import { Money, Notice, Skeleton, num, useJson } from "@/app/(app)/fund/_components/ui";
import { Fact, Facts, Section } from "@/app/(app)/fund/uc-debtor/uc-debtor-detail";
import { FUNDS, SECTIONS, isCalc } from "@/app/(app)/fund/stm-import/labels";
import { KIND_LABEL } from "@/app/api/fund/ar-sync/ledger";
import { SOURCE_LABEL } from "@/app/api/fund/ar-collect/collect";
import { REP_ACCOUNTS, type PreviewRow, type SettleStatus } from "@/app/api/fund/ar-settle/settle";
import type { DetailDebt, DetailLine, SettleDetail } from "@/app/api/fund/ar-settle/detail/route";

const th = "px-3 py-1.5 font-medium whitespace-nowrap";
const td = "px-3 py-1.5 align-top";
const box = "max-w-full overflow-x-auto rounded-lg border border-line";
const head = "bg-surface-sunken text-left text-xs text-muted";
const dash = <span className="text-muted">–</span>;
const source = (s: string) => SOURCE_LABEL[s] ?? "HOSxP";
const account = (code: string | null, name: string | null) =>
  code ? (
    <>
      {code}
      {name && <span className="ml-1.5 text-muted">{name}</span>}
    </>
  ) : (
    <span className="text-danger">ยังไม่ระบุบัญชี</span>
  );

/** เหตุที่ตัดไม่ได้ของกลุ่ม "ไม่พบหนี้ที่ตัดได้" และ "REP งวดนี้ STM ไม่จ่าย" */
const REASON: Partial<Record<SettleStatus, (doc: string) => string>> = {
  no_ref: (doc) => `บรรทัดใน ${doc} ไม่มี VN/AN และจับคู่กับ REP ด้วย TRAN_ID ของสิทธิเดียวกันไม่ได้`,
  no_debt: () => "ยังไม่มีหนี้ของ VN/AN นี้ในสมุดลูกหนี้ (ยังไม่ดึงจาก HOSxP หรือสิทธินี้ไม่ตั้งลูกหนี้)",
  not_stm: (doc) =>
    doc === "REP" ? `หนี้อยู่บัญชีที่ REP ตัดไม่ได้ ตัดด้วย REP ได้เฉพาะ ${Object.values(REP_ACCOUNTS).flat().join(", ")}` : "หนี้อยู่บัญชีที่ไม่ตัดด้วย STM (ตั้งที่ /admin/ar-accounts)",
  no_account: () => "หนี้ยังไม่ระบุบัญชี กำหนดกติกาบัญชีที่ /admin/ar-accounts แล้วปรับสมุดลูกหนี้",
  zero: (doc) => `${doc} จ่าย 0 บาท ไม่มียอดที่ตัด`,
  missing: () => "REP งวดที่ STM นี้จ่ายผ่านแล้ว แต่ไฟล์ STM ไม่มีบรรทัดของรายนี้ หนี้ยังค้าง",
};

function Funds({ f }: { f: DetailLine["fund_amounts"] }) {
  const funds = Object.entries(f ?? {});
  if (!funds.length) return dash;
  return (
    <ul className="flex flex-col">
      {funds.map(([k, v]) => (
        // ยอดคำนวณได้แสดงจาง เพราะไม่รวมในยอดชดเชย
        <li key={k} className={`flex justify-between gap-3 whitespace-nowrap ${isCalc(k) ? "text-muted" : ""}`}>
          <span>{FUNDS[k] ?? k}</span>
          <span>{formatBaht(Number(v))}</span>
        </li>
      ))}
    </ul>
  );
}

function Lines({ d, doc }: { d: SettleDetail; doc: string }) {
  const stm = d.line_doc === "stm";
  const adjrw = d.row.patient_type === "IP";
  const errors = d.lines.some((l) => l.error_codes?.length);
  return (
    <div className={box}>
      <table className="w-full border-collapse tabular-nums">
        <caption className="sr-only">รายการใน {doc}</caption>
        <thead className={head}>
          <tr>
            <th className={th}>REP</th>
            <th className={th}>TRAN_ID</th>
            {stm && <th className={th}>ส่วน</th>}
            {adjrw && <th className={`${th} ${num}`}>AdjRW</th>}
            {errors && <th className={th}>รหัสติด C/Deny</th>}
            <th className={`${th} ${num}`}>เรียกเก็บ (บาท)</th>
            <th className={th}>ยอดรายกองทุน (บาท)</th>
            <th className={`${th} ${num}`}>{doc} จ่าย (บาท)</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className={td}>{l.rep_no}</td>
              <td className={td}>{l.tran_id || dash}</td>
              {stm && <td className={`${td} whitespace-nowrap`}>{l.section ? (SECTIONS[l.section] ?? l.section) : dash}</td>}
              {adjrw && <td className={`${td} ${num}`}>{l.adjrw ?? dash}</td>}
              {errors && <td className={td}>{l.error_codes?.join(", ") || dash}</td>}
              <td className={`${td} ${num}`}><Money value={l.claim_total == null ? null : Number(l.claim_total)} /></td>
              <td className={td}><Funds f={l.fund_amounts} /></td>
              <td className={`${td} ${num}`}>{formatBaht(Number(l.paid_total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Plan({ d, doc, closeOn }: { d: SettleDetail; doc: string; closeOn: boolean }) {
  const settleable = d.debts.filter((x) => x.settles);
  const hasDiff = settleable.some((x) => x.diff);
  const cr = settleable.find((x) => x.ref.endsWith(":CR"));
  return (
    <>
      {d.row.group === "done" && <p className="mb-3 text-muted">บรรทัดของ {doc} นี้ตัดแล้ว ดูแถวที่ลงไว้ในรายการสมุดลูกหนี้ด้านล่าง</p>}
      {cr && d.cr_paid > 0 && (
        <p className="mb-3 text-muted">
          {doc} จ่ายค่าพาหนะส่งต่อ (AE) <span className="font-semibold text-foreground">{formatBaht(d.cr_paid)}</span> บาท ตัดหนี้ {cr.ref} ({cr.account_code}) ก่อน ไม่เกินคงเหลือ ที่เหลือตัดหนี้หลัก
        </p>
      )}
      <div className={box}>
        <table className="w-full border-collapse tabular-nums">
          <caption className="sr-only">การแบ่งยอดตัดหนี้</caption>
          <thead className={head}>
            <tr>
              <th className={th}>หนี้</th>
              <th className={th}>บัญชี</th>
              <th className={`${th} ${num}`}>หนี้คงเหลือ (บาท)</th>
              <th className={`${th} ${num}`}>รับชำระรอบนี้ (บาท)</th>
              <th className={`${th} ${num}`}>คงเหลือหลังตัด (บาท)</th>
              <th className={`${th} ${num}`}>ส่วนต่างถ้าปิด (บาท)</th>
            </tr>
          </thead>
          <tbody>
            {settleable.map((x) => (
              <tr key={x.ref} className="border-t border-line">
                <td className={`${td} whitespace-nowrap`}>{x.ref}</td>
                <td className={td}>{account(x.account_code, x.account_name)}</td>
                <td className={`${td} ${num}`}>{formatBaht(x.before)}</td>
                <td className={`${td} ${num}`}>{formatBaht(-x.settle)}</td>
                <td className={`${td} ${num}`}>{formatBaht(x.after)}</td>
                <td className={`${td} ${num}`}>{x.diff ? formatBaht(-x.diff) : dash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasDiff && (
        <div className="mt-3 space-y-1">
          <p className={closeOn ? "text-foreground" : "text-muted"}>
            {closeOn ? "ติ๊กปิดส่วนต่างอยู่: ตัดแล้วจะลงส่วนต่างให้หนี้คงเหลือ 0" : "ไม่ได้ติ๊กปิดส่วนต่าง: คงเหลือเก็บไว้รอเอกสารงวดถัดไป ติ๊กในตารางเพื่อปิด"}
          </p>
          {settleable.filter((x) => x.diff_line).map((x) => (
            <p key={x.ref} className="tabular-nums text-muted">
              {x.ref} {x.diff < 0 ? "ได้รับต่ำกว่า" : "ได้รับสูงกว่า"} {formatBaht(Math.abs(x.diff))} บาท · Dr {x.diff_line!.dr_code ?? "ยังไม่กำหนด"} {x.diff_line!.dr_name} / Cr{" "}
              {x.diff_line!.cr_code ?? "ยังไม่กำหนด"} {x.diff_line!.cr_name}
              {x.prior_year && " (หนี้บริการปีงบก่อน)"}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

function Ledger({ x }: { x: DetailDebt }) {
  return (
    <div>
      <h4 className="mb-2 font-semibold">
        {x.ref} <span className="font-normal">· {account(x.account_code, x.account_name)}</span>
        {!x.settles && <span className="ml-1.5 font-normal text-muted">(ไม่ตัดด้วยเอกสารนี้)</span>}
      </h4>
      <div className={box}>
        <table className="w-full border-collapse tabular-nums">
          <caption className="sr-only">รายการในสมุดลูกหนี้ของหนี้ {x.ref}</caption>
          <thead className={head}>
            <tr>
              <th className={th}>วันที่ลงบัญชี</th>
              <th className={th}>ประเภท</th>
              <th className={th}>ที่มา</th>
              <th className={`${th} ${num}`}>จำนวนเงิน (บาท)</th>
              <th className={`${th} ${num}`}>คงเหลือ (บาท)</th>
              <th className={th}>ชุดตัดหนี้</th>
            </tr>
          </thead>
          <tbody>
            {x.entries.map((e) => (
              <tr key={e.id} className={`border-t border-line ${e.this_doc ? "bg-accent-soft" : ""}`}>
                <td className={`${td} whitespace-nowrap`}>
                  {formatThaiDate(e.entry_date)}
                  {e.orig_entry_date && <span className="block text-xs text-muted">เลื่อนจาก {formatThaiDate(e.orig_entry_date)}</span>}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {KIND_LABEL[e.kind] ?? e.kind}
                  {e.note && <span className="block text-xs text-muted">{e.note}</span>}
                </td>
                <td className={`${td} whitespace-nowrap`}>{source(e.source)}</td>
                <td className={`${td} ${num}`}>{formatBaht(Number(e.amount))}</td>
                <td className={`${td} ${num}`}>{formatBaht(e.running)}</td>
                <td className={td}>
                  {e.batch_id ? (
                    <>
                      #{e.batch_id} · ใบเสร็จ {e.receipt_no ?? "–"} {e.receipt_date && formatThaiDate(e.receipt_date)}
                      <span className="block text-xs text-muted">
                        {e.settled_by} {e.settled_at && `${formatThaiDate(e.settled_at)} ${e.settled_at.slice(11, 16)} น.`}
                        {e.this_doc && " · เอกสารนี้"}
                      </span>
                    </>
                  ) : (
                    dash
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** รายละเอียดหนึ่งแถวของตัวอย่างการตัด: เอกสาร (STM/REP) ของรายนี้ การแบ่งยอด และรายการในสมุดลูกหนี้ ; closeOn = สถานะ checkbox ปิดส่วนต่างตอนนี้ */
export function SettleDetailView({ doc, id, row, status, closeOn }: { doc: "stm" | "rep"; id: string; row: PreviewRow; status: ReactNode; closeOn: boolean }) {
  const qs = new URLSearchParams({ [doc === "rep" ? "rep" : "id"]: id, key: row.key });
  const { data: d, error, loading, retry } = useJson<SettleDetail>(`/api/fund/ar-settle/detail?${qs}`);
  if (loading) return <Skeleton rows={6} />;
  if (error || !d)
    return (
      <Notice title="โหลดรายละเอียดไม่สำเร็จ" detail={error} action={<button type="button" onClick={retry} className="underline underline-offset-2">ลองใหม่</button>} />
    );
  const docName = d.line_doc === "rep" ? "REP" : "STM";
  const reason = REASON[d.row.status]?.(doc === "rep" ? "REP" : "STM");
  const settleable = d.debts.some((x) => x.settles) && d.row.group !== "none" && d.row.group !== "missing";
  return (
    <div className="text-base">
      <Facts>
        <Fact label="สถานะ">{status}</Fact>
        <Fact label="HN">{copyable(row.hn, "HN")}</Fact>
        <Fact label="บัญชี">{row.account_code}</Fact>
        <Fact label="หนี้คงเหลือ (บาท)"><Money value={row.balance} /></Fact>
        <Fact label={`${doc === "rep" ? "REP" : "STM"} จ่าย (บาท)`}><Money value={row.paid} /></Fact>
        <Fact label="คงเหลือหลังตัด (บาท)"><Money value={row.remaining} /></Fact>
      </Facts>
      {reason && <p className="mt-4 text-warning">{reason}</p>}
      <Section title={`${docName} ของรายนี้`}>{d.lines.length ? <Lines d={d} doc={docName} /> : <p className="text-muted">ไม่พบบรรทัด</p>}</Section>
      {settleable && (
        <Section title="การแบ่งยอด">
          <Plan d={d} doc={docName} closeOn={closeOn} />
        </Section>
      )}
      <Section title="รายการในสมุดลูกหนี้">
        {d.debts.length ? <div className="space-y-4">{d.debts.map((x) => <Ledger key={x.ref} x={x} />)}</div> : <p className="text-muted">ยังไม่มีหนี้ของรายนี้ในสมุดลูกหนี้</p>}
      </Section>
    </div>
  );
}
