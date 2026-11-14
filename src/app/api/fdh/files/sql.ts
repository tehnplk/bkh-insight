// SQL ดึงข้อมูล 16 แฟ้มมาตรฐานจาก HOSxP (อ่านอย่างเดียว ผ่าน prove-query แล้ว) แบบ pure ไม่มี import ค่า
// ทุก statement: params [start, end, limit, offset] ส่งออกทั้งแฟ้มใช้ exportSql (ตัด LIMIT/OFFSET) params [start, end]
// ORDER BY ขึ้นต้นด้วยคอลัมน์วันที่ที่กรอง (ไม่งั้น ODX ช้ามาก) ห้ามเปลี่ยน ; นับแถวใช้ countDef ใน c-check/checks.ts
// ชื่อแฟ้มเลือก SQL จาก record นี้เท่านั้น (whitelist) ไม่ต่อ string จากผู้ใช้
import type { FdhType, IpFile, OpFile } from "../c-check/files";

const H = "WITH p AS (SELECT CAST(? AS DATE) AS s, CAST(? AS DATE) AS e)";
const PAGE = " LIMIT ? OFFSET ?";
const HCODE = "(SELECT hospitalcode FROM opdconfig LIMIT 1)";
const AI = "FROM p JOIN ipt a ON a.dchdate BETWEEN p.s AND p.e";
const q = (select: string, rest: string) => `${H}\nSELECT ${select}\n${rest}${PAGE}`;

