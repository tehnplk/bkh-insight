# Handoff: werawat (อัปเดต 13 พ.ย. 2569)

## สถานะ
- PR #29 (ลูกหนี้เฟส 1, รายการค่าใช้จ่ายใน uc-debtor) deploy แล้ว
- PR #30 (main `7cc67a2`, 10 พ.ย. 2569) deploy แล้ว: นำเข้า STM, ตั้งลูกหนี้อัตโนมัติ 01:00, โมดูล FDH, UC นอกสังกัด สธ., คอลัมน์ "ส่งเข้าแผนก" ใน `/fund/opd-department`
- timer ติดตั้งบน server แล้ว (enable, รอบแรก 11 พ.ย. 2569 01:00) ต้องเช็คว่ารันสำเร็จ: `journalctl -u bkh-insight-ar-sync.service` หรือ `ar_sync_log`
- ยังไม่มีใครเห็นคอลัมน์ "ส่งเข้าแผนก" ในหน้าจอจริง (9 พ.ย. 2569 คลินิกพรีเมียม ควรเป็น 41 visit / 113,337.02)
- server timezone `Asia/Bangkok` ; nginx `client_max_body_size 32m`

## รอบ 13 พ.ย. 2569 (PR #31)
- เมนูจัดตามขั้นตอนงาน ; หน้า fluid ทั้งหมด ; สิทธิ์ -> สิทธิ (ยกเว้น migration ที่ merge แล้ว)
- ใหม่: `/fund/claim-errors`, `/fund/claim-status`, `/fdh/files` (16 แฟ้ม .txt), `/admin/mapcode` (Drug catalog สปสช. migration `202611131500_drug_catalog_nhso.sql` รันแล้ว ตารางยังว่าง)
- `/ipd/admissions` และ `/opd/admissions` (OPD/IPD แยกรายสิทธิ): เลือกแถว -> modal 16 แฟ้ม (`FdhPreviewModal`) ตรวจ C + zip
- OPD: เลขที่ใบเสร็จจาก `rcpt_print` (status OK, แสดง เล่ม/เลขที่) ตัวกรอง `unclosed=1` ; DataGrid `reorderable` จำลำดับคอลัมน์ต่อผู้ใช้ (`bkh:grid-cols:<user>:<path>`)
- ค้าง: วันที่ใน txt (YYYYMMDD ตามสเปก?), DID ใน DRU (icode vs 24 หลัก), DRUGREMARK ของยา NED ว่างทุกแถว, Drug/Lab catalog สกส.

## งานในรอบนี้
1. `/fund/stm-import` นำเข้า statement (UC และ OFC layout) migration `202611101000_stm_import.sql` (รันลงฐานแล้ว): `stm_file`, `stm_summary`, `stm_row`, `ar_ledger.stm_row_id` (FK กันลบไฟล์ที่ใช้ตัดหนี้แล้ว)
   - UC จับคู่ `tran_id` กับ `rep_row` 100% ; ยอด STM = `net_nhso` ; OFC จับคู่ (rep_no, seq_no/an) ; ไฟล์ไม่มีวันที่โอน ผู้นำเข้ากรอก
2. ตั้งลูกหนี้รายวัน 01:00: `scripts/ar-sync-daily.mjs` + `deploy/bkh-insight-ar-sync.{service,timer}` (`npm run ar:sync`)
3. FDH `/fdh/c-check` ตรวจ C ก่อนส่ง (skill `fdh-pre-validate` แปลงเป็น WITH อ่านอย่างเดียว ไม่สร้าง view ใน HOSxP)
   - C111/C112 ยอม '01'–'09' ; C153/C114 แปลง `ipt.bw` กรัม → กก. ; C160/C161 ปิด (ไม่มี SVCTYPE ทุก admission = 1)
4. UC OP นอกสังกัด สธ. (14972 ม.นเรศวร, 11517 ค่ายสมเด็จฯ, 41429 จิตเวชพิษณุโลก) → `1102050102.201` migration `202611101530_ar_uc_non_moph.sql` (รันแล้ว ย้าย 62 แถว)
5. `/fund/opd-department` คอลัมน์ "ส่งเข้าแผนก" และ "มูลค่าที่ส่งเข้าแผนก (บาท)" จาก `opd_dep_queue` (ตรงกับ OPD Visit List ของ HOSxP ที่กรองแผนก) แยกตามกองทุน กดตัวเลขเปิด modal (`via=queue`, API visits รับ `qdep`)
   - ซ้ำข้ามแผนกได้ แถวรวมจึงเป็น "–" ; ยอดเดิมยังนับตาม `ovst.main_dep`
   - ยังไม่ได้ตรวจในหน้าจอจริง (agent login SSO จาก localhost ไม่ได้)

