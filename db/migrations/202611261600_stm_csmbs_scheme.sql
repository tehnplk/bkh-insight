-- STM ของ ขสมก. (BMT) และ BKK เป็นไฟล์แบบเดียวกับ OFC ทุกช่อง ไฟล์ที่นำเข้าด้วยมือก่อนรองรับ BMT จึงถูกบันทึกเป็น OFC
-- (นับปนในแนวโน้ม STM กลุ่ม OFC) แก้ scheme ตาม REP ในไฟล์ (rep_row ที่ไม่ใช่ UCS ; เลข REP ไม่ซ้ำข้ามสิทธิ) กติกาเดียวกับ csmbsScheme ของ route นำเข้า
-- เฉพาะไฟล์ที่ REP ทุกใบที่พบเป็นสิทธิเดียวและไม่ใช่ OFC ; ไฟล์ที่ไม่พบ REP คงเป็น OFC ; ไม่แตะ ar_ledger (แถวตัดหนี้อ้าง stm_row ไม่ใช่ scheme)
UPDATE stm_file f SET scheme = x.scheme
FROM (
  SELECT s.stm_file_id, min(r.scheme) AS scheme
  FROM stm_summary s JOIN rep_row r ON r.rep_no = s.rep_no AND r.scheme <> 'UCS'
  GROUP BY s.stm_file_id
  HAVING count(DISTINCT r.scheme) = 1
) x
WHERE f.id = x.stm_file_id AND f.layout = 'csmbs' AND f.scheme = 'OFC' AND x.scheme <> 'OFC';
