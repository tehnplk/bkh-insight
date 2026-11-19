-- หน่วยบริการใน CUP ที่ admin ปรับเอง (/admin/cup) สำหรับ /fund/claim-type
-- ค่าเริ่มต้นอ่านจาก his (hospcode อำเภอเดียวกับ opdconfig.hospitalcode) ไม่เก็บที่นี่ ; CUP จริง = ค่าเริ่มต้น ∪ include − exclude
CREATE TABLE cup_hospcode (
  hcode text PRIMARY KEY CHECK (hcode ~ '^[0-9]{5}$'),
  mode text NOT NULL CHECK (mode IN ('include', 'exclude')),
  note text CHECK (length(note) <= 200),
  updated_by text NOT NULL,                    -- ชื่อใน session (super user ไม่มี user_id)
  updated_at timestamptz NOT NULL DEFAULT now()
);