// SELECT list ที่ OP กับ IP ใช้ร่วมกัน (ข้อความเหมือนกันทุกตัวอักษร)
const INS = `v.hn AS \`HN\`, COALESCE(t.hipdata_code, t.pcode, 'UCS') AS \`INSCL\`, COALESCE(t.pttype, '') AS \`SUBTYPE\`, pt.cid AS \`CID\`, ${HCODE} AS \`HCODE\`, DATE_FORMAT(pp.expire_date, '%Y-%m-%d') AS \`DATEEXP\`, COALESCE(v.hospmain, ${HCODE}) AS \`HOSPMAIN\`, COALESCE(v.hospsub, v.hospmain, ${HCODE}) AS \`HOSPSUB\`, COALESCE(t.pcode, '') AS \`GOVCODE\`, COALESCE(t.name, '') AS \`GOVNAME\`, CASE WHEN t.hipdata_code = 'STP' THEN COALESCE(NULLIF(ap.auth_code, ''), '') ELSE COALESCE(v.pttypeno, '') END AS \`PERMITNO\`, '' AS \`DOCNO\`, COALESCE(pt.father_cid, pt.mother_cid, pt.cid) AS \`OWNRPID\`, COALESCE(pt.fathername, pt.mathername, CONCAT(pt.fname, ' ', pt.lname)) AS \`OWNNAME\`, COALESCE(v.an, '') AS \`AN\`, v.vn AS \`SEQ\`, COALESCE(t.nhso_subinscl, '') AS \`SUBINSCL\`, '1' AS \`RELINSCL\`, '1' AS \`HTYPE\``;
// PERMITNO ของ STP = Authen Code ของสิทธิใน visit/admission (ap) ว่างก็ส่งว่าง ไม่ใช้ pttypeno แทน
const INS_JOIN_OP = "INNER JOIN patient pt ON pt.hn = v.hn LEFT JOIN pttype t ON t.pttype = v.pttype LEFT JOIN patient_pttype pp ON pp.hn = v.hn AND pp.pttype = v.pttype LEFT JOIN visit_pttype ap ON ap.vn = v.vn AND ap.pttype = v.pttype";
const INS_JOIN_IP = "INNER JOIN patient pt ON pt.hn = v.hn LEFT JOIN pttype t ON t.pttype = v.pttype LEFT JOIN patient_pttype pp ON pp.hn = v.hn AND pp.pttype = v.pttype LEFT JOIN ipt_pttype ap ON ap.an = v.an AND ap.pttype = v.pttype";
const PAT = `${HCODE} AS \`HCODE\`, pt.hn AS \`HN\`, LPAD(COALESCE(pt.chwpart, '00'), 2, '0') AS \`CHANGWAT\`, LPAD(COALESCE(pt.amppart, '00'), 2, '0') AS \`AMPHUR\`, DATE_FORMAT(pt.birthday, '%Y-%m-%d') AS \`DOB\`, COALESCE(pt.sex, '1') AS \`SEX\`, COALESCE(pt.marrystatus, '9') AS \`MARRIAGE\`, LPAD(COALESCE(pt.occupation, '000'), 3, '0') AS \`OCCUPA\`, LPAD(COALESCE(pt.nationality, '099'), 3, '0') AS \`NATION\`, pt.cid AS \`PERSON_ID\`, CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS \`NAMEPAT\`, COALESCE(pt.pname, '') AS \`TITLE\`, COALESCE(pt.fname, '') AS \`FNAME\`, COALESCE(pt.lname, '') AS \`LNAME\`, CASE WHEN LENGTH(pt.cid) = 13 THEN '1' ELSE '2' END AS \`IDTYPE\``;
const CLINIC = "CONCAT('0', LPAD(COALESCE(v.spclty, '01'), 2, '0'), '00')";
const CHA = `op.hn AS \`HN\`, COALESCE(op.an, '') AS \`AN\`, DATE_FORMAT(COALESCE(op.rxdate, op.vstdate), '%Y-%m-%d') AS \`DATE\`, LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0') AS \`CHRGITEM\`, ROUND(SUM(op.sum_price), 2) AS \`AMOUNT\`, pt.cid AS \`PERSON_ID\`, COALESCE(op.vn, '') AS \`SEQ\``;
const CHA_GROUP = "GROUP BY op.hn, op.an, op.vn, COALESCE(op.rxdate, op.vstdate), LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0'), pt.cid\nHAVING ROUND(SUM(op.sum_price), 2) > 0";
const AER = `v.hn AS \`HN\`, COALESCE(v.an, '') AS \`AN\`, DATE_FORMAT(er.vstdate, '%Y-%m-%d') AS \`DATEOPD\`, COALESCE(er.er_emergency_type, '') AS \`AUTHAE\`, DATE_FORMAT(COALESCE(ed.accident_datetime, er.vstdate), '%Y-%m-%d') AS \`AEDATE\`, DATE_FORMAT(COALESCE(ed.accident_datetime, v.vsttime), '%H%i') AS \`AETIME\`, COALESCE(ed.accident_transport_type_id, '1') AS \`AETYPE\`, COALESCE(rin.referin_number, rin.docno, '') AS \`REFER_NO\`, COALESCE(rin.refer_hospcode, rin.hospcode, '') AS \`REFMAINI\`, COALESCE(er.er_pt_type, '1') AS \`IREFTYPE\`, COALESCE(rout.refer_hospcode, '') AS \`REFMAINO\`, COALESCE(rout.refer_type, '') AS \`OREFTYPE\`, CASE WHEN er.er_emergency_type = '1' THEN '1' ELSE '0' END AS \`UCAE\`, COALESCE(er.er_emergency_level_id, '1') AS \`EMTYPE\`, er.vn AS \`SEQ\`, COALESCE(er.er_dch_type, '1') AS \`AESTATUS\`, '' AS \`DALERT\`, '' AS \`TALERT\``;
const AER_JOIN = "LEFT JOIN er_nursing_detail ed ON ed.vn = er.vn LEFT JOIN referin rin ON rin.vn = er.vn LEFT JOIN referout rout ON rout.vn = er.vn";
const ADP = `op.hn AS \`HN\`, COALESCE(op.an, '') AS \`AN\`, DATE_FORMAT(COALESCE(op.rxdate, op.vstdate), '%Y-%m-%d') AS \`DATEOPD\`, COALESCE(nd.nhso_adp_type_id, 3) AS \`TYPE\`, COALESCE(nd.nhso_adp_code, nd.billcode, op.icode) AS \`CODE\`, ROUND(op.qty, 2) AS \`QTY\`, ROUND(op.unitprice, 2) AS \`RATE\`, COALESCE(op.vn, '') AS \`SEQ\`, '' AS \`CAGCODE\`, '' AS \`DOSE\`, '' AS \`CA_TYPE\`, '' AS \`SERIALNO\`, ROUND(COALESCE(op.paidst, 0), 2) AS \`TOTCOPAY\`, '' AS \`USE_STATUS\`, ROUND(op.sum_price, 2) AS \`TOTAL\`, '' AS \`QTYDAY\`, COALESCE(nd.tmlt_code, '') AS \`TMLTCODE\`, '' AS \`STATUS1\`, '' AS \`BI\`, ${CLINIC} AS \`CLINIC\`, '1' AS \`ITEMSRC\`, COALESCE(doc.licenseno, op.staff, '') AS \`PROVIDER\`, '' AS \`GRAVIDA\`, '' AS \`GA_WEEK\`, '' AS \`DCIP/E_screen\`, '' AS \`LMP\`, '' AS \`SP_ITEM\``;
const ADP_JOIN = "INNER JOIN nondrugitems nd ON nd.icode = op.icode LEFT JOIN ovst v ON v.vn = op.vn LEFT JOIN doctor doc ON doc.code = op.doctor";
const DRU = `${HCODE} AS \`HCODE\`, op.hn AS \`HN\`, COALESCE(op.an, '') AS \`AN\`, CASE WHEN op.an IS NOT NULL AND op.an <> '' THEN CONCAT('1', LPAD(COALESCE(i.spclty, '01'), 2, '0'), '00') ELSE ${CLINIC} END AS \`CLINIC\`, pt.cid AS \`PERSON_ID\`, DATE_FORMAT(COALESCE(op.rxdate, op.vstdate), '%Y-%m-%d') AS \`DATE_SERV\`, COALESCE(d.did, d.sks_drug_code, d.icode) AS \`DID\`, d.name AS \`DIDNAME\`, ROUND(op.qty, 0) AS \`AMOUNT\`, ROUND(op.unitprice, 2) AS \`DRUGPRICE\`, ROUND(COALESCE(d.unitcost, 0), 2) AS \`DRUGCOST\`, COALESCE(d.tmt_tp_code, d.tmt_gp_code, d.sks_drug_code, '') AS \`DIDSTD\`, d.units AS \`UNIT\`, COALESCE(d.packqty, '1') AS \`UNIT_PACK\`, COALESCE(op.vn, '') AS \`SEQ\`, '' AS \`DRUGREMARK\`, '' AS \`PA_NO\`, ROUND(COALESCE(op.paidst, 0), 2) AS \`TOTCOPAY\`, CASE WHEN op.an IS NOT NULL AND op.an <> '' AND op.income = 3 THEN '1' ELSE '2' END AS \`USE_STATUS\`, ROUND(op.sum_price, 2) AS \`TOTAL\`, COALESCE(du.shortlist, op.drugusage, '') AS \`SIGCODE\`, TRIM(CONCAT(COALESCE(du.name1, ''), ' ', COALESCE(du.name2, ''), ' ', COALESCE(du.name3, ''))) AS \`SIGTEXT\`, COALESCE(doc.licenseno, op.staff, '') AS \`PROVIDER\`, '' AS \`SP_ITEM\``;
const DRU_JOIN = "INNER JOIN drugitems d ON d.icode = op.icode INNER JOIN patient pt ON pt.hn = op.hn LEFT JOIN ovst v ON v.vn = op.vn LEFT JOIN ipt i ON i.an = op.an LEFT JOIN drugusage du ON du.drugusage = op.drugusage LEFT JOIN doctor doc ON doc.code = op.doctor";
const LABFU = `${HCODE} AS \`HCODE\`, lh.hn AS \`HN\`, pt.cid AS \`PERSON_ID\`, DATE_FORMAT(lh.order_date, '%Y-%m-%d') AS \`DATESERV\`, COALESCE(lh.vn, '') AS \`SEQ\`, COALESCE(li.provis_labcode, li.tmlt_code, li.labtest, li.lab_items_code) AS \`LABTEST\`, lo.lab_order_result AS \`LABRESULT\`, COALESCE(i.an, '') AS \`AN\``;
const LABFU_JOIN = "INNER JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number INNER JOIN lab_items li ON li.lab_items_code = lo.lab_items_code INNER JOIN patient pt ON pt.hn = lh.hn LEFT JOIN ipt i ON i.vn = lh.vn";
const LAB_RESULT = "lo.lab_order_result IS NOT NULL AND lo.lab_order_result <> ''";
const PHDB = `op.hn AS \`HN\`, COALESCE(nd.moph_price_item_code, nd.nhso_adp_code, nd.billcode, op.icode) AS \`CODE\`, ROUND(op.qty, 0) AS \`QTY\`, ROUND(op.sum_price, 2) AS \`PRICE\`, COALESCE(op.an, '') AS \`AN\`, COALESCE(op.vn, '') AS \`SEQ\`, COALESCE(t.hipdata_code, t.pcode, 'UCS') AS \`INSCL\``;
const PHDB_JOIN = "INNER JOIN nondrugitems nd ON nd.icode = op.icode LEFT JOIN ovst v ON v.vn = op.vn LEFT JOIN ipt i ON i.an = op.an LEFT JOIN pttype t ON t.pttype = COALESCE(v.pttype, i.pttype)";
const OP_RANGE = "FROM p JOIN opitemrece op FORCE INDEX (ix_vstdate) ON op.vstdate BETWEEN p.s AND p.e";
const OP_ONLY = "op.vn IS NOT NULL AND (op.an IS NULL OR op.an = '')";
const IP_ITEMS = `${AI} JOIN opitemrece op FORCE INDEX (ix_an) ON op.an = a.an`;
const NOT_OPD = "v.an IS NULL OR v.an = ''"; // แฟ้ม OP ตัด visit ที่ admit

