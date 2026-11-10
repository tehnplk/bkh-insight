// SQL นับแถวและกฎตรวจรหัส C ของแต่ละแฟ้ม FDH บน HOSxP (อ่านอย่างเดียว ผ่าน prove-query แล้ว) แบบ pure ไม่มี import ค่า
// ทุก statement ขึ้นต้นด้วย H และใช้ `?` สองตัวแรกเป็น [start, end] เสมอ: mysql2 แทน `?` ตามลำดับจนหมดค่า
// `?` ใน regex ของกฎ (C111/C112) จึงไม่ถูกแทน ชื่อแฟ้มเลือก SQL จาก record นี้เท่านั้น (whitelist) ไม่ต่อ string จากผู้ใช้
import type { FdhType, IpFile, OpFile } from "./files";

/** จำนวนรายเคสสูงสุดต่อ request */
export const CASE_LIMIT = 1000;

const H = "WITH p AS (SELECT CAST(? AS DATE) AS s, CAST(? AS DATE) AS e)";
const AI = "p JOIN ipt a ON a.dchdate BETWEEN p.s AND p.e";

/** sql = statement นับแถว, col = คอลัมน์ของจำนวน (ADP/PHDB/DRU ใช้ statement เดียวกัน) */
type CountDef = { sql: string; col: string };
const n = (body: string): CountDef => ({ sql: `${H} SELECT COUNT(*) AS n FROM ${body}`, col: "n" });

const OP_ITEMS = `${H} SELECT SUM(nd.icode IS NOT NULL AND op.income NOT IN (3,4)) AS adp_phdb, SUM(d.icode IS NOT NULL AND pt.hn IS NOT NULL AND op.income IN (3,4)) AS dru FROM p JOIN opitemrece op FORCE INDEX (ix_vstdate) ON op.vstdate BETWEEN p.s AND p.e LEFT JOIN nondrugitems nd ON nd.icode = op.icode LEFT JOIN drugitems d ON d.icode = op.icode LEFT JOIN patient pt ON pt.hn = op.hn WHERE op.vn IS NOT NULL AND (op.an IS NULL OR op.an = '')`;
const IP_ITEMS = `${H} SELECT SUM(nd.icode IS NOT NULL AND op.income NOT IN (3,4)) AS adp_phdb, SUM(d.icode IS NOT NULL AND pt.hn IS NOT NULL AND op.income IN (3,4)) AS dru FROM p JOIN ipt a ON a.dchdate BETWEEN p.s AND p.e JOIN opitemrece op FORCE INDEX (ix_an) ON op.an = a.an LEFT JOIN nondrugitems nd ON nd.icode = op.icode LEFT JOIN drugitems d ON d.icode = op.icode LEFT JOIN patient pt ON pt.hn = op.hn`;

