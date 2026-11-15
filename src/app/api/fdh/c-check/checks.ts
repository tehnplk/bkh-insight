// SQL นับแถวและกฎตรวจรหัส C ของแต่ละแฟ้ม FDH บน HOSxP (MariaDB 10.11, อ่านอย่างเดียว ผ่าน prove-query แล้ว) แบบ pure ไม่มี import ค่า
// statement นับแถวขึ้นต้นด้วย H params [start, end] ; statement กฎขึ้นต้นด้วย H4 params ruleParams() = [start, end, selJson, closedJson]
// mysql2 แทน `?` ตามลำดับโดยไม่สนเครื่องหมายคำพูด จึงห้ามมี `?` อื่นใน SQL (regex ใช้ 0{0,1}) ; ชื่อแฟ้มเลือก SQL จาก record นี้เท่านั้น (whitelist)
import type { FdhType, IpFile, OpFile } from "./files";

/** จำนวนรายเคสสูงสุดต่อ request */
export const CASE_LIMIT = 1000;

const H = "WITH p AS (SELECT CAST(? AS DATE) AS s, CAST(? AS DATE) AS e)";
// sel = VN/AN ที่เลือกใน modal ('[]' = ทั้งช่วง), cl = VN ที่ปิดสิทธิสำเร็จใน insight ; MariaDB ไม่รองรับ CAST(? AS JSON) จึงส่ง string ตรง
const H4 = `${H},
sel AS (SELECT j.k FROM JSON_TABLE(?, '$[*]' COLUMNS (k BIGINT PATH '$')) j),
cl AS (SELECT j.k FROM JSON_TABLE(?, '$[*]' COLUMNS (k BIGINT PATH '$')) j)`;
const AI = "p JOIN ipt a ON a.dchdate BETWEEN p.s AND p.e";
// แยกยา/ไม่ใช่ยาด้วยหมวดค่ารักษา 3/4 และ ADP.TYPE: สูตรเดียวกับ fdh/files/sql.ts (ไม่ import ค่า ; fdh.test.mjs ตรวจว่าตรงกัน)
const DRUG_INC = "INNER JOIN income inc ON inc.income = op.income AND inc.drg_chrgitem_id IN (3, 4)";
const NOT_DRUG = "COALESCE(inc.drg_chrgitem_id, 0) NOT IN (3, 4)";
const ADP_TYPE = "COALESCE(CASE inc.drg_chrgitem_id WHEN 1 THEN 10 WHEN 5 THEN 11 WHEN 13 THEN 12 WHEN 6 THEN 14 WHEN 7 THEN 15 WHEN 8 THEN 16 WHEN 12 THEN 17 WHEN 10 THEN 18 WHEN 11 THEN 19 WHEN 14 THEN 20 END, nd.nhso_adp_type_id, 3)";

/** sql = statement นับแถว, col = คอลัมน์ของจำนวน (ADP/PHDB/DRU ใช้ statement เดียวกัน) */
type CountDef = { sql: string; col: string };
const n = (body: string): CountDef => ({ sql: `${H} SELECT COUNT(*) AS n FROM ${body}`, col: "n" });

const OP_ITEMS = `${H} SELECT SUM(nd.icode IS NOT NULL AND COALESCE(inc.drg_chrgitem_id, 0) NOT IN (3,4)) AS adp_phdb, SUM(d.icode IS NOT NULL AND pt.hn IS NOT NULL AND inc.drg_chrgitem_id IN (3,4)) AS dru FROM p JOIN opitemrece op FORCE INDEX (ix_vstdate) ON op.vstdate BETWEEN p.s AND p.e LEFT JOIN income inc ON inc.income = op.income LEFT JOIN nondrugitems nd ON nd.icode = op.icode LEFT JOIN drugitems d ON d.icode = op.icode LEFT JOIN patient pt ON pt.hn = op.hn WHERE op.vn IS NOT NULL AND (op.an IS NULL OR op.an = '')`;
const IP_ITEMS = `${H} SELECT SUM(nd.icode IS NOT NULL AND COALESCE(inc.drg_chrgitem_id, 0) NOT IN (3,4)) AS adp_phdb, SUM(d.icode IS NOT NULL AND pt.hn IS NOT NULL AND inc.drg_chrgitem_id IN (3,4)) AS dru FROM p JOIN ipt a ON a.dchdate BETWEEN p.s AND p.e JOIN opitemrece op FORCE INDEX (ix_an) ON op.an = a.an LEFT JOIN income inc ON inc.income = op.income LEFT JOIN nondrugitems nd ON nd.icode = op.icode LEFT JOIN drugitems d ON d.icode = op.icode LEFT JOIN patient pt ON pt.hn = op.hn`;

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
  CHT: n("p JOIN vn_stat vs ON vs.vstdate BETWEEN p.s AND p.e INNER JOIN patient pt ON pt.hn = vs.hn INNER JOIN ovst v ON v.vn = vs.vn WHERE v.an IS NULL OR v.an = ''"),
  CHA: n("(SELECT 1 FROM p JOIN opitemrece op FORCE INDEX (ix_vstdate) ON op.vstdate BETWEEN p.s AND p.e INNER JOIN patient pt ON pt.hn = op.hn LEFT JOIN income inc ON inc.income = op.income WHERE op.vn IS NOT NULL AND (op.an IS NULL OR op.an = '') GROUP BY op.hn, op.an, op.vn, COALESCE(op.rxdate, op.vstdate), LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0'), pt.cid HAVING ROUND(SUM(op.sum_price), 2) > 0) g"),
  AER: n("p JOIN er_regist er ON er.vstdate BETWEEN p.s AND p.e INNER JOIN ovst v ON v.vn = er.vn LEFT JOIN referout rout ON rout.vn = er.vn WHERE v.an IS NULL OR v.an = ''"),
  ADP: { sql: OP_ITEMS, col: "adp_phdb" },
  DRU: { sql: OP_ITEMS, col: "dru" },
  LABFU: n("p JOIN lab_head lh ON lh.order_date BETWEEN p.s AND p.e INNER JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number INNER JOIN lab_items li ON li.lab_items_code = lo.lab_items_code INNER JOIN patient pt ON pt.hn = lh.hn LEFT JOIN ipt i ON i.vn = lh.vn WHERE li.labtest <> '' AND lo.lab_order_result REGEXP '^[0-9]+([.][0-9]+){0,1}$' AND lo.lab_order_result + 0 > 0 AND i.an IS NULL AND EXISTS (SELECT 1 FROM clinic c JOIN clinic_visit cv ON cv.clinic = c.clinic AND cv.vn = lh.vn)"),
  PHDB: { sql: OP_ITEMS, col: "adp_phdb" },
} satisfies Record<OpFile, CountDef>;

// IP: ทุกแฟ้มยึด admission ที่จำหน่ายในช่วง (AI) รายการที่เกิดก่อนวันเริ่มจึงติดมาครบ
const IP_COUNT = {
  INS: n(`${AI} INNER JOIN ovst v ON v.an = a.an INNER JOIN patient pt ON pt.hn = v.hn LEFT JOIN patient_pttype pp ON pp.hn = v.hn AND pp.pttype = v.pttype`),
  PAT: n(`patient pt WHERE pt.hn IN (SELECT a.hn FROM ${AI})`),
  IPD: n(AI),
  IRF: n(`${AI} INNER JOIN referout ro ON ro.vn = a.an`),
  IDX: n(`${AI} INNER JOIN iptdiag id ON id.an = a.an`),
  IOP: n(`${AI} INNER JOIN iptoprt io ON io.an = a.an`),
  CHT: n(`${AI} INNER JOIN an_stat ans ON ans.an = a.an INNER JOIN patient pt ON pt.hn = ans.hn`),
  CHA: n(`(SELECT 1 FROM ${AI} JOIN opitemrece op FORCE INDEX (ix_an) ON op.an = a.an INNER JOIN patient pt ON pt.hn = op.hn LEFT JOIN income inc ON inc.income = op.income GROUP BY op.hn, op.an, op.vn, COALESCE(op.rxdate, op.vstdate), LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0'), pt.cid HAVING ROUND(SUM(op.sum_price), 2) > 0) g`),
  AER: n(`${AI} INNER JOIN ovst v ON v.an = a.an INNER JOIN er_regist er ON er.vn = v.vn LEFT JOIN referout rout ON rout.vn = er.vn`),
  ADP: { sql: IP_ITEMS, col: "adp_phdb" },
  LVD: n(`${AI} INNER JOIN ipt_home_leave hl ON hl.an = a.an`),
  DRU: { sql: IP_ITEMS, col: "dru" },
  LABFU: n(`${AI} WHERE 1 = 0`), // แฟ้มส่งออกผู้ป่วยในว่าง
  PHDB: { sql: IP_ITEMS, col: "adp_phdb" },
} satisfies Record<IpFile, CountDef>;