const OP_SQL = {
  INS: q(INS, `FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e ${INS_JOIN_OP}\nWHERE ${NOT_OPD}\nORDER BY v.vstdate, v.vn, pp.patient_pttype_id`),
  PAT: q(PAT, "FROM patient pt WHERE pt.hn IN (SELECT v.hn FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e)\nORDER BY pt.hn"),
  // DETAIL: '\\r' '\\n' ใน JS = '\r' '\n' ใน SQL (MySQL แปลงเป็น CR/LF เอง)
  OPD: q(
    `v.hn AS \`HN\`, ${CLINIC} AS \`CLINIC\`, DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS \`DATEOPD\`, DATE_FORMAT(v.vsttime, '%H%i') AS \`TIMEOPD\`, v.vn AS \`SEQ\`, CASE WHEN v.ovstost IN ('03', '04') THEN '3' ELSE '1' END AS \`UUC\`, SUBSTRING(REPLACE(REPLACE(COALESCE(s.cc, ''), '\\r', ' '), '\\n', ' '), 1, 255) AS \`DETAIL\`, ROUND(s.temperature, 1) AS \`BTEMP\`, ROUND(s.bps) AS \`SBP\`, ROUND(s.bpd) AS \`DBP\`, ROUND(s.pulse) AS \`PR\`, ROUND(s.rr) AS \`RR\`, CASE WHEN TIME(v.vsttime) BETWEEN '08:00:00' AND '16:00:00' THEN '1' ELSE '2' END AS \`OPTYPE\`, CASE WHEN rf_in.vn IS NOT NULL THEN '3' WHEN oa.hn IS NOT NULL THEN '2' ELSE '1' END AS \`TYPEIN\`, CASE WHEN i.an IS NOT NULL THEN '3' WHEN rf_out.vn IS NOT NULL THEN '2' WHEN v.ovstost IN ('04', '09') THEN '4' ELSE '1' END AS \`TYPEOUT\``,
    "FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e LEFT JOIN opdscreen s ON s.vn = v.vn LEFT JOIN ipt i ON i.vn = v.vn LEFT JOIN referin rf_in ON rf_in.vn = v.vn LEFT JOIN referout rf_out ON rf_out.vn = v.vn LEFT JOIN oapp oa ON oa.hn = v.hn AND oa.nextdate = v.vstdate\nORDER BY v.vstdate, v.vn, rf_out.referout_id, oa.oapp_id",
  ),
  ORF: q(
    `ro.hn AS \`HN\`, DATE_FORMAT(ro.refer_date, '%Y-%m-%d') AS \`DATEOPD\`, ${CLINIC} AS \`CLINIC\`, COALESCE(ro.refer_hospcode, ro.hospcode) AS \`REFER\`, COALESCE(ro.refer_type, 1) AS \`REFERTYPE\`, ro.vn AS \`SEQ\`, DATE_FORMAT(ro.refer_date, '%Y-%m-%d') AS \`REFERDATE\``,
    `FROM p JOIN referout ro ON ro.refer_date BETWEEN p.s AND p.e INNER JOIN ovst v ON v.vn = ro.vn\nWHERE ${NOT_OPD}\nORDER BY ro.refer_date, ro.vn, ro.referout_id`,
  ),
  ODX: q(
    `od.hn AS \`HN\`, DATE_FORMAT(od.vstdate, '%Y-%m-%d') AS \`DATEDX\`, ${CLINIC} AS \`CLINIC\`, REPLACE(od.icd10, '.', '') AS \`DIAG\`, COALESCE(od.diagtype, '1') AS \`DXTYPE\`, COALESCE(doc.licenseno, od.doctor, '') AS \`DRDX\`, pt.cid AS \`PERSON_ID\`, od.vn AS \`SEQ\``,
    "FROM p JOIN ovstdiag od ON od.vstdate BETWEEN p.s AND p.e INNER JOIN ovst v ON v.vn = od.vn INNER JOIN patient pt ON pt.hn = od.hn LEFT JOIN doctor doc ON doc.code = od.doctor\nORDER BY od.vstdate, od.vn, od.ovst_diag_id",
  ),
  OOP: q(
    `v.hn AS \`HN\`, DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS \`DATEOPD\`, ${CLINIC} AS \`CLINIC\`, REPLACE(dop.icd9, '.', '') AS \`OPER\`, COALESCE(doc.licenseno, dop.doctor, '') AS \`DROPID\`, pt.cid AS \`PERSON_ID\`, v.vn AS \`SEQ\`, ROUND(COALESCE(dop.price, 0), 2) AS \`SERVPRICE\``,
    "FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e INNER JOIN doctor_operation dop ON dop.vn = v.vn INNER JOIN patient pt ON pt.hn = v.hn LEFT JOIN doctor doc ON doc.code = dop.doctor\nORDER BY v.vstdate, v.vn, dop.doctor_operation_id",
  ),
  CHT: q(
    "vs.hn AS `HN`, '' AS `AN`, DATE_FORMAT(vs.vstdate, '%Y-%m-%d') AS `DATE`, ROUND(vs.income, 2) AS `TOTAL`, ROUND(vs.paid_money, 2) AS `PAID`, vs.pttype AS `PTTYPE`, pt.cid AS `PERSON_ID`, vs.vn AS `SEQ`, '' AS `OPD_MEMO`, COALESCE(rp.bill_number, '') AS `INVOICE_NO`, COALESCE(rp.book_number, '') AS `INVOICE_LT`",
    `FROM p JOIN vn_stat vs ON vs.vstdate BETWEEN p.s AND p.e INNER JOIN patient pt ON pt.hn = vs.hn INNER JOIN ovst v ON v.vn = vs.vn LEFT JOIN rcpt_print rp ON rp.vn = vs.vn\nWHERE ${NOT_OPD}\nORDER BY vs.vstdate, vs.vn, rp.finance_number`,
  ),
  CHA: q(CHA, `${OP_RANGE} INNER JOIN patient pt ON pt.hn = op.hn LEFT JOIN income inc ON inc.income = op.income\nWHERE ${OP_ONLY}\n${CHA_GROUP}\nORDER BY \`DATE\`, \`SEQ\`, \`HN\`, \`AN\`, \`CHRGITEM\``),
  AER: q(AER, `FROM p JOIN er_regist er ON er.vstdate BETWEEN p.s AND p.e INNER JOIN ovst v ON v.vn = er.vn ${AER_JOIN}\nWHERE ${NOT_OPD}\nORDER BY er.vstdate, er.vn, rout.referout_id`),
  ADP: q(ADP, `${OP_RANGE} ${ADP_JOIN}\nWHERE ${OP_ONLY} AND op.income NOT IN (3, 4)\nORDER BY op.vstdate, op.vn, op.hos_guid`),
  DRU: q(DRU, `${OP_RANGE} ${DRU_JOIN}\nWHERE ${OP_ONLY} AND op.income IN (3, 4)\nORDER BY op.vstdate, op.vn, op.hos_guid`),
  LABFU: q(LABFU, `FROM p JOIN lab_head lh ON lh.order_date BETWEEN p.s AND p.e ${LABFU_JOIN}\nWHERE ${LAB_RESULT} AND i.an IS NULL\nORDER BY lh.order_date, lh.lab_order_number, lo.lab_items_code`),
  PHDB: q(PHDB, `${OP_RANGE} ${PHDB_JOIN}\nWHERE ${OP_ONLY} AND op.income NOT IN (3, 4)\nORDER BY op.vstdate, op.vn, op.hos_guid`),
} satisfies Record<OpFile, string>;

