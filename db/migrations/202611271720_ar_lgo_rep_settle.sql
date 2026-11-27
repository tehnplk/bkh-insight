-- ตัดลูกหนี้ อปท. รายตัวด้วย REP (/fund/ar-settle แท็บ "REP อปท.") ได้เฉพาะ REP ที่เงินโอน SMT (budgetSource LGO) ของใบนั้นลงรับแล้วและยอดตรง
--   งานประกันยืนยันว่า อปท. ไม่มี STM ; SMT โอนทีละ REP (refDocNo = เลขที่ REP) mophId "1102050102.801/802" ไม่แยก OP/IP
--   การนำเข้าจึงหาฝั่งจาก patient_type ของ REP ใน rep_row แล้วใช้ mapping OP/IP ; REP ที่ยังไม่นำเข้า = ALL (ไม่จับคู่ ไม่นำเข้า จนนำเข้า REP แล้วดึงใหม่)
INSERT INTO ar_transfer_fund_map (fund_key, side, fund_name, smt_account_name, account_code, updated_by) VALUES
  ('LGO|1102050102.801/802|086001', 'ALL', 'กรณีจ่ายตรงหน่วยบริการ', 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรง อปท. OP/IP', NULL, 'migration'),
  ('LGO|1102050102.801/802|086001', 'OP', 'กรณีจ่ายตรงหน่วยบริการ', 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรง อปท. OP/IP', '1102050102.801', 'migration'),
  ('LGO|1102050102.801/802|086001', 'IP', 'กรณีจ่ายตรงหน่วยบริการ', 'ลูกหนี้ค่ารักษา - เบิกจ่ายตรง อปท. OP/IP', '1102050102.802', 'migration')
ON CONFLICT (fund_key, side) DO NOTHING;

-- เงื่อนไขตัดด้วย REP หาเงินโอนของ REP ตาม ref_doc_no (รายการ REP ทำทีละแถว)
CREATE INDEX IF NOT EXISTS ar_transfer_ref_doc_idx ON ar_transfer (ref_doc_no) WHERE source = 'smt';

-- เงินโอน LGO เข้าลูกหนี้ .801/.802 ไม่ลงสมุดรายวัน (ลงตอนตัดรายตัวด้วย REP: Dr เงินฝาก / Cr ลูกหนี้) ; บันทึกรับเงินเองที่ /fund/ar-ledger ปิด กันตัดซ้ำ
UPDATE ar_account SET settles_by_stm = true WHERE code IN ('1102050102.801', '1102050102.802') AND NOT settles_by_stm;
