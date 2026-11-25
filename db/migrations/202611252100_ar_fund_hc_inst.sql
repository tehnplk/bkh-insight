-- ช่วง 4a: แยก HC + INST ออกจากลูกหนี้ UC OP ใน CUP (.201) ไป .216 แบบโปรแกรม Claim (ar-sync ลงเป็นหนี้ ref "<debt_id>:CR")
--   adp_types: ADP type (nondrugitems.nhso_adp_type_id) ที่นับเป็นรายการของกติกา แปลงเป็น icode ตอนคำนวณ (รายการใหม่ใน HOSxP เข้าเอง)
--   exclude_icodes: icode ที่ไม่นับแม้ตรงหมวดรายรับ/icode/ADP type
ALTER TABLE ar_fund_rule
  ADD COLUMN adp_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN exclude_icodes text[] NOT NULL DEFAULT '{}';

-- HC = Clopidogrel 1460542, Streptokinase 1580002 (ต.ค. 2569 ตรงโปรแกรม Claim 68 visit 16,510.25 บาท) ผู้ป่วยนอกเท่านั้น
UPDATE ar_fund_rule SET icodes = '{1460542,1580002}', account_op = '1102050101.216', account_ip = NULL,
  updated_by = 'migration', updated_at = now()
WHERE code = 'HC';

-- INST = ADP type 2 (อุปกรณ์) ไม่นับรายการที่ Claim ไม่ใช่ UC (ec_nhsolink nhsotype 2 ucs_chk 0): ครอบฟัน/สะพานฟัน/เดือยฟัน (ADP 9211–9214),
--   CTR (2111), ถุงทวารเทียม D65 (XXXX2) และค่าส่วนเกินอวัยวะเทียม 3003333 (ไม่มี ADP type)
UPDATE ar_fund_rule SET incomes = '{}', adp_types = '{2}',
  exclude_icodes = '{3001197,3001985,3002053,3002229,3002406,3003045,3003379,3003333}',
  updated_by = 'migration', updated_at = now()
WHERE code = 'INST';