const COUNT: Record<FdhType, Record<string, CountDef>> = { op: OP_COUNT, ip: IP_COUNT };

// ---- กฎตรวจ C: PREFIX ต่อหมวด + block ต่อแฟ้ม คืน c_code, fdh_file, hn, an, seq, found ----

// กฎเฉพาะกองทุน STP (รหัส STP-… ใน files.ts): CTE ต่อท้าย PREFIX เฉพาะ visit/admission สิทธิ STP (มีน้อย CTE stp จึงประเมินซ้ำได้)
// ไม่แตะ opitemrece ตามช่วงวันที่ (join ด้วย vn/an) ; ห้ามเปลี่ยน filter กองทุน ; *_BASE ต่อท้าย PREFIX_BASE, *_ITEMS ต่อท้าย PREFIX_ITEMS
const STP_OP_BASE = `stp AS (
  SELECT v.hn AS HN, '' AS AN, v.vn AS SEQ,
         COALESCE(v.hospmain, (SELECT hospitalcode FROM opdconfig LIMIT 1)) AS HOSPMAIN,
         COALESCE(v.hospsub, v.hospmain, (SELECT hospitalcode FROM opdconfig LIMIT 1)) AS HOSPSUB,
         COALESCE(NULLIF(vp.auth_code, ''), '') AS PERMITNO,
         '1' AS UUC,
         COALESCE(NULLIF(vp.nhso_ucae_type_code, ''), '') AS UCAE
  FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e
  INNER JOIN patient pt ON pt.hn = v.hn
  LEFT JOIN visit_pttype vp ON vp.vn = v.vn AND vp.pttype = v.pttype
  WHERE v.pttype IN (SELECT pttype FROM pttype WHERE hipdata_code = 'STP') AND (v.an IS NULL OR v.an = '')
),
dx_s AS (
  SELECT s.HN, s.AN, s.SEQ, od.icd10 AS DIAG, COALESCE(od.diagtype, '1') AS DXTYPE
  FROM stp s JOIN ovstdiag od ON od.vn = s.SEQ
),
aer_s AS (
  SELECT s.HN, s.AN, s.SEQ, COALESCE(rin.refer_hospcode, rin.hospcode, '') AS REFMAINI, COALESCE(rout.refer_hospcode, '') AS REFMAINO,
         rin.vn IS NOT NULL AS HAS_IN, rout.vn IS NOT NULL AS HAS_OUT
  FROM stp s JOIN er_regist er ON er.vn = s.SEQ LEFT JOIN referin rin ON rin.vn = er.vn LEFT JOIN referout rout ON rout.vn = er.vn
),
orf_s AS (
  SELECT s.HN, s.AN, s.SEQ, COALESCE(ro.refer_hospcode, ro.hospcode) AS REFER FROM stp s JOIN referout ro ON ro.vn = s.SEQ
)`;
// CTE STP ที่อ่าน opitemrece/vn_stat/an_stat (ต่อท้าย PREFIX_ITEMS)
const STP_OP_ITEMS = `adp_s AS (
  SELECT s.HN, s.AN, s.SEQ, DATE_FORMAT(COALESCE(op.rxdate, op.vstdate), '%Y-%m-%d') AS DATEOPD, ${ADP_TYPE} AS ADPTYPE, COALESCE(nd.nhso_adp_code, nd.billcode, op.icode) AS CODE,
         ROUND(op.qty, 2) AS QTY, ROUND(op.unitprice, 2) AS RATE, ROUND(op.sum_price, 2) AS TOTAL
  FROM stp s JOIN opitemrece op ON op.vn = s.SEQ INNER JOIN nondrugitems nd ON nd.icode = op.icode LEFT JOIN income inc ON inc.income = op.income
  WHERE (op.an IS NULL OR op.an = '') AND ${NOT_DRUG}
),
dru_s AS (
  SELECT s.HN, s.AN, s.SEQ, ROUND(op.qty, 0) AS AMOUNT, ROUND(op.unitprice, 2) AS DRUGPRICE, ROUND(op.sum_price, 2) AS TOTAL,
         CASE WHEN op.item_type = 'H' OR op.income = '04' THEN '2' ELSE '1' END AS USE_STATUS
  FROM stp s JOIN opitemrece op ON op.vn = s.SEQ ${DRUG_INC} INNER JOIN drugitems d ON d.icode = op.icode
  WHERE (op.an IS NULL OR op.an = '')
),
cha_s AS (
  SELECT s.HN, s.AN, s.SEQ, COALESCE(op.rxdate, op.vstdate) AS D,
         LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0') AS CHRGITEM, ROUND(SUM(op.sum_price), 2) AS AMOUNT
  FROM stp s JOIN opitemrece op ON op.vn = s.SEQ LEFT JOIN income inc ON inc.income = op.income
  WHERE (op.an IS NULL OR op.an = '')
  GROUP BY s.HN, s.AN, s.SEQ, COALESCE(op.rxdate, op.vstdate), LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0')
  HAVING ROUND(SUM(op.sum_price), 2) > 0
),
cht_s AS (
  SELECT s.HN, s.AN, s.SEQ, ROUND(vs.income, 2) AS TOTAL FROM stp s JOIN vn_stat vs ON vs.vn = s.SEQ
)`;

const STP_IP_BASE = `stp AS (
  SELECT DISTINCT v.hn AS HN, a.AN AS AN, '' AS SEQ,
         COALESCE(v.hospmain, (SELECT hospitalcode FROM opdconfig LIMIT 1)) AS HOSPMAIN,
         COALESCE(v.hospsub, v.hospmain, (SELECT hospitalcode FROM opdconfig LIMIT 1)) AS HOSPSUB,
         COALESCE(NULLIF(ap.auth_code, ''), '') AS PERMITNO
  FROM a INNER JOIN ovst v ON v.an = a.AN
  INNER JOIN patient pt ON pt.hn = v.hn
  LEFT JOIN ipt_pttype ap ON ap.an = a.AN AND ap.pttype = v.pttype
  WHERE v.pttype IN (SELECT pttype FROM pttype WHERE hipdata_code = 'STP')
),
dx_s AS (
  SELECT s.HN, s.AN, s.SEQ, id.icd10 AS DIAG, COALESCE(id.diagtype, '1') AS DXTYPE
  FROM stp s JOIN iptdiag id ON id.an = s.AN
),
aer_s AS (
  SELECT s.HN, s.AN, s.SEQ, COALESCE(rin.refer_hospcode, rin.hospcode, '') AS REFMAINI, COALESCE(rout.refer_hospcode, '') AS REFMAINO,
         rin.vn IS NOT NULL AS HAS_IN, rout.vn IS NOT NULL AS HAS_OUT
  FROM stp s INNER JOIN ovst v ON v.an = s.AN INNER JOIN er_regist er ON er.vn = v.vn
  LEFT JOIN referin rin ON rin.vn = er.vn LEFT JOIN referout rout ON rout.vn = er.vn
),
orf_s AS (
  SELECT s.HN, s.AN, s.SEQ, COALESCE(ro.refer_hospcode, ro.hospcode) AS REFER
  FROM stp s JOIN ipt i ON i.an = s.AN JOIN referout ro ON ro.vn = i.vn
)`;
// CTE STP ที่อ่าน opitemrece/vn_stat/an_stat (ต่อท้าย PREFIX_ITEMS)
const STP_IP_ITEMS = `adp_s AS (
  SELECT s.HN, s.AN, s.SEQ, DATE_FORMAT(COALESCE(op.rxdate, op.vstdate), '%Y-%m-%d') AS DATEOPD, ${ADP_TYPE} AS ADPTYPE, COALESCE(nd.nhso_adp_code, nd.billcode, op.icode) AS CODE,
         ROUND(op.qty, 2) AS QTY, ROUND(op.unitprice, 2) AS RATE, ROUND(op.sum_price, 2) AS TOTAL
  FROM stp s JOIN opitemrece op ON op.an = s.AN INNER JOIN nondrugitems nd ON nd.icode = op.icode LEFT JOIN income inc ON inc.income = op.income
  WHERE ${NOT_DRUG}
),
dru_s AS (
  SELECT s.HN, s.AN, s.SEQ, ROUND(op.qty, 0) AS AMOUNT, ROUND(op.unitprice, 2) AS DRUGPRICE, ROUND(op.sum_price, 2) AS TOTAL,
         CASE WHEN op.item_type = 'H' OR op.income = '04' THEN '2' ELSE '1' END AS USE_STATUS
  FROM stp s JOIN opitemrece op ON op.an = s.AN ${DRUG_INC} INNER JOIN drugitems d ON d.icode = op.icode
),
cha_s AS (
  SELECT s.HN, s.AN, s.SEQ, COALESCE(op.rxdate, op.vstdate) AS D,
         LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0') AS CHRGITEM, ROUND(SUM(op.sum_price), 2) AS AMOUNT
  FROM stp s JOIN opitemrece op ON op.an = s.AN LEFT JOIN income inc ON inc.income = op.income
  GROUP BY s.HN, s.AN, s.SEQ, COALESCE(op.rxdate, op.vstdate), LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0')
  HAVING ROUND(SUM(op.sum_price), 2) > 0
),
cht_s AS (
  SELECT s.HN, s.AN, s.SEQ, ROUND(ans.income, 2) AS TOTAL FROM stp s JOIN an_stat ans ON ans.an = s.AN
)`;

