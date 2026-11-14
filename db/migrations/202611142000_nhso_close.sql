-- ปิดสิทธิผ่าน NHSO ENDPOINT ของ สปสช. จากหน้า /fund/close-privilege (ผลไม่ย้อนเข้า HOSxP)
-- 1) รหัสแพทย์ใน HOSxP (doctor.code) ของผู้ใช้ ใช้หาเลขบัตรผู้บันทึก (recorderPid) ตอนปิดสิทธิ ผู้ดูแลตั้งที่ /admin/users
ALTER TABLE users ADD COLUMN his_doctor_code text CHECK (his_doctor_code ~ '^[0-9A-Za-z]{1,10}$');

-- 2) บันทึกทุกครั้งที่ยิงปิดสิทธิ (สำเร็จหรือไม่) ห้ามเก็บเลขบัตร (pid/recorderPid) หรือ request body
--    zone: test = Test Zone/เครื่องทดสอบ, prod = nhsoapi.nhso.go.th ; /fund/claim-pipeline นับเฉพาะ prod ที่สำเร็จ
CREATE TABLE nhso_close_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vn text NOT NULL CHECK (vn ~ '^\d{12}$'),
  transaction_id text NOT NULL,
  zone text NOT NULL CHECK (zone IN ('test', 'prod')),
  request_at timestamptz NOT NULL,
  response_at timestamptz,
  ok boolean NOT NULL,
  http_status int,
  seq text,
  authen_code text,
  error text,
  requested_by text NOT NULL,
  user_id bigint REFERENCES users (id),
  doctor_code text,
  total_amount numeric(12, 2),
  privilege_amount numeric(12, 2),
  cash_amount numeric(12, 2)
);
-- ปิดสำเร็จได้ครั้งเดียวต่อ visit ต่อ zone (กันปิดซ้ำชั้นสุดท้าย นอกจาก advisory lock ใน route)
CREATE UNIQUE INDEX nhso_close_log_ok_vn ON nhso_close_log (vn, zone) WHERE ok;
CREATE INDEX nhso_close_log_vn ON nhso_close_log (vn);
