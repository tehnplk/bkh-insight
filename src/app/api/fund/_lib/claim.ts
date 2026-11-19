import "server-only";
import { fundSql } from "./fund";

// สถานะการเคลมต่อ visit (prove-query ผ่านแล้ว) ต้องมี alias: o = ovst, c = nhso_confirm_privilege, vp = visit_pttype
// ปิดสิทธิ = ยืนยันกับ สปสช. แล้วไม่ถูกยกเลิก หรือไม่มี confirm แต่ auth_code เป็น EP
// authen = auth_code PP หรือมี claim_code PP ใน nhso_smartcard_agent (auth_code ถูกเขียนทับเป็น EP หลังปิดสิทธิ)
const CLOSED_SQL = `(c.vn IS NOT NULL AND c.nhso_status = 'Y' AND c.nhso_cancel_datetime IS NULL)
        OR (c.vn IS NULL AND vp.auth_code LIKE 'EP%')`;
export const STATUS_SQL = `CASE
      WHEN ${CLOSED_SQL} THEN 'closed'
      WHEN vp.auth_code LIKE 'PP%'
        OR EXISTS (SELECT 1 FROM nhso_smartcard_agent s WHERE s.vn = o.vn AND s.claim_code LIKE 'PP%') THEN 'authen_only'
      ELSE 'none'
    END`;
export const CLAIM_JOINS = `LEFT JOIN nhso_confirm_privilege c ON c.vn = o.vn
  LEFT JOIN visit_pttype vp ON vp.vn = o.vn AND vp.pttype = o.pttype`;
// ยอดต่อ vn จาก opitemrece (MyISAM) รวมใน derived table ที่ใช้ ix_vstdate ก่อน join ovst params: start, end
export const VISIT_AMOUNT_JOIN = `LEFT JOIN (
    SELECT vn, SUM(sum_price) AS amt FROM opitemrece FORCE INDEX (ix_vstdate)
    WHERE vstdate BETWEEN ? AND ? AND vn IS NOT NULL GROUP BY vn
  ) x ON x.vn = o.vn`;

// OFC ผู้ป่วยนอก: ปิดสิทธิ = มี Approval Code EDC ตัวล่าสุด (ตัวท้ายของ ovst_seq.edc_approve_list_text) ไม่ fallback (สูตรเดียวกับ PERMITNO ของ fdh/files/sql.ts)
// ต้องมี alias: t = pttype, sq = ovst_seq
export const IS_OFC_SQL = `${fundSql("t")} = 'OFC'`;
export const APPROVE_CODE_SQL = `NULLIF(SUBSTRING_INDEX(sq.edc_approve_list_text, ',', -1), '')`;
/** ปิดสิทธิแล้ว (1/0) = claim_status 'closed' ของ /opd/admissions ใช้เป็น closed ของสถานะเคลม (loadClaims) */
export const OP_CLOSED_SQL = `IF(${IS_OFC_SQL}, ${APPROVE_CODE_SQL} IS NOT NULL, ${CLOSED_SQL})`;
// ผลส่ง FDH ของ HOSxP สำหรับสถานะเคลม (vn UNIQUE = eq_ref) ชื่อคอลัมน์ตรงกับ FdhStatus ของ claim-batch/claim.ts หลังตัด fdh_
export const FDH_JOIN = "LEFT JOIN fdh_claim_status fcs ON fcs.vn = o.vn";
export const FDH_COLS = "fcs.fdh_reservation_status AS fdh_resv, fcs.fdh_reservation_datetime AS fdh_resv_at, fcs.fdh_claim_status_message AS fdh_msg, fcs.fdh_claim_status_datetime AS fdh_msg_at";
