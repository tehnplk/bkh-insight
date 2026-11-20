-- เปลี่ยนชื่อ nhso_close_log -> nhso_save_endpoint_log ให้สื่อว่าเป็น log การบันทึกผ่าน NHSO ENDPOINT (พร้อม index/sequence/constraint ให้ชื่อตรงกัน)
ALTER TABLE nhso_close_log RENAME TO nhso_save_endpoint_log;
ALTER INDEX nhso_close_log_ok_vn RENAME TO nhso_save_endpoint_log_ok_vn;
ALTER INDEX nhso_close_log_vn RENAME TO nhso_save_endpoint_log_vn;
ALTER SEQUENCE nhso_close_log_id_seq RENAME TO nhso_save_endpoint_log_id_seq;

-- pkey (index ตามไปด้วย), fkey, check และ NOT NULL ที่มีชื่อ (PostgreSQL 18) ชุดชื่อต่างกันตามเวอร์ชัน จึงวนจาก pg_constraint
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'nhso_save_endpoint_log'::regclass AND conname LIKE 'nhso\_close\_log\_%' LOOP
    EXECUTE format('ALTER TABLE nhso_save_endpoint_log RENAME CONSTRAINT %I TO %I', c, 'nhso_save_endpoint_log_' || substr(c, length('nhso_close_log_') + 1));
  END LOOP;
END $$;