// PREFIX_BASE ไม่แตะ opitemrece ; PREFIX_ITEMS = BASE + CTE ที่ scan opitemrece (แฟ้ม ADP DRU CHA CHT รัน statement ละแฟ้ม)
// MariaDB ประเมิน CTE ใหม่ทุกจุดที่อ้าง (ไม่ materialize ครั้งเดียว) block items จึงอ้าง it/ia/cmp ให้น้อยที่สุด ; *_RAW = ค่าดิบก่อน COALESCE ของแฟ้มส่งออก
// ins.PERMITNO = สูตรเดียวกับ INS.PERMITNO ของ fdh/files/sql.ts (คนละไฟล์เพราะ checks.ts ไม่ import ค่า ; fdh.test.mjs ยืนยันว่า CASE ตรงกัน) ; UUC = '1' ตายตัวเหมือนแฟ้มส่งออก
// ADM_W: ipt.bw เป็นกรัม แต่ 16 แฟ้มส่งเป็นกิโลกรัม (C114/C153 ใช้ กก.) ปัด 3 ตำแหน่งไม่ให้ค่าขอบ 0.5/6 เพี้ยน ; ไม่มี SVCTYPE จึงปิด C160/C161
const PREFIX_BASE: Record<FdhType, string> = {
  op: `${H4},
hc AS (SELECT o.hospitalcode AS HCODE, h.chwpart AS CHW FROM opdconfig o LEFT JOIN hospcode h ON h.hospcode = o.hospitalcode LIMIT 1),
ph AS (SELECT DISTINCT v.hn FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e),
vis AS (
  SELECT v.hn AS HN, '' AS AN, v.vn AS SEQ, v.vn AS K, v.vstdate AS VSTDATE, v.vsttime AS VSTTIME,
         '1' AS UUC,
         (v.an IS NOT NULL AND v.an <> '') AS ADMIT
  FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e
),
cs AS (SELECT HN, AN, SEQ, K, VSTDATE, VSTTIME FROM vis WHERE NOT ADMIT),
ins AS (
  SELECT v.hn AS HN, COALESCE(t.hipdata_code, t.pcode, 'UCS') AS INSCL,
         CASE WHEN t.hipdata_code = 'UCS' THEN COALESCE(NULLIF((SELECT MAX(n.nhso_authen_code) FROM nhso_confirm_privilege n WHERE n.vn = v.vn AND n.nhso_status = 'Y' AND n.nhso_authen_code <> ''), ''), NULLIF(ap.auth_code, ''), '')
              WHEN t.hipdata_code = 'OFC' THEN COALESCE(NULLIF(SUBSTRING_INDEX(sq.edc_approve_list_text, ',', -1), ''), '')
              WHEN t.hipdata_code = 'STP' THEN COALESCE(NULLIF(ap.auth_code, ''), '')
              ELSE COALESCE(v.pttypeno, '') END AS PERMITNO,
         COALESCE(v.an, '') AS AN, v.vn AS SEQ
  FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e
  INNER JOIN patient pt ON pt.hn = v.hn
  LEFT JOIN pttype t ON t.pttype = v.pttype
  LEFT JOIN patient_pttype pp ON pp.hn = v.hn AND pp.pttype = v.pttype
  LEFT JOIN visit_pttype ap ON ap.vn = v.vn AND ap.pttype = v.pttype
  LEFT JOIN ovst_seq sq ON sq.vn = v.vn
  WHERE v.an IS NULL OR v.an = ''
),
dx AS (
  SELECT od.hn AS HN, '' AS AN, od.vn AS SEQ, od.vn AS K, REPLACE(od.icd10, '.', '') AS DIAG,
         COALESCE(od.diagtype, '1') AS DXTYPE, od.diagtype AS DXTYPE_RAW
  FROM p JOIN ovstdiag od ON od.vstdate BETWEEN p.s AND p.e
  INNER JOIN ovst v ON v.vn = od.vn INNER JOIN patient pt ON pt.hn = od.hn
),
${STP_OP_BASE}`,
  ip: `${H4},
a AS (
  SELECT i.hn AS HN, i.an AS AN, i.vn AS VN, i.pttype AS PTTYPE, i.regdate AS REGDATE, i.dchdate AS DCHDATE,
         DATE_FORMAT(i.regdate, '%Y-%m-%d') AS DATEADM, DATE_FORMAT(i.regtime, '%H%i') AS TIMEADM,
         DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS DATEDSC, DATE_FORMAT(i.dchtime, '%H%i') AS TIMEDSC,
         TIMESTAMP(i.regdate, i.regtime) AS ADM_AT, TIMESTAMP(i.dchdate, i.dchtime) AS DSC_AT,
         COALESCE(i.dchstts, '1') AS DISCHS, COALESCE(i.dchtype, '1') AS DISCHT,
         i.dchstts AS DISCHS_RAW, i.dchtype AS DISCHT_RAW,
         ROUND(COALESCE(i.bw, 0) / 1000, 3) AS ADM_W
  FROM p JOIN ipt i ON i.dchdate BETWEEN p.s AND p.e
),
aw AS (
  SELECT i.hn AS HN, i.an AS AN, DATE_FORMAT(i.regdate, '%Y-%m-%d') AS DATEADM, DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS DATEDSC
  FROM p JOIN ipt i ON i.dchdate BETWEEN (SELECT MIN(m.regdate) FROM ipt m WHERE m.dchdate BETWEEN p.s AND p.e) AND p.e
),
ph AS (SELECT DISTINCT HN FROM a),
cs AS (SELECT HN, AN, '' AS SEQ, AN AS K FROM a),
ins AS (
  SELECT v.hn AS HN, COALESCE(t.hipdata_code, t.pcode, 'UCS') AS INSCL,
         CASE WHEN t.hipdata_code = 'UCS' THEN COALESCE(NULLIF((SELECT MAX(n.nhso_authen_code) FROM nhso_confirm_privilege n WHERE n.vn = a.VN AND n.nhso_status = 'Y' AND n.nhso_authen_code <> ''), ''), NULLIF(ap.auth_code, ''), '')
              WHEN t.hipdata_code IN ('OFC', 'LGO') THEN COALESCE(NULLIF(ap.claim_code, ''), NULLIF(ap.auth_code, ''), '')
              WHEN t.hipdata_code = 'STP' THEN COALESCE(NULLIF(ap.auth_code, ''), '')
              ELSE COALESCE(v.pttypeno, '') END AS PERMITNO,
         a.AN AS AN, v.vn AS SEQ
  FROM a INNER JOIN ovst v ON v.an = a.AN
  INNER JOIN patient pt ON pt.hn = v.hn
  LEFT JOIN pttype t ON t.pttype = v.pttype
  LEFT JOIN patient_pttype pp ON pp.hn = v.hn AND pp.pttype = v.pttype
  LEFT JOIN ipt_pttype ap ON ap.an = a.AN AND ap.pttype = v.pttype
),
dx AS (
  SELECT a.HN, a.AN, '' AS SEQ, a.AN AS K, REPLACE(id.icd10, '.', '') AS DIAG,
         COALESCE(id.diagtype, '1') AS DXTYPE, id.diagtype AS DXTYPE_RAW
  FROM a JOIN iptdiag id ON id.an = a.AN
),
${STP_IP_BASE}`,
};

