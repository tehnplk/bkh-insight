-- Lab Catalog จาก FDH (/catalog/standard-codes แท็บ Lab catalog FDH): รายการ Lab ของหน่วยบริการต่อสิทธิประโยชน์ (OFC/SSS/STP/UCS)
-- เก็บเฉพาะไฟล์ล่าสุด (นำเข้าใหม่ = แทนที่ทั้งชุด) ประวัติไฟล์อยู่ใน catalog_file
ALTER TABLE catalog_file DROP CONSTRAINT catalog_file_kind_check;
ALTER TABLE catalog_file ADD CONSTRAINT catalog_file_kind_check
  CHECK (kind IN ('drug_nhso', 'drug_chi', 'lab_chi', 'service_uc', 'service_ofc', 'claim_stp', 'lab_fdh'));

-- หนึ่งแถวต่อแถวในไฟล์ ; (benefit_plan, lab_code) ซ้ำได้ (Lab Code เดียวมีหลายรหัสกรมบัญชีกลาง) key จึงเป็น (file_id, line_no)
-- cgd_code NULL = ไฟล์ไม่มีรหัสกรมบัญชีกลาง ; end_at 9999-12-31 23:59 = ไม่มีวันสิ้นสุด
CREATE TABLE lab_catalog_fdh (
  id bigserial PRIMARY KEY,
  file_id bigint NOT NULL REFERENCES catalog_file (id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  benefit_plan text NOT NULL,
  cgd_code text,
  name text NOT NULL,
  unit text,
  price numeric(12, 2),
  gyear smallint,
  start_at timestamp,
  end_at timestamp,
  flag text,
  tmlt_code text,
  tmlt_name text,
  lab_code text NOT NULL,
  loinc text,
  exception text,
  UNIQUE (file_id, line_no)
);
CREATE INDEX lab_catalog_fdh_lab_code_idx ON lab_catalog_fdh (lab_code);
CREATE INDEX lab_catalog_fdh_tmlt_code_idx ON lab_catalog_fdh (tmlt_code);
