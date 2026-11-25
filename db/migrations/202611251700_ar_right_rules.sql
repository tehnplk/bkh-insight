-- บัญชีลูกหนี้ตามกลุ่มสิทธิ × OP/IP × ที่ตั้งหน่วยบริการประจำ ตามโปรแกรม Claim ของการเงิน (ช่วง 3) แทน ar_account_map
--   pttype -> กลุ่มสิทธิ ตาม ec_ipttype.map_id ของ Claim (isuse = 'Y') ; WEL นับเป็น UC ; P&P เป็นกลุ่มของตัวเอง (.209 ทุกที่)
--   ar_account_map ไม่ใช้แล้ว (เก็บไว้ดูย้อนหลัง) override เดิม 52/99 -> กลุ่ม NRH, 64/74 -> UC ตาม Claim
--   ยังไม่ย้ายบัญชีของแถวเดิม: ผู้ดูแลกด "คำนวณบัญชีใหม่" ที่ /admin/ar-accounts (ต้องทำก่อนปิดงวดใดๆ)

-- main_hcode = หน่วยบริการหลักของสิทธิ ใช้แยกที่ตั้ง (NULL = ไม่แยก) ; books_ar = false ไม่ตั้งลูกหนี้ (สวัสดิการ Claim ลงค่าใช้จ่าย)
CREATE TABLE ar_right (
  code text PRIMARY KEY,
  name text NOT NULL,
  main_hcode text,
  books_ar boolean NOT NULL DEFAULT true
);

