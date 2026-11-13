import { createHash } from "node:crypto";
import { read, utils } from "xlsx";
import { auth } from "@/auth";
import { escapeLike, insightQuery, insightTransaction } from "@/lib/db";
import { parseGridQuery, type GridPage } from "@/lib/grid-query";
import { xlsxResponse } from "@/lib/xlsx";
import { MAX_CATALOG_BYTES, parseDrugNhso, type CatalogFileInfo, type DrugNhsoImportResult, type DrugNhsoItem } from "../drug-nhso";

// proxy.ts กันไว้แล้ว แต่ route ใต้ /api/admin ต้องเช็คเองซ้ำ (เหมือน /api/admin/users)
async function adminSession() {
  const session = await auth();
  if (!session) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (session.user.role !== "admin") return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { name: session.user.name ?? "admin" };
}

const COLS = [
  "line_no", "hosp_drug_code", "product_cat", "tmt_id", "spec_prep", "generic_name", "trade_name", "dfs_code", "dosage_form",
  "strength", "content", "unit_price", "distributor", "manufacturer", "ised", "ndc24", "pack_size", "pack_price", "update_flag",
  "date_change", "date_update", "date_effective", "ised_approved", "ndc24_approved", "date_approved", "ised_status",
] as const;
const COL_TYPES: Record<string, string> = { line_no: "integer", unit_price: "numeric", pack_price: "numeric", date_change: "date", date_update: "date", date_effective: "date", date_approved: "date" };
// ส่งแถวเป็น JSON ก้อนเดียวต่อ chunk (parameter ไม่ใหญ่เกิน) ชื่อคอลัมน์มาจากรายการคงที่ข้างบน ไม่ได้มาจากผู้ใช้
const INSERT_ROWS = `INSERT INTO drug_catalog_nhso (file_id, ${COLS.join(", ")})
SELECT $2, ${COLS.join(", ")} FROM jsonb_to_recordset($1::jsonb) AS x(${COLS.map((c) => `${c} ${COL_TYPES[c] ?? "text"}`).join(", ")})`;
const CHUNK = 1000;

const result = (r: DrugNhsoImportResult, status = 200) => Response.json(r, { status });

