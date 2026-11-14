import { createHash } from "node:crypto";
import { read, utils } from "xlsx";
import { parseUcCatalog } from "../_lib/parse";
import { adminSession, importResult, listGet, readUpload, saveDataset } from "../_lib/server";

/** แถวที่ GET ส่งให้ DataGrid (price null = ไม่มีอัตรา) */
export type UcItem = {
  line_no: number; chrgitem_group: string | null; group_name: string | null; code: string | null; name: string; price: number | null;
  unit: string | null; start_date: string | null; end_date: string | null; updated_date: string | null; fs_status: number | null; fs_label: string | null;
};

const COLS = {
  line_no: "integer", chrgitem_group: "text", group_name: "text", hosp_code: "text", code: "text", name: "text", price: "numeric",
  unit: "text", start_date: "date", end_date: "date", updated_date: "date", fs_status: "smallint",
};

/** POST multipart file: Service catalog ที่ export จากระบบของ สปสช. แทนที่ชุดเดิม (admin) */
export async function POST(request: Request) {
  const { error, name } = await adminSession();
  if (error) return error;
  const up = await readUpload(request);
  if (up.error) return up.error;
  let parsed;
  try {
    const wb = read(up.buf, { type: "buffer" });
    parsed = parseUcCatalog(utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true }));
  } catch (e) {
    return importResult({ status: "error", file: up.name, errors: [`อ่านไฟล์ Excel ไม่ได้: ${(e as Error).message}`] }, 400);
  }
  if (parsed.errors.length) return importResult({ status: "error", file: up.name, errors: parsed.errors }, 400);
  const sha256 = createHash("sha256").update(up.buf).digest("hex");
  const r = await saveDataset("service_uc", { fileName: up.name, sha256, by: name }, "service_catalog_uc", COLS, parsed.rows);
  return importResult(r, r.status === "error" ? 500 : 200);
}

const FS_LABEL: Record<string, string> = { "1": "อยู่ใน Fee Schedule", "2": "ไม่อยู่ใน Fee Schedule", "3": "ไม่อยู่ในรหัสมาตรฐาน" };

export async function GET(request: Request) {
  return listGet<UcItem>(request, {
    kind: "service_uc",
    from: "FROM service_catalog_uc",
    select: `line_no, chrgitem_group, group_name, code, name, price, unit, start_date, end_date, updated_date, fs_status,
  CASE fs_status WHEN 1 THEN '${FS_LABEL[1]}' WHEN 2 THEN '${FS_LABEL[2]}' WHEN 3 THEN '${FS_LABEL[3]}' END AS fs_label`,
    sort: { code: "code", name: "name", price: "price", chrgitem_group: "chrgitem_group::int", start_date: "start_date", end_date: "end_date" },
    defaultOrder: "chrgitem_group::int, code, start_date DESC, line_no",
    search: ["code", "name"],
    filters: {
      chrgitem_group: { expr: "chrgitem_group", label: "group_name" },
      fs_status: { expr: "fs_status::text", labels: FS_LABEL },
      unit: { expr: "unit" },
      start_date: { expr: "to_char(start_date, 'YYYY-MM-DD')" },
      end_date: { expr: "to_char(end_date, 'YYYY-MM-DD')" },
    },
    numeric: ["price"],
    xlsx: {
      file: "service-catalog-uc.xlsx",
      columns: [
        { key: "chrgitem_group", header: "หมวด", width: 6 },
        { key: "group_name", header: "ชื่อหมวด", width: 28 },
        { key: "code", header: "รหัสมาตรฐาน", width: 12 },
        { key: "name", header: "ชื่อ", width: 50 },
        { key: "price", header: "อัตรา (บาท)", width: 12, type: "money" },
        { key: "unit", header: "หน่วยนับ", width: 10 },
        { key: "start_date", header: "วันที่เริ่มต้น", width: 12 },
        { key: "end_date", header: "วันที่สิ้นสุด", width: 12 },
        { key: "fs_label", header: "สถานะ", width: 22 },
      ],
    },
  });
}