const OP_COUNT = {
  INS: n("p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e INNER JOIN patient pt ON pt.hn = v.hn LEFT JOIN patient_pttype pp ON pp.hn = v.hn AND pp.pttype = v.pttype WHERE v.an IS NULL OR v.an = ''"),
  PAT: n("patient pt WHERE pt.hn IN (SELECT v.hn FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e)"),
  OPD: {
    sql: `${H} SELECT SUM(COALESCE(oa.c, 1)) AS n FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e LEFT JOIN ipt i ON i.vn = v.vn LEFT JOIN referin rf_in ON rf_in.vn = v.vn LEFT JOIN referout rf_out ON rf_out.vn = v.vn LEFT JOIN (SELECT o.hn, o.nextdate, COUNT(*) AS c FROM p JOIN oapp o ON o.nextdate BETWEEN p.s AND p.e GROUP BY o.hn, o.nextdate) oa ON oa.hn = v.hn AND oa.nextdate = v.vstdate`,
    col: "n",
  },
  ORF: n("p JOIN referout ro ON ro.refer_date BETWEEN p.s AND p.e INNER JOIN ovst v ON v.vn = ro.vn WHERE v.an IS NULL OR v.an = ''"),
  ODX: n("p JOIN ovstdiag od ON od.vstdate BETWEEN p.s AND p.e INNER JOIN ovst v ON v.vn = od.vn INNER JOIN patient pt ON pt.hn = od.hn"),
  OOP: n("p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e INNER JOIN doctor_operation dop ON dop.vn = v.vn INNER JOIN patient pt ON pt.hn = v.hn"),
  CHT: n("p JOIN vn_stat vs ON vs.vstdate BETWEEN p.s AND p.e INNER JOIN patient pt ON pt.hn = vs.hn INNER JOIN ovst v ON v.vn = vs.vn LEFT JOIN rcpt_print rp ON rp.vn = vs.vn WHERE v.an IS NULL OR v.an = ''"),
  CHA: n("(SELECT 1 FROM p JOIN opitemrece op FORCE INDEX (ix_vstdate) ON op.vstdate BETWEEN p.s AND p.e INNER JOIN patient pt ON pt.hn = op.hn LEFT JOIN income inc ON inc.income = op.income WHERE op.vn IS NOT NULL AND (op.an IS NULL OR op.an = '') GROUP BY op.hn, op.an, op.vn, COALESCE(op.rxdate, op.vstdate), LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0'), pt.cid HAVING ROUND(SUM(op.sum_price), 2) > 0) g"),
  AER: n("p JOIN er_regist er ON er.vstdate BETWEEN p.s AND p.e INNER JOIN ovst v ON v.vn = er.vn LEFT JOIN referout rout ON rout.vn = er.vn WHERE v.an IS NULL OR v.an = ''"),
  ADP: { sql: OP_ITEMS, col: "adp_phdb" },
  DRU: { sql: OP_ITEMS, col: "dru" },
  LABFU: n("p JOIN lab_head lh ON lh.order_date BETWEEN p.s AND p.e INNER JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number INNER JOIN lab_items li ON li.lab_items_code = lo.lab_items_code INNER JOIN patient pt ON pt.hn = lh.hn LEFT JOIN ipt i ON i.vn = lh.vn WHERE lo.lab_order_result IS NOT NULL AND lo.lab_order_result <> '' AND i.an IS NULL"),
  PHDB: { sql: OP_ITEMS, col: "adp_phdb" },
} satisfies Record<OpFile, CountDef>;

// IP: ทุกแฟ้มยึด admission ที่จำหน่ายในช่วง (AI) รายการที่เกิดก่อนวันเริ่มจึงติดมาครบ
const IP_COUNT = {
  INS: n(`${AI} INNER JOIN ovst v ON v.an = a.an INNER JOIN patient pt ON pt.hn = v.hn LEFT JOIN patient_pttype pp ON pp.hn = v.hn AND pp.pttype = v.pttype`),
  PAT: n(`patient pt WHERE pt.hn IN (SELECT a.hn FROM ${AI})`),
  IPD: n(AI),
  IRF: n(`${AI} INNER JOIN referout ro ON ro.vn = a.vn`),
  IDX: n(`${AI} INNER JOIN iptdiag id ON id.an = a.an`),
  IOP: n(`${AI} INNER JOIN iptoprt io ON io.an = a.an`),
  CHT: n(`${AI} INNER JOIN an_stat ans ON ans.an = a.an INNER JOIN patient pt ON pt.hn = ans.hn LEFT JOIN rcpt_print rp ON rp.vn = ans.vn`),
  CHA: n(`(SELECT 1 FROM ${AI} JOIN opitemrece op FORCE INDEX (ix_an) ON op.an = a.an INNER JOIN patient pt ON pt.hn = op.hn LEFT JOIN income inc ON inc.income = op.income GROUP BY op.hn, op.an, op.vn, COALESCE(op.rxdate, op.vstdate), LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0'), pt.cid HAVING ROUND(SUM(op.sum_price), 2) > 0) g`),
  AER: n(`${AI} INNER JOIN ovst v ON v.an = a.an INNER JOIN er_regist er ON er.vn = v.vn LEFT JOIN referout rout ON rout.vn = er.vn`),
  ADP: { sql: IP_ITEMS, col: "adp_phdb" },
  LVD: n(`${AI} INNER JOIN ipt_home_leave hl ON hl.an = a.an`),
  DRU: { sql: IP_ITEMS, col: "dru" },
  LABFU: n(`${AI} INNER JOIN lab_head lh ON lh.vn = a.vn INNER JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number INNER JOIN lab_items li ON li.lab_items_code = lo.lab_items_code INNER JOIN patient pt ON pt.hn = lh.hn WHERE lo.lab_order_result IS NOT NULL AND lo.lab_order_result <> ''`),
  PHDB: { sql: IP_ITEMS, col: "adp_phdb" },
} satisfies Record<IpFile, CountDef>;