// cha/cmp ใช้ข้อความเดียวกันทั้งสองหมวด ; cmp = ยอด CHA ต่อหมวด (A) เทียบผลรวม ADP+DRU ของหมวดนั้น (T, NULL = ไม่มีรายการในหมวด)
const CHA_CMP = `cha AS (
  SELECT HN, AN, SEQ, K, D, CHRGITEM, ROUND(SUM(SP), 2) AS AMOUNT FROM it
  GROUP BY HN, AN, SEQ, K, D, CHRGITEM HAVING ROUND(SUM(SP), 2) > 0
),
cmp AS (
  SELECT HN, AN, SEQ, K, CHRGITEM,
         SUM(CASE WHEN AMT > 0 THEN AMT END) AS A,
         CASE WHEN SUM(ITN) > 0 THEN ROUND(SUM(ITM), 2) END AS T
  FROM (SELECT HN, AN, SEQ, K, D, CHRGITEM, ROUND(SUM(SP), 2) AS AMT, SUM(IS_ADP OR IS_DRU) AS ITN,
               SUM(CASE WHEN IS_ADP OR IS_DRU THEN TOTAL END) AS ITM
        FROM it GROUP BY HN, AN, SEQ, K, D, CHRGITEM) g
  GROUP BY HN, AN, SEQ, K, CHRGITEM HAVING SUM(AMT > 0) > 0
)`;

// it = รายการของแฟ้ม ADP/DRU/CHA ในรูปเดียวกับแฟ้มส่งออก (scan opitemrece ด้วย FORCE INDEX) ; ia (op) = รวมต่อ visit ครั้งเดียวให้ block ADP op
const PREFIX_ITEMS: Record<FdhType, string> = {
  op: `${PREFIX_BASE.op},
it AS (
  SELECT op.hn AS HN, '' AS AN, op.vn AS SEQ, op.vn AS K, DATE_FORMAT(COALESCE(op.rxdate, op.vstdate), '%Y-%m-%d') AS D,
         op.icode AS ICODE, LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0') AS CHRGITEM,
         COALESCE(nd.icode IS NOT NULL AND ${NOT_DRUG}, 0) AS IS_ADP,
         COALESCE(d.icode IS NOT NULL AND inc.drg_chrgitem_id IN (3, 4), 0) AS IS_DRU,
         COALESCE(d.icode IS NOT NULL AND (op.income = '20' OR COALESCE(d.drugaccount, '') IN ('', '-')), 0) AS IS_NED,
         ${ADP_TYPE} AS ADPTYPE, COALESCE(nd.nhso_adp_code, nd.billcode, op.icode) AS CODE,
         op.qty AS QTY, op.sum_price AS SP, ROUND(op.sum_price, 2) AS TOTAL
  FROM p JOIN opitemrece op FORCE INDEX (ix_vstdate) ON op.vstdate BETWEEN p.s AND p.e
  LEFT JOIN income inc ON inc.income = op.income
  LEFT JOIN nondrugitems nd ON nd.icode = op.icode
  LEFT JOIN drugitems d ON d.icode = op.icode
  WHERE op.vn IS NOT NULL AND (op.an IS NULL OR op.an = '')
),
cht AS (
  SELECT vs.hn AS HN, '' AS AN, vs.vn AS SEQ, vs.vn AS K, ROUND(COALESCE(x.S, 0), 2) AS TOTAL
  FROM p JOIN vn_stat vs ON vs.vstdate BETWEEN p.s AND p.e INNER JOIN ovst v ON v.vn = vs.vn
  LEFT JOIN (SELECT K, SUM(SP) AS S FROM it GROUP BY K) x ON x.K = vs.vn
  WHERE v.an IS NULL OR v.an = ''
),
ia AS (
  SELECT HN, AN, SEQ, K,
         GROUP_CONCAT(DISTINCT CASE WHEN CODE IN ('S1801', 'S1802', 'S1803') THEN CODE END ORDER BY CODE) AS VEH,
         MIN(CASE WHEN TOTAL < 0 THEN CONCAT(CODE, ' ', TOTAL) END) AS NEG,
         MAX(CODE = '30014') AS PRT,
         MAX(CODE = '30010') AS USG,
         GROUP_CONCAT(DISTINCT CASE WHEN CODE IN ('8901', '8902', '8706', '8707', '8711') THEN CODE END ORDER BY CODE) AS DEV,
         GROUP_CONCAT(DISTINCT CASE WHEN CODE IN ('12003', '12004') THEN CODE END ORDER BY CODE) AS PRM
  FROM it WHERE IS_ADP GROUP BY HN, AN, SEQ, K
),
${CHA_CMP},
${STP_OP_ITEMS}`,
  ip: `${PREFIX_BASE.ip},
it AS (
  SELECT op.hn AS HN, op.an AS AN, '' AS SEQ, op.an AS K, DATE_FORMAT(COALESCE(op.rxdate, op.vstdate), '%Y-%m-%d') AS D,
         op.icode AS ICODE, LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0') AS CHRGITEM,
         COALESCE(nd.icode IS NOT NULL AND ${NOT_DRUG}, 0) AS IS_ADP,
         COALESCE(d.icode IS NOT NULL AND inc.drg_chrgitem_id IN (3, 4), 0) AS IS_DRU,
         COALESCE(d.icode IS NOT NULL AND (op.income = '20' OR COALESCE(d.drugaccount, '') IN ('', '-')), 0) AS IS_NED,
         ${ADP_TYPE} AS ADPTYPE, COALESCE(nd.nhso_adp_code, nd.billcode, op.icode) AS CODE,
         op.qty AS QTY, op.sum_price AS SP, ROUND(op.sum_price, 2) AS TOTAL
  FROM a JOIN opitemrece op FORCE INDEX (ix_an) ON op.an = a.AN
  LEFT JOIN income inc ON inc.income = op.income
  LEFT JOIN nondrugitems nd ON nd.icode = op.icode
  LEFT JOIN drugitems d ON d.icode = op.icode
),
cht AS (SELECT ans.hn AS HN, ans.an AS AN, '' AS SEQ, ans.an AS K, ROUND(ans.income, 2) AS TOTAL FROM a JOIN an_stat ans ON ans.an = a.AN),
${CHA_CMP},
${STP_IP_ITEMS}`,
};

// pt.cid ต้องอยู่ใน block ไม่ใช่ CTE (db-cli ปิดค่า cid เป็น MD5 ทำให้พิสูจน์ผิด) ; C103 ใช้เพศดิบ (แฟ้มส่งออก COALESCE เป็น '1')
const PAT_BLOCK = `SELECT '101' AS c_code, 'PAT' AS fdh_file, pt.hn AS hn, '' AS an, '' AS seq,
       CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS found
FROM ph JOIN patient pt ON pt.hn = ph.hn WHERE TRIM(COALESCE(pt.fname, '')) = '' OR TRIM(COALESCE(pt.lname, '')) = ''
UNION ALL SELECT '102', 'PAT', pt.hn, '', '', DATE_FORMAT(pt.birthday, '%Y-%m-%d')
FROM ph JOIN patient pt ON pt.hn = ph.hn WHERE pt.birthday IS NULL OR pt.birthday > CURDATE()
UNION ALL SELECT '103', 'PAT', pt.hn, '', '', COALESCE(pt.sex, 'NULL')
FROM ph JOIN patient pt ON pt.hn = ph.hn WHERE pt.sex IS NULL OR pt.sex NOT IN ('1', '2')
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

// C305: Authen ผิดพลาด (Er…) หรือปิดสิทธิแล้วถูกยกเลิกและไม่มีปิดใหม่ ; C349: ไม่มี Authen เลย (ยกเว้นปิดสิทธิแล้ว/PP ใน smartcard agent)
// cl = ปิดสิทธิผ่าน /fund/close-privilege ; ovst ต้อง FORCE INDEX (ix_vstdate) ไม่งั้น optimizer เริ่มที่ pttype แล้วสแกน ovst ทั้งสิทธิ
const INS_OP_RULES = `UNION ALL SELECT '305', 'INS', o.hn, '', o.vn, CONCAT(t.hipdata_code, ' ', COALESCE(NULLIF(vp.auth_code, ''), '-'))
  FROM p JOIN ovst o FORCE INDEX (ix_vstdate) ON o.vstdate BETWEEN p.s AND p.e
  JOIN pttype t ON t.pttype = o.pttype
  LEFT JOIN visit_pttype vp ON vp.vn = o.vn AND vp.pttype = o.pttype
  WHERE (o.an IS NULL OR o.an = '') AND t.hipdata_code IN ('UCS', 'WEL') AND CAST(o.vn AS UNSIGNED) NOT IN (SELECT k FROM cl)
    AND COALESCE(vp.auth_code, '') NOT LIKE 'PP%'
    AND NOT EXISTS (SELECT 1 FROM nhso_confirm_privilege c WHERE c.vn = o.vn AND c.nhso_status = 'Y' AND c.nhso_cancel_datetime IS NULL)
    AND (COALESCE(vp.auth_code, '') LIKE 'Er%'
         OR EXISTS (SELECT 1 FROM nhso_confirm_privilege c WHERE c.vn = o.vn AND c.nhso_cancel_datetime IS NOT NULL))
