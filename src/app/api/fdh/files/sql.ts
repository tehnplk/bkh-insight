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

// SELECT list ที่ OP กับ IP ใช้ร่วมกัน (ข้อความเหมือนกันทุกตัวอักษร ยกเว้น PERMITNO)
const ins = (permit: string) => `v.hn AS \`HN\`, COALESCE(t.hipdata_code, t.pcode, 'UCS') AS \`INSCL\`, COALESCE(t.pttype, '') AS \`SUBTYPE\`, pt.cid AS \`CID\`, ${HCODE} AS \`HCODE\`, DATE_FORMAT(pp.expire_date, '%Y-%m-%d') AS \`DATEEXP\`, COALESCE(v.hospmain, ${HCODE}) AS \`HOSPMAIN\`, COALESCE(v.hospsub, v.hospmain, ${HCODE}) AS \`HOSPSUB\`, COALESCE(t.pcode, '') AS \`GOVCODE\`, COALESCE(t.name, '') AS \`GOVNAME\`, ${permit} AS \`PERMITNO\`, '' AS \`DOCNO\`, COALESCE(pt.father_cid, pt.mother_cid, pt.cid) AS \`OWNRPID\`, COALESCE(pt.fathername, pt.mathername, CONCAT(pt.fname, ' ', pt.lname)) AS \`OWNNAME\`, COALESCE(v.an, '') AS \`AN\`, v.vn AS \`SEQ\`, COALESCE(t.nhso_subinscl, '') AS \`SUBINSCL\`, '1' AS \`RELINSCL\`, '1' AS \`HTYPE\``;
// PERMITNO ต่อสิทธิ: UCS = Authen Code (ปิดสิทธิใน nhso_confirm_privilege ก่อน แล้ว auth_code ของสิทธิ) ; OFC (OP) = Approve Code ล่าสุดของ EDC
// ไม่ fallback (ว่างให้กฎ C เตือน) ; OFC/LGO (IP) = claim_code แล้ว auth_code ; STP = Authen Code (ap) ว่างก็ส่งว่าง ; สิทธิอื่น = pttypeno เดิม
const ucsAuthen = (vn: string) =>
  `COALESCE(NULLIF((SELECT MAX(n.nhso_authen_code) FROM nhso_confirm_privilege n WHERE n.vn = ${vn} AND n.nhso_status = 'Y' AND n.nhso_authen_code <> ''), ''), NULLIF(ap.auth_code, ''), '')`;