const COUNT: Record<FdhType, Record<string, CountDef>> = { op: OP_COUNT, ip: IP_COUNT };

// ---- กฎตรวจ C: PREFIX ต่อหมวด + block ต่อแฟ้ม คืน c_code, fdh_file, hn, an, seq, found ----

const PREFIX: Record<FdhType, string> = {
  op: `${H},
ph AS (SELECT DISTINCT v.hn FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e),
ins AS (
  SELECT v.hn AS HN, COALESCE(t.hipdata_code, t.pcode, 'UCS') AS INSCL, COALESCE(v.pttypeno, '') AS PERMITNO,
         COALESCE(v.an, '') AS AN, v.vn AS SEQ
  FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e
  INNER JOIN patient pt ON pt.hn = v.hn
  LEFT JOIN pttype t ON t.pttype = v.pttype
  LEFT JOIN patient_pttype pp ON pp.hn = v.hn AND pp.pttype = v.pttype
  WHERE v.an IS NULL OR v.an = ''
)`,
  // ไม่มี SVCTYPE: HOSxP ของเราไม่มีข้อมูลประเภทบริการ จึงปิด C160/C161
  // ADM_W: ipt.bw เป็นกรัม แต่ 16 แฟ้มส่งเป็นกิโลกรัม (C114/C153 ใช้ กก.) ปัด 3 ตำแหน่งไม่ให้ค่าขอบ 0.5/6 เพี้ยน
  ip: `${H},
a AS (
  SELECT i.hn AS HN, i.an AS AN,
         DATE_FORMAT(i.regdate, '%Y-%m-%d') AS DATEADM, DATE_FORMAT(i.regtime, '%H%i') AS TIMEADM,
         DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS DATEDSC, DATE_FORMAT(i.dchtime, '%H%i') AS TIMEDSC,
         COALESCE(i.dchstts, '1') AS DISCHS, COALESCE(i.dchtype, '1') AS DISCHT,
         ROUND(COALESCE(i.bw, 0) / 1000, 3) AS ADM_W
  FROM p JOIN ipt i ON i.dchdate BETWEEN p.s AND p.e
),
aw AS (
  SELECT i.hn AS HN, i.an AS AN, DATE_FORMAT(i.regdate, '%Y-%m-%d') AS DATEADM, DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS DATEDSC
  FROM p JOIN ipt i ON i.dchdate BETWEEN (SELECT MIN(m.regdate) FROM ipt m WHERE m.dchdate BETWEEN p.s AND p.e) AND p.e
),
ph AS (SELECT DISTINCT HN FROM a),
ins AS (
  SELECT v.hn AS HN, COALESCE(t.hipdata_code, t.pcode, 'UCS') AS INSCL, COALESCE(v.pttypeno, '') AS PERMITNO, a.AN AS AN, v.vn AS SEQ
  FROM a INNER JOIN ovst v ON v.an = a.AN
  INNER JOIN patient pt ON pt.hn = v.hn
  LEFT JOIN pttype t ON t.pttype = v.pttype
  LEFT JOIN patient_pttype pp ON pp.hn = v.hn AND pp.pttype = v.pttype
)`,
};