UNION ALL SELECT '349', 'INS', o.hn, '', o.vn, '-'
  FROM p JOIN ovst o FORCE INDEX (ix_vstdate) ON o.vstdate BETWEEN p.s AND p.e
  JOIN pttype t ON t.pttype = o.pttype
  LEFT JOIN visit_pttype vp ON vp.vn = o.vn AND vp.pttype = o.pttype
  WHERE (o.an IS NULL OR o.an = '') AND t.hipdata_code IN ('UCS', 'WEL') AND CAST(o.vn AS UNSIGNED) NOT IN (SELECT k FROM cl)
    AND COALESCE(vp.auth_code, '') = ''
    AND NOT EXISTS (SELECT 1 FROM nhso_confirm_privilege c WHERE c.vn = o.vn AND c.nhso_status = 'Y' AND c.nhso_cancel_datetime IS NULL)
    AND NOT EXISTS (SELECT 1 FROM nhso_smartcard_agent s WHERE s.vn = o.vn AND s.claim_code LIKE 'PP%')`;

// OP visit ห่าง admission ไม่ถึง 4 ชม. (UC) หรืออยู่ใน 24 ชม. ก่อน admit (ข้าราชการ/อปท.) ; C998 ส่งได้ถึง 31 ธ.ค. หลังปีงบสิ้นสุด
const OPD_BLOCK = `SELECT '105' AS c_code, 'OPD' AS fdh_file, v.hn AS hn, '' AS an, v.vn AS seq, v.hn AS found FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e WHERE v.hn IS NULL OR TRIM(v.hn) = ''
UNION ALL SELECT '151', 'OPD', c.HN, c.AN, c.SEQ, CONCAT('AN ', i.an) FROM cs c
  JOIN ipt i ON i.hn = c.HN AND i.regdate <= c.VSTDATE + INTERVAL 1 DAY AND (i.dchdate IS NULL OR i.dchdate >= c.VSTDATE - INTERVAL 1 DAY)
  JOIN pttype t ON t.pttype = i.pttype
  WHERE t.hipdata_code IN ('UCS', 'WEL', 'OFC', 'LGO')
    AND TIMESTAMP(c.VSTDATE, c.VSTTIME) BETWEEN TIMESTAMP(i.regdate, i.regtime) - INTERVAL IF(t.hipdata_code IN ('OFC', 'LGO'), 24, 4) HOUR
        AND COALESCE(TIMESTAMP(i.dchdate, i.dchtime), NOW()) + INTERVAL IF(t.hipdata_code IN ('OFC', 'LGO'), 0, 4) HOUR
UNION ALL SELECT '179', 'OPD', c.HN, c.AN, c.SEQ, CONCAT('VN ', d.SEQ) FROM cs c
  JOIN cs d ON d.HN = c.HN AND d.VSTDATE = c.VSTDATE AND d.SEQ <> c.SEQ
UNION ALL SELECT '902', 'OPD', c.HN, c.AN, c.SEQ, DATE_FORMAT(pt.deathday, '%Y-%m-%d') FROM cs c
  JOIN patient pt ON pt.hn = c.HN WHERE pt.death = 'Y' AND pt.deathday < c.VSTDATE
UNION ALL SELECT '998', 'OPD', HN, AN, SEQ, DATE_FORMAT(VSTDATE, '%Y-%m-%d') FROM cs
  WHERE CURDATE() > DATE(CONCAT(YEAR(VSTDATE) + (MONTH(VSTDATE) >= 10), '-12-31'))`;

// C111/C112 ใช้ค่าดิบและยอมรับ '01'–'09' (HOSxP เก็บสองหลัก) ; C151 เหลือเฉพาะ OP visit ในช่วง admit (arm AN ซ้อนกันไม่ตรง REP)
const IPD_BLOCK = `SELECT '107' AS c_code, 'IPD' AS fdh_file, HN AS hn, AN AS an, '' AS seq, DATEADM AS found FROM a WHERE DATEADM IS NULL
UNION ALL SELECT '109', 'IPD', HN, AN, '', TIMEADM FROM a WHERE TIMEADM IS NULL OR TIMEADM NOT REGEXP '^([01][0-9]|2[0-3])[0-5][0-9]$'
UNION ALL SELECT '110', 'IPD', HN, AN, '', TIMEDSC FROM a WHERE TIMEDSC IS NULL OR TIMEDSC NOT REGEXP '^([01][0-9]|2[0-3])[0-5][0-9]$'
UNION ALL SELECT '111', 'IPD', HN, AN, '', COALESCE(DISCHT_RAW, 'NULL') FROM a WHERE DISCHT_RAW IS NULL OR DISCHT_RAW NOT REGEXP '^0{0,1}[1-9]$'
UNION ALL SELECT '112', 'IPD', HN, AN, '', COALESCE(DISCHS_RAW, 'NULL') FROM a WHERE DISCHS_RAW IS NULL OR DISCHS_RAW NOT REGEXP '^0{0,1}[1-9]$'
UNION ALL SELECT '114', 'IPD', a.HN, a.AN, '', a.ADM_W FROM a JOIN patient pt ON pt.hn = a.HN
  WHERE DATEDIFF(a.DATEADM, pt.birthday) BETWEEN 0 AND 27 AND COALESCE(a.ADM_W, 0) <= 0
UNION ALL SELECT '153', 'IPD', a.HN, a.AN, '', a.ADM_W FROM a JOIN patient pt ON pt.hn = a.HN
  WHERE DATEDIFF(a.DATEADM, pt.birthday) BETWEEN 0 AND 27 AND a.ADM_W > 0 AND (a.ADM_W < 0.5 OR a.ADM_W > 6)
UNION ALL SELECT '120', 'IPD', a.HN, a.AN, '', CONCAT(a.DATEADM, ' < ', DATE_FORMAT(pt.birthday, '%Y-%m-%d')) FROM a JOIN patient pt ON pt.hn = a.HN
  WHERE a.DATEADM < DATE_FORMAT(pt.birthday, '%Y-%m-%d')
UNION ALL SELECT '121', 'IPD', HN, AN, '', CONCAT(DATEADM, ' ', TIMEADM, ' > ', DATEDSC, ' ', TIMEDSC) FROM a
  WHERE CONCAT(DATEADM, TIMEADM) > CONCAT(DATEDSC, TIMEDSC)
UNION ALL SELECT '151', 'IPD', a.HN, a.AN, '', CONCAT('OP VN ', o.vn) FROM a JOIN pttype t ON t.pttype = a.PTTYPE
  JOIN ovst o ON o.hn = a.HN AND o.vstdate BETWEEN a.REGDATE - INTERVAL 1 DAY AND a.DCHDATE + INTERVAL 1 DAY AND (o.an IS NULL OR o.an = '')
  WHERE t.hipdata_code IN ('UCS', 'WEL', 'OFC', 'LGO')
    AND TIMESTAMP(o.vstdate, o.vsttime) BETWEEN a.ADM_AT - INTERVAL IF(t.hipdata_code IN ('OFC', 'LGO'), 24, 4) HOUR
        AND a.DSC_AT + INTERVAL IF(t.hipdata_code IN ('OFC', 'LGO'), 0, 4) HOUR
UNION ALL SELECT '902', 'IPD', a.HN, a.AN, '', DATE_FORMAT(pt.deathday, '%Y-%m-%d') FROM a JOIN patient pt ON pt.hn = a.HN
  WHERE pt.death = 'Y' AND pt.deathday < a.REGDATE
