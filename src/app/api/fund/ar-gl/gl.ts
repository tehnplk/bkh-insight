// ส่งออกสมุดขาย (ตั้งหนี้) ผู้ป่วยนอกเข้าโปรแกรม GL ผ่านตาราง TB1 (skill gl-hos) แบบ pure ทดสอบด้วย node ได้ตรง (gl.test.mjs)
//   ใบละวัน (entry_date) จาก journalLines() ของแถว OP rcpt_debt ของวันนั้น (ห้ามเขียนกติกา Dr/Cr ซ้ำ) รวมเป็นยอดสุทธิต่อบัญชี
//   หนึ่งบรรทัดต่อบัญชี ยอดสุทธิบวก = Dr ลบ = Cr (TB1/DataTbl1 validation >= 0) ไม่มีบรรทัด 0
//   เรียงแบบใบของการเงิน: ลูกหนี้ (11…) Dr → บรรทัด Cr (รายได้) → Dr ที่เหลือ (ส่วนต่าง) แต่ละกลุ่มตามรหัส
import { journalLines, type JournalGroup } from "../ar-journal/journal";
import { fiscalYearOf } from "../uc-dashboard/dashboard";

export const GL_SALES_NOTE = "บันทึกบัญชีลูกหนี้ค่ารักษาพยาบาลประจำวัน";
const SALES_KINDS = new Set(["set", "adjust", "cancel", "reverse", "diff"]);

// รหัส Manual "ภายในกรมเดียวกัน" ที่การเงินใช้แทนรหัสหลัก: ไฟล์ GL_HOS_70 (ปีงบ 2570) ลง UC OP นอก CUP ในจังหวัด สธ. ที่ .20301
// ส่วนไฟล์ปีงบ 2569 สมุดขายยังลง .203 (skill gl-hos ข้อ 3 และ references/schema.md) จึงแปลงตั้งแต่ปีงบ 2570
const MANUAL_FROM_FY = 2570;
const MANUAL_CODES: Record<string, string> = {
  "1102050101.203": "1102050101.20301",
  "4301020105.203": "4301020105.20301",
};
export const glCode = (code: string, date: string) => (fiscalYearOf(date) >= MANUAL_FROM_FY ? (MANUAL_CODES[code] ?? code) : code);

export type GlRow = JournalGroup & { entry_date: string; patient_type: string };
export type GlLine = { code: string; name: string; dr: number; cr: number };
/** error = ใบนั้นนำเข้าไม่ได้ (ไม่สร้างไฟล์) */
export type GlVoucher = { date: string; lines: GlLine[]; dr: number; cr: number; error: string | null };

const baht = (cents: number) => cents / 100;

/** ใบสำคัญหนึ่งใบจากแถว ar_ledger (ยอดรวมตาม SQL ของ route) ของวันเดียว */
export function glVoucher(date: string, groups: JournalGroup[]): GlVoucher {
  const net = new Map<string, { code: string | null; name: string; cents: number }>();
  const add = (code: string | null, name: string, cents: number) => {
    const c = code && glCode(code, date);
    const key = c ?? `\0${name}`;
    const acc = net.get(key) ?? { code: c, name, cents: 0 };
    acc.cents += cents;
    net.set(key, acc);
  };
  for (const l of journalLines(groups)) {
    const cents = Math.round(l.amount * 100);
    add(l.dr_code, l.dr_name, cents);
    add(l.cr_code, l.cr_name, -cents);
  }
  const accounts = [...net.values()].filter((a) => a.cents !== 0);
  const unknown = accounts.filter((a) => !a.code);
  const group = (a: { code: string; cents: number }) => (a.cents > 0 ? (a.code.startsWith("11") ? 0 : 2) : 1);
  const known = accounts.filter((a): a is { code: string; name: string; cents: number } => !!a.code);
  known.sort((a, b) => group(a) - group(b) || a.code.localeCompare(b.code));
  const lines = known.map((a) => ({ code: a.code, name: a.name, dr: a.cents > 0 ? baht(a.cents) : 0, cr: a.cents < 0 ? baht(-a.cents) : 0 }));
  const dr = known.reduce((s, a) => s + Math.max(a.cents, 0), 0);
  const cr = known.reduce((s, a) => s + Math.max(-a.cents, 0), 0);
  const fmt = (c: number) => (c / 100).toFixed(2);
  const error = unknown.length
    ? `ยังไม่กำหนดบัญชี: ${unknown.map((a) => `${a.name} ${fmt(a.cents)}`).join(", ")} (กำหนดที่ /admin/ar-accounts)`
    : dr !== cr ? `Dr รวม ${fmt(dr)} ไม่เท่ากับ Cr รวม ${fmt(cr)}`
    : !lines.length ? "ยอดสุทธิทุกบัญชีเป็น 0" : null;
  return { date, lines, dr: baht(dr), cr: baht(cr), error };
}

/** สมุดขายผู้ป่วยนอก: ใบละ entry_date เรียงตามวัน เฉพาะวันที่มีแถวตั้งหนี้ OP (source rcpt_debt) */
export function glSalesOp(rows: GlRow[]): GlVoucher[] {
  const byDate = new Map<string, JournalGroup[]>();
  for (const r of rows) {
    if (r.patient_type !== "OP" || r.source !== "rcpt_debt" || !SALES_KINDS.has(r.kind)) continue;
    byDate.set(r.entry_date, [...(byDate.get(r.entry_date) ?? []), r]);
  }
  return [...byDate.keys()].sort().map((d) => glVoucher(d, byDate.get(d)!));
}
