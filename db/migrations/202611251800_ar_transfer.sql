-- เงินโอนที่ได้รับ (/fund/ar-transfer): รายการโอนจาก SMT ของ สปสช. (budgetSource UC) และที่การเงินเพิ่มเอง
--   ใช้เป็นยอดรับจริงของบัญชีรายได้เหมาจ่าย (.214 OP, .217 P&P) ที่รอบตัดหนี้สิ้นเดือน (.201/.209) จะใช้ต่อ
--   สมุดรายวัน/งบทดลอง: Dr เงินฝากธนาคาร / Cr account_code ตาม transfer_date (ไม่นับแถวที่ยกเลิก)
--   ไม่มีข้อมูลผู้ป่วย (SMT เป็นยอดรวมต่อรายการโอน)

-- fund_key = "<budgetSource>|<mophId>|<mouGrpCode ไม่รวมปี 2 หลักแรก>" เช่น "UC|4301020105.214|010101"
--   mophId คือบัญชีที่ SMT แนะนำ (บางแถวว่าง) ; mouGrpCode 6 หลักท้าย = กองทุน/กองทุนย่อย/รายการ คงที่ข้ามปีงบ
--   แถวที่ account_code NULL และ ignore = false คือยังไม่จับคู่ (ดึงจาก SMT แล้วไม่นำเข้า) ; ignore = ไม่ใช้กองทุนนี้
CREATE TABLE ar_transfer_fund_map (
  fund_key text PRIMARY KEY,
  fund_name text,
  smt_account_name text,
  account_code text CHECK (account_code ~ '^\d{10}\.(\d{3}|\d{5})$'),
  ignore boolean NOT NULL DEFAULT false,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (ignore AND account_code IS NOT NULL))
);

INSERT INTO ar_transfer_fund_map (fund_key, fund_name, smt_account_name, account_code, updated_by) VALUES
  ('UC|4301020105.214|010101', 'งบบริการผู้ป่วยนอกจ่ายแบบเหมาจ่ายต่อผู้มีสิทธิ', 'รายได้กองทุน  UC -OP แบบเหมาจ่าย', '4301020105.214', 'migration'),
  ('UC|4301020105.217|160301', 'บริการสร้างเสริมสุขภาพและป้องกันโรคสำหรับบริการพื้นฐาน (P&P BASIC SERVICE)', 'รายได้กองทุน UC - P&P แบบเหมาจ่ายต่อผู้มีสิทธิ', '4301020105.217', 'migration'),
  -- จัดสรรเหมาจ่ายพลางก่อนครั้งแรกของปีงบ 2569 (8 ต.ค. 2568) SMT ไม่ระบุบัญชี
  ('UC||010101', 'งบบริการผู้ป่วยนอกจ่ายแบบเหมาจ่ายต่อผู้มีสิทธิ', NULL, '4301020105.214', 'migration'),
  ('UC||160301', 'บริการสร้างเสริมสุขภาพและป้องกันโรคสำหรับบริการพื้นฐาน (P&P BASIC SERVICE)', NULL, '4301020105.217', 'migration');

-- smt_key = "<budgetSource>|<postingDate>|<batchNo>|<refDocNo>|<mouGrpCode>|<mophId>" (unique ในข้อมูล SMT จริง) นำเข้าซ้ำไม่ซ้ำแถว
-- amount = ยอดที่ใช้ (โอนสุทธิ ติดลบได้เมื่อ SMT หักหนี้ เช่น OP REFER) ; smt_amount = ยอดเดิมจาก SMT (manual = NULL)
-- updated_by ไม่ NULL = การเงินแก้แล้ว นำเข้าใหม่ไม่ทับ amount/account_code/note ; แถวที่ยกเลิกก็ไม่ทับ
CREATE TABLE ar_transfer (
  id bigserial PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('smt', 'manual')),
  smt_key text UNIQUE,
  transfer_date date NOT NULL,
  ref_doc_no text,
  fund_key text,
  fund_name text,
  account_code text NOT NULL CHECK (account_code ~ '^\d{10}\.(\d{3}|\d{5})$'),
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  smt_amount numeric(14,2),
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text,
  cancel_reason text,
  CHECK ((source = 'smt') = (smt_key IS NOT NULL)),
  CHECK ((cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
      OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND btrim(cancel_reason) <> ''))
);
CREATE INDEX ar_transfer_date_idx ON ar_transfer (transfer_date);
