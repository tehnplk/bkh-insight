-- ขยายกติกากองทุนย่อย (/admin/ar-funds) ให้ครบแบบ smart-statement
--   match_mode: items = มีรายการตามเงื่อนไข (เดิม) ; rights = ทุก visit ของสิทธิที่เลือกที่มียอดลูกหนี้สิทธิ ; icd = ทุก visit ที่มีรหัสโรคตามที่กำหนด
--     rights/icd ใช้ยอดตั้งเบิก = ยอดรายการ paidst 02 ทั้ง visit
--   pttypes: กรองรหัสสิทธิเพิ่มจากกองทุนหลัก (ว่าง = ทุกสิทธิในกองทุนหลัก)
--   icd10: รหัสเดี่ยว (ขึ้นต้นด้วย) หรือช่วง A00-B99 ; icd_scope: any = ทุกวินิจฉัย, pdx = เฉพาะโรคหลัก
--   required_icodes: รายการจำเป็น visit ที่เข้าเกณฑ์แต่ขาดรายการเหล่านี้จะถูกแจ้งในหน้าตรวจเทียบ
ALTER TABLE ar_fund_rule
  ADD COLUMN match_mode text NOT NULL DEFAULT 'items' CHECK (match_mode IN ('items', 'rights', 'icd')),
  ADD COLUMN pttypes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN icd_scope text NOT NULL DEFAULT 'any' CHECK (icd_scope IN ('any', 'pdx')),
  ADD COLUMN required_icodes text[] NOT NULL DEFAULT '{}';

-- กิจกรรมย่อย (เช่น PP: ฝากครรภ์, ทดสอบการตั้งครรภ์) เมื่อกติกามีกิจกรรมที่เปิดใช้ visit เข้าเกณฑ์เมื่อผ่านกิจกรรมใดกิจกรรมหนึ่งครบ
-- (รายการ + รหัสโรคของกิจกรรมนั้น ไม่จับข้ามกิจกรรม) แทนเงื่อนไขรายการระดับกติกา ; ยอดตั้งเบิก = ราคารวมของรายการในกิจกรรมที่ผ่าน (รายการซ้ำนับครั้งเดียว)
CREATE TABLE ar_fund_activity (
  id bigserial PRIMARY KEY,
  rule_code text NOT NULL REFERENCES ar_fund_rule ON DELETE CASCADE ON UPDATE CASCADE,
  name text NOT NULL CHECK (name <> ''),
  items_mode text NOT NULL DEFAULT 'any' CHECK (items_mode IN ('any', 'all')),  -- any = มีรายการใดก็ได้ ; all = ต้องมีครบทุกรายการ/หมวด
  incomes text[] NOT NULL DEFAULT '{}',
  icodes text[] NOT NULL DEFAULT '{}',
  icd10 text[] NOT NULL DEFAULT '{}',
  icd_scope text NOT NULL DEFAULT 'any' CHECK (icd_scope IN ('any', 'pdx')),
  active boolean NOT NULL DEFAULT true,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(incomes) + cardinality(icodes) > 0)
);
CREATE INDEX ar_fund_activity_rule_idx ON ar_fund_activity (rule_code);
