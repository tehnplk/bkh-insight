-- Service catalog (/catalog/service-catalog): รายการอ้างอิงค่าบริการ UC (สปสช.), อัตรากรมบัญชีกลาง (OFC) และรายการเคลมกองทุน STP
-- ใช้เทียบกับรายการค่าบริการใน HOSxP (nondrugitems) ; แต่ละชุดเก็บเฉพาะไฟล์ล่าสุด (นำเข้าใหม่ = แทนที่ทั้งชุด) ประวัติไฟล์อยู่ใน catalog_file
ALTER TABLE catalog_file DROP CONSTRAINT catalog_file_kind_check;
ALTER TABLE catalog_file ADD CONSTRAINT catalog_file_kind_check
  CHECK (kind IN ('drug_nhso', 'drug_chi', 'lab_chi', 'service_uc', 'service_ofc', 'claim_stp'));

-- หมวดค่ารักษา 19 หมวด (CHRGITEM ของแฟ้ม CHA) กับ ADP TYPE ของแฟ้ม ADP
-- ที่มา: หมวดรายการเบิกจ่าย 19 หมวด และการบันทึกข้อมูล 16 แฟ้ม กองทุน STP ผ่าน FDH (ฉบับปรับปรุง 1 ส.ค. 2568)
-- adp_types: ADP TYPE ที่ใช้ได้ (ตัวแรก = หลัก) ; NULL = ไม่มีในแฟ้ม ADP (หมวด 3/4 อยู่แฟ้ม DRU, หมวด 16–18 และ พรบ.)
CREATE TABLE chrgitem_group (
  code text PRIMARY KEY,
  name text NOT NULL,
  chrgitem_claim text NOT NULL,
  chrgitem_excess text,
  adp_types smallint[],
  adp_file text CHECK (adp_file IN ('ADP', 'DRU')),
  sort_order smallint NOT NULL
);
INSERT INTO chrgitem_group (code, name, chrgitem_claim, chrgitem_excess, adp_types, adp_file, sort_order) VALUES
  ('1', 'ค่าห้อง/ค่าอาหาร', '11', '12', '{10}', 'ADP', 1),
  ('2', 'อวัยวะเทียม/อุปกรณ์บำบัดรักษา', '21', '22', '{2}', 'ADP', 2),
  ('3', 'ยาและสารอาหารทางเส้นเลือดที่ใช้ใน รพ.', '31', '32', NULL, 'DRU', 3),
  ('4', 'ยาที่นำไปใช้ต่อที่บ้าน', '41', '42', NULL, 'DRU', 4),
  ('5', 'เวชภัณฑ์ที่ไม่ใช่ยา', '51', '52', '{11}', 'ADP', 5),
  ('6', 'บริการโลหิตและส่วนประกอบของโลหิต', '61', '62', '{14}', 'ADP', 6),
  ('7', 'ตรวจวินิจฉัยทางเทคนิคการแพทย์และพยาธิวิทยา', '71', '72', '{15}', 'ADP', 7),
  ('8', 'ตรวจวินิจฉัยและรักษาทางรังสีวิทยา', '81', '82', '{16}', 'ADP', 8),
  ('9', 'ตรวจวินิจฉัยโดยวิธีพิเศษอื่นๆ', '91', '92', '{9}', 'ADP', 9),
  ('10', 'อุปกรณ์ของใช้และเครื่องมือการแพทย์', 'A1', 'A2', '{18}', 'ADP', 10),
  ('11', 'ทำหัตถการและบริการวิสัญญี', 'B1', 'B2', '{19}', 'ADP', 11),
  ('12', 'ค่าบริการทางการพยาบาล', 'C1', 'C2', '{17}', 'ADP', 12),
  ('13', 'บริการทางทันตกรรม', 'D1', 'D2', '{12}', 'ADP', 13),
  ('14', 'บริการทางกายภาพบำบัดและเวชกรรมฟื้นฟู', 'E1', 'E2', '{20}', 'ADP', 14),
  ('15', 'ค่าบริการฝังเข็มฯและอื่นๆ', 'F1', 'F2', '{13}', 'ADP', 15),
  ('16', 'ค่าบริการผ่าตัดและห้องคลอด', 'G1', 'G2', NULL, NULL, 16),
  ('17', 'ค่าธรรมเนียมบุคลากรทางการแพทย์', 'H1', 'H2', NULL, NULL, 17),
  ('18', 'บริการอื่นๆและส่งเสริมป้องกันโรค', 'I1', 'I2', NULL, NULL, 18),
  -- หมวด 19 ใช้ ADP 3 เป็นหลัก บางรายการใช้ ADP 1 (HC เช่น เมทาโดน) และ ADP 4 (ส่งเสริมป้องกัน)
  ('19', 'บริการอื่นๆที่ยังไม่ได้จัดหมวด', 'J1', 'J2', '{3,1,4}', 'ADP', 19),
  ('K', 'พรบ.', 'K1', NULL, NULL, NULL, 20);

