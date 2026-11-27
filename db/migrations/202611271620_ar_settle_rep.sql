-- ตัดลูกหนี้ อปท. (LGO) รายตัวด้วย REP ที่ /fund/ar-settle: อปท. ไม่มี STM ; SMT (budgetSource LGO) โอนทีละ REP
--   แถวที่ลงใช้ source 'stm' เดิม (= ตัดรายตัวด้วยเอกสารของผู้จ่าย STM หรือ REP) ทุกที่ที่นับยอดคงเหลือ/สมุดรายวัน/ปีงบก่อนจึงใช้ได้ทันที
--   อ้างบรรทัด REP ด้วย rep_tran_id (rep_row.tran_id) แทน stm_row_id ; กันลงซ้ำด้วย unique (rep_tran_id, ref, kind)
--   REP อุทธรณ์ที่ส่ง tran_id เดิม (rep_row upsert) ถือว่าตัดแล้ว ไม่ตัดซ้ำ ; FK กัน rep_row ที่ตัดแล้วถูกลบ
ALTER TABLE ar_ledger ADD COLUMN rep_tran_id varchar(12) REFERENCES rep_row (tran_id);
ALTER TABLE ar_ledger ADD CONSTRAINT ar_ledger_rep_tran_source_check CHECK (rep_tran_id IS NULL OR (source = 'stm' AND stm_row_id IS NULL));
CREATE UNIQUE INDEX ar_ledger_rep_once_uq ON ar_ledger (rep_tran_id, ref, kind) WHERE rep_tran_id IS NOT NULL;

-- ชุดตัดหนี้: หนึ่งไฟล์ STM หรือหนึ่งเลขที่ REP (scheme ของ REP อยู่ในคอลัมน์ rep_scheme)
ALTER TABLE ar_settle_batch ALTER COLUMN stm_file_id DROP NOT NULL;
ALTER TABLE ar_settle_batch ADD COLUMN rep_no varchar(12), ADD COLUMN rep_scheme text;
ALTER TABLE ar_settle_batch ADD CONSTRAINT ar_settle_batch_doc_check
  CHECK ((stm_file_id IS NULL) <> (rep_no IS NULL) AND (rep_no IS NULL) = (rep_scheme IS NULL));
CREATE INDEX ar_settle_batch_rep_idx ON ar_settle_batch (rep_no, id DESC) WHERE rep_no IS NOT NULL;

-- ลูกหนี้ อปท. ตัดรายตัวที่หน้าตัดลูกหนี้ (settles_by_stm = ตัดรายตัวด้วย STM/REP): บันทึกรับเงินเองที่สมุดลูกหนี้ไม่ได้ (กันตัดซ้ำ)
--   และเงินโอน SMT ที่อาจนำเข้าบัญชีนี้ภายหลังไม่ลงสมุดรายวันซ้ำ ; .803/.804 (อปท.รูปแบบพิเศษ) ยังไม่อยู่ในขอบเขต
UPDATE ar_account SET settles_by_stm = true WHERE code IN ('1102050102.801', '1102050102.802') AND NOT settles_by_stm;
