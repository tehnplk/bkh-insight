-- ตัดลูกหนี้ด้วย STM แบบ manual (/fund/ar-settle) แทนการตัดอัตโนมัติท้าย ar-sync: หนึ่งแถวต่อการกดยืนยันหนึ่งครั้งของไฟล์ STM หนึ่งไฟล์
--   receipt_date = entry_date ของแถวที่ลง (trigger ar_ledger_period_guard อาจเลื่อนเข้างวดเปิด วันเดิมอยู่ใน orig_entry_date)
--   receipt_no NULL ได้เฉพาะชุดที่มีแต่ปิดส่วนต่าง (ไม่มีรับชำระ) ; settled_user_id NULL = super user
--   แถวตัดหนี้อัตโนมัติเดิม (sync_id) ไม่มี settle_batch_id และไม่ถูกแก้
CREATE TABLE ar_settle_batch (
  id bigserial PRIMARY KEY,
  stm_file_id bigint NOT NULL REFERENCES stm_file,
  receipt_date date NOT NULL,
  receipt_no text CHECK (receipt_no IS NULL OR btrim(receipt_no) <> ''),
  settled_by text NOT NULL,
  settled_user_id bigint REFERENCES users (id),
  settled_at timestamptz NOT NULL DEFAULT now(),
  counts jsonb NOT NULL DEFAULT '{}'      -- { settle, diff, settle_amount, diff_amount, shifted, skipped }
);
CREATE INDEX ar_settle_batch_file_idx ON ar_settle_batch (stm_file_id, id DESC);

-- ไม่มี default และไม่ UPDATE แถวเดิม จึงไม่แตะแถวในงวดปิด
ALTER TABLE ar_ledger ADD COLUMN settle_batch_id bigint REFERENCES ar_settle_batch;
ALTER TABLE ar_ledger ADD CONSTRAINT ar_ledger_settle_batch_source_check CHECK (settle_batch_id IS NULL OR source = 'stm');
