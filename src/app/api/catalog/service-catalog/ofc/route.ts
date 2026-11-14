import { createHash } from "node:crypto";
import { parseOfc, type CgdMed } from "../_lib/parse";
import { adminSession, importResult, listGet, saveDataset } from "../_lib/server";

export type OfcItem = { line_no: number; code: string; name: string | null; remark: string | null; unit: string | null; price: number | null };

// API สาธารณะที่หน้า mbdb.cgd.go.th/wel/mwa03q040 ใช้ (ไม่ต้อง login) ส่งแค่ offset/limit ไม่มีข้อมูลของโรงพยาบาล
const CGD_URL = "https://mbdb.cgd.go.th/mwa-api/mwa/getMedSearch";
const PAGE = 500;
const MAX_ROWS = 20_000; // กันวนไม่จบถ้า count จากต้นทางผิดปกติ (ตอนตรวจมี 2,019 รายการ)
const SOURCE = "mbdb.cgd.go.th (กรมบัญชีกลาง)";

async function fetchPage(offset: number): Promise<{ count: number; results: CgdMed[] }> {
  const res = await fetch(CGD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset, limit: PAGE, orders: [] }),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { paginator?: { count?: unknown }; results?: unknown };
  const count = Number(body.paginator?.count);
  if (!Array.isArray(body.results) || !Number.isInteger(count) || count < 0 || count > MAX_ROWS) throw new Error("รูปแบบข้อมูลจากกรมบัญชีกลางเปลี่ยนไป");
  return { count, results: body.results as CgdMed[] };
}

/** POST: ดึงอัตราค่าบริการทั้งหมดจากกรมบัญชีกลางฝั่ง server แล้วแทนที่ชุดเดิม (admin) ; ข้อมูลเหมือนครั้งก่อน = duplicate */
export async function POST() {
  const { error, name } = await adminSession();
  if (error) return error;
  const all: CgdMed[] = [];
  try {
    let count = Infinity;
    for (let offset = 0; offset < count; offset += PAGE) {
      if (offset) await new Promise((r) => setTimeout(r, 300)); // หน่วงระหว่างหน้า ไม่ให้ภาระกับเว็บต้นทาง
      const page = await fetchPage(offset);
      count = page.count;
      all.push(...page.results);
      if (!page.results.length) break;
    }
    if (all.length !== count) throw new Error(`ได้ ${all.length} จาก ${count} รายการ`);
  } catch (e) {
    console.error("service-catalog ofc fetch", (e as Error).message);
    return importResult({ status: "error", file: SOURCE, errors: [`ดึงข้อมูลจากกรมบัญชีกลางไม่สำเร็จ: ${(e as Error).message}`] }, 502);
  }
  const parsed = parseOfc(all);
  if (parsed.errors.length) return importResult({ status: "error", file: SOURCE, errors: parsed.errors }, 502);
  const sha256 = createHash("sha256").update(JSON.stringify(parsed.rows)).digest("hex");
  const r = await saveDataset(
    "service_ofc",
    { fileName: SOURCE, sha256, by: name },
    "service_catalog_ofc",
    { line_no: "integer", med_seqno: "text", code: "text", name: "text", remark: "text", unit: "text", price: "numeric" },
    parsed.rows,
  );
  return importResult(r.status === "duplicate" ? { ...r, errors: ["ข้อมูลไม่เปลี่ยนจากครั้งที่ดึงล่าสุด"] } : r, r.status === "error" ? 500 : 200);
}

export async function GET(request: Request) {
  return listGet<OfcItem>(request, {
    kind: "service_ofc",
    from: "FROM service_catalog_ofc",
    select: "line_no, code, name, remark, unit, price",
    sort: { line_no: "line_no", code: "code", name: "name", price: "price" },
    defaultOrder: "line_no",
    search: ["code", "name", "remark"],
    filters: { unit: { expr: "unit" } },
    numeric: ["price"],
    xlsx: {
      file: "ofc-rates.xlsx",
      columns: [
        { key: "line_no", header: "ลำดับ", width: 7, type: "count" },
        { key: "code", header: "รหัส", width: 10 },
        { key: "name", header: "รายการ", width: 50 },
        { key: "unit", header: "หน่วย", width: 10 },
        { key: "price", header: "อัตรา (บาท)", width: 12, type: "money" },
        { key: "remark", header: "หมายเหตุ", width: 60 },
      ],
    },
  });
}
