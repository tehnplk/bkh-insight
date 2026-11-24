-- บัตรประกันสุขภาพต่างด้าว (/fund/fwf-card): เงินรับล่วงหน้า 2103010103.502 จากค่าบริการทางการแพทย์ของบัตร ใช้ตัดหนี้ผู้ถือบัตร (.501/.502)
-- เก็บ HN เท่านั้น ไม่เก็บชื่อ/เลขบัตร (ชื่ออ่านจาก HOSxP ตอนแสดง)

-- 1) บัญชีลูกหนี้ตามสิทธิ (override ราย pttype) ; ถ้ามีแถว pttype เดิมอยู่แล้วคงค่าเดิมไว้
INSERT INTO ar_account_map (pttype, patient_type, account_code, updated_by) VALUES
  ('99', 'OP', '1102050101.501', 'migration'),
  ('99', 'IP', '1102050101.502', 'migration'),
  ('52', 'OP', '1102050101.503', 'migration'),
  ('52', 'IP', '1102050101.504', 'migration'),
  ('64', 'OP', '1102050101.505', 'migration'),
  ('64', 'IP', '1102050101.506', 'migration')
ON CONFLICT (pttype, patient_type) WHERE pttype IS NOT NULL DO NOTHING;

-- แถวเดิมที่ยังไม่ระบุบัญชีของสามสิทธินี้ ได้บัญชีตาม mapping (เหมือนปุ่มคำนวณบัญชีใหม่ของ /admin/ar-accounts)
-- ข้ามหนี้ที่มีแถวอยู่ในงวดที่ปิดแล้ว (trigger ห้าม UPDATE) ให้ทุกแถวของหนี้เดียวกันอยู่บัญชีเดียวกัน
UPDATE ar_ledger l SET account_code = m.account_code
FROM ar_account_map m
WHERE l.account_code IS NULL AND m.pttype = l.pttype AND m.patient_type = l.patient_type AND m.pttype IN ('99', '52', '64')
  AND NOT EXISTS (SELECT 1 FROM ar_ledger x WHERE x.patient_type = l.patient_type AND x.ref = l.ref
                  AND x.entry_date < COALESCE(ar_open_from(), '-infinity'::date));

-- 2) บัญชีรายได้คู่/ส่วนต่างของลูกหนี้ต่างด้าว
UPDATE ar_account a SET revenue_code = v.rev, diff_under_code = v.under, diff_over_code = v.over
FROM (VALUES
  ('1102050101.501', '4301020106.503', '4301020106.505', NULL),
  ('1102050101.502', '4301020106.504', '4301020106.507', NULL),
  ('1102050101.503', '4301020106.512', '4301020106.515', '4301020106.519'),
  ('1102050101.504', '4301020106.513', '4301020106.510', '4301020106.511'),
  ('1102050101.505', '4301020106.509', NULL, NULL),
  ('1102050101.506', '4301020106.514', '4301020106.510', '4301020106.511')
) AS v(code, rev, under, over)
WHERE a.code = v.code;

-- 3) ชนิดบัตร: จับคู่รายการขายใน HOSxP ด้วย (icode, ราคาต่อหน่วย) ; pool_amount = ค่าบริการทางการแพทย์ที่เข้าเงินรับล่วงหน้าต่อบัตร (NULL = ยังไม่กำหนด หน้าเตือนและห้ามตัดหนี้)
CREATE TABLE fwf_card_type (
  id bigserial PRIMARY KEY,
  icode text NOT NULL CHECK (btrim(icode) <> ''),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price > 0),
  label text NOT NULL CHECK (btrim(label) <> ''),
  months int NOT NULL CHECK (months BETWEEN 1 AND 60),
  pool_amount numeric(12,2) CHECK (pool_amount IS NULL OR pool_amount >= 0),
  active boolean NOT NULL DEFAULT true,
  note text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (icode, unit_price)
);
-- 3002154 ราคา 500 เป็นค่าตรวจสุขภาพ ไม่ใช่บัตร จึงไม่ใส่
INSERT INTO fwf_card_type (icode, unit_price, label, months, pool_amount, note, updated_by) VALUES
  ('3002154', 1600, 'บัตรแรงงาน 1 ปี (2,100)', 12, 914, NULL, 'migration'),
  ('3002163', 900, '6 เดือน (1,400)', 6, 515, NULL, 'migration'),
  ('3002201', 3200, '2 ปี (4,200)', 24, 1828, NULL, 'migration'),
  ('3002548', 2400, '1 ปี 6 เดือน (3,400)', 18, NULL, NULL, 'migration'),
  ('3002530', 2200, 'คนต่างด้าว 1 ปี (2,700)', 12, 1514, NULL, 'migration'),
  ('3002530', 2100, 'ยังไม่ระบุชนิด (2,100)', 12, NULL, 'รอการเงินยืนยันชนิดบัตรและค่าบริการทางการแพทย์', 'migration'),
  ('3002530', 1600, 'ประกัน 1 ปี (1,600)', 12, 914, NULL, 'migration'),
  ('3002203', 3200, 'ประกัน 2 ปี (3,200)', 24, 1828, NULL, 'migration'),
  ('3002203', 730, 'เด็ก ≤7 ปี 2 ปี (730)', 24, 514, NULL, 'migration'),
  ('3002139', 365, 'เด็ก ≤7 ปี 1 ปี (365)', 12, 257, NULL, 'migration');