const PERMIT_OP = `CASE WHEN t.hipdata_code = 'UCS' THEN ${ucsAuthen("v.vn")} WHEN t.hipdata_code = 'OFC' THEN COALESCE(NULLIF(SUBSTRING_INDEX(sq.edc_approve_list_text, ',', -1), ''), '') WHEN t.hipdata_code = 'STP' THEN COALESCE(NULLIF(ap.auth_code, ''), '') ELSE COALESCE(v.pttypeno, '') END`;
// ipt.vn (a.vn) = visit ที่ admit
const PERMIT_IP = `CASE WHEN t.hipdata_code = 'UCS' THEN ${ucsAuthen("a.vn")} WHEN t.hipdata_code IN ('OFC', 'LGO') THEN COALESCE(NULLIF(ap.claim_code, ''), NULLIF(ap.auth_code, ''), '') WHEN t.hipdata_code = 'STP' THEN COALESCE(NULLIF(ap.auth_code, ''), '') ELSE COALESCE(v.pttypeno, '') END`;
const INS_JOIN_OP = "INNER JOIN patient pt ON pt.hn = v.hn LEFT JOIN pttype t ON t.pttype = v.pttype LEFT JOIN patient_pttype pp ON pp.hn = v.hn AND pp.pttype = v.pttype LEFT JOIN visit_pttype ap ON ap.vn = v.vn AND ap.pttype = v.pttype LEFT JOIN ovst_seq sq ON sq.vn = v.vn";
const INS_JOIN_IP = "INNER JOIN patient pt ON pt.hn = v.hn LEFT JOIN pttype t ON t.pttype = v.pttype LEFT JOIN patient_pttype pp ON pp.hn = v.hn AND pp.pttype = v.pttype LEFT JOIN ipt_pttype ap ON ap.an = v.an AND ap.pttype = v.pttype";
const PAT = `${HCODE} AS \`HCODE\`, pt.hn AS \`HN\`, LPAD(COALESCE(pt.chwpart, '00'), 2, '0') AS \`CHANGWAT\`, LPAD(COALESCE(pt.amppart, '00'), 2, '0') AS \`AMPHUR\`, DATE_FORMAT(pt.birthday, '%Y-%m-%d') AS \`DOB\`, COALESCE(pt.sex, '1') AS \`SEX\`, COALESCE(pt.marrystatus, '9') AS \`MARRIAGE\`, LPAD(COALESCE(pt.occupation, '000'), 3, '0') AS \`OCCUPA\`, LPAD(COALESCE(pt.nationality, '099'), 3, '0') AS \`NATION\`, pt.cid AS \`PERSON_ID\`, CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS \`NAMEPAT\`, COALESCE(pt.pname, '') AS \`TITLE\`, COALESCE(pt.fname, '') AS \`FNAME\`, COALESCE(pt.lname, '') AS \`LNAME\`, CASE WHEN LENGTH(pt.cid) = 13 THEN '1' ELSE '2' END AS \`IDTYPE\``;
// CLINIC/DEPT = รหัสแผนก สปสช. (spclty.nhso_code) ; แฟ้มที่ใช้ CLINIC ต้อง join SP_V (หรือ spclty sp ของตัวเอง)
const CLINIC = "CONCAT('0', LPAD(COALESCE(sp.nhso_code, '01'), 2, '0'), '00')";
const SP_V = "LEFT JOIN spclty sp ON sp.spclty = v.spclty";
const ITEM_CLINIC = "CONCAT(CASE WHEN op.an IS NOT NULL AND op.an <> '' THEN '1' ELSE '0' END, LPAD(COALESCE(sp.nhso_code, '01'), 2, '0'), '00')";
// ยา = หมวดค่ารักษา 3/4 (income.drg_chrgitem_id) ไม่ใช่รหัส income ; DRU + ADP ครอบทุกรายการของ visit/AN ไม่ซ้อนกัน
const DRUG_INC = "INNER JOIN income inc ON inc.income = op.income AND inc.drg_chrgitem_id IN (3, 4)";
const NOT_DRUG = "COALESCE(inc.drg_chrgitem_id, 0) NOT IN (3, 4)";
// ADP.TYPE ตามหมวดค่ารักษา ไม่เข้าหมวดใช้ nhso_adp_type_id ; checks.ts ใช้สูตรเดียวกัน (fdh.test.mjs ตรวจ)
const ADP_TYPE = "COALESCE(CASE inc.drg_chrgitem_id WHEN 1 THEN 10 WHEN 5 THEN 11 WHEN 13 THEN 12 WHEN 6 THEN 14 WHEN 7 THEN 15 WHEN 8 THEN 16 WHEN 12 THEN 17 WHEN 10 THEN 18 WHEN 11 THEN 19 WHEN 14 THEN 20 END, nd.nhso_adp_type_id, 3)";
const TOTCOPAY = "ROUND(CASE WHEN op.paidst = '03' THEN op.sum_price ELSE 0 END, 2) AS `TOTCOPAY`";
const CHA = `op.hn AS \`HN\`, COALESCE(op.an, '') AS \`AN\`, DATE_FORMAT(COALESCE(op.rxdate, op.vstdate), '%Y-%m-%d') AS \`DATE\`, LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0') AS \`CHRGITEM\`, ROUND(SUM(op.sum_price), 2) AS \`AMOUNT\`, pt.cid AS \`PERSON_ID\`, COALESCE(op.vn, '') AS \`SEQ\``;
const CHA_GROUP = "GROUP BY op.hn, op.an, op.vn, COALESCE(op.rxdate, op.vstdate), LPAD(COALESCE(inc.drg_chrgitem_id, inc.std_group, op.income), 2, '0'), pt.cid\nHAVING ROUND(SUM(op.sum_price), 2) > 0";
const AER = `v.hn AS \`HN\`, COALESCE(v.an, '') AS \`AN\`, DATE_FORMAT(er.vstdate, '%Y-%m-%d') AS \`DATEOPD\`, COALESCE(NULLIF(ac.claim_code, ''), '') AS \`AUTHAE\`, DATE_FORMAT(COALESCE(ed.accident_datetime, er.vstdate), '%Y-%m-%d') AS \`AEDATE\`, DATE_FORMAT(COALESCE(ed.accident_datetime, v.vsttime), '%H%i') AS \`AETIME\`, COALESCE(ac.ac_type, '') AS \`AETYPE\`, COALESCE(rin.referin_number, rin.docno, '') AS \`REFER_NO\`, COALESCE(rin.refer_hospcode, rin.hospcode, '') AS \`REFMAINI\`, CASE WHEN rin.vn IS NOT NULL THEN '1100' ELSE '' END AS \`IREFTYPE\`, COALESCE(rout.refer_hospcode, '') AS \`REFMAINO\`, CASE WHEN rout.vn IS NOT NULL THEN '1100' ELSE '' END AS \`OREFTYPE\`, COALESCE(NULLIF(ac.ac_ae, ''), NULLIF(ept.ucae, 'N'), '') AS \`UCAE\`, '' AS \`EMTYPE\`, er.vn AS \`SEQ\`, '' AS \`AESTATUS\`, '' AS \`DALERT\`, '' AS \`TALERT\``;
const AER_JOIN = "LEFT JOIN er_nursing_detail ed ON ed.vn = er.vn LEFT JOIN referin rin ON rin.vn = er.vn LEFT JOIN referout rout ON rout.vn = er.vn LEFT JOIN er_pt_type ept ON ept.er_pt_type = er.er_pt_type LEFT JOIN ipt_accident ac ON ac.an = v.an";
// TMLTCODE เติมในโค้ดด้วย applyLabTmlt จาก icode (alias ไม่มี backtick จึงไม่อยู่ใน fileColumns และถูกลบก่อนส่งออก)
const ADP = `op.hn AS \`HN\`, COALESCE(op.an, '') AS \`AN\`, DATE_FORMAT(COALESCE(op.rxdate, op.vstdate), '%Y-%m-%d') AS \`DATEOPD\`, ${ADP_TYPE} AS \`TYPE\`, COALESCE(nd.nhso_adp_code, nd.billcode, op.icode) AS \`CODE\`, ROUND(op.qty, 2) AS \`QTY\`, ROUND(op.unitprice, 2) AS \`RATE\`, COALESCE(op.vn, '') AS \`SEQ\`, '' AS \`CAGCODE\`, '' AS \`DOSE\`, '' AS \`CA_TYPE\`, '' AS \`SERIALNO\`, ${TOTCOPAY}, '' AS \`USE_STATUS\`, ROUND(op.sum_price, 2) AS \`TOTAL\`, '' AS \`QTYDAY\`, '' AS \`TMLTCODE\`, '' AS \`STATUS1\`, '' AS \`BI\`, ${ITEM_CLINIC} AS \`CLINIC\`, '1' AS \`ITEMSRC\`, COALESCE(doc.licenseno, op.staff, '') AS \`PROVIDER\`, '' AS \`GRAVIDA\`, '' AS \`GA_WEEK\`, '' AS \`DCIP/E_screen\`, '' AS \`LMP\`, '' AS \`SP_ITEM\`, op.icode AS icode`;
const ADP_JOIN = "INNER JOIN nondrugitems nd ON nd.icode = op.icode LEFT JOIN ovst v ON v.vn = op.vn LEFT JOIN doctor doc ON doc.code = op.doctor LEFT JOIN income inc ON inc.income = op.income LEFT JOIN ipt ia ON ia.an = op.an LEFT JOIN spclty sp ON sp.spclty = COALESCE(v.spclty, ia.spclty)";
// remark = DRUGREMARK: OP = เหตุผลใช้ยานอกบัญชี EA–EF (ต้องอยู่บรรทัดเดียว opDruCheckSql ตัดที่ "\nSELECT "/"\nFROM ")
const dru = (remark: string) => `${HCODE} AS \`HCODE\`, op.hn AS \`HN\`, COALESCE(op.an, '') AS \`AN\`, ${ITEM_CLINIC} AS \`CLINIC\`, pt.cid AS \`PERSON_ID\`, DATE_FORMAT(COALESCE(op.rxdate, op.vstdate), '%Y-%m-%d') AS \`DATE_SERV\`, op.icode AS \`DID\`, d.name AS \`DIDNAME\`, ROUND(op.qty, 0) AS \`AMOUNT\`, ROUND(op.unitprice, 2) AS \`DRUGPRICE\`, ROUND(COALESCE(d.unitcost, 0), 2) AS \`DRUGCOST\`, COALESCE(d.did, '') AS \`DIDSTD\`, d.units AS \`UNIT\`, COALESCE(d.packqty, '1') AS \`UNIT_PACK\`, COALESCE(op.vn, '') AS \`SEQ\`, ${remark} AS \`DRUGREMARK\`, '' AS \`PA_NO\`, ${TOTCOPAY}, CASE WHEN op.item_type = 'H' OR op.income = '04' THEN '2' ELSE '1' END AS \`USE_STATUS\`, ROUND(op.sum_price, 2) AS \`TOTAL\`, COALESCE(du.shortlist, op.drugusage, '') AS \`SIGCODE\`, TRIM(CONCAT(COALESCE(du.name1, ''), ' ', COALESCE(du.name2, ''), ' ', COALESCE(du.name3, ''))) AS \`SIGTEXT\`, COALESCE(doc.licenseno, op.staff, '') AS \`PROVIDER\`, '' AS \`SP_ITEM\``;
const OP_REMARK = "(SELECT MIN(CASE WHEN UPPER(pn.presc_reason) REGEXP '^E[A-F]$' THEN UPPER(pn.presc_reason) END) FROM ovst_presc_ned pn WHERE pn.vn = op.vn AND pn.icode = op.icode)";
const DRU_JOIN = `${DRUG_INC} INNER JOIN drugitems d ON d.icode = op.icode INNER JOIN patient pt ON pt.hn = op.hn LEFT JOIN ovst v ON v.vn = op.vn LEFT JOIN ipt i ON i.an = op.an LEFT JOIN drugusage du ON du.drugusage = op.drugusage LEFT JOIN doctor doc ON doc.code = op.doctor LEFT JOIN spclty sp ON sp.spclty = COALESCE(i.spclty, v.spclty)`;
const LABFU = `${HCODE} AS \`HCODE\`, lh.hn AS \`HN\`, pt.cid AS \`PERSON_ID\`, DATE_FORMAT(lh.order_date, '%Y-%m-%d') AS \`DATESERV\`, COALESCE(lh.vn, '') AS \`SEQ\`, li.labtest AS \`LABTEST\`, ROUND(lo.lab_order_result + 0, 2) AS \`LABRESULT\`, COALESCE(i.an, '') AS \`AN\``;
const LABFU_JOIN = "INNER JOIN lab_order lo ON lo.lab_order_number = lh.lab_order_number INNER JOIN lab_items li ON li.lab_items_code = lo.lab_items_code INNER JOIN patient pt ON pt.hn = lh.hn LEFT JOIN ipt i ON i.vn = lh.vn";
// LABFU = ผลแล็บตัวเลขของผู้ป่วยคลินิกโรคเรื้อรัง ; regex ใช้ {0,1} แทน ? (mysql2 แทน ? ทุกตัวเป็น param)
const LABFU_OP_WHERE = "li.labtest <> '' AND lo.lab_order_result REGEXP '^[0-9]+([.][0-9]+){0,1}$' AND lo.lab_order_result + 0 > 0 AND i.an IS NULL AND EXISTS (SELECT 1 FROM clinic c JOIN clinic_visit cv ON cv.clinic = c.clinic AND cv.vn = lh.vn)";
const PHDB = `op.hn AS \`HN\`, COALESCE(nd.moph_price_item_code, nd.nhso_adp_code, nd.billcode, op.icode) AS \`CODE\`, ROUND(op.qty, 0) AS \`QTY\`, ROUND(op.sum_price, 2) AS \`PRICE\`, COALESCE(op.an, '') AS \`AN\`, COALESCE(op.vn, '') AS \`SEQ\`, COALESCE(t.hipdata_code, t.pcode, 'UCS') AS \`INSCL\``;
const PHDB_JOIN = "INNER JOIN nondrugitems nd ON nd.icode = op.icode LEFT JOIN ovst v ON v.vn = op.vn LEFT JOIN ipt i ON i.an = op.an LEFT JOIN pttype t ON t.pttype = COALESCE(v.pttype, i.pttype) LEFT JOIN income inc ON inc.income = op.income";
const OP_RANGE = "FROM p JOIN opitemrece op FORCE INDEX (ix_vstdate) ON op.vstdate BETWEEN p.s AND p.e";
const OP_ONLY = "op.vn IS NOT NULL AND (op.an IS NULL OR op.an = '')";
const IP_ITEMS = `${AI} JOIN opitemrece op FORCE INDEX (ix_an) ON op.an = a.an`;
const NOT_OPD = "v.an IS NULL OR v.an = ''"; // แฟ้ม OP ตัด visit ที่ admit

