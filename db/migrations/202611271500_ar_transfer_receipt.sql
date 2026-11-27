-- ลงรับเงินโอน (ใบเสร็จ) ที่ /fund/ar-transfer: การเงินออกใบเสร็จหนึ่งใบต่อหนึ่งชุดโอน SMT (วันที่โอน + batchNo ของ smt_key)
--   และลงบัญชีตามวันที่ใบเสร็จ ; ยังไม่ลงรับ (receipt_date NULL) = "รอออกใบเสร็จ" ไม่ลงสมุดรายวัน/งบทดลอง ไม่นับใน pool เหมาจ่าย
--   receipt_no รูปแบบ "เล่ม/เลขที่" เช่น 40485/60 ; แถวเดิมของปีงบ 2569 และก่อนนั้นรับแล้วตามวันที่โอน ไม่มีเลขที่
--   unreceive_* = ยกเลิกการรับครั้งล่าสุด (เหตุผลบังคับ) ; ไม่มีคอลัมน์ชุดแยก เพราะ batchNo อยู่ใน smt_key ซึ่งไม่เปลี่ยนแล้ว
ALTER TABLE ar_transfer
  ADD COLUMN receipt_no text,
  ADD COLUMN receipt_date date,
  ADD COLUMN received_by text,
  ADD COLUMN received_at timestamptz,
  ADD COLUMN unreceived_by text,
  ADD COLUMN unreceived_at timestamptz,
  ADD COLUMN unreceive_reason text,
  ADD CONSTRAINT ar_transfer_receipt_check CHECK (
    (receipt_date IS NULL AND receipt_no IS NULL AND received_by IS NULL AND received_at IS NULL)
    OR (receipt_date IS NOT NULL AND receipt_date >= transfer_date AND received_by IS NOT NULL AND received_at IS NOT NULL
        AND (receipt_no IS NULL OR btrim(receipt_no) <> ''))
  );

UPDATE ar_transfer SET receipt_date = transfer_date, received_by = 'migration', received_at = now()
WHERE transfer_date <= '2026-09-30';

-- สมุดรายวัน/งบทดลอง/pool เหมาจ่ายเลือกตามช่วง receipt_date
CREATE INDEX ar_transfer_receipt_date_idx ON ar_transfer (receipt_date);
