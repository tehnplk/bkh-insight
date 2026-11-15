-- ปิดงวดสมุดลูกหนี้ (/admin/ar-periods): หนึ่งแถวต่อการปิดหนึ่งเดือน เปิดงวด = ตั้ง unlocked_* ไม่ลบแถว (เก็บประวัติ)
--   snapshot = งบทดลองของเดือนนั้น ณ เวลาปิด (trialBalance ใน src/app/api/fund/ar-trial-balance/trial-balance.ts)
--   เดือนหนึ่งปิดอยู่ได้แถวเดียว (unique เฉพาะแถวที่ยังไม่เปิด)
CREATE TABLE ar_period_close (
  id bigserial PRIMARY KEY,
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  locked_by text NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL,
  unlocked_by text,
  unlocked_at timestamptz,
  unlock_reason text,
  CHECK ((unlocked_at IS NULL) = (unlocked_by IS NULL)),
  CHECK (unlocked_at IS NULL OR coalesce(unlock_reason, '') <> '')
);
CREATE UNIQUE INDEX ar_period_close_active_uq ON ar_period_close (month) WHERE unlocked_at IS NULL;

-- วันที่ลงบัญชีเดิมของแถวที่ trigger เลื่อนเข้างวดเปิด (NULL = ไม่ถูกเลื่อน)
ALTER TABLE ar_ledger ADD COLUMN orig_entry_date date;

-- วันแรกของงวดที่ยังเปิด (NULL = ยังไม่เคยปิดงวด)
CREATE FUNCTION ar_open_from() RETURNS date LANGUAGE sql STABLE AS
$$ SELECT (max(month) + interval '1 month')::date FROM ar_period_close WHERE unlocked_at IS NULL $$;

-- INSERT ที่ตกงวดปิด เลื่อนเป็นวันแรกของงวดเปิด (ar-sync รายวัน, ตัดหนี้ STM, ปรับปรุงที่อนุมัติ) ; UPDATE/DELETE แถวในงวดปิด = error
-- migration ต่อไปที่ UPDATE/DELETE ar_ledger จะล้มถ้าแตะแถวในงวดปิด
CREATE FUNCTION ar_ledger_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE open_from date := ar_open_from();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF open_from IS NOT NULL AND NEW.entry_date < open_from THEN
      NEW.orig_entry_date := NEW.entry_date;
      NEW.entry_date := open_from;
    END IF;
    RETURN NEW;
  END IF;
  IF open_from IS NOT NULL AND (OLD.entry_date < open_from OR (TG_OP = 'UPDATE' AND NEW.entry_date < open_from)) THEN
    RAISE EXCEPTION 'ar_ledger: งวดถึง % ปิดแล้ว แก้หรือลบรายการในงวดที่ปิดไม่ได้', open_from - 1;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ar_ledger_period_guard BEFORE INSERT OR UPDATE OR DELETE ON ar_ledger
  FOR EACH ROW EXECUTE FUNCTION ar_ledger_period_guard();
