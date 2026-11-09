-- REP ของ e-Claim สปสช. ที่นำเข้าจาก /fund/rep-import (ไม่เก็บชื่อผู้ป่วย)

CREATE TABLE rep_file (
  id bigserial PRIMARY KEY,
  file_name text NOT NULL UNIQUE,
  file_sha256 text NOT NULL UNIQUE,
  hcode varchar(10),
  rep_type text NOT NULL,              -- IP, OP, OP_APPEAL_CD, OP_APPEAL_NHSO, ...
  file_date date,                      -- จากชื่อไฟล์ (พ.ศ. แปลงเป็น ค.ศ.)
  printed_at timestamp,                -- "ออกรายงานวันที่" ในไฟล์
  row_count int NOT NULL,              -- แถวใน Detail + Detail(ST) (TRAN_ID ไม่ซ้ำ)
  imported_by text,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- ชีต Summary / Summary(ST) หนึ่งแถวต่อ REP
CREATE TABLE rep_summary (
  rep_file_id bigint NOT NULL REFERENCES rep_file ON DELETE CASCADE,
  rep_no varchar(12) NOT NULL,
  sheet text NOT NULL,
  period text,
  total_cases int,
  passed int,
  failed int,
  amounts jsonb,                       -- { "ข้อมูลปกติ / HC / เรียกเก็บ": n, ... } ทุกช่องตัวเลข ยกเว้นสองคอลัมน์ด้านล่าง
  paid_affiliation numeric(14,2),      -- จ่ายชดเชยต้นสังกัด
  paid_total numeric(14,2),            -- จ่ายชดเชยทั้งสิ้น
  PRIMARY KEY (rep_file_id, rep_no, sheet)
);

-- ชีต Detail / Detail(ST) หนึ่งแถวต่อ TRAN_ID ส่งใหม่ได้ TRAN_ID ใหม่ (ใหญ่กว่า) จึงเก็บทุกครั้ง
-- ล่าสุดของ visit = max(tran_id) ต่อ seq_no (OP, = HOSxP ovst.vn) หรือต่อ an (IP)
CREATE TABLE rep_row (
  tran_id varchar(12) PRIMARY KEY,
  rep_no varchar(12) NOT NULL,
  rep_file_id bigint NOT NULL REFERENCES rep_file,   -- ไฟล์ล่าสุดที่นำเข้าแถวนี้
  sheet text NOT NULL,
  patient_type varchar(2),
  hn varchar(15),
  an varchar(12),
  pid varchar(13),
  seq_no varchar(15),
  admit_at timestamp,
  discharge_at timestamp,
  net_nhso numeric(12,2),              -- ชดเชยสุทธิ สปสช.
  net_affiliation numeric(12,2),       -- ชดเชยสุทธิ ต้นสังกัด
  claim_total numeric(12,2),           -- เรียกเก็บ (1.3)
  central_reimburse numeric(12,2),
  self_pay numeric(12,2),
  paid numeric(12,2),                  -- จ่ายชดเชย (9)
  error_codes text[] NOT NULL DEFAULT '{}',
  main_fund text[],
  sub_fund text[],
  main_inscl varchar(6),
  sub_inscl varchar(6),
  hmain varchar(10),
  proj text,
  drg varchar(10),
  rw numeric(10,4),
  adjrw numeric(10,4),
  fund_amounts jsonb,                  -- ชดเชยรายกองทุน { "หัวตาราง 3 ชั้น": n } เฉพาะค่าที่ไม่ใช่ 0
  deny jsonb,                          -- กลุ่ม Deny เฉพาะช่องที่มีค่า
  remark text,
  pay_mode text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rep_row_an_idx ON rep_row (an);
CREATE INDEX rep_row_seq_no_idx ON rep_row (seq_no);
CREATE INDEX rep_row_hn_admit_idx ON rep_row (hn, admit_at);
CREATE INDEX rep_row_rep_no_idx ON rep_row (rep_no);
CREATE INDEX rep_row_rep_file_idx ON rep_row (rep_file_id);