// pt.cid ต้องอยู่ใน block ไม่ใช่ CTE (db-cli ปิดค่า cid เป็น MD5 ทำให้พิสูจน์ผิด)
const PAT_BLOCK = `SELECT '101' AS c_code, 'PAT' AS fdh_file, pt.hn AS hn, '' AS an, '' AS seq,
       CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS found
FROM ph JOIN patient pt ON pt.hn = ph.hn WHERE TRIM(COALESCE(pt.fname, '')) = '' OR TRIM(COALESCE(pt.lname, '')) = ''
UNION ALL SELECT '102', 'PAT', pt.hn, '', '', DATE_FORMAT(pt.birthday, '%Y-%m-%d')
FROM ph JOIN patient pt ON pt.hn = ph.hn WHERE pt.birthday IS NULL OR pt.birthday > CURDATE()
UNION ALL SELECT '103', 'PAT', pt.hn, '', '', COALESCE(pt.sex, '1')
FROM ph JOIN patient pt ON pt.hn = ph.hn WHERE COALESCE(pt.sex, '1') NOT IN ('1', '2')
UNION ALL SELECT '104', 'PAT', pt.hn, '', '', pt.cid
FROM ph JOIN patient pt ON pt.hn = ph.hn WHERE pt.cid IS NULL OR TRIM(pt.cid) = ''
UNION ALL SELECT '116', 'PAT', pt.hn, '', '', pt.cid
FROM ph JOIN patient pt ON pt.hn = ph.hn
WHERE TRIM(pt.cid) <> ''
  AND (pt.cid NOT REGEXP '^[0-9]{13}$'
    OR MOD(11 - MOD(
         SUBSTRING(pt.cid, 1, 1) * 13 + SUBSTRING(pt.cid, 2, 1) * 12 + SUBSTRING(pt.cid, 3, 1) * 11
       + SUBSTRING(pt.cid, 4, 1) * 10 + SUBSTRING(pt.cid, 5, 1) * 9  + SUBSTRING(pt.cid, 6, 1) * 8
       + SUBSTRING(pt.cid, 7, 1) * 7  + SUBSTRING(pt.cid, 8, 1) * 6  + SUBSTRING(pt.cid, 9, 1) * 5
       + SUBSTRING(pt.cid, 10, 1) * 4 + SUBSTRING(pt.cid, 11, 1) * 3 + SUBSTRING(pt.cid, 12, 1) * 2
       , 11), 10) <> SUBSTRING(pt.cid, 13, 1))`;

const insBlock = (code: string) =>
  `SELECT '${code}' AS c_code, 'INS' AS fdh_file, HN AS hn, AN AS an, SEQ AS seq, INSCL AS found FROM ins WHERE INSCL IN ('OFC', 'LGO') AND TRIM(PERMITNO) = ''`;

// C111/C112 ยอมรับ '01'–'09' ด้วย (HOSxP เก็บ dchtype/dchstts เป็นสองหลัก)
const IPD_BLOCK = `SELECT '106' AS c_code, 'IPD' AS fdh_file, HN AS hn, AN AS an, '' AS seq, AN AS found FROM a WHERE AN IS NULL OR TRIM(AN) = ''
UNION ALL SELECT '107', 'IPD', HN, AN, '', DATEADM FROM a WHERE DATEADM IS NULL
UNION ALL SELECT '108', 'IPD', HN, AN, '', DATEDSC FROM a WHERE DATEDSC IS NULL
UNION ALL SELECT '109', 'IPD', HN, AN, '', TIMEADM FROM a WHERE TIMEADM IS NULL OR TIMEADM NOT REGEXP '^([01][0-9]|2[0-3])[0-5][0-9]$'
UNION ALL SELECT '110', 'IPD', HN, AN, '', TIMEDSC FROM a WHERE TIMEDSC IS NULL OR TIMEDSC NOT REGEXP '^([01][0-9]|2[0-3])[0-5][0-9]$'
UNION ALL SELECT '111', 'IPD', HN, AN, '', DISCHT FROM a WHERE DISCHT IS NULL OR DISCHT NOT REGEXP '^0?[1-9]$'
UNION ALL SELECT '112', 'IPD', HN, AN, '', DISCHS FROM a WHERE DISCHS IS NULL OR DISCHS NOT REGEXP '^0?[1-9]$'
UNION ALL SELECT '114', 'IPD', a.HN, a.AN, '', a.ADM_W FROM a JOIN patient pt ON pt.hn = a.HN
  WHERE DATEDIFF(a.DATEADM, pt.birthday) BETWEEN 0 AND 27 AND COALESCE(a.ADM_W, 0) <= 0
UNION ALL SELECT '153', 'IPD', a.HN, a.AN, '', a.ADM_W FROM a JOIN patient pt ON pt.hn = a.HN
  WHERE DATEDIFF(a.DATEADM, pt.birthday) BETWEEN 0 AND 27 AND a.ADM_W > 0 AND (a.ADM_W < 0.5 OR a.ADM_W > 6)
UNION ALL SELECT '120', 'IPD', a.HN, a.AN, '', CONCAT(a.DATEADM, ' < ', DATE_FORMAT(pt.birthday, '%Y-%m-%d')) FROM a JOIN patient pt ON pt.hn = a.HN
  WHERE a.DATEADM < DATE_FORMAT(pt.birthday, '%Y-%m-%d')
UNION ALL SELECT '121', 'IPD', HN, AN, '', CONCAT(DATEADM, ' ', TIMEADM, ' > ', DATEDSC, ' ', TIMEDSC) FROM a
  WHERE CONCAT(DATEADM, TIMEADM) > CONCAT(DATEDSC, TIMEDSC)
UNION ALL SELECT '151', 'IPD', a.HN, a.AN, '', CONCAT('overlaps AN ', b.AN) FROM a JOIN aw b ON b.HN = a.HN AND b.AN > a.AN
  WHERE a.DATEADM < b.DATEDSC AND b.DATEADM < a.DATEDSC`;

