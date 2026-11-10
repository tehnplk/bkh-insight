import type { NextRequest } from "next/server";
import { hisQuery } from "@/lib/db";
import { ITEM_NAME_SQL, badRequest, isAuthed, loadLookups, unauthorized } from "../../_lib/fund";
import { groupDebtorItems, type DebtorItemsResponse, type ItemRow } from "./items";

// รายการเดียวกันราคาเดียวกันรวมเป็นแถวเดียว แยกตาม paidst เพื่อบอกว่าส่วนไหนเป็นลูกหนี้สิทธิ
const SELECT = `SELECT o.income, o.icode, ${ITEM_NAME_SQL} AS name, o.unitprice, o.paidst, SUM(o.qty) AS qty, SUM(o.sum_price) AS amount`;
const GROUP = "GROUP BY o.income, o.icode, o.unitprice, o.paidst, name ORDER BY amount DESC, o.icode";
// IPD: ต้อง FORCE INDEX (ix_an) opitemrece เป็น MyISAM ห้ามสแกนนาน / OPD: point lookup ใช้ ix_vn เอง ห้าม FORCE ix_vstdate
const IPD_SQL = `${SELECT} FROM opitemrece o FORCE INDEX (ix_an) LEFT JOIN s_drugitems s ON s.icode = o.icode WHERE o.an = ? ${GROUP}`;
const OPD_SQL = `${SELECT} FROM opitemrece o LEFT JOIN s_drugitems s ON s.icode = o.icode WHERE o.vn = ? ${GROUP}`;

/** GET ?vn=<12 หลัก> หรือ ?an=<9 หลัก> อย่างใดอย่างหนึ่ง */
export async function GET(request: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const params = request.nextUrl.searchParams;
  const vn = params.get("vn");
  const an = params.get("an");
  if ((vn == null) === (an == null)) return badRequest("ต้องระบุ vn หรือ an อย่างใดอย่างหนึ่ง");
  if (vn != null && !/^\d{12}$/.test(vn)) return badRequest("vn ต้องเป็นตัวเลข 12 หลัก");
  if (an != null && !/^\d{9}$/.test(an)) return badRequest("an ต้องเป็นตัวเลข 9 หลัก");

  const [lk, rows] = await Promise.all([
    loadLookups(),
    an != null ? hisQuery<ItemRow>(IPD_SQL, [an]) : hisQuery<ItemRow>(OPD_SQL, [vn]),
  ]);
  const body: DebtorItemsResponse = groupDebtorItems(rows, (code) => lk.income.get(code) ?? code);
  return Response.json(body);
}
