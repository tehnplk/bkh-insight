-- วันที่ของหนี้ใน ar_ledger ให้ตรงกับ ar-sync ใหม่ (ledger.ts planOpd/planIpd):
--   OP ref_date = วันรับบริการ (เดิม debt_date), entry_date ของ set = วันรับบริการ ไม่ก่อน LEDGER_START
--   IP entry_date ของ set = วันจำหน่าย (เดิมรายวันลงวันที่ sync)
-- ต้องรันก่อนปิดงวดใดๆ (ar_period_close ว่าง): trigger ar_ledger_period_guard ห้าม UPDATE แถวในงวดที่ปิดแล้ว
-- '2025-10-01' = LEDGER_START ใน src/app/api/fund/ar-sync/ledger.ts (สมุดไม่มียอดยกมาก่อนวันนั้น)
-- ฐานเปล่า/ไม่มีแถว = ไม่มีอะไรเปลี่ยน

-- OP manual/fwf คัดลอก ref_date จากแถว set (ar-adjust, receipt, fwf-card) ย้ายตามเฉพาะแถวที่ยังเท่าแถว set
-- ต้องรันก่อน UPDATE ถัดไปที่เปลี่ยน ref_date ของแถว set
UPDATE ar_ledger l
SET ref_date = to_date((1957 + substr(l.vn,1,2)::int)::text || substr(l.vn,3,4), 'YYYYMMDD')
FROM ar_ledger s
WHERE l.patient_type = 'OP' AND l.source IN ('manual', 'fwf') AND l.vn ~ '^[0-9]{12}$'
  AND s.source = 'rcpt_debt' AND s.kind = 'set' AND s.patient_type = 'OP' AND s.ref = l.ref
  AND l.ref_date = s.ref_date
  AND l.ref_date IS DISTINCT FROM to_date((1957 + substr(l.vn,1,2)::int)::text || substr(l.vn,3,4), 'YYYYMMDD');

-- OP: ref_date of all rows of the debt (set/cancel/stm) = service date derived from vn (BE yymmdd ; 99.99% = ovst.vstdate, proven)
--     entry_date of set = service date, not before LEDGER_START 2025-10-01
WITH d AS (
  SELECT id, source, kind,
         to_date((1957 + substr(vn,1,2)::int)::text || substr(vn,3,4), 'YYYYMMDD') AS vst
  FROM ar_ledger
  WHERE patient_type = 'OP' AND source IN ('rcpt_debt', 'stm') AND vn ~ '^[0-9]{12}$'
)
UPDATE ar_ledger l
SET ref_date = d.vst,
    entry_date = CASE WHEN d.source = 'rcpt_debt' AND d.kind = 'set' THEN GREATEST(d.vst, DATE '2025-10-01') ELSE l.entry_date END
FROM d
WHERE l.id = d.id
  AND (l.ref_date IS DISTINCT FROM d.vst
       OR (d.source = 'rcpt_debt' AND d.kind = 'set' AND l.entry_date IS DISTINCT FROM GREATEST(d.vst, DATE '2025-10-01')));

-- IP: entry_date of set rows = discharge date
UPDATE ar_ledger SET entry_date = ref_date
WHERE source = 'ipt' AND kind = 'set' AND entry_date <> ref_date;
