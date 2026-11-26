-- รายงานพึงจ่าย รพ.สต. (Hsub) ของ สปสช. แนบกับไฟล์ STM UC OP ที่ /fund/stm-import
-- เงินของ รพ.สต. ในเครือข่ายโอนรวมมากับยอดของโรงพยาบาล (HCODE_PAID = โรงพยาบาล) SMT จึงเท่ากับ STM + Hsub ใช้ที่ /fund/smt-reconcile
-- เก็บเฉพาะยอดรวม ไม่มีคอลัมน์รายผู้ป่วย (PDPA: ผู้ป่วยของ รพ.สต.)

CREATE TABLE stm_hsub_file (
  id bigserial PRIMARY KEY,
  stm_file_id bigint NOT NULL,
  file_name text NOT NULL,
  file_sha256 text NOT NULL,
  printed_at timestamp,                        -- "ออกรายงานวันที่" (ไฟล์เป็น ค.ศ.)
  cases int NOT NULL,
  net_total numeric(14,2) NOT NULL,            -- ยอดชดเชยทั้งสิ้นรวมทุก รพ.สต.
  amounts jsonb NOT NULL DEFAULT '{}',         -- ยอดรวมรายกองทุน key เดียวกับ stm_summary.amounts
  imported_by text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  -- หนึ่งไฟล์ Hsub ต่อหนึ่งไฟล์ STM นำเข้าใหม่ = แทนที่ ; ลบ STM = ลบ Hsub ด้วย
  CONSTRAINT stm_hsub_file_stm_file_fk FOREIGN KEY (stm_file_id) REFERENCES stm_file (id) ON DELETE CASCADE,
  CONSTRAINT stm_hsub_file_stm_file_key UNIQUE (stm_file_id),
  CONSTRAINT stm_hsub_file_sha256_key UNIQUE (file_sha256)
);

-- หนึ่งแถวต่อ (ส่วน, รพ.สต., REP) ; REP ซ้ำกับของโรงพยาบาลได้ จึงมี hcode ใน key
CREATE TABLE stm_hsub_summary (
  hsub_file_id bigint NOT NULL,
  section text NOT NULL,
  hcode varchar(5) NOT NULL,
  rep_no varchar(12) NOT NULL,
  cases int NOT NULL,
  amounts jsonb NOT NULL DEFAULT '{}',
  net numeric(14,2) NOT NULL,
  CONSTRAINT stm_hsub_summary_pkey PRIMARY KEY (hsub_file_id, section, hcode, rep_no),
  CONSTRAINT stm_hsub_summary_file_fk FOREIGN KEY (hsub_file_id) REFERENCES stm_hsub_file (id) ON DELETE CASCADE,
  CONSTRAINT stm_hsub_summary_section_check CHECK (section IN ('normal', 'appeal'))
);
