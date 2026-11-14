-- 1) บัญชีรายได้คู่และบัญชีส่วนต่าง (ใช้ทำสมุดรายวัน /fund/ar-ledger) และบัญชีที่ตัดหนี้ด้วย STM ได้ แก้ที่ /admin/ar-accounts
--    ค่าเริ่มต้นตามผังบัญชี 2569 (ดู .claude/skills/uc-ar-subaccounts) บัญชีอื่นให้งานบัญชีกำหนด
--    diff_under_code = ได้รับต่ำกว่าลูกหนี้ (Dr) ; diff_over_code = ได้รับสูงกว่าลูกหนี้ (Cr)
--    settles_by_stm: ตัดเฉพาะบัญชีที่ สปสช./กรมบัญชีกลางจ่ายรายครั้ง ไม่ตัด .201 (เหมาจ่ายรายหัว) และ .203/.204 (เรียกเก็บจากหน่วยบริการอื่น)
ALTER TABLE ar_account
  ADD COLUMN revenue_code text CHECK (revenue_code ~ '^\d{10}\.(\d{3}|\d{5})$'),
  ADD COLUMN diff_under_code text CHECK (diff_under_code ~ '^\d{10}\.(\d{3}|\d{5})$'),
  ADD COLUMN diff_over_code text CHECK (diff_over_code ~ '^\d{10}\.(\d{3}|\d{5})$'),
  ADD COLUMN settles_by_stm boolean NOT NULL DEFAULT false;

UPDATE ar_account a SET revenue_code = v.rev, diff_under_code = v.under, diff_over_code = v.over, settles_by_stm = v.stm
FROM (VALUES
  ('1102050101.201', '4301020105.201', NULL, NULL, false),
  ('1102050101.202', '4301020105.202', '4301020105.231', '4301020105.232', true),
  ('1102050101.203', '4301020105.203', '4301020105.239', '4301020105.240', false),
  ('1102050101.204', '4301020105.205', '4301020105.239', '4301020105.240', false),
  ('1102050102.201', '4301020105.207', NULL, NULL, false),
  ('1102050101.209', '4301020105.241', NULL, NULL, true),
  ('1102050101.216', '4301020105.244', '4301020105.258', '4301020105.260', true),
  ('1102050101.217', '4301020105.245', '4301020105.251', '4301020105.252', true),
  ('1102050101.222', '4301020105.263', NULL, NULL, true),
  ('1102050101.401', NULL, NULL, NULL, true),
  ('1102050101.402', NULL, NULL, NULL, true)
) AS v(code, rev, under, over, stm)
WHERE a.code = v.code;

-- 2) ตัดหนี้ด้วย STM: source 'stm' ref = ref ของหนี้ (OP = debt_id, IP = an ตาม patient_type) ไม่นับในการเทียบยอดของ ar-sync
--    settle = ยอดที่ STM จ่าย (ติดลบ) ; diff = ส่วนต่างที่ปิดหนี้ให้เหลือ 0 (ลบ = ได้รับต่ำกว่า, บวก = ได้รับสูงกว่า)
--    manual = ปรับปรุงที่งานบัญชีขอและผู้ดูแลอนุมัติ (kind adjust) ref = ref ของหนี้เช่นกัน
ALTER TABLE ar_ledger DROP CONSTRAINT ar_ledger_kind_check;
ALTER TABLE ar_ledger ADD CONSTRAINT ar_ledger_kind_check CHECK (kind IN ('set', 'adjust', 'cancel', 'reverse', 'settle', 'diff'));
-- STM หนึ่งแถวตัดแต่ละหนี้ได้ครั้งเดียว (กดซ้ำไม่ลงซ้ำ)
CREATE UNIQUE INDEX ar_ledger_stm_once_uq ON ar_ledger (stm_row_id, ref, kind) WHERE stm_row_id IS NOT NULL;
CREATE INDEX ar_ledger_debt_idx ON ar_ledger (patient_type, ref);

-- 3) คำขอปรับปรุงลูกหนี้ด้วยมือ: ผู้ใช้ขอ ผู้ดูแลอีกคนอนุมัติ (อนุมัติของตัวเองไม่ได้) อนุมัติแล้วลง ar_ledger (source manual)
CREATE TABLE ar_adjust_request (
  id bigserial PRIMARY KEY,
  patient_type text NOT NULL CHECK (patient_type IN ('OP', 'IP')),
  ref text NOT NULL,                       -- OP = debt_id, IP = an
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  reason text NOT NULL CHECK (reason <> ''),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  ledger_id bigint REFERENCES ar_ledger
);
CREATE INDEX ar_adjust_request_status_idx ON ar_adjust_request (status, requested_at DESC);

-- 4) บันทึกการเข้าถึง (PDPA): ทุก request ไป /api/* ที่มี session บันทึกโดย src/proxy.ts
CREATE TABLE access_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_name text,
  user_id text,
  role text,
  method text NOT NULL,
  path text NOT NULL,
  query text                               -- query string ทั้งหมด (อาจมีคำค้น เช่น HN) ตารางนี้จึงเป็นข้อมูลอ่อนไหว ดูได้เฉพาะ admin
);
CREATE INDEX access_log_at_idx ON access_log (at DESC);
CREATE INDEX access_log_user_idx ON access_log (user_name, at DESC);