UNION ALL SELECT '998', 'IPD', HN, AN, '', DATEDSC FROM a WHERE CURDATE() > DATE(CONCAT(YEAR(DCHDATE) + (MONTH(DCHDATE) >= 10), '-12-31'))`;

// C801 รหัสเฉพาะเพศ (WHO ICD-10 Vol.2) ใช้ 3/4 ตัวแรกหลังตัดจุด
const MALE = "LEFT(d.DIAG, 3) BETWEEN 'C60' AND 'C63' OR LEFT(d.DIAG, 3) BETWEEN 'N40' AND 'N51' OR LEFT(d.DIAG, 3) BETWEEN 'Q53' AND 'Q55' OR LEFT(d.DIAG, 3) IN ('D29', 'D40', 'E29', 'R86') OR LEFT(d.DIAG, 4) IN ('B260', 'D074', 'D075', 'D076', 'D176', 'E895', 'F524', 'I861', 'L291', 'S312', 'S313', 'Z125')";
const FEMALE = "LEFT(d.DIAG, 1) = 'O' OR LEFT(d.DIAG, 3) BETWEEN 'C51' AND 'C58' OR LEFT(d.DIAG, 3) BETWEEN 'D25' AND 'D28' OR LEFT(d.DIAG, 3) BETWEEN 'N70' AND 'N98' OR LEFT(d.DIAG, 3) BETWEEN 'Q50' AND 'Q52' OR LEFT(d.DIAG, 3) BETWEEN 'Z32' AND 'Z36' OR LEFT(d.DIAG, 3) IN ('A34', 'D06', 'D39', 'E28', 'F53', 'R87', 'Z39') OR LEFT(d.DIAG, 4) IN ('B373', 'C796', 'D070', 'D071', 'D072', 'D073', 'E894', 'F525', 'I863', 'L292', 'L705', 'M800', 'M801', 'M810', 'M811', 'M830', 'N992', 'N993', 'P546', 'S314', 'S374', 'S375', 'S376', 'T192', 'T193', 'T833', 'Z014', 'Z124', 'Z301', 'Z303', 'Z305', 'Z311', 'Z312', 'Z437', 'Z875', 'Z975')";

/** block วินิจฉัย: extra = 206 (IDX) ต่อหลัง 202 ; tail = 152 (ODX) ต่อท้าย */
const dxBlock = (dxf: string, extra: string, tail: string) => `SELECT '201' AS c_code, '${dxf}' AS fdh_file, c.HN AS hn, c.AN AS an, c.SEQ AS seq, '' AS found FROM cs c
  WHERE NOT EXISTS (SELECT 1 FROM dx d WHERE d.K = c.K AND d.DXTYPE = '1' AND TRIM(d.DIAG) <> '')
UNION ALL SELECT '202', '${dxf}', c.HN, c.AN, c.SEQ, GROUP_CONCAT(CONCAT(d.DIAG, ':', COALESCE(d.DXTYPE_RAW, 'NULL')) ORDER BY d.DIAG)
  FROM cs c JOIN dx d ON d.K = c.K AND d.DXTYPE = '1' GROUP BY c.HN, c.AN, c.SEQ HAVING COUNT(*) > 1${extra}
UNION ALL SELECT '232', '${dxf}', c.HN, c.AN, c.SEQ, d.DIAG FROM cs c JOIN dx d ON d.K = c.K AND d.DXTYPE = '1'
  WHERE LEFT(d.DIAG, 1) IN ('S', 'T') AND NOT EXISTS (SELECT 1 FROM dx e WHERE e.K = c.K AND LEFT(e.DIAG, 1) IN ('V', 'W', 'X', 'Y'))
UNION ALL SELECT '801', '${dxf}', c.HN, c.AN, c.SEQ, CONCAT('sex ', pt.sex, ' ', d.DIAG) FROM cs c JOIN dx d ON d.K = c.K JOIN patient pt ON pt.hn = c.HN
  WHERE (pt.sex = '1' AND (${FEMALE})) OR (pt.sex = '2' AND (${MALE}))${tail}`;
const IDX_206 = `
UNION ALL SELECT '206', 'IDX', c.HN, c.AN, c.SEQ, d.DIAG FROM cs c JOIN dx d ON d.K = c.K AND d.DXTYPE = '1'
  WHERE LEFT(d.DIAG, 3) = 'Z13' OR LEFT(d.DIAG, 4) = 'Z763' OR LEFT(d.DIAG, 1) IN ('V', 'W', 'X', 'Y')`;
const ODX_152 = `
UNION ALL SELECT '152', 'ODX', c.HN, c.AN, c.SEQ, CONCAT(d.DIAG, ' VN ', c2.SEQ) FROM cs c
  JOIN dx d ON d.K = c.K AND d.DXTYPE = '1'
  JOIN cs c2 ON c2.HN = c.HN AND c2.VSTDATE = c.VSTDATE AND c2.SEQ <> c.SEQ
  JOIN dx d2 ON d2.K = c2.K AND d2.DXTYPE = '1' AND d2.DIAG = d.DIAG`;

// ADP op: arm เดียวหลายรหัส (cross join ตารางรหัส) อ่าน ia ครั้งเดียว ; เงื่อนไขต่อรหัสใช้ LEFT JOIN + IS NULL (EXISTS ใน OR ทำให้สแกนทั้งตาราง)
// รายการรหัสต้องตรงกับ ADP_OP_CODES (ตรวจใน fdh.test.mjs)
const ADP_OP_CODES = ["171", "514", "301", "234", "357", "634", "756"];
const ADP_OP_BLOCK = `SELECT DISTINCT c.c AS c_code, 'ADP' AS fdh_file, x.HN AS hn, x.AN AS an, x.SEQ AS seq,
       CASE c.c WHEN '171' THEN x.VEH
                WHEN '514' THEN CONCAT(x.VEH, IF(er.vn IS NULL, ' noAER', ' in-province'))
                WHEN '301' THEN x.NEG WHEN '234' THEN '30014' WHEN '357' THEN x.DEV WHEN '634' THEN '30010'
                WHEN '756' THEN CONCAT(x.PRM, ' age ', TIMESTAMPDIFF(YEAR, pt.birthday, o.vstdate)) END AS found
FROM ia x
LEFT JOIN ovst o ON o.vn = x.SEQ
LEFT JOIN pttype t ON t.pttype = o.pttype
LEFT JOIN patient pt ON pt.hn = o.hn
LEFT JOIN er_regist er ON er.vn = x.SEQ
LEFT JOIN referout ro ON ro.vn = x.SEQ AND TRIM(COALESCE(ro.refer_hospcode, '')) <> ''
LEFT JOIN hospcode h ON h.hospcode = ro.refer_hospcode
LEFT JOIN doctor_operation dop ON dop.vn = x.SEQ AND dop.icd9 LIKE '8878%'
LEFT JOIN ovstdiag dz ON dz.vn = x.SEQ AND dz.icd10 LIKE 'Z32%'
JOIN (${ADP_OP_CODES.map((c, i) => `SELECT '${c}'${i ? "" : " AS c"}`).join(" UNION ALL ")}) c
WHERE (c.c = '171' AND x.VEH IS NOT NULL AND ro.vn IS NULL)
   OR (c.c = '514' AND x.VEH IS NOT NULL AND ro.vn IS NOT NULL AND (er.vn IS NULL OR (t.hipdata_code IN ('UCS', 'WEL') AND h.chwpart = (SELECT CHW FROM hc))))
   OR (c.c = '301' AND x.NEG IS NOT NULL)
   OR (c.c = '234' AND x.PRT = 1 AND dz.vn IS NULL)
   OR (c.c = '357' AND x.DEV IS NOT NULL AND t.hipdata_code IN ('UCS', 'WEL'))
   OR (c.c = '634' AND x.USG = 1 AND dop.vn IS NULL)
   OR (c.c = '756' AND x.PRM IS NOT NULL AND TIMESTAMPDIFF(YEAR, pt.birthday, o.vstdate) NOT BETWEEN 35 AND 59)`;

// C312 ค่าห้องนับวัน admit และวันจำหน่าย จึงยอมเกินวันนอนได้ 1 ; C952 > 999 แถวมีได้แค่ IP
const ADP_IP_BLOCK = `SELECT '301' AS c_code, 'ADP' AS fdh_file, HN AS hn, AN AS an, SEQ AS seq, CONCAT(CODE, ' ', TOTAL) AS found FROM it WHERE IS_ADP AND TOTAL < 0
UNION ALL SELECT '312', 'ADP', x.HN, x.AN, '', CONCAT(x.CODE, ' ', x.Q, ' > ', l.LOS)
  FROM (SELECT HN, AN, CODE, SUM(QTY) AS Q FROM it WHERE IS_ADP AND ADPTYPE = 10 GROUP BY HN, AN, CODE) x
  JOIN (SELECT a.AN, GREATEST(DATEDIFF(a.DCHDATE, a.REGDATE), 1) - COALESCE(SUM(DATEDIFF(hl.reg_date, hl.dch_date)), 0) AS LOS
        FROM a LEFT JOIN ipt_home_leave hl ON hl.an = a.AN GROUP BY a.AN, a.DCHDATE, a.REGDATE) l ON l.AN = x.AN
  WHERE x.Q > l.LOS + 1
