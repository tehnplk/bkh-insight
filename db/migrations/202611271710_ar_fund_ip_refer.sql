-- แยกค่าพาหนะส่งต่อของ UC IP (.202) เป็นลูกหนี้ CR 1102050101.217 (ar-sync ลงเป็นหนี้ ref "<an>:CR", IP_CR_SPLIT ใน ar-sync/ledger.ts)
--   ผู้ใช้เลือก 27 พ.ย. 2569: แยกเฉพาะค่าพาหนะ (รหัสเบิก S1801/S1802) ตามที่ สปสช. จ่ายจริงใน STM (กองทุน AE) ; เลนส์/INST และรถพยาบาลระดับสูง (3002121) คงอยู่ .202
--   account_op ว่าง = ใช้เฉพาะผู้ป่วยใน (ruleSide) จึงไม่กระทบการแยก CR ของ OP (.216) ; กติกา INST คง account_ip .217 ไว้แสดงกองทุนย่อย แต่ ar-sync ไม่ใช้แยก IP
--   icodes = nondrugitems ที่ nhso_adp_code ขึ้นต้น S18 ณ 27 พ.ย. 2569 (ADP type 3 กว้างเกิน: มีค่าฝากศพ ยาฝังคุมกำเนิด ฯลฯ)
--   รายการค่าพาหนะใหม่ใน HOSxP ให้เพิ่ม icode ที่ /admin/ar-funds แล้วกด "ดูผลก่อนปรับ" / "ยืนยันปรับสมุดลูกหนี้" ที่ /admin/ar-accounts
INSERT INTO ar_fund_rule (code, name, hipdata_codes, icodes, rep_keys, account_op, account_ip, match_mode, updated_by) VALUES (
  'CARREF', 'ค่าพาหนะส่งต่อ (CR)', '{UCS}',
  '{3001205,3001222,3001548,3001550,3002350,3002351,3002352,3002353,3002354,3002355,3002356,3002547,3003046,3003047,3003048,3003050,3003056,3003059,3003060,3003061}',
  '{"อุบัติเหตุฉุกเฉิน (AE) / CAREF","อุบัติเหตุฉุกเฉิน (AE) / CAREF-PUC"}',
  NULL, '1102050101.217', 'items', 'migration')
ON CONFLICT (code) DO NOTHING;
