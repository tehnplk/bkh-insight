import ExcelJS from "exceljs";

/**
 * type: "money" = ตัวเลขจริง รูปแบบ #,##0.00 (ใส่หน่วยไว้ที่ header เช่น "มูลค่า (บาท)")
 *       "count" = ตัวเลขจริง รูปแบบ #,##0
 *       ไม่ระบุ = ใส่ค่าตามที่ได้มา (string เป็นข้อความเสมอ เช่น HN เก็บเลข 0 นำหน้าไว้)
 */
export type XlsxColumn<T> = { key: keyof T & string; header: string; width?: number; type?: "money" | "count" };

const NUM_FMT = { money: "#,##0.00", count: "#,##0" } as const;

// DB อาจคืน DECIMAL/COUNT เป็น string จึงแปลงเป็น number ก่อนลง cell ค่าว่างหรือแปลงไม่ได้ = cell ว่าง
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ponytail: สร้างทั้งไฟล์ในหน่วยความจำ ถ้า export เกินราว 100k แถวให้เปลี่ยนไปใช้ ExcelJS.stream.xlsx.WorkbookWriter
export async function xlsxResponse<T extends object>(
  filename: string,
  columns: XlsxColumn<T>[],
  rows: T[],
): Promise<Response> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("data", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 16,
    ...(c.type && { style: { numFmt: NUM_FMT[c.type] } }),
  }));
  ws.getRow(1).font = { bold: true };
  // ค่า string ถูกเก็บเป็นข้อความเสมอ (exceljs สร้างสูตรเฉพาะจาก { formula }) จึงไม่เกิด formula injection
  const numeric = columns.filter((c) => c.type).map((c) => c.key);
  ws.addRows(
    numeric.length
      ? rows.map((r) => ({ ...r, ...Object.fromEntries(numeric.map((k) => [k, toNumber(r[k as keyof T])])) }))
      : rows,
  );
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
    },
  });
}
