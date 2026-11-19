-- ยืนยันว่าชุดส่งออก (claim_batch) อัปโหลดขึ้น FDH/e-Claim แล้ว และยกเลิกชุดที่ส่งออกผิด/ไม่ได้อัปโหลด (หน้า /fdh/claim-batch)
-- ยืนยันแล้ว = สถานะเคลม "ส่งแล้ว" ; ยังไม่ยืนยัน = "ส่งออกแล้ว รอยืนยัน" ; ยกเลิกแล้วไม่นับเป็นหลักฐาน
ALTER TABLE claim_batch
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN confirmed_by text,                          -- ชื่อใน session (super user ไม่มี user_id)
  ADD COLUMN confirmed_user_id bigint REFERENCES users (id),
  ADD COLUMN submitted_on date,                          -- วันที่เจ้าหน้าที่บอกว่าอัปโหลด (ค่าเริ่มต้น = วันที่ยืนยัน)
  ADD COLUMN note text,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by text;