CREATE TABLE ar_right_pttype (
  pttype text PRIMARY KEY,
  right_code text NOT NULL REFERENCES ar_right,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- loc: main (hospmain = main_hcode หรือใน CUP เมื่อหน่วยหลักคือโรงพยาบาล), province_moph (จังหวัดเดียวกัน hospital_type_id 5/7),
--   province_other (จังหวัดเดียวกัน ประเภทอื่น), outside (จังหวัดอื่น), unknown (ไม่มี hospmain/ไม่พบใน hospcode), any (ใช้เมื่อไม่มีกติกาของที่ตั้งนั้น)
-- cap = ลูกหนี้ไม่เกิน (บาท) ; debt_pct = ลูกหนี้เป็น % ของค่ารักษา ; ส่วนที่เกินลง ar_ledger kind diff (source เดียวกัน) Dr diff_under_code
CREATE TABLE ar_account_rule (
  right_code text NOT NULL REFERENCES ar_right,
  patient_type text NOT NULL CHECK (patient_type IN ('OP', 'IP')),
  loc text NOT NULL CHECK (loc IN ('any', 'main', 'province_moph', 'province_other', 'outside', 'unknown')),
  account_code text NOT NULL REFERENCES ar_account,
  cap numeric(14,2) CHECK (cap > 0),
  debt_pct numeric(5,2) CHECK (debt_pct > 0 AND debt_pct < 100),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (right_code, patient_type, loc),
  CHECK (cap IS NULL OR debt_pct IS NULL)
);

-- hospcode.hospital_type_id ของหน่วยบริการประจำ (แยก ในจังหวัด สังกัด สธ./นอกสังกัด โดยไม่ต้องอ่าน his ตอนคำนวณบัญชีใหม่)
ALTER TABLE ar_ledger ADD COLUMN hospmain_type text;

INSERT INTO ar_right (code, name, main_hcode, books_ar) VALUES
  ('UCS', 'UC (รวม WEL)', '11252', true),
  ('PP', 'สร้างเสริมสุขภาพและป้องกันโรค (P&P)', NULL, true),
  ('OFC', 'ข้าราชการ กรมบัญชีกลาง', NULL, true),
  ('OFC_CHECKUP', 'ตรวจสุขภาพข้าราชการ', NULL, true),
  ('AGENCY', 'เบิกต้นสังกัด', NULL, true),
  ('LGO', 'อปท.', NULL, true),
  ('BKK', 'อปท.รูปแบบพิเศษ (กทม.)', NULL, true),
  ('BMT', 'เบิกจ่ายตรงหน่วยงานอื่น (BMT)', NULL, true),
  ('SSS', 'ประกันสังคม', '10676', true),
  ('SSI', 'ประกันสังคม กองทุนทดแทน/ทันตกรรม/ตรวจสุขภาพ', NULL, true),
  ('SSS72', 'ประกันสังคม 72 ชั่วโมงแรก', NULL, true),
  ('INS', 'พรบ.รถ', NULL, true),
  ('NRH', 'คนต่างด้าวและแรงงานต่างด้าว', '11252', true),
  ('STP', 'บุคคลที่มีปัญหาสถานะและสิทธิ', '11252', true),
  ('SELF', 'ชำระเงินเอง', NULL, true),
  ('FREE', 'สวัสดิการ (ไม่ตั้งลูกหนี้)', NULL, false);

INSERT INTO ar_right_pttype (pttype, right_code, updated_by)
SELECT p, r, 'migration' FROM (VALUES
  ('UCS', ARRAY['89', '21', '22', '24', '25', '40', '64', '69', '71', '72', '73', '74', '75', '76', '77', '80', '81', '82', '87', '88',
                '90', '91', '92', '94', '95', '96', '98', 'D1']),
  ('PP', ARRAY['53', '61', '62', '63']),
  ('OFC', ARRAY['O1', 'O2', 'O3', 'O4', 'O5']),
  ('OFC_CHECKUP', ARRAY['49']),
  ('AGENCY', ARRAY['13', 'F9', 'F1', 'F2', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6']),
  ('LGO', ARRAY['46', '50', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L9']),
  ('BKK', ARRAY['19', 'B1', 'B2', 'B3', 'B4', 'B5', 'E8', 'E9']),
  ('BMT', ARRAY['G5', 'G6']),
  ('SSS', ARRAY['S1', 'S2', 'S3', 'S4']),
  ('SSI', ARRAY['14', '15', '54', 'S6']),
  ('SSS72', ARRAY['66']),
  ('INS', ARRAY['58', '68']),
  ('NRH', ARRAY['52', '99']),
  ('STP', ARRAY['65', 'pa', 'ST']),
  ('SELF', ARRAY['01', '02', '09', '10', '11', '12', '16', '23', '30', '34', '38', '39', '41', '42', '43', '44', '47', '51', '55', '56',
                 '67', '97', 'AA', 'E1', 'E2', 'E3', 'E4', 'N8', 'N9']),
  ('FREE', ARRAY['26', '29', '32'])
) v(r, ps), unnest(ps) AS p;

INSERT INTO ar_account_rule (right_code, patient_type, loc, account_code, cap, debt_pct, updated_by)
SELECT r, pt, loc, acc, cap, pct, 'migration' FROM (VALUES
  ('UCS', 'OP', 'main', '1102050101.201', NULL::numeric, NULL::numeric),
  ('UCS', 'OP', 'province_moph', '1102050101.203', 700, NULL),
  ('UCS', 'OP', 'province_other', '1102050102.201', 700, NULL),
  ('UCS', 'OP', 'outside', '1102050101.216', NULL, NULL),
  ('UCS', 'OP', 'unknown', '1102050101.216', NULL, NULL),
  ('UCS', 'IP', 'any', '1102050101.202', NULL, NULL),
  ('PP', 'OP', 'any', '1102050101.209', NULL, NULL),
  ('OFC', 'OP', 'any', '1102050101.401', NULL, NULL),
  ('OFC', 'IP', 'any', '1102050101.402', NULL, NULL),
  ('OFC_CHECKUP', 'OP', 'any', '1102050101.103', NULL, NULL),
  ('AGENCY', 'OP', 'any', '1102050102.108', NULL, NULL),
  ('AGENCY', 'IP', 'any', '1102050102.109', NULL, NULL),
  ('LGO', 'OP', 'any', '1102050102.801', NULL, NULL),
  ('LGO', 'IP', 'any', '1102050102.802', NULL, NULL),
  ('BKK', 'OP', 'any', '1102050102.803', NULL, NULL),
  ('BKK', 'IP', 'any', '1102050102.804', NULL, NULL),
  ('BMT', 'OP', 'any', '1102050102.110', NULL, NULL),
  ('BMT', 'IP', 'any', '1102050102.111', NULL, NULL),
  ('SSS', 'OP', 'main', '1102050101.301', NULL, 45),
  ('SSS', 'OP', 'any', '1102050101.309', NULL, NULL),
  ('SSS', 'IP', 'main', '1102050101.302', NULL, 55),
  ('SSS', 'IP', 'any', '1102050101.308', NULL, NULL),
  ('SSI', 'OP', 'any', '1102050101.307', NULL, NULL),
  ('SSI', 'IP', 'any', '1102050101.307', NULL, NULL),
  ('SSS72', 'OP', 'any', '1102050101.309', NULL, NULL),
  ('SSS72', 'IP', 'any', '1102050101.308', NULL, NULL),
  ('INS', 'OP', 'any', '1102050102.602', NULL, NULL),
  ('INS', 'IP', 'any', '1102050102.603', NULL, NULL),
  ('NRH', 'OP', 'main', '1102050101.501', NULL, NULL),
  ('NRH', 'OP', 'any', '1102050101.503', NULL, NULL),
  ('NRH', 'IP', 'main', '1102050101.502', NULL, NULL),
  ('NRH', 'IP', 'any', '1102050101.504', NULL, NULL),
  ('STP', 'OP', 'main', '1102050101.701', NULL, NULL),
  ('STP', 'OP', 'any', '1102050101.702', NULL, NULL),
  ('STP', 'IP', 'any', '1102050101.704', NULL, NULL),
  ('SELF', 'OP', 'any', '1102050102.106', NULL, NULL),
  ('SELF', 'IP', 'any', '1102050102.107', NULL, NULL)
) v(r, pt, loc, acc, cap, pct);

-- บัญชีรายได้คู่/ส่วนต่างจาก ec_accitem ของ Claim (accno_recieve, accno_high) เติมเฉพาะที่ยังเป็น NULL
UPDATE ar_account a SET revenue_code = COALESCE(a.revenue_code, v.rev), diff_under_code = COALESCE(a.diff_under_code, v.under)
FROM (VALUES
  ('1102050101.103', '4301020102.104', NULL),
  ('1102050101.109', '4301020102.105', NULL),
  ('1102050101.201', '4301020105.201', NULL),
  ('1102050101.202', '4301020105.202', NULL),
  ('1102050101.203', '4301020105.203', '4301020105.239'),
  ('1102050101.204', '4301020105.205', NULL),
  ('1102050101.209', '4301020105.241', NULL),
  ('1102050101.216', '4301020105.244', '4301020105.258'),
  ('1102050101.217', '4301020105.245', NULL),
  ('1102050101.222', '4301020105.263', NULL),
  ('1102050101.223', '4301020105.267', NULL),
  ('1102050101.224', '4301020105.268', '4301020105.269'),
  ('1102050101.301', '4301020106.305', '4301020106.315'),
  ('1102050101.302', '4301020106.306', '4301020106.317'),
  ('1102050101.303', '4301020106.307', NULL),
  ('1102050101.304', '4301020106.308', NULL),
  ('1102050101.307', '4301020106.311', NULL),
  ('1102050101.308', '4301020106.312', NULL),
  ('1102050101.309', '4301020106.313', '4301020106.319'),
  ('1102050101.310', '4301020106.314', NULL),
  ('1102050101.401', '4301020104.401', '4301020104.405'),
  ('1102050101.402', '4301020104.402', NULL),
  ('1102050101.501', '4301020106.503', NULL),
  ('1102050101.502', '4301020106.504', NULL),
  ('1102050101.503', '4301020106.512', NULL),
  ('1102050101.504', '4301020106.513', NULL),
  ('1102050101.505', '4301020106.509', NULL),
  ('1102050101.506', '4301020106.514', NULL),
  ('1102050101.701', '4301020106.709', NULL),
  ('1102050101.702', '4301020106.701', NULL),
  ('1102050101.703', '4301020106.703', NULL),
  ('1102050101.704', '4301020106.710', NULL),
  ('1102050102.103', '4301020102.102', NULL),
  ('1102050102.106', '4301020104.106', NULL),
  ('1102050102.107', '4301020104.107', NULL),
  ('1102050102.108', '4301020104.104', NULL),
  ('1102050102.109', '4301020104.105', NULL),
  ('1102050102.110', '4301020104.108', NULL),
  ('1102050102.111', '4301020104.109', NULL),
  ('1102050102.201', '4301020105.207', '4301020105.239'),
  ('1102050102.301', '4301020106.309', NULL),
  ('1102050102.302', '4301020106.310', NULL),
  ('1102050102.602', '4301020104.602', NULL),
  ('1102050102.603', '4301020104.603', NULL),
  ('1102050102.801', '4301020104.801', '4301020104.803'),
  ('1102050102.802', '4301020104.802', NULL),
  ('1102050102.803', '4301020104.805', NULL),
  ('1102050102.804', '4301020104.806', NULL)
) v(code, rev, under)
WHERE a.code = v.code AND (a.revenue_code IS NULL OR (a.diff_under_code IS NULL AND v.under IS NOT NULL));
