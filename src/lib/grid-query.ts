// สัญญา API ของ DataGrid (ใช้ร่วมกันทุก module)
// GET {endpoint}?page=1&pageSize=20&sort=<column>&dir=asc|desc&q=<text>[&format=xlsx]
//   json -> { rows: T[], total: number }   (total = จำนวนแถวทั้งหมดหลัง filter)
//   xlsx -> ไฟล์ Excel ทุกแถวตาม sort/q ปัจจุบัน (ไม่สน page/pageSize)
//   ค่าไม่ถูกต้อง -> 400 { error: string }

export const MAX_PAGE_SIZE = 100;
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE = 100_000;
const MAX_Q_LENGTH = 100;

export type SortDir = "asc" | "desc";
export type GridPage<T> = { rows: T[]; total: number };
export type GridQuery<C extends string> = {
  page: number;
  pageSize: number;
  /** อยู่ใน allowlist เสมอ จึงต่อเป็นชื่อคอลัมน์ใน SQL ได้ ส่วน q ต้องส่งเป็น bind parameter */
  sort: C | null;
  dir: SortDir;
  /** ข้อความค้นหา (global search) server เป็นคนเลือกว่าค้นคอลัมน์ไหน */
  q: string;
  format: "json" | "xlsx";
};

function int(raw: string | null, name: string, min: number, max: number, fallback: number) {
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} ต้องเป็นจำนวนเต็ม`);
  const n = Number(raw);
  if (n < min || n > max) throw new Error(`${name} ต้องอยู่ระหว่าง ${min}-${max}`);
  return n;
}

export function parseGridQuery<C extends string>(
  params: URLSearchParams,
  sortable: readonly C[],
): { ok: true; query: GridQuery<C> } | { ok: false; error: string } {
  try {
    const sort = params.get("sort") || null;
    if (sort !== null && !(sortable as readonly string[]).includes(sort)) {
      throw new Error(`sort ได้เฉพาะ: ${sortable.join(", ")}`);
    }
    const dir = params.get("dir") || "asc";
    if (dir !== "asc" && dir !== "desc") throw new Error("dir ต้องเป็น asc หรือ desc");
    const format = params.get("format") || "json";
    if (format !== "json" && format !== "xlsx") throw new Error("format ต้องเป็น json หรือ xlsx");
    const q = (params.get("q") ?? "").trim();
    if (q.length > MAX_Q_LENGTH) throw new Error(`q ยาวได้ไม่เกิน ${MAX_Q_LENGTH} ตัวอักษร`);
    return {
      ok: true,
      query: {
        page: int(params.get("page"), "page", 1, MAX_PAGE, 1),
        pageSize: int(params.get("pageSize"), "pageSize", 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
        sort: sort as C | null,
        dir,
        q,
        format,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