// IP: ทุกแฟ้มยึด admission ที่จำหน่ายในช่วง (AI) ; IPD: SVCTYPE = '1' ทุก admission (ไม่มี w.is_icu), ADM_W แปลงกรัมเป็นกิโลกรัม
const IP_SQL = {
  INS: q(INS, `${AI} INNER JOIN ovst v ON v.an = a.an ${INS_JOIN_IP}\nORDER BY a.dchdate, a.an, v.vn, pp.patient_pttype_id`),
  PAT: q(PAT, "FROM patient pt WHERE pt.hn IN (SELECT a.hn FROM p JOIN ipt a ON a.dchdate BETWEEN p.s AND p.e)\nORDER BY pt.hn"),
  IPD: q(
    "i.hn AS `HN`, i.an AS `AN`, DATE_FORMAT(i.regdate, '%Y-%m-%d') AS `DATEADM`, DATE_FORMAT(i.regtime, '%H%i') AS `TIMEADM`, DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS `DATEDSC`, DATE_FORMAT(i.dchtime, '%H%i') AS `TIMEDSC`, COALESCE(i.dchstts, '1') AS `DISCHS`, COALESCE(i.dchtype, '1') AS `DISCHT`, COALESCE(w.ward_export_code, w.sss_code, w.ward, '01') AS `WARDDSC`, LPAD(COALESCE(i.spclty, '01'), 2, '0') AS `DEPT`, ROUND(COALESCE(i.bw, 0) / 1000, 3) AS `ADM_W`, '1' AS `UUC`, '1' AS `SVCTYPE`",
    "FROM p JOIN ipt i ON i.dchdate BETWEEN p.s AND p.e LEFT JOIN ward w ON w.ward = i.ward\nORDER BY i.dchdate, i.an",
  ),
  IRF: q(
    "a.an AS `AN`, COALESCE(ro.refer_hospcode, ro.hospcode) AS `REFER`, COALESCE(ro.refer_type, 1) AS `REFERTYPE`",
    `${AI} INNER JOIN referout ro ON ro.vn = a.vn\nORDER BY a.dchdate, a.an, ro.referout_id`,
  ),
  IDX: q(
    "id.an AS `AN`, REPLACE(id.icd10, '.', '') AS `DIAG`, COALESCE(id.diagtype, '1') AS `DXTYPE`, COALESCE(doc.licenseno, id.doctor, '') AS `DRDX`",
    `${AI} INNER JOIN iptdiag id ON id.an = a.an LEFT JOIN doctor doc ON doc.code = id.doctor\nORDER BY a.dchdate, a.an, id.ipt_diag_id`,
  ),
  IOP: q(
    "io.an AS `AN`, REPLACE(io.icd9, '.', '') AS `OPER`, COALESCE(io.oper_type, 1) AS `OPTYPE`, COALESCE(doc.licenseno, io.doctor, '') AS `DROPID`, DATE_FORMAT(io.opdate, '%Y-%m-%d') AS `DATEIN`, DATE_FORMAT(io.optime, '%H%i') AS `TIMEIN`, DATE_FORMAT(COALESCE(io.enddate, io.opdate), '%Y-%m-%d') AS `DATEOUT`, DATE_FORMAT(COALESCE(io.endtime, io.optime), '%H%i') AS `TIMEOUT`",
    `${AI} INNER JOIN iptoprt io ON io.an = a.an LEFT JOIN doctor doc ON doc.code = io.doctor\nORDER BY a.dchdate, a.an, io.iptoprt_id`,
  ),
  CHT: q(
    "ans.hn AS `HN`, ans.an AS `AN`, DATE_FORMAT(ans.dchdate, '%Y-%m-%d') AS `DATE`, ROUND(ans.income, 2) AS `TOTAL`, ROUND(ans.paid_money, 2) AS `PAID`, ans.pttype AS `PTTYPE`, pt.cid AS `PERSON_ID`, '' AS `SEQ`, '' AS `OPD_MEMO`, COALESCE(rp.bill_number, '') AS `INVOICE_NO`, COALESCE(rp.book_number, '') AS `INVOICE_LT`",
    `${AI} INNER JOIN an_stat ans ON ans.an = a.an INNER JOIN patient pt ON pt.hn = ans.hn LEFT JOIN rcpt_print rp ON rp.vn = ans.vn\nORDER BY a.dchdate, a.an, rp.finance_number`,
  ),
  CHA: q(CHA, `${IP_ITEMS} INNER JOIN patient pt ON pt.hn = op.hn LEFT JOIN income inc ON inc.income = op.income\n${CHA_GROUP}\nORDER BY \`AN\`, \`DATE\`, \`SEQ\`, \`CHRGITEM\`, \`HN\``),
  AER: q(AER, `${AI} INNER JOIN ovst v ON v.an = a.an INNER JOIN er_regist er ON er.vn = v.vn ${AER_JOIN}\nORDER BY a.dchdate, a.an, er.vn, rout.referout_id`),
  ADP: q(ADP, `${IP_ITEMS} ${ADP_JOIN}\nWHERE op.income NOT IN (3, 4)\nORDER BY a.dchdate, a.an, op.vstdate, op.hos_guid`),
  LVD: q(
    "hl.ipt_home_leave_id AS `SEQLVD`, hl.an AS `AN`, DATE_FORMAT(hl.dch_date, '%Y-%m-%d') AS `DATEOUT`, DATE_FORMAT(hl.dch_time, '%H%i') AS `TIMEOUT`, DATE_FORMAT(hl.reg_date, '%Y-%m-%d') AS `DATEIN`, DATE_FORMAT(hl.reg_time, '%H%i') AS `TIMEIN`, DATEDIFF(hl.reg_date, hl.dch_date) AS `QTYDAY`",
    `${AI} INNER JOIN ipt_home_leave hl ON hl.an = a.an\nORDER BY a.dchdate, a.an, hl.ipt_home_leave_id`,
  ),
  DRU: q(DRU, `${IP_ITEMS} ${DRU_JOIN}\nWHERE op.income IN (3, 4)\nORDER BY a.dchdate, a.an, op.vstdate, op.hos_guid`),
  LABFU: q(LABFU, `${AI} INNER JOIN lab_head lh ON lh.vn = a.vn ${LABFU_JOIN}\nWHERE ${LAB_RESULT}\nORDER BY a.dchdate, a.an, lh.lab_order_number, lo.lab_items_code`),
  PHDB: q(PHDB, `${IP_ITEMS} ${PHDB_JOIN}\nWHERE op.income NOT IN (3, 4)\nORDER BY a.dchdate, a.an, op.vstdate, op.hos_guid`),
} satisfies Record<IpFile, string>;

