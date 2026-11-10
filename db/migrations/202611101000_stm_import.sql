-- Statement การโอนเงิน (STM) ของ สปสช. (UC) และกรมบัญชีกลาง (OFC) นำเข้าจาก /fund/stm-import (ไม่เก็บชื่อผู้ป่วย)
-- ใช้ตัดลูกหนี้ใน ar_ledger (source 'stm', kind 'settle') ในขั้นถัดไป: UC จับคู่ rep_row ด้วย tran_id, OFC ด้วย (rep_no, seq_no) หรือ (rep_no, an)

CREATE TABLE stm_file (
  id bigserial PRIMARY KEY,
  file_name text NOT NULL,
  file_sha256 text NOT NULL UNIQUE,
  doc_no text NOT NULL UNIQUE,                 -- "เลขที่เอกสาร" ในไฟล์ เช่น 11252_OPUCS256812_01, 11252_OP202512_01 (ชื่อไฟล์ดาวน์โหลดซ้ำมี " (1)" จึงไม่ใช้ชื่อไฟล์กันซ้ำ)
  hcode varchar(10) NOT NULL,
  scheme text NOT NULL,                        -- UCS, OFC
  layout text NOT NULL CHECK (layout IN ('uc', 'csmbs')),
  patient_type varchar(2) NOT NULL CHECK (patient_type IN ('OP', 'IP')),
  period_month date NOT NULL,                  -- งวด: วันที่ 1 ของเดือน ค.ศ. (UC เลขที่เอกสารเป็น พ.ศ.)
  run_no int NOT NULL,                         -- ครั้งที่ของงวด (_01, _02)
  printed_at timestamp,                        -- "ออกรายงานวันที่"
  transfer_date date NOT NULL,                 -- วันที่โอนเงิน ผู้นำเข้ากรอก (ไม่มีในไฟล์)
  paid_total numeric(14,2) NOT NULL,           -- จ่ายชดเชย (UC รายงานพึงรับ, OFC จ่ายชดเชยทั้งสิ้น)
  deduction numeric(14,2) NOT NULL DEFAULT 0,  -- ยอดหักเงินเดือน (ระดับไฟล์)
  net_total numeric(14,2) NOT NULL,            -- ยอดโอนสุทธิ = paid_total - deduction
  row_count int NOT NULL,
  imported_by text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CHECK (net_total = paid_total - deduction)
);
CREATE INDEX stm_file_period_idx ON stm_file (period_month, scheme, patient_type);

-- ชีตรายงานสรุป / สรุป(พึงรับ) หนึ่งแถวต่อ REP ต่อส่วน
CREATE TABLE stm_summary (
  stm_file_id bigint NOT NULL REFERENCES stm_file ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN ('normal', 'appeal', 'd1_normal', 'd1_appeal')),
  rep_no varchar(12) NOT NULL,
  period_label text,                           -- "งวด" เช่น 6812_OP_01 (OFC เป็น "-")
  cases int,                                   -- OFC เท่านั้น
  passed int,
  failed int,                                  -- OFC เท่านั้น
  claim_total numeric(14,2),
  amounts jsonb NOT NULL DEFAULT '{}',         -- ยอดรายกองทุน/หมวด key เดียวกับ stm_row.fund_amounts
  paid_total numeric(14,2) NOT NULL,
  source text,                                 -- แหล่งข้อมูล (UC)
  PRIMARY KEY (stm_file_id, section, rep_no)
);

-- ชีตรายละเอียด / พึงรับ หนึ่งแถวต่อรายการ tran_id ไม่ใช่ PK เพราะรายการเดิมอาจจ่ายเพิ่ม/เรียกคืนในงวดหลัง
CREATE TABLE stm_row (
  id bigserial PRIMARY KEY,
  stm_file_id bigint NOT NULL REFERENCES stm_file ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN ('normal', 'appeal', 'd1_normal', 'd1_appeal')),
  rep_no varchar(12) NOT NULL,
  line_no int NOT NULL,                        -- ลำดับที่
  tran_id varchar(12),                         -- UC เท่านั้น = rep_row.tran_id
  hn varchar(15),
  an varchar(12),
  pid varchar(13),
  seq_no varchar(15),                          -- OP = HOSxP ovst.vn (ไฟล์ UC ยุคแรกว่าง)
  admit_at timestamp,
  discharge_at timestamp,
  main_inscl varchar(6),                       -- UC เท่านั้น (มี OFC/LGO ปนบ้าง)
  proj text,
  source text,                                 -- FDH / EC2 / NHSO (UC)
  adjrw numeric(10,4),
  claim_total numeric(12,2),                   -- เรียกเก็บ
  paid_total numeric(12,2) NOT NULL,           -- ยอดชดเชยทั้งสิ้น (UC) / พึงรับทั้งหมด (OFC)
  fund_amounts jsonb NOT NULL DEFAULT '{}',    -- { "OP": n, "HC": n, ... } เฉพาะค่าที่ไม่ใช่ 0 (_CALC = ยอดคำนวณได้ ไม่นับในยอดรวม)
  UNIQUE (stm_file_id, section, rep_no, line_no)
);
CREATE INDEX stm_row_tran_id_idx ON stm_row (tran_id);
CREATE INDEX stm_row_seq_no_idx ON stm_row (seq_no);
CREATE INDEX stm_row_an_idx ON stm_row (an);
CREATE INDEX stm_row_rep_no_idx ON stm_row (rep_no);

-- แถวตัดหนี้ของสมุดลูกหนี้อ้างรายการ STM ที่ใช้ตัด: FK กันลบไฟล์ STM ที่ตัดหนี้ไปแล้ว (cascade ลง stm_row แล้วชน FK นี้)
ALTER TABLE ar_ledger ADD COLUMN stm_row_id bigint REFERENCES stm_row;
ALTER TABLE ar_ledger ADD CONSTRAINT ar_ledger_stm_row_source_check CHECK (stm_row_id IS NULL OR source = 'stm');
CREATE INDEX ar_ledger_stm_row_idx ON ar_ledger (stm_row_id) WHERE stm_row_id IS NOT NULL;
