-- REP ของสิทธิอื่น (IPCS/IPLGO/OPBKK/OPBMT/OPLGO) นำเข้าตาราง rep_row เดียวกับ UC เพื่อดูสถานะเคลมและ error C (ไม่ใช้ตัดหนี้)
-- scheme แยกแถว UC ออกจากสิทธิอื่น: UCS, OFC (IPCS), LGO, BKK, BMT ; แถวเดิมทั้งหมดมาจากตัวอ่าน UC จึงเป็น UCS
-- หน้าที่นับเฉพาะ UC (uc-dashboard, admin/ar-funds, freshness) กรอง scheme = 'UCS'
ALTER TABLE rep_row ADD COLUMN scheme text NOT NULL DEFAULT 'UCS';
