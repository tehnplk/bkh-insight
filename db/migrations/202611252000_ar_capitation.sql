-- ตัดหนี้เหมาจ่ายสิ้นเดือน (/fund/ar-capitation): หนี้ .201 (UC OP ใน CUP) และ .209 (P&P) ตัดกับเงินโอนเหมาจ่ายที่ได้รับ (ar_transfer)
--   ตัดได้ไม่เกินยอดสะสมของปีงบ (รับโอนเข้า clear_code ถึงสิ้นเดือน − ที่ตัดไปแล้วในปีงบ) ส่วนที่ไม่พอลงส่วนต่าง clear_short_code ทันที
--   สมุดรายวัน: settle Dr clear_code (รายได้เหมาจ่าย) / Cr ลูกหนี้ ; diff Dr clear_short_code / Cr ลูกหนี้

-- clear_short_code = บัญชีส่วนต่างเมื่อเงินเหมาจ่ายไม่พอตัด (Dr) ; ตัดเฉพาะบัญชีที่มี clear_code
ALTER TABLE ar_account ADD COLUMN clear_short_code text CHECK (clear_short_code ~ '^\d{10}\.(\d{3}|\d{5})$');
UPDATE ar_account SET clear_code = '4301020105.217' WHERE code = '1102050101.209';
-- ส่วนต่างค่ารักษาที่สูงกว่าเหมาจ่ายรายหัว: .229 กองทุน UC OP, .257 P&P
UPDATE ar_account SET clear_short_code = '4301020105.229' WHERE code = '1102050101.201';
UPDATE ar_account SET clear_short_code = '4301020105.257' WHERE code = '1102050101.209';

-- หนึ่งชุดต่อการกดยืนยัน (เดือน, บัญชีลูกหนี้) กดซ้ำได้เฉพาะหนี้ที่ยังคงเหลือ ; clear_code/clear_short_code ณ ตอนตัด ใช้ทำสมุดรายวันและ pool
CREATE TABLE ar_capitation_batch (
  id bigserial PRIMARY KEY,
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  account_code text NOT NULL REFERENCES ar_account (code),
  clear_code text NOT NULL,
  clear_short_code text NOT NULL,
  pool_before numeric(14,2) NOT NULL,
  pool_after numeric(14,2) NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}',   -- { n, settle_n, diff_n, settle_amount, diff_amount, shifted }
  created_by text NOT NULL,
  created_user_id bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ar_capitation_batch_pool_idx ON ar_capitation_batch (clear_code, month);

-- source 'capitation' = ตัดด้วยเงินเหมาจ่าย ref = ref ของหนี้ ; ไม่ใช่ source ของหนี้ ar-sync จึงไม่นับในการเทียบยอดกับ HOSxP (เหมือน stm/manual/fwf)
ALTER TABLE ar_ledger DROP CONSTRAINT ar_ledger_source_check;
ALTER TABLE ar_ledger ADD CONSTRAINT ar_ledger_source_check CHECK (source IN ('rcpt_debt', 'ipt', 'stm', 'manual', 'fwf', 'capitation'));
ALTER TABLE ar_ledger ADD COLUMN capitation_batch_id bigint REFERENCES ar_capitation_batch;
ALTER TABLE ar_ledger ADD CONSTRAINT ar_ledger_capitation_batch_source_check CHECK ((source = 'capitation') = (capitation_batch_id IS NOT NULL));
CREATE UNIQUE INDEX ar_ledger_capitation_once_uq ON ar_ledger (capitation_batch_id, patient_type, ref, kind) WHERE capitation_batch_id IS NOT NULL;