## รอคำตอบจากการเงิน (ก่อนทำเฟส 2 ตัดลูกหนี้จาก STM)
- คำตอบที่ได้แล้ว: หนี้ OP ใน CUP .201 และ P&P ไม่อยู่ใน STM ให้ปิดทั้งก้อนแล้วลงส่วนต่าง "ส่วนต่างค่ารักษาที่สูงกว่าเหมาจ่ายรายหัว-กองทุน UC OP/P&P" ; วันตัดหนี้ = วันที่การเงินออกใบเสร็จ ; CR โอนมากับ IP ดูรายตัว ; บัญชีนอกสังกัด สธ. ใช้ ; OP-Refer ไม่ใช้
- ยังรอ: Q1 ปิดหนี้ .201/P&P เมื่อไร (แนะนำ: เมื่อ REP ผ่านไม่ติด C) ; Q2 จ่ายหลาย statement เมื่อไรถือว่าครบ (แนะนำ: เทียบ STM ที่รับกับยอดพึงรับใน REP รายกองทุน)
- แบบที่วางไว้: ขั้น "ตัดหนี้" ต่อไฟล์ STM กรอกวันที่และเลขใบเสร็จ, แถว settle อ้าง `stm_row_id` (หนึ่งหนี้มีหลาย settle ได้), แยก CR → .216/.217, P&P → .209
- ก่อนเขียน SQL ตัดหนี้: ผู้ใช้ต้องนำเข้า STM 75 ไฟล์ และ backfill ลูกหนี้ ต.ค. 2568–ก.ย. 2569

## ค้างอื่นๆ
- FDH: ยังไม่มีส่งออก Excel, ยังไม่ทดสอบ error state, กฎยังไม่ได้เทียบกับ REP จริง
- `deps=UNKNOWN` ใน opd-department ไม่นับคิวที่ depcode ว่าง (31 วันมี 1 แถว)
- ย้าย `fund/_components/ui` + `Segmented` ไป `src/components/`
- REP: ORF และ .ecd ยังไม่รองรับ ; admin UI ของ rep_error_code ยังไม่มี
- claim-overview `visit-items` ยังไม่ได้ดูที่จอแคบ ; `stacked-bar.tsx` endLabelPlugin ค้างค่าเก่า
- ผู้ป่วยใน 10 รายมี `ward` NULL ควรแจ้งเวชระเบียน ; `deploy_guide.md` เก็บรหัสผ่านเป็นข้อความธรรมดา ควรเปลี่ยนเป็น SSH key

## การตัดสินใจ
- deploy เฉพาะ main หลังผู้ใช้สั่ง merge ; ฐาน insight ของ dev กับ prod เป็นฐานเดียวกัน
- his อ่านอย่างเดียวแม้ skill จะสั่งให้สร้าง view
- REP ใช้บอกสถานะเคลม ; ตัดลูกหนี้ใช้ STM ; ledger เพิ่มแถวอย่างเดียว (migration non-MOPH แก้ตรงได้เพราะบัญชียังไม่ใช้ยอด)

## คำสั่งตรวจ
- `npx tsc --noEmit` ; `npm run lint`
- `node --test src/app/api/fund/ar-sync/ledger.test.mjs src/app/api/fund/uc-debtor/items/items.test.mjs src/app/api/fund/rep-import/*.test.mjs src/app/api/fund/stm-import/stm.test.mjs src/app/api/fdh/c-check/fdh.test.mjs`
- deploy: `cd /var/www/bkh-insight && git pull --ff-only && npm ci (ถ้า lockfile เปลี่ยน) && npm run db:migrate && npm run build && sudo systemctl restart bkh-insight`
- timer: `systemctl list-timers bkh-insight-ar-sync.timer` ; `journalctl -u bkh-insight-ar-sync.service`