UNION ALL SELECT '952', 'ADP', HN, AN, SEQ, CONCAT(CHRGITEM, ' ', COUNT(*)) FROM it WHERE IS_ADP GROUP BY HN, AN, SEQ, CHRGITEM HAVING COUNT(*) > 999`;

// C303 ไม่นับแถวที่จำนวนและราคาเป็น 0 (บันทึกแล้วไม่จ่ายจริง)
const DRU_BLOCK = `SELECT '301' AS c_code, 'DRU' AS fdh_file, HN AS hn, AN AS an, SEQ AS seq, CONCAT(ICODE, ' ', TOTAL) AS found FROM it WHERE IS_DRU AND TOTAL < 0
UNION ALL SELECT '303', 'DRU', HN, AN, SEQ, CONCAT(ICODE, ' qty ', COALESCE(QTY, 'NULL')) FROM it WHERE IS_DRU AND (QTY IS NULL OR ROUND(QTY, 0) <= 0) AND COALESCE(TOTAL, 0) <> 0`;
// C565 (OP): ยานอกบัญชีของ OFC/LGO ต้องมีเหตุผล EA–EF (ovst_presc_ned) = DRUGREMARK ของแฟ้ม
const DRU_OP_565 = `
UNION ALL SELECT '565', 'DRU', x.HN, x.AN, x.SEQ, x.ICODE FROM it x JOIN ovst o ON o.vn = x.SEQ JOIN pttype t ON t.pttype = o.pttype
  WHERE x.IS_DRU AND x.IS_NED AND t.hipdata_code IN ('OFC', 'LGO')
    AND NOT EXISTS (SELECT 1 FROM ovst_presc_ned pn WHERE pn.vn = x.SEQ AND pn.icode = x.ICODE AND UPPER(pn.presc_reason) REGEXP '^E[A-F]$')`;
const DRU_IP_952 ="\nUNION ALL SELECT '952', 'DRU', HN, AN, SEQ, CONCAT(CHRGITEM, ' ', COUNT(*)) FROM it WHERE IS_DRU GROUP BY HN, AN, SEQ, CHRGITEM HAVING COUNT(*) > 999";

// C302 = หมวดมียอดแต่ไม่มีรายการ ADP/DRU, C555 = ยอดหมวดไม่เท่าผลรวมรายการ (arm เดียวสองรหัส อ่าน cmp ครั้งเดียว)
const CHA_BLOCK = `SELECT IF(T IS NULL, '302', '555') AS c_code, 'CHA' AS fdh_file, HN AS hn, AN AS an, SEQ AS seq,
       IF(T IS NULL, CONCAT(CHRGITEM, ' ', A), CONCAT(CHRGITEM, ' CHA ', A, ' <> ', T)) AS found
FROM cmp WHERE T IS NULL OR ABS(A - T) >= 0.01`;
const CHT_BLOCK = `SELECT '301' AS c_code, 'CHT' AS fdh_file, HN AS hn, AN AS an, SEQ AS seq, TOTAL AS found FROM cht WHERE TOTAL IS NULL OR TOTAL <= 0
UNION ALL SELECT '555', 'CHT', t.HN, t.AN, t.SEQ, CONCAT('CHT ', t.TOTAL, ' <> CHA ', COALESCE(h.S, 0)) FROM cht t
  LEFT JOIN (SELECT K, SUM(AMOUNT) AS S FROM cha GROUP BY K) h ON h.K = t.K
  WHERE ABS(COALESCE(t.TOTAL, 0) - COALESCE(h.S, 0)) >= 0.01`;

// block STP ต่อแฟ้ม (ใช้ CTE stp/*_s) rf/dx = ชื่อแฟ้มส่งต่อ/วินิจฉัยของหมวด ; IP ไม่มี STP-R112 (block OPD)
const stpBlocks = (rf: string, dx: string) => ({
  INS: `SELECT 'STP-R175' AS c_code, 'INS' AS fdh_file, HN AS hn, AN AS an, SEQ AS seq, CONCAT(HOSPMAIN, '/', HOSPSUB) AS found FROM stp WHERE TRIM(COALESCE(HOSPMAIN, '')) = '' OR TRIM(COALESCE(HOSPSUB, '')) = ''
UNION ALL SELECT 'STP-AUTH', 'INS', HN, AN, SEQ, PERMITNO FROM stp WHERE PERMITNO = '' OR BINARY PERMITNO NOT REGEXP '^[A-Z]{2}[0-9]{10}$'`,
  OPD: "SELECT 'STP-R112' AS c_code, 'OPD' AS fdh_file, HN AS hn, AN AS an, SEQ AS seq, UCAE AS found FROM stp WHERE UUC = '1' AND UCAE NOT IN ('A', 'E', 'I', 'O')",
  AER: `SELECT 'STP-R111' AS c_code, 'AER' AS fdh_file, HN AS hn, AN AS an, SEQ AS seq, CONCAT(REFMAINI, '/', REFMAINO) AS found FROM aer_s WHERE (HAS_IN AND TRIM(REFMAINI) = '') OR (HAS_OUT AND TRIM(REFMAINO) = '')
UNION ALL SELECT 'STP-R113', 'AER', HN, AN, SEQ, CONCAT(REFMAINI, '/', REFMAINO) FROM aer_s WHERE (REFMAINI <> '' AND TRIM(REFMAINI) NOT REGEXP '^[0-9]{5}$') OR (REFMAINO <> '' AND TRIM(REFMAINO) NOT REGEXP '^[0-9]{5}$')`,
  RF: `SELECT 'STP-R113' AS c_code, '${rf}' AS fdh_file, HN AS hn, AN AS an, SEQ AS seq, REFER AS found FROM orf_s WHERE TRIM(COALESCE(REFER, '')) <> '' AND TRIM(REFER) NOT REGEXP '^[0-9]{5}$'`,
  ADP: `SELECT 'STP-R108' AS c_code, 'ADP' AS fdh_file, HN AS hn, AN AS an, SEQ AS seq, CONCAT_WS('/', QTY, RATE, TOTAL) AS found FROM adp_s WHERE QTY IS NULL OR QTY <= 0 OR RATE IS NULL OR RATE <= 0 OR TOTAL IS NULL OR TOTAL <= 0
UNION ALL SELECT 'STP-R188', 'ADP', HN, AN, SEQ, CODE FROM adp_s WHERE CODE NOT IN ('55999', '57999') GROUP BY HN, AN, SEQ, DATEOPD, ADPTYPE, CODE HAVING COUNT(*) > 1
UNION ALL SELECT 'STP-R292', 'ADP', HN, AN, SEQ, QTY FROM adp_s WHERE CODE = 'S1801' AND (QTY < 1 OR QTY > 2)
UNION ALL SELECT 'STP-R180', 'ADP', x.HN, x.AN, x.SEQ, x.CODE FROM adp_s x WHERE x.CODE = 'S1802' AND NOT EXISTS (SELECT 1 FROM adp_s y WHERE y.CODE = 'S1801' AND y.AN = x.AN AND y.SEQ = x.SEQ) GROUP BY x.HN, x.AN, x.SEQ, x.CODE
UNION ALL SELECT 'STP-R194', 'ADP', HN, AN, SEQ, COUNT(*) FROM adp_s WHERE CODE = 'S1801' GROUP BY HN, AN, SEQ HAVING COUNT(*) > 1`,
  DRU: "SELECT 'STP-R108' AS c_code, 'DRU' AS fdh_file, HN AS hn, AN AS an, SEQ AS seq, CONCAT_WS('/', AMOUNT, DRUGPRICE, TOTAL) AS found FROM dru_s WHERE AMOUNT IS NULL OR AMOUNT <= 0 OR DRUGPRICE IS NULL OR DRUGPRICE <= 0 OR TOTAL IS NULL OR TOTAL <= 0",
  CHT: "SELECT 'STP-R186' AS c_code, 'CHT' AS fdh_file, c.HN AS hn, c.AN AS an, c.SEQ AS seq, CONCAT(c.TOTAL, ' <> ', COALESCE(h.S, 0)) AS found FROM cht_s c LEFT JOIN (SELECT AN, SEQ, SUM(AMOUNT) AS S FROM cha_s GROUP BY AN, SEQ) h ON h.AN = c.AN AND h.SEQ = c.SEQ WHERE ABS(c.TOTAL - COALESCE(h.S, 0)) >= 0.01",
  DX: `SELECT 'STP-R191' AS c_code, '${dx}' AS fdh_file, s.HN AS hn, s.AN AS an, s.SEQ AS seq, '' AS found FROM stp s WHERE NOT EXISTS (SELECT 1 FROM dx_s d WHERE d.AN = s.AN AND d.SEQ = s.SEQ AND d.DXTYPE = '1' AND TRIM(d.DIAG) <> '')