const SQL: Record<FdhType, Record<string, string>> = { op: OP_SQL, ip: IP_SQL };

/** SQL หนึ่งหน้า params [start, end, limit, offset] (file ต้องผ่าน isFile แล้ว) */
export const pageSql = (type: FdhType, file: string) => SQL[type][file];
/** SQL ทั้งแฟ้มของช่วง params [start, end] */
export const exportSql = (type: FdhType, file: string) => pageSql(type, file).slice(0, -PAGE.length);
/**
 * SQL ทั้งแฟ้มของผู้ป่วยในตามรายการ AN (เลือกรายคนส่ง FDH) แทนเงื่อนไขวันจำหน่ายของ admission ด้วย `an IN (?, …)`
 * params [วันใดก็ได้, วันใดก็ได้, ...ans] (CTE p ยังอยู่แต่ไม่ถูกใช้) n ต้อง > 0 ; พิสูจน์แล้วว่าได้แถวเท่ากับแบบช่วงวันที่ของ AN ชุดเดียวกันครบ 14 แฟ้ม
 */
export const ipAnExportSql = (file: string, n: number) =>
  exportSql("ip", file).replace(/\b(a|i)\.dchdate BETWEEN p\.s AND p\.e/, (_, x) => `${x}.an IN (${Array(n).fill("?").join(", ")})`);
