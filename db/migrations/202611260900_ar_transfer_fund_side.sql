-- จับคู่บัญชีของกองทุน SMT แยก OP/IP (/fund/ar-transfer)
--   SMT บางกองทุนมีทั้งรายการ OP และ IP ใน mophId/mouGrpCode เดียวกัน (เช่น บริการกรณีเฉพาะ "1102050101.216/222")
--   แต่ลงคนละบัญชี ; ฝั่งของแถวมาจาก refDocNo "YYMM_OP_NN" / "YYMM_IP_NN" (งวด REP/STM) ที่เหลือไม่ระบุฝั่ง
-- side: 'ALL' = ทั้งกองทุน (แถวเดิมทั้งหมด ทำงานเหมือนเดิม) ; 'OP'/'IP' = ใช้กับแถวฝั่งนั้นแทน ALL
--   แถว OP/IP ที่ account_code NULL และ ignore = false = ยังไม่แยก ใช้ตาม ALL
ALTER TABLE ar_transfer_fund_map ADD COLUMN side text NOT NULL DEFAULT 'ALL' CHECK (side IN ('ALL', 'OP', 'IP'));
ALTER TABLE ar_transfer_fund_map DROP CONSTRAINT ar_transfer_fund_map_pkey;
ALTER TABLE ar_transfer_fund_map ADD PRIMARY KEY (fund_key, side);