-- Service catalog UC: export จากระบบของ สปสช. (Excel 12 คอลัมน์) ; หนึ่งแถวต่อแถวในไฟล์
-- รหัสซ้ำได้: ประวัติราคาหลายช่วง (start_date ต่างกัน) และรหัสเดียวหลายรายการในช่วงเดียวกัน (เช่น 385401) key จึงเป็น (file_id, line_no)
-- price NULL = ไม่มีอัตรา (ไฟล์ใส่ 0 สำหรับรายการที่ไม่อยู่ใน Fee Schedule) ; fs_status 1 อยู่ใน Fee Schedule, 2 ไม่อยู่ใน Fee Schedule, 3 ไม่อยู่ในรหัสมาตรฐาน
CREATE TABLE service_catalog_uc (
  id bigserial PRIMARY KEY,
  file_id bigint NOT NULL REFERENCES catalog_file (id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  chrgitem_group text,
  group_name text,
  hosp_code text,
  code text,
  name text NOT NULL,
  price numeric(12, 2),
  unit text,
  start_date date,
  end_date date,
  updated_date date,
  fs_status smallint CHECK (fs_status IN (1, 2, 3)),
  UNIQUE (file_id, line_no)
);
CREATE INDEX service_catalog_uc_code_idx ON service_catalog_uc (code, start_date DESC);

-- อัตราค่าบริการกรมบัญชีกลาง จาก API สาธารณะของ mbdb.cgd.go.th (getMedSearch) ; code เก็บตามต้นทาง (มีรหัสไม่มาตรฐาน เช่น "ต่อ 47050")
-- price NULL = ไม่มีอัตรา (รายการ "อื่นๆ" x999)
CREATE TABLE service_catalog_ofc (
  id bigserial PRIMARY KEY,
  file_id bigint NOT NULL REFERENCES catalog_file (id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  med_seqno text,
  code text NOT NULL,
  name text,
  remark text,
  unit text,
  price numeric(12, 2),
  UNIQUE (file_id, line_no)
);
CREATE INDEX service_catalog_ofc_code_idx ON service_catalog_ofc (code);

-- รายการเคลมของกองทุน (ตอนนี้ STP = บุคคลที่มีปัญหาสถานะและสิทธิ จากไฟล์หมวดรายการเบิกจ่าย 19 หมวด) หนึ่งแถวต่อแถวในชีต
-- code NULL = ไฟล์ไม่มีรหัส (เช่น ยาที่ใส่ "-") ; qty เป็นข้อความตามไฟล์ (หน่วย/เงื่อนไข) ; adp_type เป็นเลข ADP TYPE หรือ 'DRU'
CREATE TABLE fund_claim_item (
  id bigserial PRIMARY KEY,
  file_id bigint NOT NULL REFERENCES catalog_file (id) ON DELETE CASCADE,
  fund text NOT NULL CHECK (fund IN ('STP')),
  sheet text NOT NULL,
  line_no integer NOT NULL,
  seq text,
  code text,
  name text NOT NULL,
  qty text,
  rate numeric(12, 2),
  chrgitem_group text,
  adp_type text,
  use_status text,
  tmt_id text,
  opd boolean,
  ipd boolean,
  note text,
  UNIQUE (file_id, sheet, line_no)
);
CREATE INDEX fund_claim_item_code_idx ON fund_claim_item (fund, code);
