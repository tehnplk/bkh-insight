-- ผู้ลงนามท้ายรายงานลูกหนี้ (/fund/ar-report) 3 ช่อง แก้ได้โดย admin ไม่ต้องแก้โค้ด ; person_name NULL = พิมพ์เส้นว่างให้เขียนชื่อเอง
CREATE TABLE ar_report_signer (
  slot smallint PRIMARY KEY CHECK (slot BETWEEN 1 AND 3),
  role_label text NOT NULL,
  person_name text,
  position text,
  updated_by text,
  updated_at timestamptz
);

INSERT INTO ar_report_signer (slot, role_label, position) VALUES
  (1, 'ผู้รับรองลูกหนี้', 'หัวหน้าศูนย์จัดเก็บรายได้'),
  (2, 'ผู้ตรวจสอบบันทึกบัญชี', 'นักวิชาการการเงินและบัญชี'),
  (3, 'ผู้อำนวยการ', 'ผู้อำนวยการโรงพยาบาล');
