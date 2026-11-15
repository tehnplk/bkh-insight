-- ดึงใหม่รายราย (POST /api/fund/ar-sync/case): หนึ่งแถวต่อการกดหนึ่งราย บันทึกผู้กดใน requested_by และแถวที่ลงลิงก์ด้วย sync_id
--   case_ref = 'OP:<vn>' หรือ 'IP:<an>' ; หน้าที่แสดง "ดึงยอดล่าสุด" ต้องกรอง mode <> 'case'
ALTER TABLE ar_sync_log DROP CONSTRAINT ar_sync_log_mode_check;
ALTER TABLE ar_sync_log ADD CONSTRAINT ar_sync_log_mode_check CHECK (mode IN ('daily', 'backfill', 'case'));
ALTER TABLE ar_sync_log ADD COLUMN case_ref text,
  ADD CONSTRAINT ar_sync_log_case_ref_check CHECK ((mode = 'case') = (case_ref IS NOT NULL));
