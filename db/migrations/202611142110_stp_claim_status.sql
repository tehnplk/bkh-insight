-- สถานะเคลมกองทุน STP ที่เจ้าหน้าที่บันทึกเองจากหน้า /fund/stp-claim (STP ต้องกดส่งเคลมเองใน FDH และผลไม่ย้อนเข้า HOSxP)
-- ต่อท้ายอย่างเดียว ไม่แก้ไม่ลบ: สถานะปัจจุบัน = แถวล่าสุดต่อ (patient_type, ref) ; ไม่มีแถว = not_sent ; ห้ามเก็บเลขบัตร
CREATE TABLE stp_claim_status_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_type text NOT NULL CHECK (patient_type IN ('OP', 'IP')),
  ref text NOT NULL CHECK (ref ~ '^\d{1,15}$'),  -- OP = vn, IP = an
  status text NOT NULL CHECK (status IN ('not_sent', 'uploaded', 'submitted', 'fix', 'approved', 'rejected', 'paid', 'capitation', 'unclaimed', 'cancelled')),
  note text CHECK (char_length(note) <= 500),
  recorded_by text NOT NULL,
  user_id bigint NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stp_claim_status_log_ref_idx ON stp_claim_status_log (patient_type, ref, created_at DESC, id DESC);
