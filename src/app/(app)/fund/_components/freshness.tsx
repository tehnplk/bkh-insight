"use client";

import { THAI_MONTHS_SHORT, formatThaiDate } from "@/lib/thai-date";
import type { Freshness } from "@/app/api/fund/freshness/route";
import { useJson } from "./ui";

const month = (iso: string) => `${THAI_MONTHS_SHORT[+iso.slice(5, 7) - 1]} ${+iso.slice(0, 4) + 543}`;

/**
 * แถบบอกว่าข้อมูลแต่ละแหล่งมีถึงเมื่อไร กันการอ่านช่วงที่ยังไม่มี REP/STM ว่า "ไม่ได้รับเงิน"
 * ใช้ที่ /fund/ar-ledger และ /admin/ar-funds โหลดไม่สำเร็จไม่แสดงอะไร (ไม่บังข้อมูลหลักของหน้า)
 */
export function DataFreshness() {
  const { data } = useJson<Freshness>("/api/fund/freshness");
  if (!data) return null;
  const item = (label: string, value: string | null) => (
    <li key={label} className="whitespace-nowrap">
      <span className="text-muted">{label}</span> <span className={value ? "tabular-nums" : "text-warning"}>{value ?? "ยังไม่มี"}</span>
    </li>
  );
  return (
    <ul aria-label="ข้อมูลล่าสุดของแต่ละแหล่ง" className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {item("ลูกหนี้จาก HOSxP ดึงล่าสุด", data.arSync && `${formatThaiDate(data.arSync)} ${data.arSync.slice(11)} น.`)}
      {item("REP ผู้ป่วยนอกถึง", data.repOp && formatThaiDate(data.repOp))}
      {item("REP ผู้ป่วยในถึง", data.repIp && formatThaiDate(data.repIp))}
      {data.stm.length === 0
        ? item("STM", null)
        : data.stm.map((s) => item(`STM ${s.scheme} ${s.patient_type} งวด`, `${month(s.period_month)} (โอน ${formatThaiDate(s.transfer_date)})`))}
    </ul>
  );
}
