// ข้อมูลผู้ป่วยสมมติ 500 แถว สร้างแบบ deterministic (seed คงที่) ไม่ได้ต่อฐานข้อมูลจริง
export type Patient = {
  hn: string;
  name: string;
  sex: "ชาย" | "หญิง";
  age: number;
  ward: string;
  admitDate: string; // YYYY-MM-DD
  diagnosis: string;
  status: "รักษาอยู่" | "จำหน่าย" | "ส่งต่อ";
  doctor: string;
  phone: string;
};

const FIRST_M = ["สมชาย", "ประเสริฐ", "วิชัย", "อนันต์", "สุรชัย", "ธนากร", "กิตติ", "พงศกร", "ณัฐวุฒิ", "อภิชาติ"];
const FIRST_F = ["สมหญิง", "วิไลวรรณ", "กาญจนา", "สุภาพร", "นภัสสร", "ปิยะดา", "อรุณี", "จันทร์เพ็ญ", "รัตนา", "ศิริพร"];
const LAST = ["ใจดี", "ศรีสุข", "บุญมา", "แก้วกล้า", "ทองดี", "สุขสวัสดิ์", "พรหมมา", "จันทร์แก้ว", "วงศ์ใหญ่", "มีสุข", "ชัยมงคล", "สายทอง"];
const WARDS = ["อายุรกรรมชาย", "อายุรกรรมหญิง", "ศัลยกรรม", "กุมารเวช", "สูติกรรม", "ICU", "ออร์โธปิดิกส์"];
const DX = [
  "E11.9 เบาหวานชนิดที่ 2",
  "I10 ความดันโลหิตสูง",
  "J18.9 ปอดอักเสบ",
  "A90 ไข้เลือดออก",
  "K35.8 ไส้ติ่งอักเสบเฉียบพลัน",
  "N18.5 ไตวายเรื้อรังระยะที่ 5",
  "S72.0 กระดูกต้นขาหัก",
  "I63.9 หลอดเลือดสมองตีบ",
  "J44.1 ปอดอุดกั้นเรื้อรังกำเริบ",
  "O80 คลอดปกติ",
];
const DOCTORS = ["นพ.วีระ", "พญ.ชนิดา", "นพ.กฤษณ์", "พญ.มาลี", "นพ.ธีระ"];
const STATUS: Patient["status"][] = ["รักษาอยู่", "รักษาอยู่", "จำหน่าย", "จำหน่าย", "ส่งต่อ"];

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const r = rng(20261103);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
const DAY = 86_400_000;
const start = Date.UTC(2026, 0, 1);

export const PATIENTS: Patient[] = Array.from({ length: 500 }, (_, i) => {
  const male = r() < 0.5;
  return {
    hn: `HN${String(640001 + i * 7).padStart(7, "0")}`,
    name: `${pick(male ? FIRST_M : FIRST_F)} ${pick(LAST)}`,
    sex: male ? "ชาย" : "หญิง",
    age: 1 + Math.floor(r() * 90),
    ward: pick(WARDS),
    admitDate: new Date(start + Math.floor(r() * 300) * DAY).toISOString().slice(0, 10),
    diagnosis: pick(DX),
    status: pick(STATUS),
    doctor: pick(DOCTORS),
    phone: `08${Math.floor(r() * 1e8).toString().padStart(8, "0")}`,
  };
});
