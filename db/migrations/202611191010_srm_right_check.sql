-- ผลตรวจสิทธิกับ สปสช. (SRM right-search) ล่าสุดต่อ HN จากปุ่ม "ตรวจสอบสิทธิ(SRM)" ของ /opd/admissions
-- ผลที่ตรวจไม่เกิน 24 ชั่วโมงใช้แทนการยิง สปสช. ซ้ำ (โควตาใช้ร่วมทั้งโรงพยาบาล) และแสดงในตารางหลังโหลดหน้าใหม่
-- เก็บเฉพาะผลจาก สปสช. ไม่เก็บเลขบัตร ชื่อ หรือ response ดิบ (PDPA) ; ผลเทียบกับ HOSxP คำนวณใหม่ทุกครั้งจึงไม่เก็บ
CREATE TABLE srm_right_check (
  hn text PRIMARY KEY CHECK (char_length(hn) BETWEEN 1 AND 20),
  found boolean NOT NULL,  -- false = สปสช. ไม่พบสิทธิ (คอลัมน์สิทธิ/หน่วยบริการเป็น NULL)
  main_inscl text,         -- mainInscl.id เช่น UCS, OFC, WEL
  main_inscl_name text,
  sub_inscl_name text,
  hosp_main text,
  hosp_main_name text,
  hosp_sub text,
  hosp_sub_name text,
  start_date date,
  expire_date date,        -- NULL = ไม่มีวันหมดอายุ (สปสช. ส่งปี 9999)
  checked_by text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
