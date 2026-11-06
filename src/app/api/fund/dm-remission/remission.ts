// เกณฑ์จ่าย DM type 2 remission (สปสช.) แบบ pure ไม่มี import จึงรันทดสอบด้วย node ได้ตรง (remission.test.mjs)

export const THRESHOLD = 6.5;
export const FIRST_AMOUNT = 4000;
export const EXTRA_AMOUNT = 2000;
const MIN_GAP_DAYS = 90;
const MAX_EXTRA_GAP_DAYS = 183;

export type LabResult = { vn: string | null; date: string; value: number };
export type RemissionKind = "ครั้งแรก" | "เพิ่มเติม";
export type RemissionEvent = { kind: RemissionKind; prev: LabResult; cur: LabResult; days: number; amount: number };

/** แถวของ /api/fund/dm-remission */
export type DmRemissionRow = {
  id: string;
  hn: string;
  full_name: string;
  age: number;
  prev_date: string;
  prev_value: number;
  date: string;
  value: number;
  days: number;
  kind: RemissionKind;
  amount: number;
};
export type DmRemissionSummary = { first: number; extra: number; amount: number };

const DAY_MS = 86_400_000;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/** เรียงตามวันที่ วันเดียวกันหลายผลเก็บค่าสูงสุด (ค่าเท่ากันเอา vn มากกว่า) ให้ผลคงที่และไม่จ่ายเกินจากผลที่ดีกว่าในวันเดียวกัน */
export function normalizeResults(rows: LabResult[]): LabResult[] {
  const byDate = new Map<string, LabResult>();
  for (const r of rows) {
    const old = byDate.get(r.date);
    if (!old || r.value > old.value || (r.value === old.value && (r.vn ?? "") > (old.vn ?? ""))) byDate.set(r.date, r);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

const below = (r: LabResult) => r.value < THRESHOLD;

/** มีคู่ผลติดกันที่ต่ำกว่าเกณฑ์ทั้งคู่ ห่าง >= 90 วัน และผลหลังอยู่ใน [start, end] (ยังไม่ดูยา) ใช้คัด hn ก่อนดึงยาจาก opitemrece */
export function hasCandidatePair(results: LabResult[], start: string, end: string): boolean {
  return results.some((r, i) => i > 0 && below(results[i - 1]) && below(r) && daysBetween(results[i - 1].date, r.date) >= MIN_GAP_DAYS && r.date >= start && r.date <= end);
}

/** ครั้งแรก: คู่ติดกันคู่แรกที่ต่ำกว่าเกณฑ์ทั้งคู่ ห่าง >= 90 วัน และไม่มียาลดน้ำตาลใน [ผลก่อน, ผลหลัง)
 *  เพิ่มเติม: ผลถัดจากครั้งแรกทันที ต่ำกว่าเกณฑ์ ห่าง 90-183 วัน และไม่มียา (ครั้งเดียว)
 *  results ต้องผ่าน normalizeResults แล้ว drugDates เป็น ISO YYYY-MM-DD */
export function remissionEvents(results: LabResult[], drugDates: string[]): RemissionEvent[] {
  const noDrug = (from: string, to: string) => !drugDates.some((d) => d >= from && d < to);
  for (let k = 1; k < results.length; k++) {
    const prev = results[k - 1];
    const cur = results[k];
    const days = daysBetween(prev.date, cur.date);
    if (!below(prev) || !below(cur) || days < MIN_GAP_DAYS || !noDrug(prev.date, cur.date)) continue;
    const events: RemissionEvent[] = [{ kind: "ครั้งแรก", prev, cur, days, amount: FIRST_AMOUNT }];
    const next = results[k + 1];
    if (next) {
      const gap = daysBetween(cur.date, next.date);
      if (below(next) && gap >= MIN_GAP_DAYS && gap <= MAX_EXTRA_GAP_DAYS && noDrug(cur.date, next.date)) {
        events.push({ kind: "เพิ่มเติม", prev: cur, cur: next, days: gap, amount: EXTRA_AMOUNT });
      }
    }
    return events;
  }
  return [];
}

/** อายุเต็มปี ณ วันที่ date (ISO) birthday ว่าง/ผิดรูปแบบ (รวม 0000-00-00 ของ HOSxP) = null */
export function ageAt(birthday: string | null, date: string): number | null {
  if (!birthday || !/^(19|20)\d{2}-\d{2}-\d{2}/.test(birthday)) return null;
  const age = Number(date.slice(0, 4)) - Number(birthday.slice(0, 4));
  return date.slice(5, 10) < birthday.slice(5, 10) ? age - 1 : age;
}