UNION ALL SELECT 'STP-R136', '${dx}', HN, AN, SEQ, DIAG FROM dx_s WHERE DXTYPE = '1' AND DIAG LIKE 'H54%'
UNION ALL SELECT 'STP-R116', '${dx}', d.HN, d.AN, d.SEQ, MIN(d.DIAG) FROM dx_s d WHERE LEFT(d.DIAG, 1) IN ('S', 'T') AND NOT EXISTS (SELECT 1 FROM dx_s x WHERE x.AN = d.AN AND x.SEQ = d.SEQ AND x.DXTYPE = '5') GROUP BY d.HN, d.AN, d.SEQ`,
});
const STP_OP_BLOCKS = stpBlocks("ORF", "ODX");
const STP_IP_BLOCKS = stpBlocks("IRF", "IDX");
const STP_INS = ["STP-R175", "STP-AUTH"];
const STP_ADP = ["STP-R108", "STP-R188", "STP-R292", "STP-R180", "STP-R194"];
const STP_DX = ["STP-R191", "STP-R136", "STP-R116"];

/** items = block อ่าน CTE ที่ scan opitemrece (ใช้ PREFIX_ITEMS และรันแยก statement ต่อแฟ้ม) */
type Rule = { codes: string[]; sql: string; items?: true };
const PAT_RULE: Rule = { codes: ["101", "102", "103", "104", "116"], sql: PAT_BLOCK };

/** แฟ้มที่ไม่มีใน record = ยังไม่มีกฎตรวจ */
export const RULES: Record<FdhType, Record<string, Rule>> = {
  op: {
    PAT: PAT_RULE,
    OPD: { codes: ["105", "151", "179", "902", "998", "STP-R112"], sql: `${OPD_BLOCK}\nUNION ALL ${STP_OP_BLOCKS.OPD}` },
    INS: { codes: ["127", "305", "349", ...STP_INS], sql: `${insBlock("127")}\n${INS_OP_RULES}\nUNION ALL ${STP_OP_BLOCKS.INS}` },
    AER: { codes: ["STP-R111", "STP-R113"], sql: STP_OP_BLOCKS.AER },
    ORF: { codes: ["STP-R113"], sql: STP_OP_BLOCKS.RF },
    OOP: {
      codes: ["952"],
      sql: `SELECT '952' AS c_code, 'OOP' AS fdh_file, v.hn AS hn, '' AS an, v.vn AS seq, ROUND(dop.price, 2) AS found
FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e INNER JOIN doctor_operation dop ON dop.vn = v.vn WHERE dop.price > 99999`,
    },
    ODX: { codes: ["201", "202", "232", "801", "152", ...STP_DX], sql: `${dxBlock("ODX", "", ODX_152)}\nUNION ALL ${STP_OP_BLOCKS.DX}` },
    ADP: { codes: [...ADP_OP_CODES, ...STP_ADP], sql: `${ADP_OP_BLOCK}\nUNION ALL ${STP_OP_BLOCKS.ADP}`, items: true },
    DRU: { codes: ["301", "303", "565", "STP-R108"], sql: `${DRU_BLOCK}${DRU_OP_565}\nUNION ALL ${STP_OP_BLOCKS.DRU}`, items: true },
    CHA: { codes: ["302", "555"], sql: CHA_BLOCK, items: true },
    CHT: { codes: ["301", "555", "STP-R186"], sql: `${CHT_BLOCK}\nUNION ALL ${STP_OP_BLOCKS.CHT}`, items: true },
  } satisfies Partial<Record<OpFile, Rule>>,
  ip: {
    PAT: PAT_RULE,
    IPD: { codes: ["107", "109", "110", "111", "112", "114", "153", "120", "121", "151", "902", "998"], sql: IPD_BLOCK },
    INS: { codes: ["125", ...STP_INS], sql: `${insBlock("125")}\nUNION ALL ${STP_IP_BLOCKS.INS}` },
    AER: { codes: ["STP-R111", "STP-R113"], sql: STP_IP_BLOCKS.AER },
    IRF: { codes: ["STP-R113"], sql: STP_IP_BLOCKS.RF },
    IDX: { codes: ["201", "202", "206", "232", "801", ...STP_DX], sql: `${dxBlock("IDX", IDX_206, "")}\nUNION ALL ${STP_IP_BLOCKS.DX}` },
    ADP: { codes: ["301", "312", "952", ...STP_ADP], sql: `${ADP_IP_BLOCK}\nUNION ALL ${STP_IP_BLOCKS.ADP}`, items: true },
    DRU: { codes: ["301", "303", "952", "STP-R108"], sql: `${DRU_BLOCK}${DRU_IP_952}\nUNION ALL ${STP_IP_BLOCKS.DRU}`, items: true },
    CHA: { codes: ["302", "555"], sql: CHA_BLOCK, items: true },
    CHT: { codes: ["301", "555", "STP-R186"], sql: `${CHT_BLOCK}\nUNION ALL ${STP_IP_BLOCKS.CHT}`, items: true },
  } satisfies Partial<Record<IpFile, Rule>>,
};

/** statement นับแถวของแฟ้ม (แฟ้มที่ใช้ statement เดียวกันได้ sql เดียวกัน รันครั้งเดียวได้) */
export const countDef = (type: FdhType, file: string): CountDef => COUNT[type][file];
export const ruleCodes = (type: FdhType, file: string): string[] => RULES[type][file]?.codes ?? [];
/** แฟ้มที่กฎอ่าน opitemrece: summary รันแยก statement ละแฟ้ม (รวมก้อนเดียวล็อก MyISAM นานเกิน) */
export const itemFiles = (type: FdhType) => Object.keys(RULES[type]).filter((f) => RULES[type][f].items);

const prefix = (items: boolean, type: FdhType) => (items ? PREFIX_ITEMS : PREFIX_BASE)[type];

/**
 * จำนวนเคสต่อรหัสต่อแฟ้ม params ruleParams(): ระบุ file = เฉพาะแฟ้มนั้น (ต้องมีกฎ) ;
 * ไม่ระบุ = ทุกแฟ้มที่ไม่ใช่ items รวม statement เดียว (แฟ้ม items รันทีละแฟ้มด้วย itemFiles)
 */
export const ruleSummarySql = (type: FdhType, file?: string) => {
  const rules = file ? [RULES[type][file]] : Object.values(RULES[type]).filter((r) => !r.items);
  return `${prefix(!!file && !!RULES[type][file].items, type)}\nSELECT c_code, fdh_file, COUNT(*) AS n FROM (\n${rules.map((r) => r.sql).join("\nUNION ALL ")}\n) r GROUP BY c_code, fdh_file`;
};

/** กรองรายที่เลือก (sel) ก่อน LIMIT: PAT ใช้ HN ของ VN/AN ที่เลือก ; กฎข้ามราย (C151/C152/C179) จึงยังเทียบกับรายอื่นในช่วงได้ครบ */
const selWhere = (type: FdhType, file: string) =>
  `NOT EXISTS (SELECT 1 FROM sel) OR ${
    file === "PAT"
      ? type === "op"
        ? "r.hn IN (SELECT o.hn FROM ovst o WHERE CAST(o.vn AS UNSIGNED) IN (SELECT k FROM sel))"
        : "r.hn IN (SELECT i.hn FROM ipt i WHERE CAST(i.an AS UNSIGNED) IN (SELECT k FROM sel))"
      : `CAST(r.${type === "op" ? "seq" : "an"} AS UNSIGNED) IN (SELECT k FROM sel)`
  }`;

/** รายเคสของแฟ้ม (ต้องมีกฎ) ไม่เกิน CASE_LIMIT แถว params ruleParams() */
export const casesSql = (type: FdhType, file: string) =>
  `${prefix(!!RULES[type][file].items, type)}\nSELECT c_code, hn, an, seq, found FROM (\n${RULES[type][file].sql}\n) r\nWHERE ${selWhere(type, file)}\nORDER BY c_code, hn, an, seq LIMIT ${CASE_LIMIT}`;

/**
 * params ของทุก statement กฎ: [start, end, selJson, closedJson] ; sel = VN (op) / AN (ip) ที่เลือก ว่าง = ทั้งช่วง ;
 * closed = VN ที่ปิดสิทธิแล้ว (closed.ts, ip ส่งว่าง) ; ทุกค่าเป็นตัวเลขล้วนที่ route/DB ตรวจแล้ว
 */
export const ruleParams = (start: string, end: string, sel: string[] = [], closed: string[] = []) => [
  start,
  end,
  JSON.stringify(sel.map(Number)),
  JSON.stringify(closed.map(Number)),
];

/** รหัสที่ found เป็นเลขบัตรประชาชน */
const CID_CODES = new Set(["104", "116"]);

/** ปิดกลางเลขบัตรก่อนส่งออกจาก server: 1234xxxxx5678 (สั้นกว่า 9 ตัวปิดทั้งหมด แต่ยังเห็นความยาว) */
export function maskCid(s: string): string {
  return s.length > 8 ? `${s.slice(0, 4)}${"x".repeat(s.length - 8)}${s.slice(-4)}` : "x".repeat(s.length);
}

export const maskFound = (code: string, found: string | null) => (found != null && CID_CODES.has(code) ? maskCid(String(found)) : found);
