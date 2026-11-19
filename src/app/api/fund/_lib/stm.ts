import "server-only";

// เงินเข้า STM ต่อ VN/AN ของรายการใน $1 (text[] ห้ามว่าง): paid ติดลบได้ (= เรียกคืน), paid_at = วันโอนล่าสุด
// STM UC ยุคแรกไม่มี seq_no จึงจับผ่าน rep_row ด้วย tran_id ; ใช้ทั้ง /fund/claim-pipeline และสถานะเคลมของ opd/ipd admissions
export const STM_PAID_SQL = {
  op: `SELECT key, sum(paid) AS paid, max(paid_at)::text AS paid_at FROM (
  SELECT r.seq_no AS key, sum(r.paid_total) AS paid, max(f.transfer_date) AS paid_at
  FROM stm_row r JOIN stm_file f ON f.id = r.stm_file_id
  WHERE f.patient_type = 'OP' AND r.seq_no = ANY($1::text[]) GROUP BY r.seq_no
  UNION ALL
  SELECT rr.seq_no, sum(r.paid_total), max(f.transfer_date)
  FROM stm_row r JOIN stm_file f ON f.id = r.stm_file_id JOIN rep_row rr ON rr.tran_id = r.tran_id
  WHERE f.patient_type = 'OP' AND NULLIF(r.seq_no, '') IS NULL AND rr.seq_no = ANY($1::text[]) GROUP BY rr.seq_no
) u GROUP BY key`,
  ip: `SELECT r.an AS key, sum(r.paid_total) AS paid, max(f.transfer_date)::text AS paid_at
FROM stm_row r JOIN stm_file f ON f.id = r.stm_file_id
WHERE f.patient_type = 'IP' AND r.an = ANY($1::text[]) GROUP BY r.an`,
};
