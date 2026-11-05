import { connection, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { escapeLike, hisQuery } from "@/lib/db";
import { parseGridQuery, type GridPage } from "@/lib/grid-query";
import { xlsxResponse, type XlsxColumn } from "@/lib/xlsx";
import { addDaysIso, todayTh } from "../../visit/opd-visit/opd-visit";
import {
  DEFAULT_KIND,
  dchRangeError,
  defaultDchFrom,
  isPendingKind,
  parseDays,
  type PendingRow,
  type PendingSummary,
} from "./pending";

// allowlist: ชื่อที่ client ส่งมา -> expression ใน SQL (ต่อเข้า ORDER BY ได้เพราะมาจากโค้ดเท่านั้น)
const SORT_SQL = {
  an: ["i.an"],
  hn: ["i.hn"],
  name: ["p.fname", "p.lname"],
  ward: ["w.name"],
  doctor: ["dr.name"],
  regdate: ["i.regdate", "i.regtime"],
  dchdate: ["i.dchdate", "i.dchtime"],
  days: ["days"],
} as const;
type SortKey = keyof typeof SORT_SQL;

/*
 * ข้อความ SQL ของแต่ละหมวด (มาจากโค้ดเท่านั้น ค่าทุกตัวเป็น bind parameter)
 *   where: เงื่อนไขของหมวด ใช้กับ ipt i อย่างเดียว จึงใช้ทั้งในรายการและสรุปตาม ward
 *   days:  expression ของวันที่ค้าง มี ? = วันนี้ (เวลาไทย ไม่พึ่ง CURDATE() ของ server)
 * ตรวจกับ HIS แล้ว: ค้างจำหน่ายใช้ index ipt.dchdate (ref const ~100 แถว) ส่วนยังไม่ลงรหัสใช้ range ของ ipt.dchdate
 * + NOT EXISTS ผ่าน iptdiag ix_an_dxtype (เดือนเดียว ~700 แถว ทั้งปีไม่ถึงวินาที)
 */
const KINDS = {
  "overdue-discharge": {
    where: " WHERE i.dchdate IS NULL AND i.regdate <= ?",
    doctor: "i.admdoctor",
    days: "DATEDIFF(?, i.regdate)",
    sortable: ["an", "hn", "name", "ward", "doctor", "regdate", "days"],
    order: "i.regdate, i.an",
  },
  "ipd-no-dx": {
    where: ` WHERE i.dchdate BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM iptdiag d WHERE d.an = i.an AND d.diagtype = '1')`,
    // ผู้ลงรหัสคือแพทย์ผู้จำหน่าย ไม่มีใช้แพทย์ผู้รับ
    doctor: "COALESCE(NULLIF(i.dch_doctor, ''), i.admdoctor)",
    days: "DATEDIFF(?, i.dchdate)",
    sortable: ["an", "hn", "name", "ward", "doctor", "regdate", "dchdate", "days"],
    order: "i.dchdate, i.an",
  },
} as const satisfies Record<string, { sortable: readonly SortKey[] } & Record<string, unknown>>;

const SEARCH = " AND (i.an LIKE ? OR i.hn LIKE ? OR CONCAT_WS(' ', p.fname, p.lname) LIKE ?)";

const XLSX_COLUMNS: Record<keyof typeof KINDS, XlsxColumn<PendingRow>[]> = {
  "overdue-discharge": [
    { key: "an", header: "AN", width: 12 },
    { key: "hn", header: "HN", width: 12 },
    { key: "name", header: "ชื่อ-นามสกุล", width: 28 },
    { key: "ward", header: "ward", width: 20 },
    { key: "doctor", header: "แพทย์ผู้รับ", width: 28 },
    { key: "regdate", header: "วันรับ", width: 12 },
    { key: "days", header: "ค้าง (วัน)", width: 10 },
  ],
  "ipd-no-dx": [
    { key: "an", header: "AN", width: 12 },
    { key: "hn", header: "HN", width: 12 },
    { key: "name", header: "ชื่อ-นามสกุล", width: 28 },
    { key: "ward", header: "ward", width: 20 },
    { key: "doctor", header: "แพทย์", width: 28 },
    { key: "regdate", header: "วันรับ", width: 12 },
    { key: "dchdate", header: "วันจำหน่าย", width: 12 },
    { key: "days", header: "หลังจำหน่าย (วัน)", width: 14 },
  ],
};

const bad = (error: string) => Response.json({ error }, { status: 400 });

export async function GET(request: NextRequest) {
  await connection(); // run per request, not at build time
  // proxy.ts กั้น /api/* แล้ว แต่ route ที่อ่าน HIS ต้องเช็ค session เองซ้ำ
  if (!(await auth())) return Response.json({ error: "unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind") || DEFAULT_KIND;
  if (!isPendingKind(kind)) return bad("kind ไม่ถูกต้อง");
  const k = KINDS[kind];
  const parsed = parseGridQuery<SortKey>(sp, k.sortable);
  if (!parsed.ok) return bad(parsed.error);
  const { page, pageSize, sort, dir, q, format } = parsed.query;

  const today = todayTh();
  let kindParams: string[];
  let range: [string, string] | null = null;
  let fileTag: string;
  if (kind === "overdue-discharge") {
    const days = parseDays(sp.get("days"));
    if (days === null) return bad("days ต้องเป็นจำนวนเต็ม 1-365");
    kindParams = [addDaysIso(today, -days)];
    fileTag = `${days}d-${today}`;
  } else {
    const from = sp.get("from") || defaultDchFrom(today);
    const to = sp.get("to") || today;
    const err = dchRangeError(from, to);
    if (err) return bad(err);
    range = [from, to];
    kindParams = range;
    fileTag = `${from}_${to}`;
  }

  const base = `
  FROM ipt i
  LEFT JOIN ward w ON w.ward = i.ward`;
  let where = `${base}
  LEFT JOIN patient p ON p.hn = i.hn
  LEFT JOIN doctor dr ON dr.code = ${k.doctor}${k.where}`;
  const params: (string | number)[] = [...kindParams];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where += SEARCH;
    params.push(like, like, like);
  }
  const select = `
  SELECT i.an, i.hn,
    CONCAT(IFNULL(p.pname, ''), IFNULL(p.fname, ''), ' ', IFNULL(p.lname, '')) AS name,
    w.name AS ward, dr.name AS doctor, i.regdate, i.dchdate,
    ${k.days} AS days`;
  const order = ` ORDER BY ${sort ? SORT_SQL[sort].map((c) => `${c} ${dir}`).join(", ") + ", " : ""}${k.order}`;

  try {
    if (format === "xlsx") {
      const rows = await hisQuery<PendingRow>(select + where + order, [today, ...params]);
      return xlsxResponse(`pending-${kind}-${fileTag}.xlsx`, XLSX_COLUMNS[kind], rows);
    }

    // สรุปตาม filter ของหมวด ไม่ขึ้นกับคำค้นหา
    const [rows, [{ total }], byWard, of] = await Promise.all([
      hisQuery<PendingRow>(select + where + order + " LIMIT ? OFFSET ?", [today, ...params, pageSize, (page - 1) * pageSize]),
      hisQuery<{ total: number }>("SELECT COUNT(*) AS total" + where, params),
      hisQuery<{ ward: string | null; count: number }>(
        `SELECT w.name AS ward, COUNT(*) AS count${base}${k.where} GROUP BY w.name ORDER BY count DESC, w.name`,
        kindParams,
      ),
      range
        ? hisQuery<{ n: number }>("SELECT COUNT(*) AS n FROM ipt WHERE dchdate BETWEEN ? AND ?", range)
        : Promise.resolve(null),
    ]);
    const wards = byWard.map((w) => ({ ward: w.ward, count: Number(w.count) }));
    const body: GridPage<PendingRow> & { summary: PendingSummary } = {
      rows,
      total: Number(total),
      summary: {
        count: wards.reduce((s, w) => s + w.count, 0),
        of: of ? Number(of[0].n) : null,
        byWard: wards,
      },
    };
    return Response.json(body);
  } catch (e) {
    // ไม่ส่งข้อความดิบของ driver ออกไป (อาจมี host/user)
    console.error("quality/pending query failed", (e as { code?: string }).code ?? e);
    return Response.json({ error: "อ่านข้อมูลจาก HIS ไม่สำเร็จ" }, { status: 503 });
  }
}
