# Handoff: werawat (อัปเดต 9 พ.ย. 2569)

## สถานะ
- main = `a52d4c5` (PR #28) deploy ขึ้น server แล้ว (https://10.10.10.159): REP import, ลูกหนี้ UC + modal, dashboard ลูกหนี้ UC, ย้าย dm-remission ไป `/visit/dm-remission`
- 10 พ.ย. 2569: PR #29 รวมรายการค่าใช้จ่ายใน uc-debtor + ระบบตั้งลูกหนี้เฟส 1 + ปรับ copy หน้า /admin/ar-accounts (จับคู่แล้วคำนวณบัญชีให้อัตโนมัติ)
- server timezone เป็น `Asia/Bangkok` ; nginx ตั้ง `client_max_body_size 32m` แล้ว

## งานที่ขึ้นใน PR #29
1. รายการค่าใช้จ่ายใน modal `/fund/uc-debtor` (OPD vn / IPD an)
   - API ใหม่ `src/app/api/fund/uc-debtor/items/{route.ts,items.ts,items.test.mjs}` (IPD ใช้ `opitemrece FORCE INDEX (ix_an)`)
   - แยก `ItemCategories` ใน `fund/_components/visit-items.tsx` (opd-fund ยังเหมือนเดิม; claim-overview ยังไม่ได้เปิดตรวจ)
   - paidst 02 = ลูกหนี้สิทธิ ตรงกับ uc_money (700/704 AN)
2. ระบบตั้งลูกหนี้รายวัน เฟส 1
   - migration `202611091700_ar_ledger.sql` **รันลงฐาน insight แล้ว** (ar_account 73 รหัส, ar_account_map, ar_ledger, ar_sync_log)
   - `src/app/api/fund/ar-sync/` (ledger.ts pure + test, sync.ts, route.ts), `src/app/api/fund/ar-ledger/`, `src/app/api/admin/ar-accounts/`
   - หน้า `/fund/ar-ledger` "ลูกหนี้ตามผังบัญชี" และ `/admin/ar-accounts` "บัญชีลูกหนี้ตามสิทธิ"
   - แก้ shared: `nav-items.ts` (2 เมนู), AGENTS.md (1 บรรทัดใต้ `@/lib/db`)
   - sync ต.ค. 2569 ลงฐานแล้ว: OPD 17,673 ราย 17,067,681.11 ; IPD 660 AN 5,047,073.99 ; ไม่ระบุบัญชี 250 ราย 313,615.66
   - ผู้ใช้ยังต้อง: backfill ต.ค. 2568–ก.ย. 2569 ที่หน้า admin, กด "ดึงยอดล่าสุด" ครั้งแรก, จับคู่สิทธิที่ยังไม่มีบัญชีกับงานบัญชี

## รอคำตอบจากผู้ใช้/งานที่เกี่ยวข้อง (ก่อนทำเฟส 2 ตัดลูกหนี้จาก STM)
1. ส่วนต่างได้ต่ำกว่าตั้ง (หนี้ OP ใน CUP .201 ส่วนใหญ่ไม่มีใน STM เพราะเป็นเหมาจ่ายรายหัว): ก. ตัดตามยอดได้รับแล้วปล่อยคงเหลือให้บัญชีปรับปรุงเอง (แนะนำ) หรือ ข. ปิดหนี้ทั้งก้อนเมื่อรายการอยู่ใน STM แล้วบันทึกส่วนต่างทันที
2. วันที่ตัดหนี้: วันที่โอนเงิน (ผู้นำเข้ากรอก) หรือวันที่นำเข้าไฟล์
3. ยังค้าง: กองทุนย่อย UC (CR .216/.217, P&P .209) ย้ายบัญชีตอนตัด STM ได้ไหม ; บัญชี 1102050102.201 (UC นอกสังกัด สธ.) และ .222 (OP-Refer) ใช้จริงไหม

## ข้อมูลสำหรับเฟส 2 (STM) ที่สำรวจแล้ว
- ไฟล์ตัวอย่าง `C:\Users\MyPC\Desktop\rep\stm` (75 ไฟล์ .xls BIFF8: OP_UC 24, IP_UC 12, OP_CS 26, IP_OFC 13) ตรวจครบ 276 ชีต ไม่มีชีตซ่อน
- UC: ชีต รายงานพึงรับ / รายงานสรุป / รายละเอียด(ข้อมูลปกติ) 1 / รายละเอียด(ข้อมูลอุทธรณ์) / ชีตผู้พิการ D1 (บางไฟล์) ; ชื่อชีตมีช่องว่าง ต้อง trim ; รายละเอียด หัว 3 ชั้น index 11–13 ข้อมูลเริ่ม 14 ; col 2 TRAN_ID, 37 ยอดชดเชยทั้งสิ้น (number), 21–36 พึงรับรายกองทุน (string มีจุลภาค), 41 SEQ NO
- UC จับคู่ `stm.tran_id = rep_row.tran_id` 100% ; ยอด STM = `net_nhso` (ไม่มี `net_affiliation` ใน STM เลย ~88.8 ล้าน/ปี) ; IP UC เม.ย. 69 มี 443 แถวที่ REP = 0 แต่ STM จ่ายจริง 1.33 ล้าน → ยอดจริงต้องใช้ STM
- OFC: layout ต่าง (ชีต พึงรับ เป็นบล็อกต่อ REP, สรุป(พึงรับ)) ไม่มี TRAN_ID ต้องจับคู่ (rep_no, seq_no) / (rep_no, an) ; ชื่อไฟล์ปี ค.ศ.
- ไม่มีวันที่โอนในไฟล์ ; กันซ้ำด้วย "เลขที่เอกสาร" + sha256 ; ไฟล์ใหญ่สุด 22 MB
- ร่าง schema stm_file / stm_summary / stm_row อยู่ในรายงาน sr (สรุป: ไม่ใช้ tran_id เป็น PK, ไม่เขียนทับ rep_row)

## ข้อเท็จจริงของ HOSxP ที่ใช้ในระบบลูกหนี้
- OPD ตั้งหนี้จาก `rcpt_debt` (key debt_id, `LENGTH(vn)=12`, ตัด ABORT) ; ABORT มี amount 0 และ `rcpt_debt_cancel.amount` เป็น NULL → ยอดลดหนี้ใช้ยอดที่ ledger เคยตั้ง
- IPD ใช้ `ipt.finance_lock='Y'` + `an_stat.uc_money` ไม่มีวันที่ปิด (backfill ใช้ dchdate, รายวันใช้วันที่ sync)
- UCS OPD แยกบัญชีตาม hospmain: 11252 หรือใน `hospcode_cup` = .201, จังหวัด 65 = .203, อื่น = .204
- ผังบัญชีจาก `C:\Users\MyPC\Desktop\rep\รหัสลูกหนี้.xlsx` (รหัสเก็บเป็นตัวเลข: `.31`→`.310`, `.11`→`.110`, Manual เป็นทศนิยม 5 หลัก)

## ค้างอื่นๆ
- ตั้งเวลา sync ลูกหนี้อัตโนมัติทุกเช้า (systemd timer + session ของ service user, ไม่แก้ proxy.ts) ยังไม่ทำ
- REP: ไฟล์อุทธรณ์แสดงผ่าน/ไม่ผ่าน "–" ในรายการไฟล์ (ยอดอยู่ในส่วนข้อมูลอุทธรณ์ คอลัมน์ 22–24) ; ORF และ .ecd ยังไม่รองรับ ; admin UI ของ rep_error_code ยังไม่มี
- dm-remission: ยังไม่เคยวัดเวลาโหลดกับข้อมูลจริง, ดูย้อนหลังแค่ 730 วัน (`shortcut:`)
- login_count ยังไม่ทดสอบกับ SSO จริง
- `fund/claim-overview/stacked-bar.tsx` endLabelPlugin ค้างค่าเก่า ; `DateRangeFilter` ช่อง "ถึง" ไม่มี max
- ผู้ป่วยใน 10 รายมี `ward` NULL ตั้งแต่ 2567 ควรแจ้งเวชระเบียน
- `deploy_guide.md` เก็บรหัสผ่านเป็นข้อความธรรมดา ควรเปลี่ยนเป็น SSH key

## การตัดสินใจ
- deploy เฉพาะ main ต้องให้ผู้ใช้สั่ง merge ก่อน (main บังคับ CI ผ่าน)
- ฐาน insight ของ dev กับ prod เป็นฐานเดียวกัน migration/ข้อมูลที่รันจาก dev มีผลกับ prod ทันที
- REP ใช้บอกสถานะเคลม/error ; การตัดลูกหนี้ใช้ STM (ผู้ใช้ยืนยัน)
- ledger เป็นแบบเพิ่มแถวอย่างเดียว ยอดที่ตั้งแล้วไม่เปลี่ยนตาม HOSxP (ลงส่วนต่างเป็นรายการปรับปรุง)

## คำสั่งตรวจ
- `npx tsc --noEmit` ; `npm run lint`
- `node --test src/app/api/fund/ar-sync/ledger.test.mjs src/app/api/fund/uc-debtor/items/items.test.mjs src/app/api/fund/rep-import/*.test.mjs`
- deploy: `cd /var/www/bkh-insight && git pull --ff-only && npm ci (ถ้า lockfile เปลี่ยน) && npm run db:migrate && npm run build && sudo systemctl restart bkh-insight`
