-- ชุดไฟล์ส่งเคลมที่ส่งออกจาก modal 16 แฟ้ม (FdhPreviewModal) ของ /opd/admissions และ /ipd/admissions
-- ใช้เป็นหลักฐาน "ส่งออกแล้ว" ของคอลัมน์สถานะเคลม (ยังไม่ถึง REP) ; ต่อท้ายอย่างเดียว ไม่เก็บเลขบัตรหรือชื่อผู้ป่วย
CREATE TABLE claim_batch (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel text NOT NULL CHECK (channel IN ('fdh', 'eclaim_txt', 'eclaim_dbf')),
  patient_type text NOT NULL CHECK (patient_type IN ('OP', 'IP')),
  created_by text NOT NULL,                    -- ชื่อใน session (super user ไม่มี user_id)
  user_id bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  item_count int NOT NULL CHECK (item_count > 0),
  total_amount numeric(14,2) NOT NULL,         -- ผลรวม CHT.TOTAL ของทุกราย
  file_sha256 text CHECK (file_sha256 ~ '^[0-9a-f]{64}$')  -- zip ที่ดาวน์โหลด (browser ที่ไม่มี crypto.subtle ส่ง NULL)
);
CREATE INDEX claim_batch_created_idx ON claim_batch (created_at);

-- หนึ่งแถวต่อราย (VN/AN) ในชุด ค่าตามแฟ้มที่ส่งออก
CREATE TABLE claim_batch_item (
  batch_id bigint NOT NULL REFERENCES claim_batch ON DELETE CASCADE,
  patient_type text NOT NULL CHECK (patient_type IN ('OP', 'IP')),
  ref text NOT NULL CHECK (ref ~ '^\d{1,15}$'),  -- OP = vn, IP = an
  hn text,
  service_date date,                           -- OP วันรับบริการ, IP วันจำหน่าย (CHT.DATE)
  scheme text,                                 -- INS.INSCL
  subtype text,                                -- INS.SUBTYPE
  hospmain text,                               -- INS.HOSPMAIN
  cht_total numeric(12,2),                     -- CHT.TOTAL
  pdx text,                                    -- ODX/IDX DXTYPE 1
  PRIMARY KEY (batch_id, ref)
);
-- สถานะเคลมหาชุดล่าสุดต่อ (patient_type, ref)
CREATE INDEX claim_batch_item_ref_idx ON claim_batch_item (patient_type, ref);
