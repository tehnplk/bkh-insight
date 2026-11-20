-- dataError ที่ สปสช. ตอบกลับ เก็บทั้งตอนสำเร็จและไม่สำเร็จ ปิดเลข 13 หลัก
ALTER TABLE nhso_close_log ADD COLUMN data_error text;
