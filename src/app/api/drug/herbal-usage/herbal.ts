// การใช้ยาสมุนไพร (/drug/herbal-usage) แบบ pure
// ไม่มี import ค่า จึงใช้ได้ทั้ง route, หน้า (client) และ herbal.test.mjs

export type Side = "OP" | "IP";
/** รายการจาก drugitems ที่ HOSxP ระบุเป็นยาสมุนไพร: หมวด (sks_product_category_id) 3/4 หรือมี ttmt_code */
export type HerbalItem = { icode: string; name: string; units: string; active: boolean; cat: number | null; ttmt: boolean };
/** ผลต่อ (เดือน, icode, ฝั่ง) ; visits = vn (OP) / an (IP) ไม่ซ้ำในเดือนนั้น */
export type UsageRow = { month: string; icode: string; side: Side; rows: number; visits: number; qty: number; amt: number };
/** มูลค่ายาทั้งหมด (income หมวดยา 3/4) ต่อ (เดือน, ฝั่ง) */
export type DrugTotalRow = { month: string; side: Side; rows: number; amt: number };

export type SideSum = { rows: number; visits: number; qty: number; amt: number };
export type ItemSum = HerbalItem & { op: SideSum; ip: SideSum; amt: number; /** % ของมูลค่ายาสมุนไพรทั้งปี ; ทั้งปีเป็น 0 = null */ share: number | null };
/** ค่าต่อเดือนยาวเท่า months ; เดือนที่ยังไม่ถึง = null */
export type Series = (number | null)[];
export type ShareSum = { op: number | null; ip: number | null; all: number | null };

export type HerbalReport = {
  items: ItemSum[];
  monthly: { op: Series; ip: Series; share: { op: Series; ip: Series; all: Series } };
  year: { amt: number; drugAmt: number; rows: number; used: number; share: ShareSum };
};

/** response ของ GET /api/drug/herbal-usage?fy=<ปีงบ พ.ศ.> */
export type HerbalResponse = HerbalReport & {
  fy: number;
  /** 12 เดือนของปีงบ YYYY-MM */
  months: string[];
  /** จำนวนเดือนแรกที่มีข้อมูลแล้ว */
  loaded: number;
  /** จำนวนเดือนแรกที่จบเดือนแล้ว */
  complete: number;
  through: string;
  /** มีเดือนที่ cache สั้น ปุ่มดึงใหม่จึงมีผล */
  live: boolean;
  computed_at: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const pctOf = (part: number, whole: number) => (whole ? (part / whole) * 100 : null);
const zero = (): SideSum => ({ rows: 0, visits: 0, qty: 0, amt: 0 });

/** เกณฑ์ที่ทำให้รายการนี้ถูกนับ (แสดงให้ห้องยาตรวจ) */
export function reasons(item: Pick<HerbalItem, "cat" | "ttmt">): string[] {
  return [...(item.cat === 3 || item.cat === 4 ? [`หมวด ${item.cat}`] : []), ...(item.ttmt ? ["TTMT"] : [])];
}

/** รวมผลรายเดือนเป็นรายงานทั้งปี: months = 12 เดือน, loaded = จำนวนเดือนแรกที่มีข้อมูล */
export function buildReport(months: string[], loaded: number, items: HerbalItem[], usage: UsageRow[], drug: DrugTotalRow[]): HerbalReport {
  const idx = new Map(months.map((m, i) => [m, i]));
  const blank = () => months.map((_, i) => (i < loaded ? 0 : null)) as Series;
  const val = { OP: blank(), IP: blank() };
  const drugVal = { OP: blank(), IP: blank() };
  const sums = new Map(items.map((it) => [it.icode, { op: zero(), ip: zero() }]));

  for (const u of usage) {
    const i = idx.get(u.month);
    const s = sums.get(u.icode);
    if (i === undefined || i >= loaded || !s) continue;
    const side = u.side === "OP" ? s.op : s.ip;
    side.rows += u.rows;
    side.visits += u.visits;
    side.qty += u.qty;
    side.amt += u.amt;
    val[u.side][i] = (val[u.side][i] ?? 0) + u.amt;
  }
  for (const d of drug) {
    const i = idx.get(d.month);
    if (i !== undefined && i < loaded) drugVal[d.side][i] = (drugVal[d.side][i] ?? 0) + d.amt;
  }

  const r2 = (v: Series) => v.map((x) => (x === null ? null : round2(x)));
  const op = r2(val.OP), ip = r2(val.IP);
  const share = (h: Series, d: Series) => h.map((x, i) => (x === null ? null : pctOf(x, d[i] ?? 0)));
  const add = (a: Series, b: Series) => a.map((x, i) => (x === null ? null : x + (b[i] ?? 0)));
  const total = (v: Series) => round2(v.reduce<number>((s, x) => s + (x ?? 0), 0));

  const yearOp = total(op), yearIp = total(ip), drugOp = total(drugVal.OP), drugIp = total(drugVal.IP);
  const amt = round2(yearOp + yearIp);
  const list: ItemSum[] = items.map((it) => {
    const s = sums.get(it.icode)!;
    for (const x of [s.op, s.ip]) {
      x.qty = round2(x.qty);
      x.amt = round2(x.amt);
    }
    const a = round2(s.op.amt + s.ip.amt);
    return { ...it, op: s.op, ip: s.ip, amt: a, share: pctOf(a, amt) };
  });
  const used = (x: ItemSum) => x.op.rows + x.ip.rows > 0;
  // ใช้แล้วเรียงตามมูลค่า รายการที่ไม่มีการใช้ไว้ท้าย
  list.sort((a, b) => Number(used(b)) - Number(used(a)) || b.amt - a.amt || a.icode.localeCompare(b.icode));

  return {
    items: list,
    monthly: { op, ip, share: { op: share(op, drugVal.OP), ip: share(ip, drugVal.IP), all: share(add(op, ip), add(drugVal.OP, drugVal.IP)) } },
    year: {
      amt,
      drugAmt: round2(drugOp + drugIp),
      rows: list.reduce((s, x) => s + x.op.rows + x.ip.rows, 0),
      used: list.filter(used).length,
      share: { op: pctOf(yearOp, drugOp), ip: pctOf(yearIp, drugIp), all: pctOf(amt, drugOp + drugIp) },
    },
  };
}