type Rule = { codes: string[]; sql: string };
const PAT_RULE: Rule = { codes: ["101", "102", "103", "104", "116"], sql: PAT_BLOCK };

/** แฟ้มที่ไม่มีใน record = ยังไม่มีกฎตรวจ */
export const RULES: Record<FdhType, Record<string, Rule>> = {
  op: {
    PAT: PAT_RULE,
    OPD: {
      codes: ["105"],
      sql: "SELECT '105' AS c_code, 'OPD' AS fdh_file, v.hn AS hn, '' AS an, v.vn AS seq, v.hn AS found FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e WHERE v.hn IS NULL OR TRIM(v.hn) = ''",
    },
    INS: { codes: ["127"], sql: insBlock("127") },
  } satisfies Partial<Record<OpFile, Rule>>,
  ip: {
    PAT: PAT_RULE,
    IPD: { codes: ["106", "107", "108", "109", "110", "111", "112", "114", "153", "120", "121", "151"], sql: IPD_BLOCK },
    INS: { codes: ["125"], sql: insBlock("125") },
  } satisfies Partial<Record<IpFile, Rule>>,
};

/** statement นับแถวของแฟ้ม (แฟ้มที่ใช้ statement เดียวกันได้ sql เดียวกัน รันครั้งเดียวได้) */
export const countDef = (type: FdhType, file: string): CountDef => COUNT[type][file];
export const ruleCodes = (type: FdhType, file: string): string[] => RULES[type][file]?.codes ?? [];

const blocks = (type: FdhType, file?: string) =>
  (file ? [RULES[type][file]] : Object.values(RULES[type])).map((r) => r.sql).join("\nUNION ALL ");

/** จำนวนเคสต่อรหัสต่อแฟ้ม ของทุกแฟ้มที่มีกฎในหมวด หรือเฉพาะแฟ้มที่ระบุ (ต้องมีกฎ) */
export const ruleSummarySql = (type: FdhType, file?: string) =>
  `${PREFIX[type]}\nSELECT c_code, fdh_file, COUNT(*) AS n FROM (\n${blocks(type, file)}\n) r GROUP BY c_code, fdh_file`;

/** รายเคสของแฟ้ม (ต้องมีกฎ) ไม่เกิน CASE_LIMIT แถว */
export const casesSql = (type: FdhType, file: string) =>
  `${PREFIX[type]}\nSELECT c_code, hn, an, seq, found FROM (\n${blocks(type, file)}\n) r ORDER BY c_code, hn, an, seq LIMIT ${CASE_LIMIT}`;

/** รหัสที่ found เป็นเลขบัตรประชาชน */
const CID_CODES = new Set(["104", "116"]);

/** ปิดกลางเลขบัตรก่อนส่งออกจาก server: 1234xxxxx5678 (สั้นกว่า 9 ตัวปิดทั้งหมด แต่ยังเห็นความยาว) */
export function maskCid(s: string): string {
  return s.length > 8 ? `${s.slice(0, 4)}${"x".repeat(s.length - 8)}${s.slice(-4)}` : "x".repeat(s.length);
}

export const maskFound = (code: string, found: string | null) => (found != null && CID_CODES.has(code) ? maskCid(String(found)) : found);