/**
 * ตรวจแฟ้ม DRU กับ Drug Catalog: FROM/WHERE/ORDER BY เดียวกับ ipAnExportSql("DRU") แถวที่ i จึงตรงกับแถวที่ i ของแฟ้ม
 * แต่ดึง icode (= HOSPDRUGCODE ของ Drug Catalog) แทน DID ซึ่งในแฟ้มเป็นรหัส 24 หลัก ; price/date_serv ใช้สูตรเดียวกับ DRUGPRICE/DATE_SERV
 */
export function ipAnDruCheckSql(n: number) {
  const s = ipAnExportSql("DRU", n);
  return `${s.slice(0, s.indexOf("\nSELECT "))}
SELECT op.icode, ROUND(op.unitprice, 2) AS price, DATE_FORMAT(COALESCE(op.rxdate, op.vstdate), '%Y-%m-%d') AS date_serv${s.slice(s.indexOf("\nFROM "))}`;
}
/**
 * ตรวจแฟ้ม DRU ผู้ป่วยนอกกับ Drug Catalog: FROM/WHERE/ORDER BY เดียวกับ exportSql("op", "DRU") params [start, end]
 * คืน seq (= SEQ ของแฟ้ม) ไว้กรอง VN ที่เลือกในลำดับเดิม แถวที่เหลือจึงตรงกับแถวของแฟ้มที่กรอง SEQ เดียวกัน
 */
