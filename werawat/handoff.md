# Handoff: werawat (อัปเดต 23 พ.ย. 2569)

## รอบ 23 พ.ย. 2569 (PR #69–#73 merge แล้ว, deploy แล้ว main `a45cc94`)

เสร็จแล้ว:
- #69 stm-import ป้ายวงกลมแยกสีตามครั้งที่ของงวด
- #70–#71 `/fund/dept-trend` หน้าใหม่ (กราฟรายเดือนทั้งปีงบต่อแผนก, ค่าเริ่มต้นแผนก 053+027 `DEFAULT_DEPS`, เดือนล่าสุดเทียบเดือนก่อนพร้อม "ข้อมูล N วัน") ; กติกาแผนก 1 visit = 1 แผนก: `main_dep` ยกเว้น visit ที่ส่งเข้าคิว 053 คลินิกพรีเมียม นับที่ 053 (`SVC_OVERRIDE_DEP`/`svcDepJoin`/`svcDepSql`/`svcDepNameSql` ใน `src/app/api/fund/_lib/fund.ts`, รองรับแผนกพิเศษตัวเดียว) ใช้ที่ dept-trend, `/fund/opd-department`, `/api/fund/opd-fund/visits` ; opd-department เอาคอลัมน์/modal "ส่งเข้าแผนก" ออก (คิวซ้ำข้ามแผนก)
- #72–#73 `/ipd/admissions` ตัวกรองช่วง AdjRW เป็นตัวกรองหัวคอลัมน์ ; DataGrid มี meta `range: { min, max, validate? }` (ชื่อ URL param) ใช้กับคอลัมน์ตัวเลขอื่นได้
- คู่มือตั้งและตัดลูกหนี้ (artifact ส่วนตัว https://claude.ai/artifact/GNPDgZf4pcgseUPGJybRhA ภาพจำลองหน้าจอข้อมูลสมมติ) ต้นฉบับอยู่ใน scratchpad ของ session ไม่ได้อยู่ใน repo ; แก้ต่อจาก session อื่นให้ใช้ Artifact `read` ด้วย URL

ค้าง:
- **FWF (ต่างด้าว) ส่งออก 16 แฟ้มด้วย FCODE**: ผู้ใช้ให้ยึด ACCLOEI เป็นต้นแบบ รอผู้ใช้ส่งไฟล์ zip ตัวอย่างที่ ACCLOEI ส่งออก (หรือภาพแฟ้ม INS/PAT/DRU) เพื่อยืนยัน: INS.INSCL (`FWF` หรือ `NRH`), INS คอลัมน์ 5 (DATEIN หรือ HCODE), FCODE แทนเลขบัตรทุกแฟ้มหรือแค่ INS, MISArv ใส่ DID หรือ DIDSTD ; ยังไม่ได้ตัดสินว่าจะทำ (ประเมินยอดเบิกได้ ~1.1 แสนบาท/ปี: สิทธิ 99 IP 6 admit ≈ 81,000 + ARV ≤ 25,000 + วัคซีน)
  - ข้อเท็จจริงที่ตรวจแล้ว: ช่องทางส่ง = FDH ; FCODE ได้จากลงทะเบียน BIO ID ใน FDH-Migrants (xlsx ทะเบียนที่ผู้ใช้มี) ; `patient_employer.fwf_code` มีค่า 562 แถว รูปแบบถูก `^F[0-9]{12}$` แค่ 271 (สิทธิ 99 มี FCODE ถูกรูปแบบ 4/14 คน) ; รหัส FWF ใหม่ (Google Sheet FDH 7 แท็บ: IP 9, on top 5, อุปกรณ์ 55 รหัส 4 หลัก, ARV MISArv01–29 ลงแฟ้ม DRU USE_STATUS 1/2, แล็บ HIV 34 รหัส ADP TYPE 15, วัคซีน/ยาฝัง ADP TYPE 4) ต่างจาก `fwf_item` ของ HOSxP 89 รหัส ; map ใน HOSxP = 0 รายการ ; ARV ใหม่ไม่มี DTG/TAF
  - จุดที่ต้องแก้ในโค้ดถ้าทำ: เลขบัตร `pt.cid` ใน `src/app/api/fdh/files/sql.ts` (INS/PAT/CHA/DRU/LABFU/ODX/OOP/CHT), PERMITNO CASE (สำเนาใน `fdh/c-check/checks.ts` + test), กฎ C104/C116, `FdhPreviewModal`
- **hosxp-mapper** (`hosxp-mapper/` gitignored, port 3100): พักไว้รอข้อมูล FWF ; user DB ของผู้ใช้ยังไม่มีสิทธิ SELECT `fwf_item` (หน้า /fwf/items 500)
- error `crypto.getRandomValues()` ตอน prerender หน้า `/` (เห็นใน console หลัง login) ยังไม่ได้ตรวจ

## ค้าง: วิเคราะห์ระบบตั้ง/ตัดลูกหนี้เทียบรายงานการเงิน (20 พ.ย. 2569, ยังไม่แก้โค้ด)
เป้าหมาย: ให้ระบบออกรายงานที่งานการเงินใช้จริงได้ และยอดตรงกัน แล้วปรับ UX หน้าลูกหนี้
- **รายงานที่การเงินต้องการ** (ผู้ใช้ส่งภาพ ระบบเดิมพิมพ์ 20/11/2569, ลงนาม: หัวหน้าศูนย์จัดเก็บรายได้ = ผู้รับรองลูกหนี้, นักวิชาการการเงินและบัญชี = ผู้ตรวจสอบบันทึกบัญชี, ผอ.)
  1. สรุปลูกหนี้ OP/IP ประจำวัน และช่วงวัน: รหัสบัญชี, ชื่อบัญชี, จำนวนลูกหนี้, ค่าใช้จ่ายจริง, เงินตั้งลูกหนี้ + รวม + เวลาพิมพ์
  2. สรุปยอดลูกหนี้คงเหลือ OP/IP ประจำเดือน: เลขผังบัญชี, ชื่อ, จำนวน, เงิน + รวม (แสดงบัญชีที่ 0 ด้วย)
  - ตัวเลขอ้างอิง ต.ค. 2569: OP 1 ต.ค. 660 / 678,055.83 (ตั้ง 654,982.13) ; OP เดือน 17,334 / 17,091,033.22 (ตั้ง 16,616,121.27) ; IP เดือน 736 / 5,562,692.21 (ตั้ง 5,506,523.57) ; คงเหลือ OP 20,442 / 17,526,664.01 (.201 = 0) ; คงเหลือ IP 1,940 / 15,272,016.07
- **ผลเทียบ (prove-query, อ่านอย่างเดียว):**
  - ยอดตั้งหนี้รวม OP ใกล้กัน: ledger 17,673 / 17,067,681.11 (HOSxP `rcpt_debt` 17,679 / 17,079,649.61) ; 1 ต.ค. ตรง HOSxP 659 ใบ / 656,906.06 ; IP ledger 660 / 5,047,073.99
  - คงเหลือใช้ไม่ได้: OP ของเรา 32,160 / 31.47M, IP 1,242 / 11.14M (นับ set ตาม ref_date)
- **ปัญหาที่พบ:**
  1. .201 ไม่เคยปิด (คงเหลือ 27,824 / 26.9M) การเงินปิดเป็น 0 ทุกเดือน — ไม่มี kind/รายการปิดสิ้นเดือน
  2. บัญชีที่ไม่ใช่ UC/OFC ลดไม่ได้ (ตัดได้ทางเดียวคือ STM `settles_by_stm`) ; คำขอปรับปรุง (`ar-adjust`, kind adjust) ถูก `journal.ts:37` ลงเป็น Dr รายได้/Cr ลูกหนี้ ไม่ใช่เงินฝาก → งบทดลองผิดถ้าใช้แทนรับชำระ ; ยังไม่อ่านใบเสร็จ/รับชำระใน HOSxP (ต้องสำรวจ `rcpt_debt%`, `rcpt_print`)
  3. mapping สิทธิ→บัญชี (`ar_account_map`) มี 9 แถว (ผังบัญชีใน `ar_account` ครบแล้ว) ; NULL ต.ค. OP 196 ref / 0.23M, IP 9 ; ที่ตรงเป๊ะ: T2→102.108, IP INS 58→102.603, IP SSI S6→.307, IP SSS 66→.308, ST→.701 ; ใกล้เคียง: INS 58→102.602, BKK B4→102.803, NRH 99→.501, SSS S1–S3→.301 (pttype 14/15/61/66 น่าจะ .307/.309), pttype 53→.209? ; .216/.217 มีเศษสตางค์ น่าจะแยกตามรายการ ; รายงานไม่มี .204 (ของเรา 76 ref / 70,460)
  4. IP entry_date = วันที่ daily sync เจอ (`ledger.ts:168`, sync รัน 01:00 ใช้ `todayIso()`) ไม่ใช่ dchdate → AN ก.ค.–ก.ย. ลง พ.ย. ขณะ STM settle ลง 1–2 ต.ค. → .202 คงเหลือ ณ 31 ต.ค. ติดลบ −10.14M ในงบทดลอง ; adjust/reverse ก็ลงวันที่รัน
  5. สมุดไม่ครบ: OP มีแค่ ต.ค. 68 + ต.ค.–พ.ย. 69 ; IP ต.ค. 68 + ก.ค.–พ.ย. 69 ต้อง backfill พ.ย. 68–ก.ย. 69
  6. นิยาม: รายงานนับต่อ VN (17,326 VN ≈ 17,334) เรานับต่อ debt_id (348 VN หลายใบ) ; "เงินตั้ง" < "ค่าใช้จ่ายจริง" เฉพาะ .203/.301/.302/102.201 (ผลต่างรวม OP 474,911.95, IP 56,168.64 = ผู้ป่วย hospmain ไม่ใช่เรา) สูตรยังไม่รู้ ; เราไม่มีค่าใช้จ่ายจริง ; IP รายงาน 736 > AN จำหน่าย ต.ค. 704 (ตัวแบ่งวันอื่น?) และเราข้าม uc_money = 0 (102.107 ฯลฯ)
  7. STM ที่ตัดอัตโนมัติไปแล้ว (.401 เหลือ 95 ref) แต่การเงินยังเหลือ .401 3,693 / 4.30M, .402 84 / 1.18M
  - อื่นๆ (จากรีวิวโค้ด): M1 PPFS .209 แยกใน ar-precheck-summary แต่ ar-sync ไม่แยก ; M3 IP ใช้ pttype หลักตัวเดียว ; M4 แก้ mapping แถวเดิมไม่ย้าย ; M5 ยกเลิกหลังตัด STM ยอดติดลบ (daily ไม่กัน) ; M6 daily ย้อน OP 14 วัน IP 120 วัน
- **UX:** ไม่มีหน้ารายงาน 5 แบบ ไม่มี print view/ช่องลงนาม ; ar-ledger ซ่อนบัญชี 0 รวม OP/IP ไม่มีจำนวนราย ; หน้า ar-ledger ยาวเกิน (ควรแยกแท็บ) ; ปุ่ม "ดึงยอดล่าสุด" ควรย้ายไป admin ; เมนู "นำเข้า STM" (รับเงิน) แยกจาก "ตัดลูกหนี้" (ลูกหนี้)
- **ข้อเสนอหน้าใหม่ `/fund/ar-report` "รายงานลูกหนี้":** OP/IP × ตั้งลูกหนี้ (DateRangeFilter วันเดียว/ช่วง) หรือคงเหลือ ณ สิ้นเดือน ; HTML table ตามแบบการเงิน แสดงบัญชีที่ 0 ; ปุ่มพิมพ์ (print CSS ซ่อน AppShell, หัวรายงาน, เวลาพิมพ์, ช่องลงนาม 3) + Excel ; ค่าใช้จ่ายจริงอ่าน HOSxP ตอนออกรายงาน (ต้อง prove)
- **คำถามที่ต้องถามการเงิน (ยังไม่ได้ถาม):** (1) วันแบ่งงวด OP (รับบริการ/ออกใบลูกหนี้/ล็อก) และ IP (จำหน่าย/finance_lock) (2) สูตร "เงินตั้งลูกหนี้" .203/.301/.302/102.201 (3) จำนวนลูกหนี้นับ VN/ใบ/คน (4) ปิด .201 สิ้นเดือนด้วยรายการอะไร และ .203/.204/102.201 (5) ลูกหนี้ SSS/อปท./พรบ./ชำระเอง/ต่างด้าว ตัดด้วยเอกสารอะไร ใคร วันไหน (6) เกณฑ์แยก .209/.216/.217/.301/.303/.307–.310/ต่างด้าว/.70x (ขอไฟล์รายรายต่อบัญชี ต.ค. ได้จะเทียบทันที) (7) การเงินตัด .401/.402 ด้วย STM เมื่อไร (8) รายงานที่ลงนามแล้ว HOSxP แก้ย้อนหลัง พิมพ์ใหม่หรือปรับปรุงเดือนถัดไป (9) ใครปิดงวด/ลงนาม
- **ลำดับที่แนะนำ:** ถามการเงิน → แก้ entry_date IP (dchdate/วันล็อก, 01:00 ลงเมื่อวาน) → backfill ทุกเดือน + ตั้ง mapping → `/fund/ar-report` → รายการปิด .201 และรับชำระที่ไม่ใช่ STM (kind ใหม่ลง Dr เงินฝาก, migration + journal.ts) → ปรับเมนู/แท็บ ar-ledger
- ข้อจำกัด: ตัวเลข HOSxP เป็นของ 20 พ.ย. ; ไม่ได้ตรวจกฎแยกตามรายการ (ต้อง scan opitemrece ทั้งเดือน ห้าม)

## รอบ 20 พ.ย. 2569 (PR #64–#68 merge แล้ว, deploy แล้ว main `a6ae7d9`)
- ปิดสิทธิ NHSO: เก็บ `data_error`, รับยา/ER/แผนกจ่ายเอง, ปุ่มปิดสิทธิใน `/opd/admissions`, ตาราง insight เปลี่ยนชื่อเป็น `nhso_save_endpoint_log` ; ค้าง: POST ยังไม่ตรวจ admit/จบบริการ/EP auth_code ฝั่ง server
- `/opd/admissions`: ป้ายปิดสิทธิ HOSxP (info) / BKH Insight (accent กดดู modal), ชื่อสองบรรทัด (เพศ/อายุ) + ปุ่มรายละเอียดหน้าชื่อ (6 grid), ป้ายสถานะเคลมกดดูวันที่ส่ง, ปุ่มคัดลอก HN/VN/AN/เลขบัตร (`CopyButton`)
- `/fund/ar-settle` ตัดลูกหนี้ manual ด้วย STM (migration `202611201700_ar_settle_batch.sql` รันแล้ว) ; ar-sync เลิกตัดหนี้อัตโนมัติ ; ยังไม่ได้ทดสอบกดตัดจริง
- เหตุการณ์: query ของ `/opd/admissions` (vn IN หลายพันค่า + EXISTS opitemrece, ยิงขนานหลายตัว) ค้างบน his จน opitemrece ล็อก หน้าเว็บอืด ; หายเองแล้ว ; เสนอ `max_statement_time` ใน `@/lib/db` (ยังไม่ทำ)

## รอบ 18–19 พ.ย. 2569 (PR #53–#63 merge แล้ว, deploy แล้ว main `a77a267`)
- deploy แล้ว (ทุก migration รันแล้ว):
  - **e-Claim:**
    - ปุ่มส่งออก TEXT/DBF เทียบไฟล์ HOSxP ที่นำเข้าได้จริงแล้ว ได้แก่ INS 19 ช่อง (ไม่มี HCODE) และ DIAG ผ่าน `icd10_nhso` (Z1281→Z128)
    - OOP แผนไทยดึงตอนกดปุ่ม และ 0009 ไม่ส่ง
    - ไฟล์ Service Catalog นำเข้า/ตรวจ อยู่ใน Downloads (`ServiceCatalogImport-11252-2026-11-18*.xlsx`)
  - **16 แฟ้ม FDH:**
    - วันที่เป็น YYYYMMDD
    - ODX ใช้ ICD-10 เท่านั้น และหัตถการจาก ovstdiag ไป OOP
    - C515: AER คู่กับ ORF/IRF, `rfrcs` เป็น IREFTYPE/OREFTYPE, ตรวจ 46 รหัส
    - zip ใส่ครบทุกแฟ้ม
  - **`/opd/admissions`:**
    - ตัวกรอง REP, กองทุนย่อย, ตรวจสอบสิทธิ (SRM) โดยใช้ token จาก `nhso_token` และ cache 24 ชม. ใน `srm_right_check` พร้อมปุ่มยืนยันใช้สิทธิ HIS
    - HCODE(HIS) / สิทธิ(HIS)
    - เลขบัตรใน modal
    - ป้าย Admit ค้าง OPD ใต้ VN
    - สถานะเคลม
  - **`/ipd/admissions`:** ป้าย PDx ขาด/รอสรุป (7 วัน), Ward หลังชื่อ, กล่องเรียกเก็บแล้ว/ไม่มี PDx, By Transfer สีเหลือง, ยอดคำนวณเงินใต้ตาราง (DataGrid `renderFooter`)
  - **สถานะส่งเคลม:**
    - ลำดับหลักฐาน: STM > REP > `fdh_claim_status` > ชุดส่งออก (`claim_batch`)
    - ปุ่มยืนยันส่งแล้ว
    - หน้า `/fdh/claim-batch`
  - **หน้าใหม่:**
    - `/fund/smt-reconcile`: เทียบ SMT กับ STM มีปุ่มดึงใหม่
    - `/fund/claim-type`: แยกประเภทการเรียกเก็บแบบ RiMS (OP)
    - `/admin/cup`
  - **นำเข้า REP/STM อัตโนมัติ:**
    - Chrome extension `extension/eclaim-sync` v1.0.1 ดาวน์โหลด zip ได้จาก modal ใน `/fund/rep-import`
    - สคริปต์ `npm run eclaim:sync`
    - ยังไม่ยืนยันว่าดึงได้ครบกับ e-Claim จริง
  - **skill `.claude/skills/fdh-c-check`:** ใช้แจก รพ. อื่น ถ้าแก้กฎต้องรัน `export_rules.mjs`
  - **หน้าแรก:** ครองเตียงหารด้วย `HOSPITAL_BEDS=90` (ตั้งใน `.env` ของ server แล้ว แต่ `.env` เครื่องนี้ยังไม่ได้ตั้ง)
- **รอผู้ใช้ตัดสินใจ / สอบถาม:**
  1. **`fdh_reservation_status = Y`:** ตอนนี้นับเป็น "ส่งถึง สปสช." แต่ผู้ใช้สงสัยว่าเป็นแค่ "จองเคลม" (เคสเมื่อวานยังไม่น่าส่ง) ถ้าใช่ให้เปลี่ยนเป็น "จองเคลมแล้ว" และไม่นับว่าส่งแล้ว (แก้ใน `src/app/api/fdh/claim-batch/claim.ts`)
  2. **ปรับไฟล์ 16 แฟ้มตาม RCM (`sql4rcm` แถว EXPORT16FILE ใน his):**
     - TYPEIN/TYPEOUT ใช้ `ovstist/ovstost.export_code`
     - IREFTYPE/OREFTYPE กลับเป็น `1100` (IP ใช้ `ipt.iref_type`)
     - LABFU dedupe (vn, labtest)
     - OPTYPE ส่งว่าง (ตกลงแล้ว)
  3. **เกณฑ์ "เกินกำหนด":** admissions ใช้ 30 วัน แต่ claim-pipeline ใช้ OP 15 วัน ยังไม่ตรงกัน
  4. **CUP:** ค่าเริ่มต้นตอนนี้ใช้อำเภอเดียวกัน (24 แห่ง) แต่ `hospcode_cup` ของ HOSxP มี 20 แห่ง (ar-sync ใช้) เสนอให้ใช้ `hospcode_cup` + 11252
  5. **VA ของ สสจ.พิษณุโลก:** ยังไม่รู้ ตอนนี้รวมไว้ใน "ในจังหวัด"
  6. **ไฟล์ ClaimDetail ของ FDH:** ผู้ใช้ยังไม่เคยเห็น รอสอบถาม
  7. **STP/SSS ในสถานะเคลม:** STP มี `stp_claim_status_log` อยู่แล้ว
  8. **กฎ STP-R111/R113:** ยังอ่าน referout แบบเดิม และใบส่งตัวที่ผูก VN ของ visit ที่ admit (ต.ค. 89 ใบ) ยังไม่ได้ส่งใน ORF/IRF
  9. **C121:** มี 3 AN ที่ `dchtime = 00:00` เป็นข้อมูลผิดใน HOSxP ให้เวชระเบียนแก้
  10. **ยังไม่ได้ทดสอบใน browser:** หน้าใหม่ทั้งหมด (claim-type, admin/cup, claim-batch, smt refresh)
- **ยกเลิก/ไม่ทำ:** UCS ฟอกไต (รพ. ไม่มีบริการ)

## รอบ 17 พ.ย. 2569 (PR #48–#50 merge แล้ว, deploy แล้ว main `b78a309`)
- deploy แล้ว:
  - **#48** หน้าแรก `/`
    - การ์ดภาวะทุพโภชนาการผู้ป่วยใน E40–E46: ตามวันจำหน่าย แยกรหัส โรคหลัก/โรคร่วม, % ของผู้จำหน่าย, Sum AdjRW ต่อ AN ไม่ซ้ำ
    - การ์ดรายเดือนเลือกปีงบได้ (`?mfy=`, `GET /api/home/malnutrition-fy`)
    - **อัปเดต Next.js 16.4.6:** ปิด advisory moderate 7 ตัว ; server รัน `npm ci` แล้ว ; ถ้า dev ตอบ 500 (Turbopack 0xc0000142) ให้ลบ `.next` แล้วเปิดใหม่
  - **#49** `/opd/admissions` และ `/ipd/admissions` ตรึงคอลัมน์ถึงคอลัมน์สิทธิ (`pinColumns` 6)
  - **#50**
    - `/opd/admissions`: OFC ปิดสิทธิด้วย Approval Code EDC ล่าสุด (สูตร PERMITNO) ต.ค. OFC 1,134 ราย มี code 866 ราย
    - `/ipd/admissions`: ตัวกรองกลุ่มโรค `?dx=` และ `?dxpos=all|pdx|sdx` ; นิยามกลุ่มใน `src/lib/dx-groups.ts` (ผู้ใช้เลือกเก็บในไฟล์ ยังไม่ทำหน้า admin)
- ข้อเท็จจริง:
  - **E40–E46 ทั้งหมดลงเป็นโรคร่วม:** FY2569 มี 68 ราย Sum AdjRW 115.0292 (ค่า 17 พ.ย.) คิดเป็นราว 0.6% ของผู้จำหน่าย อาจลงรหัสไม่ครบ ต้องถามเวชระเบียน
  - **มี 61 visit ใน opd/admissions ที่มีเลขปิดสิทธิแต่ claim_status ไม่ใช่ closed:** `CLOSED_SQL` กับ `CLOSE_CODE_SQL` นิยามต่างกัน ยังไม่แก้
- **กองทุนต่างด้าว (FWF/NRH)** ศึกษาไฟล์ Downloads แล้ว ยังไม่ลงมือ
  - **ไฟล์ "หมวดรายการเบิกจ่าย 19 หมวด และการบันทึกข้อมูลต่างด้าว.xlsx":**
    - mapping หมวด→CHA→ADP เหมือน STP
    - FWF จ่ายเฉพาะ 79 รหัส: IP RW≥4/โรคเฉพาะ/SC01, OPCA/OPHD/crypto, อุปกรณ์, ARV/Lab HIV, Norplant, วัคซีน
  - **ไฟล์ "รหัสปฏิเสธ ประกันสุขภาพคนต่างด้าว...xlsx":** มี 48 รหัส เลข 186/193/999 ชนกับรหัส C ของ สปสช. → ต้องใส่ prefix `FWF-`
  - **เสี่ยงในแฟ้มที่เราส่งออกตอนนี้:** CHA แยกตามวัน (5504), ADP TYPE หมวด 2/9/15/19 (5505/5509), UUC=1 ตายตัว
  - **P0 รอการเงินตอบ:** ส่งผ่าน FDH ไหม, INSCL/PERMITNO ของต่างด้าว, จ่ายเฉพาะ 79 รหัสจริงไหม
  - ขั้นต่อไปเมื่อได้คำตอบ: P1 นำเข้ารายการเข้า `fund_claim_item` → P2 กฎ `FWF-` โครงสร้าง → P3 กฎรายการ/อายุ → P4 กฎ ICD
- **Lab catalog** ผู้ใช้ให้พักไว้ ทำต่อทีหลัง
  - **`Downloads/11252 - โรงพยาบาลบางระกำ - LabCatalog.xlsx` (จาก FDH, ยึดไฟล์นี้):**
    - header แถว 5, 15 คอลัมน์: สิทธิประโยชน์, รหัสกรมบัญชีกลาง, ชื่อ, หน่วย, ราคากลาง, gyear, วันที่เริ่ม/สิ้นสุด `dd-mm-yyyy HH:MM`, flag, TMLT Code/Name, Lab Code, LOINC, Exception
    - 141 รายการ × 4 สิทธิ (OFC/SSS/STP/UCS) = 564 แถว
    - Lab Code 7 หลัก (น่าจะ `nondrugitems.icode` ยังไม่พิสูจน์)
    - 7 รายการไม่มีรหัสกรมบัญชีกลาง (6 รายการ TMLT 390013 ราคา 0)
  - **`Downloads/eclaimexport-11252.xls` (e-Claim, OFC):**
    - 199 รายการไม่ซ้ำ จาก 394 แถว
    - LABCode เป็น `lab_items_code` คนละชุดกับ FDH → เทียบด้วย TMLT ได้ตรง 126 รหัส
    - ราคาไม่ตรง FDH 33 รายการ
  - **แผน:**
    1. migration `catalog_file.kind` + `lab_fdh` และตาราง `lab_catalog_fdh` (UNIQUE file_id, line_no)
    2. parser + test
    3. แท็บ "Lab catalog FDH" ใน `/catalog/standard-codes` (คงแท็บ สกส. ไว้รอไฟล์ สกส.)
    4. เทียบ HOSxP: icode มีและเปิดใช้, `nondrugitems.tmlt_code` เทียบ FDH (กระทบ ADP), Lab ที่คิดเงินแต่ไม่อยู่ใน catalog, ราคา — ต้อง prove คอลัมน์ `lab_items`/`nondrugitems` ก่อน
- **NHSO Secure SmartCard Agent:** ดูหัวข้อรอบ 16 พ.ย. ยังไม่ใช้ รอเอกสาร `save-endpoint` จาก สปสช.
- **ค้างจากรอบก่อน:** นำเข้า REP สิทธิอื่นบน server, ถามบัญชีเรื่องวันที่ออก STM, uc-debtor กรอง UCS, claim-pipeline แยกวันที่ REP ตามสิทธิ
- **ตรวจผล:** `node --test src/lib/dx-groups.test.mjs src/app/api/home/overview/malnutrition.test.mjs src/app/api/ipd/admissions/admissions.test.mjs src/app/api/opd/admissions/admissions.test.mjs` ; `npx tsc --noEmit` ; `npx eslint src`

## รอบ 16 พ.ย. 2569 (PR #46 และ #47 merge แล้ว, deploy แล้ว main `5a62cea`)
- deploy แล้ว:
  - #46
    - **precheck:** ใบลูกหนี้ตรงแต่ vn_stat ค้าง (ลบค่าธรรมเนียม 30 บาทตอนยกเว้น: income คำนวณใหม่ แต่ paid_money ค้าง) ขึ้นเป็น stale_stat
    - **ใบค้างหลัง admit:** เลือกหลายรายบน precheck แล้วส่งคำขอปรับปรุงลูกหนี้ (`POST /api/fund/ar-adjust/stale-slip`) ; อนุมัติหลายรายการใน ar-ledger ; guard ห้ามลดหนี้จนติดลบทุกการอนุมัติ ; สถานะ stale_fixed
    - **admissions:** คอลัมน์ REP ใน `/opd/admissions` และ `/ipd/admissions` (badge เลขที่ REP กดเปิด RepDetail, `fund/_lib/rep.ts`)
    - **REP สิทธิอื่น:** นำเข้า REP IPCS/IPLGO/OPBKK/OPBMT/OPLGO ; migration `202611161200_rep_scheme.sql` (`rep_row.scheme`) **รันแล้ว** ; uc-dashboard/ar-funds/freshness กรอง UCS
    - **stm-import:** ป้ายวันที่เป็น "วันที่ออก STM"
    - **หน้าใหม่ `/fund/ar-precheck-summary`:** ลูกหนี้ = income − rcpt − PPFS (PPFS = income 21 paidst 02)
  - #47 `/fund/claim-pipeline` กดเงินเข้า STM / ชดเชยสุทธิ REP เปิด modal รายละเอียด (`/api/fund/claim-pipeline/stm` SQL ต้องเลือกแถวชุดเดียวกับ `STM_SQL`)
- ข้อเท็จจริง (ตรวจกับฐานแล้ว):
  - **ใบค้างหลัง admit:** ค่าบริการผู้ป่วยนอก 3001647 (50 บาท, income 12 → `vn_stat.inc14` เพราะ inc = income_group) ถูกแทนด้วยค่าบริการ IPD 300 ; หน้าจอ HOSxP XE ไม่แสดงรายการให้ลบ (กดบันทึกแล้วยอดค้างบนจอหาย แต่ฐานไม่เปลี่ยน ใบ 711294 ยังอยู่) ; ต.ค. 140 ราย ใบละ 50 บาท ลงสมุดแล้วครบ
  - คู่มือ BMS XE การเงิน OPD-IPD ข้อ 10 มี "ยกเลิกใบแจ้งหนี้" ใน Finance Entry → ให้การเงินลองกับ VN 691001000140 ก่อนใช้ปรับปรุงในสมุด
  - แหล่งอ้างอิงยืนยันวิธีเดิม: OPD = `rcpt_debt` − cancel ; IPD = `finance_lock` + `an_stat.uc_money` ; `vn_stat` เป็น snapshot ใช้แค่เทียบ
  - **e-Claim:** TRAN_ID เป็นเลขกลางทุกสิทธิ ไม่ชนกัน ; rep-import กันซ้ำด้วยชื่อไฟล์ + sha256
  - **NHSO Secure SmartCard Agent 1.2.4** (`C:\secureagent-1.2.4`, localhost:8189, prod) มี `POST /api/nhso-service/save-endpoint` (ปิดสิทธิผ่าน kiosk token) ไม่มี recorderPid/sourceId ; ความหมาย paidAmount/privilegeAmount ใน swagger สลับกับของเรา ; ไม่มีเอกสาร → ยังไม่ใช้ ; API อ่าน token ได้โดยไม่ต้องยืนยันตัวตน (แจ้งผู้ดูแลเครื่อง)
- ค้าง:
  1. **นำเข้า REP สิทธิอื่นบน server:** ไฟล์อยู่ที่ Desktop `IPเบิกได้ตค_พย69` (26 ไฟล์) แล้วตรวจ badge REP / ภาพรวม UC ไม่ปน
  2. **ทดสอบหลัง login:** ar-precheck-summary, ปุ่มปรับปรุงลูกหนี้ (ลอง 1–2 รายก่อน, อนุมัติต้องใช้ admin อีกคน), คอลัมน์ REP, modal STM/REP ใน claim-pipeline
  3. **ถามงานบัญชี:** ลงรับเงินตาม "วันที่ออก STM" ได้ไหม (ตอนนี้ settle ใช้ `stm_file.transfer_date` เป็น entry_date) ; วันที่ออก STM = วันที่ออกรายงานในไฟล์หรือไม่
  4. **แก้ต่อได้ทันที:** uc-debtor กรอง REP เฉพาะ UCS ; claim-pipeline แยกวันที่ไฟล์ REP ล่าสุดตามสิทธิ ; อปท./กทม./ขสมก. ไม่มี STM จะค้าง "รอ Statement" ตลอด
  5. ar-sync `planCancels` ควรคิดจากยอดทุก source (ถ้าวันหลังยกเลิกใบได้ จะลด −50 ซ้ำกับ manual)
  6. ar-precheck-summary SQL ซ้ำกับ ar-precheck → รวม loader เดียว
  7. ข้อค้างของรอบ 15 พ.ย. ข้อ 3–5 ยังอยู่
- ตรวจผล: `node --test src/app/api/fund/ar-precheck/precheck.test.mjs src/app/api/fund/ar-adjust/adjust.test.mjs src/app/api/fund/rep-import/rep.test.mjs src/app/api/opd/admissions/admissions.test.mjs src/app/api/ipd/admissions/admissions.test.mjs src/app/api/fund/ar-precheck-summary/summary.test.mjs src/app/api/fund/claim-pipeline/pipeline.test.mjs` ; `npx tsc --noEmit` ; deploy: merge PR (รอ CI) → `npm run db:migrate` (ถ้ามี) → server `git pull` main, `npm run build`, `sudo systemctl restart bkh-insight`

## รอบ 15 พ.ย. 2569 (PR #41–#45 merge แล้ว, deploy แล้ว main `34b46df`)
- deploy แล้ว:
  - #41 16 แฟ้มตามประกาศ e-Claim 2564 รอบ 1 + กฎ C565 (42 รหัส) ; คำถามรอบ 2 อยู่ใน artifact ส่วนตัว https://claude.ai/artifact/QB1TGYVbAVq96KmUDi2VTh (ถ้าจะแชร์ทีมต้องกด Share → anyone with the link เอง)
  - #42 `/fund/ar-precheck` ตรวจค่ารักษาก่อนตั้งหนี้, งบทดลองใน `/fund/ar-ledger`, ปิดงวด `/admin/ar-periods` (migration `202611151200_ar_period_close.sql`, trigger `ar_ledger_period_guard`) — ปิดงวดยังไม่ได้ เพราะมีแถวไม่มีบัญชี 415 แถว (INS/BKK/NRH/SSI/บาง UCS) ต้องตั้งที่ `/admin/ar-accounts` ก่อน
  - #43 modal ลากได้ (`DetailModal draggable`)
  - #44 ปุ่ม "ดึงใหม่" รายคน `POST /api/fund/ar-sync/case` (migration `202611151800_ar_sync_case.sql`, `ar_sync_log.mode='case'`) ; ทดสอบจริงแล้วกับ VN 691115075929 (ครั้งแรกตั้ง 163, กดซ้ำไม่ลงซ้ำ)
  - #45 สถานะ OPD ใหม่ใน precheck จาก `ovst.finance_lock` (admit แล้ว / ใบลูกหนี้ค้างหลัง admit / ยังไม่ล็อก / ค้างล็อก > 3 วันทำการ / ยอดสรุป HOSxP ไม่อัปเดต / คีย์รายการหลังออกใบ) ; modal ใช้ DataGrid `localState` แบ่งหน้า 100 + ตัวกรองหัวคอลัมน์ + ตรึง ; FdhPreviewModal แบ่งชุดละ 1,000 (เลือกได้ OPD 5,000 / IPD 2,000)
- ข้อเท็จจริงจากหน้างาน (ตรวจกับฐานแล้ว):
  - การเงินล็อกรายการ OPD ราว 16:00 ทุกวัน (`ovst.finance_lock='Y'` ไม่มีเวลาที่ล็อก) หลังล็อก ใบลูกหนี้ตรงรายการ 99.6% ; ใบ batch ออกวันถัดไป 16–19 น.
  - ปิดสิทธิใน HOSxP (`nhso_confirm_privilege`, 1 แถว/vn) ออกใบลูกหนี้วินาทีเดียวกัน ; คีย์เพิ่มหลังปิดสิทธิ → ตอนล็อกได้ใบที่สอง แต่ยอดที่แจ้ง สปสช. ไม่ถูกแก้ (~5% ต่ำกว่าจริง)
  - HOSxP XE ย้ายรายการทั้งหมดไป AN ตอน admit และไม่แสดงรายการค้าง (v3 ยังเห็น) → ใบลูกหนี้ OPD 50 บาทค้าง ต.ค. ~140 ราย ~7,000 บาท
  - `his` ต่อกับ replicate ไม่ใช่เครื่องจริง (ล็อก opitemrece แค่ทำ replication ช้า)
  - ใบลูกหนี้ออกตาม `opitemrece.finance_number` (เคส 691008072732 บิลรอง 40 บาทไม่มีใบ)
- ค้าง / พรุ่งนี้:
  1. ใส่คำแนะนำวิธีแก้ในรายละเอียดสถานะ "แยกชำระ/ลูกหนี้ไม่ตรง" + แสดงว่าฝั่งชำระเอง/ลูกหนี้ต่างเท่าไร (รอผู้ใช้ตอบ)
  2. ถามหน้างาน: XE ยกเลิกใบลูกหนี้ OPD ของรายที่ admit ได้ไหม (ถ้าไม่ได้ ใช้ขอปรับปรุงลูกหนี้ในสมุดแทน)
  3. AGENTS.md ยังเขียนว่าอ่าน opitemrece นานบล็อก HOSxP ทั้งโรงพยาบาล → เสนอแก้ให้ตรงว่าเป็น replicate (รอผู้ใช้อนุมัติ)
  4. เทียบยอดปิดสิทธิ (`nhso_privilege_amount`) ใน precheck — ข้อมูลพร้อม (JOIN ด้วย vn ห้าม JOIN ด้วย debt_id ไม่มี index) ยังไม่ได้สั่งทำ
  5. ดึง SMT (API สาธารณะ budgetSummaryByVendorReport) และ 16 แฟ้มรอบ 2 รอทีมตอบ
  6. ยังไม่ได้ทดสอบหลัง login: precheck สถานะใหม่/modal, แบ่งชุด 16 แฟ้มเกิน 1,000 ราย
- ตรวจผล: `node --test src/app/api/fund/ar-precheck/precheck.test.mjs src/app/api/fund/ar-sync/ledger.test.mjs src/components/fdh-preview/batch.test.mjs` ; `npx tsc --noEmit` ; deploy ตามขั้นตอนใน deploy_guide.md (git pull main, npm ci, db:migrate, build, restart ด้วย sudo)

## รอบ 14 พ.ย. 2569 ค่ำ (PR #37 merge แล้ว, deploy แล้ว main `b32835e`)
- deploy แล้ว: `/fund/close-privilege` (ปิดสิทธิ สปสช. เลือกทีละราย), `/catalog/service-catalog` (UC 8,775 / OFC 2,019 / STP 6,739 แถว, เทียบ HOSxP 7 กฎ), `/fund/claim-pipeline` OFC ผู้ป่วยนอกขั้น 2 ใช้ Approval Code EDC (`ovst_seq.edc_approve_list_text`)
- GH_TOKEN เป็น classic `ghp_` (public_repo) แล้ว agent สร้าง/merge PR เองได้ ; main มี CI ต้องผ่านก่อน merge (`gh pr checks <n> --watch`) ; VS Code ที่ยังไม่ restart ยังถือ token เก่า ให้อ่านจาก User env
- ปิดสิทธิยังใช้จริงไม่ได้: ต้องขอจาก สปสช. แล้วตั้งใน `.env` ของ server: `NHSO_ENDPOINT_URL`, `NHSO_ENDPOINT_TOKEN`, `NHSO_ENDPOINT_CLAIM_PATH`, `NHSO_ENDPOINT_SOURCE_ID` (HOSxP ไม่มีค่าเหล่านี้ ; ห้ามใช้ `BMS01` และห้ามอ่าน token จาก `nhso_token` (รายคน) หรือ `sys_var` NHSO-CONFIRM-PRIVIVLEGE-API-TOKEN — ถ้าจะใช้ token กลางเดียวกันต้องถาม สปสช. ก่อน)
- **ค้าง: ตั้งผู้บันทึกอัตโนมัติจาก HOSxP** (แทนให้ admin กรอก `his_doctor_code`):
  - his พร้อม: `officer.officer_cid_hash256` = SHA2(officer_cid,256) hex ตัวเล็ก ; officer active + cid 13 หลัก 291 คน ไม่ซ้ำ มี `officer_doctor_code` ครบ ; 11 คน active ไม่มี cid ที่ใช้ได้
  - insight ยังไม่มีคีย์: Health ID ขอ scope `openid profile email organization` ได้แค่ email/ชื่อ/org/sub (UUID) ไม่มี hash_cid
  - ขั้นต่อไป: ผู้ใช้หา scope/claim ของ PLK Health ID ที่ให้ `hash_cid` → เพิ่ม scope ใน `src/auth.ts` → ตอน sign-in query `SELECT officer_cid, officer_doctor_code FROM officer WHERE officer_cid_hash256 = ? AND officer_active = 'Y'` ได้ 1 แถวพอดีจึงตั้ง ไม่งั้นปล่อยให้ admin ตั้ง ; recorderPid ใช้ `officer_cid` ได้ตรง (อ่านตอนยิง ห้ามเก็บเลขบัตรใน insight) ; ทดสอบกับบัญชีจริงว่า hash ตรงก่อนเปิดใช้ ; SQL ต้อง prove ก่อน
- ค้างอื่น: STP claim rules/C-check (UCAE, USE_STATUS, refer, รหัสตัวใหญ่) จากไฟล์หมวด 19 หมวด ; OFC 256 visit ไม่มี Approval Code ต้องถามการเงิน ; แถว STP ชีต 1.OPAE ยังไม่มีคอลัมน์ "การบันทึกข้อมูล 16 แฟ้ม" จนกว่าจะนำเข้าไฟล์ใหม่

## รอบ 14 พ.ย. 2569 (PR #34 merge แล้ว, deploy แล้ว main `c1cb251`)
- ใหม่ (รายละเอียดอยู่ใน AGENTS.md หัวข้อสมุดลูกหนี้ และ skill `uc-ar-subaccounts` ข้อ 7):
  - `/admin/ar-funds`: กติกากองทุนย่อย `ar_fund_rule` (items/rights/icd, pttype, ICD ช่วง+PDX, รายการจำเป็น) + กิจกรรมย่อย `ar_fund_activity` ; ตรวจเทียบ REP รายเดือนพร้อมเหตุผล, อัตราได้รับรายรายการ, รายการพบบ่อยในเคสได้รับ/ไม่ได้รับ (ปุ่มเพิ่มเข้ากติกา)
  - ar-sync ตัดหนี้ด้วย STM (`settle.ts`: settle + diff ปิดหนี้ทั้งก้อน) เฉพาะ `ar_account.settles_by_stm` (.202 .209 .216 .217 .222 .401 .402 ; ไม่ตัด .201 .203 .204) — STM ที่มีตอนนี้ (UCS OP 1 ไฟล์) จับได้แต่ .201/.203 จึงยังไม่มีแถวตัดหนี้
  - `/fund/ar-ledger`: สมุดรายวัน Dr/Cr + Excel, คำขอปรับปรุงลูกหนี้ (ขอจาก modal แถว, admin อีกคนอนุมัติ), แถบความสดของข้อมูล ; `/admin/ar-accounts`: บัญชีรายได้คู่/ส่วนต่าง/ตัดด้วย STM
  - `access_log` (proxy บันทึกทุก /api/*) ดูที่ `/admin/access-log`
  - `/fdh/claim-codes` ความพร้อมรหัสเบิก: INST 376 รหัสจากประกาศ สปสช. 2568 (`claim_code`) ; PP = `nhso_adp_code` ประเภท 4 + FP/1B0 ของ HOSxP ; ผล: INST ต้องแก้ 68 รายการ (มีรหัสในประกาศที่มีรายการใน HOSxP 38/376, ET tube 3001/3002 ไม่อยู่ในประกาศแล้ว), PP ต้องแก้ 4 (HPV ไม่มีรหัส)
- พิสูจน์แหล่งยอดแล้ว: `rcpt_debt` ตรง opitemrece paidst 02 99.1% (ต่อ VN) ; `an_stat.uc_money` ตรง 662/664 AN → ไม่ต้องเปลี่ยนแหล่งยอด
- GH_TOKEN ใหม่ (bkhadmin) ใช้ได้แล้ว แต่ยังไม่เคยลอง `gh pr create` ด้วย token นี้
- ค้าง/ต่อได้:
  - ตั้งกิจกรรมย่อยของ PP แทนหมวด 21 (หมวด 21 นับ 503 ราย vs REP 150) ใช้ตาราง "เคสได้รับ/ไม่ได้รับ" ช่วยเลือก ; HC/AE ยังไม่มีเงื่อนไข
  - ส่งรายการ "ต้องแก้" จาก `/fdh/claim-codes` (Excel) ให้ admin HOSxP ; INST ประกาศแก้ไขหลัง 2568 ต้องเพิ่มด้วย migration ใหม่ ; รายการ PP ทางการ (ไฟล์รหัส) ยังหาไม่ได้
  - ยังไม่ได้ทดสอบบันทึกจริง: กิจกรรม/กติกา, บัญชีคู่, คำขอปรับปรุง+อนุมัติ (ต้องใช้ admin 2 คน) ; `access_log` ยังไม่มีการลบข้อมูลเก่า
  - งาน STP/NRH (หัวข้อถัดไป) ยังไม่เริ่ม

## งานถัดไป: เคลมผู้มีปัญหาสถานะ (สท./STP) และต่างด้าว (NRH) ถึงส่งผ่าน FDH
- deploy แล้วถึง PR #33 (main `0c769f2`): ตัวกรองหัวคอลัมน์ทุกหน้า DataGrid, แถวต่อหน้า "ทั้งหมด", OPD/IPD แยกรายสิทธิ (พอดีจอ ตรึง/ย้าย/ซ่อนคอลัมน์), modal 16 แฟ้ม กรองเฉพาะติด C + Excel
- ข้อมูลจริงในระบบ (ตรวจด้วย db-cli 13 พ.ย. 2569):
  - pttype `ST` (สิทธิเบิกกลุ่มงานประกันสุขภาพ สธ.) และ `65` → hipdata `STP` ; `99` (ต่างด้าวขึ้นทะเบียน) และ `64` (แรงงานต่างด้าวเบิกส่วนกลาง) → `NRH` ; ปีงบ 2569: ST 52 visit, 99 260 visit
  - 16 แฟ้ม: INSCL = hipdata_code (STP ถูกแล้ว) แต่ PERMITNO = `ovst.pttypeno` ขณะที่ FDH ให้ใส่ Authen Code → ต้องตรวจ
  - `ar_ledger`: NRH 57 แถว 67,205 บาท ไม่มีบัญชี (ไม่มี mapping) ; STP ผูก .701 (OP) / .704 (IP) แล้ว ; บัญชีต่างด้าวมีในผัง 1102050101.501–.506
  - `rep_row` ไม่มี STP/NRH (REP สปสช. ไม่ครอบคลุม) ผลเคลมสองกองทุนนี้ยังไม่อยู่ในระบบ
- สรุปจากเอกสาร (สไลด์อบรม HINT กองเศรษฐกิจสุขภาพฯ 27 มี.ค. 2567 เป็นหลัก):
  - ลงทะเบียน/ตรวจสิทธิใน HINT (เลข 13 หลัก ; กลุ่มเลข 6/7 หลักที่ 6–7 ≥ 50, 0xxxx89xxx, 0xxxx00xxx) ประชาชนตรวจที่ fdh.moph.go.th/inscl
  - ส่ง 16 แฟ้ม (INS INSCL=STP, ต้องมี INS/PAT/CHT + OPD หรือ IPD) → FDH (Web Portal หรือ API) → Pre-Audit → **กดส่งเคลมเองที่เมนูกองทุน STP** (UC FDH ส่งให้อัตโนมัติ) → 10 สถานะ → REP/STM ในเมนู REP ; ข่าวว่าโอนใน 15 วัน
  - ADP TYPE ↔ CHA CHRGITEM ต่อหมวด (1:10/11-12, 2:2/21-22, 3:DRU USE_STATUS=1/31-32, 4:DRU USE_STATUS=2/41-42, 5:11, 6:14, 7:15, 8:16, 9:9, 10:18/A, 11:19/B, 12:17/C, 13:12/D, 14:20/E, 16:G, 19:3,6,7/J)
  - ติดต่อ STP: Line `STP_HINT@MOPH`, 02-590-1577
  - ต่างด้าว: ยังไม่ยืนยันช่องทางเบิกปัจจุบัน (เดิม fwf.cfo.in.th ; ข่าว ต.ค. 2568 จะมี FDH–Migrant Platform ทั่วประเทศ ม.ค. 2569) ; อัตราจ่ายปี 2569 ของ STP/ต่างด้าวยังไม่พบประกาศ (ตัวเลข 700 บาท/OP, 9,600–10,300/AdjRW เป็นเอกสารเก่า)
- ตัวเลือกที่เสนอผู้ใช้ (รอเลือก): (1) ผูกบัญชี NRH (.505/.506 ส่วนกลาง หรือ .501/.502 ใน CUP — ผู้ใช้ต้องตัดสิน) (2) ตรวจ PERMITNO = Authen Code (3) หน้าคิว STP (authen/ส่ง 16 แฟ้ม/ค้าง) (4) กฎตรวจ C เฉพาะ STP (ADP/CHA, DRU USE_STATUS) (5) นำเข้า REP/STM ของกองทุน STP (ต้องได้ไฟล์ตัวอย่างจริง) (6) ต่างด้าวรอยืนยันช่องทาง
- ตรวจผล: `npx tsc --noEmit`, `npm run lint`, `node --test <ไฟล์ .test.mjs>` ; deploy ตามขั้นตอนท้ายไฟล์นี้

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
- `node --test src/app/api/fund/ar-sync/ledger.test.mjs src/app/api/fund/uc-debtor/items/items.test.mjs src/app/api/fund/rep-import/*.test.mjs src/app/api/fund/stm-import/stm.test.mjs src/app/api/fdh/c-check/fdh.test.mjs src/app/api/fund/ar-sync/settle.test.mjs src/app/api/fund/ar-journal/journal.test.mjs src/app/api/admin/ar-funds/rules.test.mjs src/app/api/fdh/claim-codes/readiness.test.mjs`
- deploy: `cd /var/www/bkh-insight && git pull --ff-only && npm ci (ถ้า lockfile เปลี่ยน) && npm run db:migrate && npm run build && sudo systemctl restart bkh-insight`
- timer: `systemctl list-timers bkh-insight-ar-sync.timer` ; `journalctl -u bkh-insight-ar-sync.service`