const OP_SQL = {
  INS: q(ins(PERMIT_OP), `FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e ${INS_JOIN_OP}\nWHERE ${NOT_OPD}\nORDER BY v.vstdate, v.vn, pp.patient_pttype_id`),
  PAT: q(PAT, "FROM patient pt WHERE pt.hn IN (SELECT v.hn FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e)\nORDER BY pt.hn"),
  // DETAIL: '\\r' '\\n' ใน JS = '\r' '\n' ใน SQL (MySQL แปลงเป็น CR/LF เอง) ; UUC = '1' ตายตัว (มาตรฐานมีแค่ 1/2 ; ovstost 03/04 ไม่เกี่ยวการใช้สิทธิ)
  OPD: q(
    `v.hn AS \`HN\`, ${CLINIC} AS \`CLINIC\`, DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS \`DATEOPD\`, DATE_FORMAT(v.vsttime, '%H%i') AS \`TIMEOPD\`, v.vn AS \`SEQ\`, '1' AS \`UUC\`, SUBSTRING(REPLACE(REPLACE(COALESCE(s.cc, ''), '\\r', ' '), '\\n', ' '), 1, 255) AS \`DETAIL\`, ROUND(s.temperature, 1) AS \`BTEMP\`, ROUND(s.bps) AS \`SBP\`, ROUND(s.bpd) AS \`DBP\`, ROUND(s.pulse) AS \`PR\`, ROUND(s.rr) AS \`RR\`, '' AS \`OPTYPE\`, CASE WHEN rf_in.vn IS NOT NULL THEN '3' WHEN oa.hn IS NOT NULL THEN '2' ELSE '1' END AS \`TYPEIN\`, COALESCE(NULLIF(ost.export_code, '1'), CASE WHEN i.an IS NOT NULL THEN '2' WHEN rf_out.vn IS NOT NULL THEN '3' END, '1') AS \`TYPEOUT\``,
    `FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e LEFT JOIN opdscreen s ON s.vn = v.vn LEFT JOIN ipt i ON i.vn = v.vn LEFT JOIN referin rf_in ON rf_in.vn = v.vn LEFT JOIN referout rf_out ON rf_out.vn = v.vn LEFT JOIN oapp oa ON oa.hn = v.hn AND oa.nextdate = v.vstdate LEFT JOIN ovstost ost ON ost.ovstost = v.ovstost ${SP_V}\nORDER BY v.vstdate, v.vn, rf_out.referout_id, oa.oapp_id`,
  ),
  ORF: q(
    `ro.hn AS \`HN\`, DATE_FORMAT(ro.refer_date, '%Y-%m-%d') AS \`DATEOPD\`, ${CLINIC} AS \`CLINIC\`, COALESCE(ro.refer_hospcode, ro.hospcode) AS \`REFER\`, '2' AS \`REFERTYPE\`, ro.vn AS \`SEQ\`, DATE_FORMAT(ro.refer_date, '%Y-%m-%d') AS \`REFERDATE\``,
    `FROM p JOIN referout ro ON ro.refer_date BETWEEN p.s AND p.e INNER JOIN ovst v ON v.vn = ro.vn ${SP_V}\nWHERE ${NOT_OPD}\nORDER BY ro.refer_date, ro.vn, ro.referout_id`,
  ),
  ODX: q(
    `od.hn AS \`HN\`, DATE_FORMAT(od.vstdate, '%Y-%m-%d') AS \`DATEDX\`, ${CLINIC} AS \`CLINIC\`, REPLACE(od.icd10, '.', '') AS \`DIAG\`, COALESCE(od.diagtype, '1') AS \`DXTYPE\`, COALESCE(doc.licenseno, od.doctor, '') AS \`DRDX\`, pt.cid AS \`PERSON_ID\`, od.vn AS \`SEQ\``,
    `FROM p JOIN ovstdiag od ON od.vstdate BETWEEN p.s AND p.e INNER JOIN ovst v ON v.vn = od.vn INNER JOIN patient pt ON pt.hn = od.hn LEFT JOIN doctor doc ON doc.code = od.doctor ${SP_V}\nORDER BY od.vstdate, od.vn, od.ovst_diag_id`,
  ),
  OOP: q(
    `v.hn AS \`HN\`, DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS \`DATEOPD\`, ${CLINIC} AS \`CLINIC\`, REPLACE(dop.icd9, '.', '') AS \`OPER\`, COALESCE(doc.licenseno, dop.doctor, '') AS \`DROPID\`, pt.cid AS \`PERSON_ID\`, v.vn AS \`SEQ\`, ROUND(COALESCE(dop.price, 0), 2) AS \`SERVPRICE\``,
    `FROM p JOIN ovst v ON v.vstdate BETWEEN p.s AND p.e INNER JOIN doctor_operation dop ON dop.vn = v.vn INNER JOIN patient pt ON pt.hn = v.hn LEFT JOIN doctor doc ON doc.code = dop.doctor ${SP_V}\nORDER BY v.vstdate, v.vn, dop.doctor_operation_id`,
  ),
  // CHT: ยอดจากรายการ opitemrece ของ visit (= ผลรวม CHA) หนึ่งแถวต่อ visit ; ใบเสร็จใบแรกตาม finance_number
  CHT: q(
    "vs.hn AS `HN`, '' AS `AN`, DATE_FORMAT(vs.vstdate, '%Y-%m-%d') AS `DATE`, ROUND(COALESCE(x.t, 0), 2) AS `TOTAL`, ROUND(COALESCE(x.pd, 0), 2) AS `PAID`, vs.pttype AS `PTTYPE`, pt.cid AS `PERSON_ID`, vs.vn AS `SEQ`, '' AS `OPD_MEMO`, COALESCE((SELECT rp.bill_number FROM rcpt_print rp WHERE rp.vn = vs.vn ORDER BY rp.finance_number LIMIT 1), '') AS `INVOICE_NO`, COALESCE((SELECT rp.book_number FROM rcpt_print rp WHERE rp.vn = vs.vn ORDER BY rp.finance_number LIMIT 1), '') AS `INVOICE_LT`",
    `FROM p JOIN vn_stat vs ON vs.vstdate BETWEEN p.s AND p.e INNER JOIN patient pt ON pt.hn = vs.hn INNER JOIN ovst v ON v.vn = vs.vn LEFT JOIN (SELECT op.vn, SUM(op.sum_price) AS t, SUM(CASE WHEN op.paidst IN ('01', '03') THEN op.sum_price ELSE 0 END) AS pd FROM p JOIN opitemrece op FORCE INDEX (ix_vstdate) ON op.vstdate BETWEEN p.s AND p.e WHERE ${OP_ONLY} GROUP BY op.vn) x ON x.vn = vs.vn\nWHERE ${NOT_OPD}\nORDER BY vs.vstdate, vs.vn`,
  ),
  CHA: q(CHA, `${OP_RANGE} INNER JOIN patient pt ON pt.hn = op.hn LEFT JOIN income inc ON inc.income = op.income\nWHERE ${OP_ONLY}\n${CHA_GROUP}\nORDER BY \`DATE\`, \`SEQ\`, \`HN\`, \`AN\`, \`CHRGITEM\``),
  AER: q(AER, `FROM p JOIN er_regist er ON er.vstdate BETWEEN p.s AND p.e INNER JOIN ovst v ON v.vn = er.vn ${AER_JOIN}\nWHERE ${NOT_OPD}\nORDER BY er.vstdate, er.vn, rout.referout_id`),
  ADP: q(ADP, `${OP_RANGE} ${ADP_JOIN}\nWHERE ${OP_ONLY} AND ${NOT_DRUG}\nORDER BY op.vstdate, op.vn, op.hos_guid`),
  DRU: q(dru(OP_REMARK), `${OP_RANGE} ${DRU_JOIN}\nWHERE ${OP_ONLY}\nORDER BY op.vstdate, op.vn, op.hos_guid`),
  LABFU: q(LABFU, `FROM p JOIN lab_head lh ON lh.order_date BETWEEN p.s AND p.e ${LABFU_JOIN}\nWHERE ${LABFU_OP_WHERE}\nORDER BY lh.order_date, lh.lab_order_number, lo.lab_items_code`),
  PHDB: q(PHDB, `${OP_RANGE} ${PHDB_JOIN}\nWHERE ${OP_ONLY} AND ${NOT_DRUG}\nORDER BY op.vstdate, op.vn, op.hos_guid`),
} satisfies Record<OpFile, string>;

