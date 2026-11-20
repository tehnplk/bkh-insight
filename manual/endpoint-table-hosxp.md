โครงสร้างตรวจกับฐาน HOSxP จริง (bkhosxp) เมื่อ 20 พ.ย. 2569 ตรวจเฉพาะ schema ไม่ได้รัน INSERT/UPDATE จริง

ข้อควรรู้ก่อนใช้:
- ต้องเขียนที่ฐานหลักของ HOSxP เท่านั้น his ที่ BKH Insight ต่ออยู่เป็น replica และ DB user มีสิทธิ SELECT อย่างเดียว ระบบนี้จึงเขียนสองตารางนี้ไม่ได้ ผลปิดสิทธิของระบบนี้เก็บที่ `nhso_save_endpoint_log` (insight)
- `nhso_confirm_privilege` เป็น MyISAM ไม่มี transaction ถ้าขั้น 1 สำเร็จแต่ขั้น 2 ล้ม จะไม่ rollback ให้

1. บันทึกผลปิดสิทธิลง nhso_confirm_privilege (เขียนทุกครั้งที่ยิง API ทั้งสำเร็จและไม่สำเร็จ)


INSERT INTO nhso_confirm_privilege
  (vn, nhso_seq, nhso_authen_code, nhso_request_json, nhso_reponse_json,
   nhso_requst_datetime, nhso_response_datetime, confirm_staff, nhso_status,
   debt_id, nhso_total_amount, pttype, nhso_privilege_amount, nhso_cash_amount,
   testzone)
VALUES
  (:vn, :seq, :authen_code, :request_json, :response_json,
   :request_at, NOW(), :confirm_staff, :status,
   :debt_id, :income, :pttype, :uc_money, :rcpt_money,
   :testzone)
ON DUPLICATE KEY UPDATE
  nhso_seq               = VALUES(nhso_seq),
  nhso_authen_code       = VALUES(nhso_authen_code),
  nhso_request_json      = VALUES(nhso_request_json),
  nhso_reponse_json      = VALUES(nhso_reponse_json),
  nhso_requst_datetime   = VALUES(nhso_requst_datetime),
  nhso_response_datetime = VALUES(nhso_response_datetime),
  confirm_staff          = VALUES(confirm_staff),
  nhso_status            = VALUES(nhso_status),
  debt_id                = VALUES(debt_id),
  nhso_total_amount      = VALUES(nhso_total_amount),
  pttype                 = VALUES(pttype),
  nhso_privilege_amount  = VALUES(nhso_privilege_amount),
  nhso_cash_amount       = VALUES(nhso_cash_amount),
  testzone               = VALUES(testzone);
ค่าที่ต้องใส่แทนบางตัว:

:status ใส่ 'Y' ถ้า สปสช. ตอบ seq มา ถ้าไม่มีใส่ 'E' (คอลัมน์เป็น char(1))
:testzone ใส่ 'Y' เมื่อส่งไป UAT ถ้าส่งระบบจริงใส่ NULL (คอลัมน์เป็น varchar(1))
:debt_id คือเลขตัวแรกของ vn_stat.debt_id_list (debt_id_list เป็น varchar(50) ส่วน debt_id เป็น int(11) ต้องตัดเลขตัวแรกแล้วแปลงเป็นจำนวนเต็มก่อน ถ้าว่างใส่ NULL)
:vn ห้ามเป็น NULL (UNIQUE ยอมให้ NULL ซ้ำได้หลายแถว จะไม่ upsert)

หมายเหตุโครงสร้าง:
- ไม่มีคอลัมน์ sourceID ในตารางนี้ (ค้นชื่อที่มีคำว่า source ไม่พบ) เอกสารฉบับก่อนใส่ไว้ ถ้าใส่จะ error Unknown column
- ชื่อ nhso_reponse_json และ nhso_requst_datetime สะกดผิดตามตารางจริง ต้องใช้ตามนี้
- PRIMARY KEY คือ nhso_confirm_privilege_id (auto_increment) ส่วน vn เป็น UNIQUE จึงมีหนึ่งแถวต่อ visit ON DUPLICATE KEY UPDATE ทับแถวเดิมของ visit
- ยิงซ้ำแล้วล้มเหลวจะทับแถวที่เคยสำเร็จ ('Y') เป็น 'E' ควรเช็คก่อนยิงว่า visit มีแถว nhso_status = 'Y' ที่ยังไม่ยกเลิกหรือไม่
- ON DUPLICATE KEY UPDATE ไม่ล้างคอลัมน์ยกเลิกของแถวเดิม (nhso_cancel_response, nhso_cancel_datetime, cancel_staff) ถ้าปิดใหม่หลังยกเลิกต้องตั้งเป็น NULL เพิ่มเอง
- คอลัมน์อื่นที่มีแต่ไม่ได้ใช้ในขั้นนี้: nhso_cancel_response, nhso_cancel_datetime, cancel_staff, nhso_confirm_type_id, fdh_send_status, fdh_transaction_id

2. ใส่รหัส EP ลง visit_pttype.auth_code (เฉพาะเมื่อปิดสิทธิสำเร็จและได้รหัสกลับมา)


UPDATE visit_pttype
SET auth_code = IF(IFNULL(auth_code, '') = '', :authen_code, auth_code)
WHERE vn = :vn
  AND pttype = :pttype;
ถ้า auth_code มีค่าอยู่แล้ว เช่นรหัส PP… จะไม่ถูกเขียนทับ

หมายเหตุโครงสร้าง:
- PRIMARY KEY ของ visit_pttype คือ (vn, pttype) visit หนึ่งมีได้หลายสิทธิ ต้องมี AND pttype = :pttype (สิทธิเดียวกับที่ปิดและบันทึกในขั้น 1) ไม่งั้นทุกสิทธิของ visit ที่ auth_code ว่างจะได้รหัส EP ไปด้วย
- auth_code เป็น varchar(15) แคบกว่า nhso_authen_code ที่เป็น varchar(20) ตรวจความยาวรหัสก่อน UPDATE ถ้ายาวเกิน 15 จะถูกตัดหรือ error ตาม sql_mode
