-- พักการตัดลูกหนี้ อปท. ด้วย REP (REP_SETTLE_ENABLED = false ใน ar-settle/settle.ts) รอคำตอบงานประกันว่า อปท. มี STM หรือไม่
--   คืน settles_by_stm ของ .801/.802 ที่ 202611271620 ตั้งไว้ ให้ฟอร์ม "บันทึกรับเงิน" ใน /fund/ar-ledger ใช้ได้เหมือนเดิมระหว่างพัก
--   คอลัมน์ ar_ledger.rep_tran_id และ ar_settle_batch.rep_no/rep_scheme คงไว้ ; รันซ้ำได้
UPDATE ar_account SET settles_by_stm = false WHERE code IN ('1102050102.801', '1102050102.802') AND settles_by_stm;
