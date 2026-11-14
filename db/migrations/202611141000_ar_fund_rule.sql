-- กติกาแยกกองทุนย่อยจากรายการค่าใช้จ่ายของ HOSxP (แบบ smart-statement) ใช้ที่ /admin/ar-funds
-- visit เข้ากองทุนเมื่อมีรายการลูกหนี้สิทธิ (opitemrece.paidst = '02') ที่หมวดรายรับอยู่ใน incomes หรือรหัสอยู่ใน icodes
-- และ (ถ้ากำหนด icd10) มีวินิจฉัยขึ้นต้นด้วยรหัสในรายการ ยอดตั้งเบิก = ราคารวมของรายการที่เข้าเกณฑ์
-- rep_keys = คอลัมน์ใน rep_row.fund_amounts ที่ใช้เทียบ ; account_op/ip = บัญชีที่จะแยกลงเมื่อเปิดใช้แยกบัญชี (ยังไม่ใช้ใน ar-sync)
CREATE TABLE ar_fund_rule (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{0,15}$'),
  name text NOT NULL CHECK (name <> ''),
  hipdata_codes text[] NOT NULL DEFAULT '{UCS}',
  incomes text[] NOT NULL DEFAULT '{}',
  icodes text[] NOT NULL DEFAULT '{}',
  icd10 text[] NOT NULL DEFAULT '{}',
  rep_keys text[] NOT NULL DEFAULT '{}',
  account_op text REFERENCES ar_account,
  account_ip text REFERENCES ar_account,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- INST = หมวดรายรับ 02 (ค่าอวัยวะเทียม) ; PP เริ่มจากหมวด 21 ซึ่งกว้างกว่าที่ REP จ่าย (ส.ค. 2569: 503 ราย vs REP 150 ราย) ต้องระบุรหัสรายการเพิ่ม
-- HC/AE ยังไม่มีเงื่อนไข (ให้งานเคลมกำหนด) ; บัญชีใส่เฉพาะที่ยืนยันจากผังบัญชี (CR .216/.217, P&P .209)
INSERT INTO ar_fund_rule (code, name, incomes, rep_keys, account_op, account_ip, updated_by) VALUES
  ('INST', 'อวัยวะเทียม/อุปกรณ์บำบัดรักษา (INST)', '{02}', '{"อวัยวะเทียม/อุปกรณ์บำบัดรักษา (INST) / OPINST"}', '1102050101.216', '1102050101.217', 'migration'),
  ('PP', 'ส่งเสริมป้องกัน (PP fee schedule)', '{21}', '{"โรคเฉพาะ (DMIS) / PP"}', '1102050101.209', NULL, 'migration'),
  ('HC', 'ค่าใช้จ่ายสูง (HC)', '{}', '{"ค่าใช้จ่ายสูง (HC) / OPHC"}', NULL, NULL, 'migration'),
  ('AE', 'อุบัติเหตุฉุกเฉิน (AE)', '{}', '{"อุบัติเหตุฉุกเฉิน (AE) / OPAE (1.1*4*5)"}', NULL, NULL, 'migration');
