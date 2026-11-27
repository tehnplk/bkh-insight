-- เงิน SMT "จัดสรรล่วงหน้า 69(ระหว่างยกเลิก Rerun68)" (โอน 29 ต.ค. 2568, mouGrpCode 69010201, SMT แนะนำ mophId 2103010103.101)
--   GL ของการเงินลง Cr 3102010102.201 (PRIOR_YEAR_ACCOUNT) แต่ mapping ของกองทุน UC|2103010103.101|010201 จับคู่ไว้ที่ลูกหนี้ UC-IP .202
--   ซึ่ง settles_by_stm (เงินโอนไม่ลงสมุดรายวัน) เงินก้อนนี้จึงหายจากสมุดรายวัน/งบทดลอง
--   fund_key นี้แยกจาก IP CAP ปกติ (UC|1102050101.202|010201) มีแค่แถวนี้กับอุทธรณ์ 6809_IP_03 ของงบปีก่อน (ลง .201 อยู่แล้ว)
--   จึงแก้ทั้ง mapping และแถวที่ยังไม่ถูกแก้มือ ; รันซ้ำได้ (เงื่อนไข account_code เดิม)
UPDATE ar_transfer_fund_map SET account_code = '3102010102.201', updated_by = 'migration', updated_at = now()
WHERE fund_key = 'UC|2103010103.101|010201' AND side = 'ALL' AND account_code = '1102050101.202';

UPDATE ar_transfer SET account_code = '3102010102.201'
WHERE fund_key = 'UC|2103010103.101|010201' AND account_code = '1102050101.202' AND updated_by IS NULL AND cancelled_at IS NULL;