-- 4) บัตรหนึ่งใบต่อหนึ่งแถว opitemrece (hos_guid) หรือที่การเงินเพิ่มเอง (manual)
--   valid_from/valid_to: ค่าเริ่มต้นวันขาย ถึง วันขาย + months − 1 วัน การเงินแก้ได้ ; sync ไม่ทับวันที่และสถานะ
--   pool_amount = pool ของชนิด × qty ตอนสร้าง (NULL เมื่อชนิดยังไม่กำหนด ตั้งชนิดแล้วเติมให้)
--   paidst/has_receipt จาก HOSxP (sync อัปเดต) ; hosxp_missing = รอบ sync ล่าสุดไม่พบแถวนี้ใน HOSxP แล้ว (การเงินตรวจแล้วยกเลิกเอง)
CREATE TABLE fwf_card (
  id bigserial PRIMARY KEY,
  hn text NOT NULL CHECK (hn ~ '^[0-9]{1,15}$'),
  card_type_id bigint NOT NULL REFERENCES fwf_card_type,
  qty int NOT NULL DEFAULT 1 CHECK (qty > 0),
  sale_date date NOT NULL,
  valid_from date NOT NULL,
  valid_to date NOT NULL CHECK (valid_to >= valid_from),
  pool_amount numeric(12,2) CHECK (pool_amount IS NULL OR pool_amount >= 0),
  source text NOT NULL CHECK (source IN ('hosxp', 'manual')),
  hos_guid text UNIQUE,
  vn varchar(13),
  paidst text,
  has_receipt boolean,
  hosxp_missing boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
  void_reason text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz,
  CHECK (source = 'manual' OR hos_guid IS NOT NULL),
  CHECK ((status = 'void') = (coalesce(btrim(void_reason), '') <> ''))
);
CREATE INDEX fwf_card_hn_idx ON fwf_card (hn);
CREATE INDEX fwf_card_sale_idx ON fwf_card (sale_date);

-- เดือนที่ดึงรายการขายบัตรจาก HOSxP แล้ว (backfill ทีละเดือนตั้งแต่วันเริ่ม pool)
CREATE TABLE fwf_sync_month (
  month date PRIMARY KEY CHECK (month = date_trunc('month', month)::date),
  counts jsonb NOT NULL DEFAULT '{}',   -- { rows, matched, added, updated, missing }
  synced_by text,
  synced_at timestamptz NOT NULL DEFAULT now()
);

-- 5) โอนเงินคงเหลือของบัตรที่หมดอายุไปเงินบำรุง (การเงินบันทึกเอง ไม่โอนอัตโนมัติ) ลดเงินรับล่วงหน้า
CREATE TABLE fwf_card_release (
  id bigserial PRIMARY KEY,
  card_id bigint NOT NULL REFERENCES fwf_card,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  released_on date NOT NULL,
  ref text CHECK (ref IS NULL OR btrim(ref) <> ''),
  note text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fwf_card_release_card_idx ON fwf_card_release (card_id);

-- 6) ตัดหนี้ผู้ถือบัตรสิ้นเดือนด้วยเงินรับล่วงหน้า: หนึ่งแถวต่อการกดยืนยันหนึ่งครั้ง ; created_user_id NULL = super user
CREATE TABLE fwf_settle_batch (
  id bigserial PRIMARY KEY,
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  counts jsonb NOT NULL DEFAULT '{}',   -- { settle, diff, settle_amount, diff_amount, check, shifted }
  created_by text NOT NULL,
  created_user_id bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fwf_settle_batch_month_idx ON fwf_settle_batch (month, id DESC);

-- source 'fwf' = ตัดด้วยเงินรับล่วงหน้า (kind settle ลง Dr 2103010103.502, kind diff ลง Dr ส่วนต่างของบัญชี) ref = ref ของหนี้
--   ไม่ใช่ source ของหนี้ ar-sync จึงไม่นับในการเทียบยอดกับ HOSxP (เหมือน stm/manual)
ALTER TABLE ar_ledger DROP CONSTRAINT ar_ledger_source_check;
ALTER TABLE ar_ledger ADD CONSTRAINT ar_ledger_source_check CHECK (source IN ('rcpt_debt', 'ipt', 'stm', 'manual', 'fwf'));
-- ไม่มี default และไม่ UPDATE แถวเดิม จึงไม่แตะแถวในงวดปิด
ALTER TABLE ar_ledger ADD COLUMN fwf_batch_id bigint REFERENCES fwf_settle_batch;
ALTER TABLE ar_ledger ADD COLUMN fwf_card_id bigint REFERENCES fwf_card;
ALTER TABLE ar_ledger ADD CONSTRAINT ar_ledger_fwf_batch_source_check CHECK ((source = 'fwf') = (fwf_batch_id IS NOT NULL));
ALTER TABLE ar_ledger ADD CONSTRAINT ar_ledger_fwf_card_source_check CHECK (fwf_card_id IS NULL OR source = 'fwf');
CREATE UNIQUE INDEX ar_ledger_fwf_once_uq ON ar_ledger (fwf_batch_id, patient_type, ref, kind) WHERE fwf_batch_id IS NOT NULL;
CREATE INDEX ar_ledger_fwf_card_idx ON ar_ledger (fwf_card_id) WHERE fwf_card_id IS NOT NULL;
