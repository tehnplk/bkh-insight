"use client";

import { useState, type ReactNode } from "react";
import { DetailModal } from "@/components/detail-modal/detail-modal";
import { formatBaht } from "@/lib/number-format";
import { REP_PAY_LABEL, type RepPay, type SubFund } from "@/app/api/admin/ar-funds/rules";
import { Fact, Facts, Section } from "@/app/(app)/fund/uc-debtor/uc-debtor-detail";
import { Money, focusRing, num } from "./ui";

const dash = <span className="text-muted">–</span>;
const chip = "rounded border px-1.5 py-0.5 whitespace-nowrap tabular-nums";
const th = "px-3 py-1.5 font-medium";
const td = "px-3 py-1.5 align-top";
/** เขียว = REP จ่ายกองทุนนี้, เหลือง = มี REP แต่ไม่จ่าย, กลาง = ยังไม่มี REP */
const TONE: Record<RepPay, string> = {
  paid: "border-success-line bg-success-soft text-success",
  unpaid: "border-warning-line bg-warning-soft text-warning",
  none: "border-line bg-surface-sunken text-muted",
};

/**
 * คอลัมน์ "กองทุนย่อย" ของ /opd/admissions และ /ipd/admissions: ป้ายละกองทุนที่เข้าเกณฑ์ (รหัส + ยอด) สีตามผลเทียบ REP กดดูรายละเอียด
 * funds: [] = ไม่เข้ากองทุนใด, undefined = โหลดไม่ได้ (บอกในแถบสรุปแล้ว) ทั้งคู่แสดงขีด
 */
export function SubfundBadges({ funds, title }: { funds?: SubFund[]; title: ReactNode }) {
  const [open, setOpen] = useState<SubFund | null>(null);
  if (!funds?.length) return dash;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {funds.map((f) => (
        <button
          key={f.code}
          type="button"
          onClick={() => setOpen(f)}
          aria-label={`ดูรายละเอียดกองทุนย่อย ${f.code} ${formatBaht(f.amount)} บาท ${REP_PAY_LABEL[f.rep]}`}
          title={`${f.name} · ${REP_PAY_LABEL[f.rep]}`}
          className={`${chip} ${TONE[f.rep]} cursor-pointer hover:underline ${focusRing}`}
        >
          <span className="font-medium">{f.code}</span> {formatBaht(f.amount)}
        </button>
      ))}
      <DetailModal open={!!open} onClose={() => setOpen(null)} size="medium" title={title}>
        {open && <SubfundDetail fund={open} />}
      </DetailModal>
    </span>
  );
}

function SubfundDetail({ fund: f }: { fund: SubFund }) {
  return (
    <div className="text-sm">
      <Facts>
        <Fact label="กองทุนย่อย">{`${f.code} ${f.name}`}</Fact>
        <Fact label="ยอดที่เข้าเกณฑ์ (บาท)">
          <span className="font-semibold">{formatBaht(f.amount)}</span>
        </Fact>
        <Fact label="เทียบ REP ล่าสุด">
          <span className={`${chip} ${TONE[f.rep]}`}>{REP_PAY_LABEL[f.rep]}</span>
        </Fact>
        <Fact label="REP จ่ายกองทุนนี้ (บาท)">{f.rep_amount == null ? null : formatBaht(f.rep_amount)}</Fact>
        <Fact label="กิจกรรมที่ผ่าน">{f.activities.join(", ")}</Fact>
        <Fact label="รหัสโรคที่ตรง">{f.icds.join(", ")}</Fact>
      </Facts>
      <Section title={`รายการที่เข้าเกณฑ์ (${f.items.length})`}>
        {f.items.length ? (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th scope="col" className={th}>รหัส</th>
                  <th scope="col" className={th}>รายการ</th>
                  <th scope="col" className={`${th} ${num}`}>มูลค่า (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {f.items.map((it, i) => (
                  <tr key={`${it.icode}-${i}`} className="border-t border-line">
                    <td className={`${td} tabular-nums`}>{it.icode}</td>
                    <td className={td}>{it.name || dash}</td>
                    <td className={`${td} ${num}`}>
                      <Money value={it.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">ใช้ยอดลูกหนี้สิทธิทั้งรายตามเงื่อนไขสิทธิ/รหัสโรค</p>
        )}
      </Section>
      {f.missing.length > 0 && (
        <Section title={`รายการจำเป็นที่ขาด (${f.missing.length})`}>
          <ul className="flex flex-col gap-1">
            {f.missing.map((m) => (
              <li key={m.icode} className="text-danger">
                <span className="tabular-nums">{m.icode}</span> {m.name}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
