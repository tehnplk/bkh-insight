import ExcelJS from "exceljs";

export type XlsxColumn<T> = { key: keyof T & string; header: string; width?: number };

// ponytail: สร้างทั้งไฟล์ในหน่วยความจำ ถ้า export เกินราว 100k แถวให้เปลี่ยนไปใช้ ExcelJS.stream.xlsx.WorkbookWriter
export async function xlsxResponse<T extends object>(
  filename: string,
  columns: XlsxColumn<T>[],
  rows: T[],
): Promise<Response> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("data", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
  ws.getRow(1).font = { bold: true };
  // ค่า string ถูกเก็บเป็นข้อความเสมอ (exceljs สร้างสูตรเฉพาะจาก { formula }) จึงไม่เกิด formula injection
  ws.addRows(rows);
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
    },
  });
}