// IP: ทุกแฟ้มยึด admission ที่จำหน่ายในช่วง (AI) ; ADM_W แปลงกรัมเป็นกิโลกรัม
// ipAnExportSql แทนแค่ a.dchdate BETWEEN ตัวแรก (p เป็นวันนี้) จึงห้ามมี subquery อื่นที่อ้าง p ; CHT ใช้ correlated subquery แทน
// LABFU ผู้ป่วยในส่งว่าง (WHERE 1 = 0) คงคอลัมน์ไว้ให้แฟ้มมี header
const IP_SQL = {
  INS: q(ins(PERMIT_IP), `${AI} INNER JOIN ovst v ON v.an = a.an ${INS_JOIN_IP}\nORDER BY a.dchdate, a.an, v.vn, pp.patient_pttype_id`),
  PAT: q(PAT, "FROM patient pt WHERE pt.hn IN (SELECT a.hn FROM p JOIN ipt a ON a.dchdate BETWEEN p.s AND p.e)\nORDER BY pt.hn"),
  IPD: q(
    "i.hn AS `HN`, i.an AS `AN`, DATE_FORMAT(i.regdate, '%Y-%m-%d') AS `DATEADM`, DATE_FORMAT(i.regtime, '%H%i') AS `TIMEADM`, DATE_FORMAT(i.dchdate, '%Y-%m-%d') AS `DATEDSC`, DATE_FORMAT(i.dchtime, '%H%i') AS `TIMEDSC`, s.nhso_dchstts AS `DISCHS`, t.nhso_dchtype AS `DISCHT`, COALESCE(w.ward_export_code, w.sss_code, w.ward, '01') AS `WARDDSC`, LPAD(COALESCE(sp.nhso_code, '01'), 2, '0') AS `DEPT`, ROUND(COALESCE(i.bw, 0) / 1000, 3) AS `ADM_W`, '1' AS `UUC`, CASE WHEN tt.is_ambulatory = 'Y' THEN 'A' ELSE 'I' END AS `SVCTYPE`",
    "FROM p JOIN ipt i ON i.dchdate BETWEEN p.s AND p.e LEFT JOIN ward w ON w.ward = i.ward LEFT JOIN ipt_type tt ON tt.ipt_type = i.ipt_type LEFT JOIN dchstts s ON s.dchstts = i.dchstts LEFT JOIN dchtype t ON t.dchtype = i.dchtype LEFT JOIN spclty sp ON sp.spclty = i.spclty\nORDER BY i.dchdate, i.an",
  ),
  // HOSxP เก็บ referout ของผู้ป่วยในด้วย vn = AN
  IRF: q(
    "a.an AS `AN`, COALESCE(ro.refer_hospcode, ro.hospcode) AS `REFER`, '2' AS `REFERTYPE`",
    `${AI} INNER JOIN referout ro ON ro.vn = a.an\nORDER BY a.dchdate, a.an, ro.referout_id`,
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
    "ans.hn AS `HN`, ans.an AS `AN`, DATE_FORMAT(ans.dchdate, '%Y-%m-%d') AS `DATE`, ROUND(COALESCE((SELECT SUM(op.sum_price) FROM opitemrece op FORCE INDEX (ix_an) WHERE op.an = ans.an), 0), 2) AS `TOTAL`, ROUND(COALESCE((SELECT SUM(CASE WHEN op.paidst IN ('01', '03') THEN op.sum_price ELSE 0 END) FROM opitemrece op FORCE INDEX (ix_an) WHERE op.an = ans.an), 0), 2) AS `PAID`, ans.pttype AS `PTTYPE`, pt.cid AS `PERSON_ID`, '' AS `SEQ`, '' AS `OPD_MEMO`, COALESCE((SELECT rp.bill_number FROM rcpt_print rp WHERE rp.vn = ans.vn ORDER BY rp.finance_number LIMIT 1), '') AS `INVOICE_NO`, COALESCE((SELECT rp.book_number FROM rcpt_print rp WHERE rp.vn = ans.vn ORDER BY rp.finance_number LIMIT 1), '') AS `INVOICE_LT`",
    `${AI} INNER JOIN an_stat ans ON ans.an = a.an INNER JOIN patient pt ON pt.hn = ans.hn\nORDER BY a.dchdate, a.an`,
  ),
  CHA: q(CHA, `${IP_ITEMS} INNER JOIN patient pt ON pt.hn = op.hn LEFT JOIN income inc ON inc.income = op.income\n${CHA_GROUP}\nORDER BY \`AN\`, \`DATE\`, \`SEQ\`, \`CHRGITEM\`, \`HN\``),
  AER: q(AER, `${AI} INNER JOIN ovst v ON v.an = a.an INNER JOIN er_regist er ON er.vn = v.vn ${AER_JOIN}\nORDER BY a.dchdate, a.an, er.vn, rout.referout_id`),
  ADP: q(ADP, `${IP_ITEMS} ${ADP_JOIN}\nWHERE ${NOT_DRUG}\nORDER BY a.dchdate, a.an, op.vstdate, op.hos_guid`),
  LVD: q(
    "hl.ipt_home_leave_id AS `SEQLVD`, hl.an AS `AN`, DATE_FORMAT(hl.dch_date, '%Y-%m-%d') AS `DATEOUT`, DATE_FORMAT(hl.dch_time, '%H%i') AS `TIMEOUT`, DATE_FORMAT(hl.reg_date, '%Y-%m-%d') AS `DATEIN`, DATE_FORMAT(hl.reg_time, '%H%i') AS `TIMEIN`, DATEDIFF(hl.reg_date, hl.dch_date) AS `QTYDAY`",
    `${AI} INNER JOIN ipt_home_leave hl ON hl.an = a.an\nORDER BY a.dchdate, a.an, hl.ipt_home_leave_id`,
  ),
  DRU: q(dru("''"), `${IP_ITEMS} ${DRU_JOIN}\nORDER BY a.dchdate, a.an, op.vstdate, op.hos_guid`),
  LABFU: q(LABFU, `${AI} INNER JOIN lab_head lh ON lh.vn = a.vn ${LABFU_JOIN}\nWHERE 1 = 0\nORDER BY a.dchdate, a.an, lh.lab_order_number, lo.lab_items_code`),
  PHDB: q(PHDB, `${IP_ITEMS} ${PHDB_JOIN}\nWHERE ${NOT_DRUG}\nORDER BY a.dchdate, a.an, op.vstdate, op.hos_guid`),
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
 * ดึง icode (= DID ของแฟ้ม = HOSPDRUGCODE ของ Drug Catalog) ; price/date_serv ใช้สูตรเดียวกับ DRUGPRICE/DATE_SERV
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

// TMLT ของรายการแล็บ (แฟ้ม ADP): Lab Catalog FDH (insight) ก่อน แล้ว lab_items ของ HOSxP ; ทั้งสองไม่มี params (ผ่าน prove-query แล้ว)
export const LAB_TMLT_HIS_SQL = "SELECT DISTINCT icode, TRIM(tmlt_code) AS tmlt_code FROM lab_items WHERE active_status = 'Y' AND icode IS NOT NULL AND icode <> '' AND TRIM(tmlt_code) <> ''";
export const LAB_TMLT_INSIGHT_SQL = "SELECT DISTINCT btrim(lab_code) AS lab_code, btrim(tmlt_code) AS tmlt_code FROM lab_catalog_fdh WHERE btrim(tmlt_code) <> '' AND (end_at IS NULL OR end_at >= localtimestamp)";

/** catalog ค่าเดียว → ใช้ ; catalog หลายค่า → ใช้ของ lab_items เมื่อเป็นหนึ่งในนั้น ; ไม่อยู่ใน catalog → lab_items ค่าเดียว ; ไม่งั้นว่าง (ไม่เดา) */
export function pickTmlt(cat?: string[], his?: string[]) {
  const h = his?.length === 1 ? his[0] : "";
  if (!cat?.length) return h;
  if (cat.length === 1) return cat[0];
  return cat.includes(h) ? h : "";
}

const byCode = (pairs: [string, string][]) => {
  const m = new Map<string, string[]>();
  for (const [k, v] of pairs) m.set(k, [...(m.get(k) ?? []), v]);
  return m;
};

/** ตั้ง TMLTCODE ของแถว ADP ตาม icode แล้วลบคอลัมน์ช่วย icode (แก้แถวเดิม) */
export function applyLabTmlt(rows: FileRow[], cat: { lab_code: string; tmlt_code: string }[], his: { icode: string; tmlt_code: string }[]) {
  const c = byCode(cat.map((r) => [r.lab_code, r.tmlt_code])), h = byCode(his.map((r) => [r.icode, r.tmlt_code]));
  for (const r of rows) {
    const icode = String(r.icode ?? "");
    delete r.icode;
    r.TMLTCODE = pickTmlt(c.get(icode), h.get(icode));
  }
  return rows;
}

/** /api/fdh/files/summary */
export type FilesSummary = { type: FdhType; files: { file: string; rows: number }[] };
/** /api/fdh/files (json) */
export type FilePage = { rows: FileRow[]; total: number; columns: string[] };
