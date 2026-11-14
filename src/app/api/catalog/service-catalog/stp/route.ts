import { createHash } from "node:crypto";
import { read, utils } from "xlsx";
import { parseStpWorkbook } from "../_lib/parse";
import { adminSession, importResult, listGet, readUpload, saveDataset } from "../_lib/server";

export type StpItem = {
  sheet: string; line_no: number; seq: string | null; code: string | null; name: string; qty: string | null; rate: number | null;
  chrgitem_group: string | null; adp_type: string | null; use_status: string | null; tmt_id: string | null;
  opd: boolean | null; ipd: boolean | null; note: string | null;
};

const COLS = {
  fund: "text", sheet: "text", line_no: "integer", seq: "text", code: "text", name: "text", qty: "text", rate: "numeric", chrgitem_group: "text",
  adp_type: "text", use_status: "text", tmt_id: "text", opd: "boolean", ipd: "boolean", note: "text",
};

/** POST multipart file: ไฟล์หมวดรายการเบิกจ่าย 19 หมวด ของกองทุน STP (ทุกชีตรายการ) แทนที่ชุดเดิม (admin) */
export async function POST(request: Request) {
  const { error, name } = await adminSession();
  if (error) return error;
  const up = await readUpload(request);
  if (up.error) return up.error;
  let parsed;
  try {
    const wb = read(up.buf, { type: "buffer" });
    parsed = parseStpWorkbook(wb.SheetNames.map((n) => ({ name: n, rows: utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, defval: null, raw: true }) })));
  } catch (e) {
    return importResult({ status: "error", file: up.name, errors: [`อ่านไฟล์ Excel ไม่ได้: ${(e as Error).message}`] }, 400);
  }
  if (parsed.errors.length) return importResult({ status: "error", file: up.name, errors: parsed.errors }, 400);
  const sha256 = createHash("sha256").update(up.buf).digest("hex");
  // shortcut: ตารางมีแค่กองทุน STP จึงแทนที่ทั้งตาราง ถ้าเพิ่มกองทุนอื่นต้องให้ saveDataset ลบเฉพาะ fund เดียวกัน
  const r = await saveDataset("claim_stp", { fileName: up.name, sha256, by: name }, "fund_claim_item", COLS, parsed.rows.map((x) => ({ fund: "STP", ...x })));
  return importResult(r, r.status === "error" ? 500 : 200);
}

export async function GET(request: Request) {
  return listGet<StpItem>(request, {
    kind: "claim_stp",
    from: "FROM fund_claim_item",
    select: "sheet, line_no, seq, code, name, qty, rate, chrgitem_group, adp_type, use_status, tmt_id, opd, ipd, note",
    sort: { code: "code", name: "name", rate: "rate", sheet: "sheet" },
    // ชีตเรียงตามเลขกลุ่มหน้าชื่อ (1.OPAE ... 27.บริการ PP FS) แล้วตามแถวในชีต
    defaultOrder: "substring(sheet from '^[0-9]+')::int, sheet, line_no",
    search: ["code", "name", "note"],
    filters: {
      sheet: { expr: "sheet" },
      chrgitem_group: { expr: "chrgitem_group" },
      adp_type: { expr: "adp_type" },
      opd: { expr: "CASE WHEN opd THEN 'Y' WHEN NOT opd THEN 'N' END", labels: { Y: "ใช้ได้", N: "ไม่ได้" } },
      ipd: { expr: "CASE WHEN ipd THEN 'Y' WHEN NOT ipd THEN 'N' END", labels: { Y: "ใช้ได้", N: "ไม่ได้" } },
    },
    numeric: ["rate"],
    xlsx: {
      file: "stp-claim-items.xlsx",
      columns: [
        { key: "sheet", header: "กลุ่ม (ชีต)", width: 18 },
        { key: "seq", header: "ลำดับ", width: 7 },
        { key: "code", header: "CODE", width: 12 },
        { key: "tmt_id", header: "TMT_ID", width: 10 },
        { key: "name", header: "รายการ", width: 50 },
        { key: "qty", header: "QTY", width: 14 },
        { key: "rate", header: "RATE (บาท)", width: 12, type: "money" },
        { key: "chrgitem_group", header: "หมวด", width: 8 },
        { key: "adp_type", header: "ADP TYPE/แฟ้ม", width: 10 },
        { key: "use_status", header: "USE_STATUS", width: 10 },
        { key: "opd", header: "OPD", width: 6 },
        { key: "ipd", header: "IPD", width: 6 },
        { key: "note", header: "หมายเหตุ", width: 40 },
      ],
    },
  });
}