/** POST multipart file: นำเข้าไฟล์ APPROVED ของ สปสช. แทนที่ชุดเดิมทั้งหมด (เก็บประวัติไฟล์ใน catalog_file) */
export async function POST(request: Request) {
  const { error, name } = await adminSession();
  if (error) return error;
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return result({ status: "error", file: "", errors: ["อ่านไฟล์ที่ส่งมาไม่ได้"] }, 400);
  }
  if (!(file instanceof File)) return result({ status: "error", file: "", errors: ["ไม่พบไฟล์"] }, 400);
  if (!/\.xlsx?$/i.test(file.name)) return result({ status: "error", file: file.name, errors: ["ต้องเป็นไฟล์ .xls หรือ .xlsx"] }, 400);
  if (file.size > MAX_CATALOG_BYTES) return result({ status: "error", file: file.name, errors: ["ไฟล์ใหญ่เกิน 10 MB"] }, 400);

  const buf = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    const wb = read(buf, { type: "buffer" });
    parsed = parseDrugNhso(utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true }));
  } catch (e) {
    return result({ status: "error", file: file.name, errors: [`อ่านไฟล์ Excel ไม่ได้: ${(e as Error).message}`] }, 400);
  }
  if (parsed.errors.length) return result({ status: "error", file: file.name, errors: parsed.errors }, 400);
  const sha = createHash("sha256").update(buf).digest("hex");

  try {
    const imported = await insightTransaction(async (tx) => {
      const [row] = await tx<{ id: string }>(
        `INSERT INTO catalog_file (kind, file_name, file_sha256, row_count, item_count, imported_by)
VALUES ('drug_nhso', $1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
        [file.name, sha, parsed.rows.length, parsed.itemCount, name],
      );
      if (!row) return false;
      // เก็บเฉพาะชุดล่าสุด: ไฟล์ APPROVED เป็นรายการทั้งหมดที่อนุมัติ ณ วันที่ดาวน์โหลดอยู่แล้ว
      await tx("DELETE FROM drug_catalog_nhso WHERE file_id <> $1", [row.id]);
      for (let i = 0; i < parsed.rows.length; i += CHUNK) await tx(INSERT_ROWS, [JSON.stringify(parsed.rows.slice(i, i + CHUNK)), row.id]);
      return true;
    });
    if (!imported) return result({ status: "duplicate", file: file.name, errors: ["ไฟล์นี้นำเข้าแล้ว"] });
    return result({ status: "imported", file: file.name, rows: parsed.rows.length, items: parsed.itemCount });
  } catch (e) {
    console.error("mapcode/drug-nhso import", file.name, (e as Error).message);
    return result({ status: "error", file: file.name, errors: ["บันทึกลงฐานข้อมูลไม่สำเร็จ"] }, 500);
  }
}

const SORT_SQL = {
  hosp_drug_code: "hosp_drug_code", tmt_id: "tmt_id", generic_name: "generic_name", trade_name: "trade_name",
  unit_price: "unit_price", ised: "ised", ised_approved: "ised_approved", date_effective: "date_effective", date_approved: "date_approved", versions: "versions",
} as const;
type SortKey = keyof typeof SORT_SQL;
const SORTABLE = Object.keys(SORT_SQL) as SortKey[];

// รายการปัจจุบัน = แถวล่าสุดของแต่ละรหัส (วันที่มีผลล่าสุด แล้ววันที่อนุมัติล่าสุด แล้วแถวท้ายไฟล์) $1 = คำค้น (null หรือ LIKE pattern)
const LATEST = `WITH v AS (
  SELECT DISTINCT ON (hosp_drug_code) hosp_drug_code, tmt_id, generic_name, trade_name, dosage_form, strength, content, unit_price,
         ised, ised_approved, product_cat, update_flag, date_effective, date_approved, ised_status,
         COUNT(*) OVER (PARTITION BY hosp_drug_code) AS versions
  FROM drug_catalog_nhso
  ORDER BY hosp_drug_code, date_effective DESC NULLS LAST, date_approved DESC NULLS LAST, line_no DESC
)
SELECT * FROM v
WHERE ($1::text IS NULL OR hosp_drug_code ILIKE $1 OR tmt_id ILIKE $1 OR generic_name ILIKE $1 OR trade_name ILIKE $1)`;

/** GET + พารามิเตอร์ DataGrid: รายการยาปัจจุบันจากไฟล์ล่าสุด และข้อมูลไฟล์ที่นำเข้า */
export async function GET(request: Request) {
  const { error } = await adminSession();
  if (error) return error;
  const grid = parseGridQuery<SortKey>(new URL(request.url).searchParams, SORTABLE);
  if (!grid.ok) return Response.json({ error: grid.error }, { status: 400 });
  const { page, pageSize, sort, dir, q, format } = grid.query;
  const like = q ? `%${escapeLike(q)}%` : null;
  const order = `ORDER BY ${SORT_SQL[sort ?? "hosp_drug_code"]} ${dir === "desc" ? "DESC" : "ASC"} NULLS LAST, hosp_drug_code`;

  if (format === "xlsx") {
    const rows = await insightQuery<DrugNhsoItem>(`${LATEST}\n${order}`, [like]);
    return xlsxResponse<DrugNhsoItem>("drug-catalog-nhso.xlsx", [
      { key: "hosp_drug_code", header: "HOSPDRUGCODE", width: 12 },
      { key: "tmt_id", header: "TMTID", width: 10 },
      { key: "generic_name", header: "GENERICNAME", width: 30 },
      { key: "trade_name", header: "TRADENAME", width: 24 },
      { key: "dosage_form", header: "DOSAGEFORM", width: 16 },
      { key: "strength", header: "STRENGTH", width: 16 },
      { key: "content", header: "CONTENT", width: 12 },
      { key: "unit_price", header: "UNITPRICE (บาท)", width: 12, type: "money" },
      { key: "ised", header: "ISED", width: 6 },
      { key: "ised_approved", header: "ISED_APPROVED", width: 8 },
      { key: "update_flag", header: "UPDATEFLAG", width: 8 },
      { key: "date_effective", header: "DATEEFFECTIVE", width: 12 },
      { key: "date_approved", header: "DATE_APPROVED", width: 12 },
      { key: "ised_status", header: "ISED_STATUS", width: 8 },
      { key: "versions", header: "จำนวนแถวในไฟล์", width: 8, type: "count" },
    ], rows);
  }

  const [rows, [{ total }], [info]] = await Promise.all([
    insightQuery<DrugNhsoItem>(`${LATEST}\n${order}\nLIMIT $2 OFFSET $3`, [like, pageSize, (page - 1) * pageSize]),
    insightQuery<{ total: number }>(`SELECT COUNT(*)::int AS total FROM (${LATEST}) t`, [like]),
    insightQuery<NonNullable<CatalogFileInfo>>(
      "SELECT file_name, row_count, item_count, imported_by, imported_at FROM catalog_file WHERE kind = 'drug_nhso' ORDER BY imported_at DESC, id DESC LIMIT 1",
    ),
  ]);
  const body: GridPage<DrugNhsoItem> & { file: CatalogFileInfo } = { rows: rows.map((r) => ({ ...r, versions: Number(r.versions) })), total, file: info ?? null };
  return Response.json(body);
}
