-- ปุ่ม "ยืนยันใช้สิทธิ์ HIS" ใน modal ผลตรวจสิทธิของ /opd/admissions: เจ้าหน้าที่ยืนยันว่าสิทธิใน HOSxP ถูกต้องแม้ไม่ตรงกับ สปสช.
-- เก็บสิทธิ/HCODE ของ HOSxP ตอนยืนยัน (confirmed_fund/confirmed_hospmain) การยืนยันแสดงเฉพาะเมื่อสิทธิของ visit ใน HOSxP ยังเท่าค่านี้
-- ตรวจสิทธิใหม่ (upsert ของ cache.ts) ไม่ล้างคอลัมน์เหล่านี้
ALTER TABLE srm_right_check
  ADD COLUMN confirmed_by text,
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN confirmed_fund text,
  ADD COLUMN confirmed_hospmain text;