export function opDruCheckSql() {
  const s = exportSql("op", "DRU");
  return `${s.slice(0, s.indexOf("\nSELECT "))}
SELECT COALESCE(op.vn, '') AS seq, op.icode, ROUND(op.unitprice, 2) AS price, DATE_FORMAT(COALESCE(op.rxdate, op.vstdate), '%Y-%m-%d') AS date_serv${s.slice(s.indexOf("\nFROM "))}`;
}
/** ชื่อคอลัมน์ตามลำดับใน SELECT (alias ในวงเล็บ backtick) hisQuery ไม่คืน fields จึงอ่านจาก SQL */
export const fileColumns = (type: FdhType, file: string) => [...pageSql(type, file).matchAll(/ AS `([^`]+)`/g)].map((m) => m[1]);

// รูปแบบไฟล์ txt (toTxt) อยู่ที่ txt.ts: client ใช้สร้าง zip ได้โดยไม่ลาก SQL ไปด้วย และไฟล์นี้ไม่มี import ค่า (node --test อ่านได้)
import type { FileRow } from "./txt";
export type { FileRow };

/** /api/fdh/files/summary */
export type FilesSummary = { type: FdhType; files: { file: string; rows: number }[] };
/** /api/fdh/files (json) */
export type FilePage = { rows: FileRow[]; total: number; columns: string[] };
