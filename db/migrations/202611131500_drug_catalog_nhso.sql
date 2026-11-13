-- ตั้งค่ารหัสมาตรฐาน (/admin/mapcode): ไฟล์ catalog ที่นำเข้า และรายการ Drug Catalogue ที่ สปสช. อนุมัติแล้ว
-- catalog_file ใช้ร่วมทุกชนิด (drug_nhso ตอนนี้ ; drug_chi, lab_chi ภายหลัง) กันนำเข้าไฟล์ซ้ำด้วย sha256
CREATE TABLE catalog_file (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('drug_nhso', 'drug_chi', 'lab_chi')),
  file_name text NOT NULL,
  file_sha256 text NOT NULL,
  row_count integer NOT NULL,
  item_count integer NOT NULL,
  imported_by text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, file_sha256)
);

-- ไฟล์ APPROVED_<hcode>_<yyyymmdd>.xls จาก drug.nhso.go.th: 21 ฟิลด์ตาม data dictionary + ผลอนุมัติ 4 คอลัมน์
-- ยาหนึ่งรหัสมีหลายแถว (ประวัติ UPDATEFLAG A/E/U) เก็บทุกแถวตามไฟล์ ; เก็บเฉพาะไฟล์ล่าสุด (นำเข้าใหม่ = แทนที่ทั้งชุด)
CREATE TABLE drug_catalog_nhso (
  id bigserial PRIMARY KEY,
  file_id bigint NOT NULL REFERENCES catalog_file (id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  hosp_drug_code text NOT NULL,
  product_cat text,
  tmt_id text,
  spec_prep text,
  generic_name text,
  trade_name text,
  dfs_code text,
  dosage_form text,
  strength text,
  content text,
  unit_price numeric(14, 2),
  distributor text,
  manufacturer text,
  ised text,
  ndc24 text,
  pack_size text,
  pack_price numeric(14, 2),
  update_flag text,
  date_change date,
  date_update date,
  date_effective date,
  ised_approved text,
  ndc24_approved text,
  date_approved date,
  ised_status text
);
CREATE INDEX drug_catalog_nhso_code_idx ON drug_catalog_nhso (hosp_drug_code, date_effective DESC, date_approved DESC, line_no DESC);
