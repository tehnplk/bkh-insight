# Handoff: werawat (อัปเดต 9 พ.ย. 2569)

## สถานะ
- PR #28: REP import, ลูกหนี้ UC + modal รายละเอียด, dashboard ลูกหนี้ UC, ย้าย dm-remission ไป /visit (migration rep_import, rep_error_code รันแล้ว; dependency xlsx จาก cdn.sheetjs.com)
- PR #21–#27 merge แล้ว deploy ขึ้น server แล้วที่ `d21436f` (https://10.10.10.159)
- server timezone เป็น `Asia/Bangkok`

## สิ่งที่ทำเสร็จ
- PR #25 `/admin/users` คอลัมน์ "จำนวนครั้งที่เข้าใช้งาน" (`users.login_count`, migration `202611060943_add_users_login_count.sql` รันแล้ว) +1 ทุกครั้งที่ login SSO ใน `src/auth.ts`
- PR #26 เมนู: "หน้าแรก" → "ภาพรวม", "กองทุน" → "จัดเก็บรายได้" (ย้ายเป็นลำดับ 2), "การรับบริการ" → "ตรวจสอบข้อมูล" (`nav-items.ts`, AGENTS.md)
- PR #27 DM Type-2 remission ย้ายเป็น `/visit/dm-remission` "ผู้รับบริการที่เข้าเกณฑ์ DM Type-2" (เมนู "ตรวจสอบข้อมูล")
  - ไฟล์: `src/app/(app)/visit/dm-remission/*`, `src/app/api/visit/dm-remission/{route.ts,remission.ts,remission.test.mjs}`
  - เกณฑ์ (ผู้ใช้ยืนยัน): E11 เคยวินิจฉัย, อายุ ≥18 ณ วันตรวจ, สิทธิ UC ตาม pttype ของ visit ที่ตรวจ
    - ครั้งแรก 4,000: HbA1c (lab_items_code 334) < 6.5 สองผลติดกัน ห่าง ≥90 วัน ไม่มียาเบาหวาน (OPD+IPD) rxdate ใน [ผลก่อน, ผลหลัง)
    - เพิ่มเติม 2,000 (ครั้งเดียว): ผลถัดไป < 6.5 ห่าง 90–183 วัน ไม่มียา
    - ผลซ้ำวันเดียวกันใช้ค่าสูงสุด, วันเกิดว่างตัดออก
  - SQL ผ่าน prove-query ทั้ง 8 ตัว query ยาใช้ `opitemrece FORCE INDEX (ix_hn)` แบ่งทีละ 50 hn รันต่อกัน (ข้อยกเว้นที่ตั้งใจ)
- วิดีโอ promo 20 วินาที: `C:\Users\MyPC\Videos\bkh-insight-promo.mp4` (เครื่องนี้เท่านั้น ไม่อยู่ใน git) เพลงร็อกสังเคราะห์ด้วย ffmpeg ติดตั้ง ffmpeg 9.0.2 ผ่าน winget แล้ว

## ค้าง / ขั้นต่อไป
- dm-remission: ยังไม่เคยเปิดดูกับข้อมูลจริงหลัง login ต้องวัดเวลาโหลดช่วง 31 วัน และสุ่มเทียบ 2–3 รายกับ HOSxP
- dm-remission: ดูประวัติย้อนหลังแค่ 730 วัน รายที่เคยผ่านเกณฑ์ก่อนนั้นอาจถูกนับ "ครั้งแรก" ซ้ำ (มี comment `shortcut:` ใน route)
- login_count: ยังไม่ได้ทดสอบว่า login SSO จริงแล้วเพิ่ม
- วิดีโอ: ยังไม่ได้ฟังเสียงจริง
- `fund/claim-overview/stacked-bar.tsx`: `endLabelPlugin` ค้างค่าเก่าเมื่อเปลี่ยนช่วงวันที่ (แก้แบบ `valueLabels` ใน charts.tsx)
- `DateRangeFilter`: ช่อง "ถึง" ไม่มี `max` เลือกวันอนาคตได้
- `fund/_components/visit-items.tsx`: ตารางแคบเกินที่ 390px
- Home ward แยกด้วยชื่อ ward (`shortcut:`)
- ผู้ป่วยใน 10 รายมี `ward` NULL ค้างตั้งแต่ 2567 ควรแจ้งเวชระเบียน
- `deploy_guide.md` เก็บรหัสผ่านเป็นข้อความธรรมดา ควรเปลี่ยนเป็น SSH key

## การตัดสินใจ
- deploy เฉพาะ main ต้องให้ผู้ใช้สั่ง merge ก่อน (main บังคับ CI ผ่าน)
- ฐาน insight ของ dev กับ prod เป็นฐานเดียวกัน migration ที่รันจาก dev มีผลกับ prod ทันที
- วิดีโอห้ามมีชื่อผู้ป่วย/HN จึงไม่ใส่หน้า dm-remission

## คำสั่งตรวจ
- `npx tsc --noEmit`
- `node --test src/app/api/visit/dm-remission/remission.test.mjs`
- deploy: `cd /var/www/bkh-insight && git pull --ff-only && npm ci (ถ้า lockfile เปลี่ยน) && npm run db:migrate && npm run build && sudo systemctl restart bkh-insight`
