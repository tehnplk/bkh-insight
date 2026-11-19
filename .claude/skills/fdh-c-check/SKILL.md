---
name: fdh-c-check
description: ชุดกฎตรวจรหัสติด C ของ 16 แฟ้ม FDH / e-Claim สปสช. จากฐาน HOSxP ก่อนส่งเคลม (45 รหัส C พร้อมระดับ error/warn/info และกฎกองทุน STP) เป็น SELECT ล้วนแบบ bind parameter ไม่สร้าง view หรือตารางในฐาน HOSxP ใช้ได้ทั้งรันตรวจเร็วด้วย db-cli และสร้างระบบตรวจ (Next.js หรือ Flask) ใช้ skill นี้ทุกครั้งที่ผู้ใช้พูดถึง ตรวจ C, รหัสติด C, ติด C, ตรวจก่อนส่งเคลม, ตรวจ 16 แฟ้ม, FDH, e-Claim, REP ตีกลับ, C-check, backtest กับ REP หรือขอนับจำนวนเคสที่น่าจะติด C จาก HOSxP แม้ไม่ได้บอกชื่อ skill และให้ใช้แทน fdh-pre-validate เมื่อฐานต้องอ่านอย่างเดียวหรือต้องการกฎครบกว่า
---

# fdh-c-check: กฎตรวจรหัสติด C ของ 16 แฟ้ม FDH (อ่านอย่างเดียว)

skill นี้คือกฎตรวจ C ชุดเดียวกับที่ BKH Insight ใช้งานจริงที่หน้า `/fdh/c-check` ส่งออกเป็นไฟล์ SQL ให้โรงพยาบาลอื่นใช้กับ HOSxP ของตัวเอง
ทุกไฟล์เป็น `SELECT` (ขึ้นต้นด้วย `WITH`) statement เดียว รับค่าเป็น bind parameter `?` ไม่สร้าง view ตาราง หรือเขียนอะไรลงฐาน
จึงรันกับฐาน replica หรือ user ที่มีสิทธิ์ `SELECT` อย่างเดียวได้ ต่างจาก `fdh-pre-validate` ที่ต้องสร้าง view 20 ตัวในฐาน HOSxP

สิ่งที่ได้มากกว่า `fdh-pre-validate` (22 รหัส): 45 รหัส C, ระดับ error/warn/info ที่ปรับจาก backtest กับ REP จริง, กฎกองทุน STP 13 กฎ,
กฎแล็บหมวด 07, C305/C349 (Authen), C565 (ยานอกบัญชี OFC/LGO) และกฎของแฟ้ม ADP/DRU/CHA/CHT ที่อ่าน `opitemrece`

## ไฟล์ใน skill

| ไฟล์ | หน้าที่ |
|---|---|
| `sql/{op,ip}/summary.sql` | จำนวนเคสต่อรหัสของทุกแฟ้มที่ไม่อ่าน `opitemrece` ใน statement เดียว คืน `c_code, fdh_file, n` |
| `sql/{op,ip}/summary_{ADP,DRU,CHA,CHT}.sql` | จำนวนเคสต่อรหัสของแฟ้มที่อ่าน `opitemrece` แฟ้มละ statement |
| `sql/{op,ip}/cases_<แฟ้ม>.sql` | รายเคสของแฟ้มที่มีกฎ คืน `c_code, hn, an, seq, found` ไม่เกิน 1,000 แถว (LIMIT อยู่ท้ายไฟล์) |
| `sql/{op,ip}/rows_<แฟ้ม>.sql` | จำนวนแถวของแฟ้ม (ทุกแฟ้ม รวมแฟ้มที่ยังไม่มีกฎ) คอลัมน์ผลตาม `manifest.json` |
| `sql/preflight.sql` | ตารางที่กฎอ่านแต่ฐานนี้ไม่มี (ผลว่าง = ครบ) ไม่มี parameter |
| `sql/manifest.json` | สารบัญให้แอปอ่าน: แฟ้มตามลำดับ, รหัสที่ตรวจต่อแฟ้ม, ไฟล์ SQL และชื่อ parameter ตามลำดับของแต่ละไฟล์ |
| `references/c_codes.json` | dictionary รหัส C (ของ `fdh-pre-validate` + C952 + `STP-*`) `codes["<รหัส>"].detail` เงื่อนไข `.fix` แนวทางแก้ `.level` ระดับ (มีเฉพาะรหัสที่มีกฎ) |
| `references/levels.json` | ระดับของทุกรหัสที่มีกฎ |
| `scripts/fill_params.mjs` | แทน `?` ด้วยค่าที่ตรวจรูปแบบแล้ว สำหรับรันด้วย db-cli (ซึ่งไม่มี bind parameter) |
| `scripts/export_rules.mjs` | (ใช้ใน repo BKH Insight เท่านั้น) สร้างไฟล์ทั้งหมดข้างบนใหม่จาก `src/app/api/fdh/c-check/checks.ts` |

ไฟล์ใน `sql/` และ `references/` ถูกสร้างจากโค้ด ห้ามแก้มือใน repo BKH Insight (test จะล้ม) โรงพยาบาลที่นำไปใช้แก้ในสำเนาของตัวเองได้

## หมวดและช่วงวันที่

- **OP/PP (`op`):** เลือก visit ด้วย `ovst.vstdate BETWEEN start AND end` (ไม่รวม visit ที่ admit)
- **IP (`ip`):** เลือก admission ด้วย `ipt.dchdate BETWEEN start AND end` แล้วอ่านทุกรายการของ AN นั้น (`opitemrece` ด้วย `ix_an`) รายการที่เกิดก่อนวันเริ่มจึงติดมาครบ

ให้เรียกหมวดผู้ป่วยในว่า "IP" ส่วน "IPD" เป็นชื่อแฟ้ม ลำดับแฟ้มอยู่ใน `manifest.json` (`types.op.files`, `types.ip.files`)

## Parameter

ทุกไฟล์มีหัว comment บอกจำนวนและชื่อ parameter ตามลำดับ `?` (ดู `manifest.json` ด้วย) มีได้ 3 แบบ:

| จำนวน | ไฟล์ | ลำดับ |
|---|---|---|
| 2 | `rows_*` | `start, end` |
| 4 | `summary.sql`, `cases_*` ส่วนใหญ่ | `start, end, sel_json, closed_json` |
| 6 | ทุกไฟล์ items ของ `op` และ `ADP` ของ `ip` | `start, end, sel_json, closed_json, lab_csv, cat_csv` |

- `start`, `end`: `YYYY-MM-DD` (ค.ศ.) แนะนำไม่เกิน 31 วันต่อครั้ง (เหตุผลในหัวข้อ `opitemrece`)
- `sel_json`: JSON array ของ VN (op) หรือ AN (ip) แบบตัวเลข เช่น `[690915083012]` ใช้ตรวจเฉพาะรายที่เลือก `'[]'` = ทั้งช่วง มีผลเฉพาะ `cases_*`
  กฎที่เทียบข้ามราย (C151, C152, C179) ยังเทียบกับรายอื่นในช่วงได้ครบ เพราะกรองหลังคำนวณ
- `closed_json` (ทางเลือก): VN ที่ปิดสิทธิสำเร็จผ่านระบบอื่นที่ผลไม่ย้อนเข้า HOSxP ส่งให้ C305/C349 ไม่นับรายนั้น ไม่มีระบบแบบนี้ส่ง `'[]'`
- `lab_csv` (ทางเลือก, C914): icode ของแล็บที่ได้ TMLT คั่นด้วย `,` — `cat_csv` (ทางเลือก, C190): Lab Code ใน Lab Catalog FDH ของหน่วยบริการ
  ส่ง `''` = แล็บหมวด 07 **ทุกรายการ** ติดรหัสนั้น ดูหัวข้อ "กฎที่ต้องมีข้อมูลเสริม"

MariaDB ไม่รองรับ `CAST(? AS JSON)` จึงส่ง `sel_json`/`closed_json` เป็น string แล้วแตกด้วย `JSON_TABLE` ใน SQL
ใน SQL ไม่มี `?` อื่นนอกจาก parameter (regex ใช้ `{0,1}` แทน `?`) อย่าเพิ่ม `?` ในข้อความหรือ comment เพราะ driver จะนับเป็น parameter

## รันตรวจเร็วด้วย db-cli (อ่านอย่างเดียว)

ต้องมี [db-cli](https://github.com/tehnplk/db-cli) และ Node.js อ่านค่าเชื่อมต่อจากที่ผู้ใช้เก็บไว้ ใส่รหัสผ่านผ่าน `DB_PASSWORD='...'` หน้าคำสั่ง ไม่ใช้ `-p`
อย่าใส่ `-w` db-cli จะปฏิเสธคำสั่งเขียนให้เอง (`fill_params.mjs` เปลี่ยน `REPLACE(x, '.', '')` เป็น `REGEXP_REPLACE` ให้แล้ว เพราะ db-cli เข้าใจว่าคำว่า REPLACE เป็นคำสั่งเขียน)

```bash
cd <โฟลเดอร์ skill>
# 0) ตารางครบไหม (ผลว่าง = ครบ)
DB_PASSWORD='...' db-cli -g my -H <host> -P <port> -u <user> -d <db> -e "$(node scripts/fill_params.mjs sql/preflight.sql 2026-11-16 2026-11-16)"
# 1) จำนวนเคสต่อรหัส: summary.sql ก่อน แล้ว summary_ADP/DRU/CHA/CHT ทีละไฟล์ (ห้ามยิงพร้อมกัน)
DB_PASSWORD='...' db-cli -g my ... -e "$(node scripts/fill_params.mjs sql/op/summary.sql 2026-11-16 2026-11-16)"
DB_PASSWORD='...' db-cli -g my ... -e "$(node scripts/fill_params.mjs sql/op/summary_ADP.sql 2026-11-16 2026-11-16 '[]' '[]' "$LAB_CSV" "$CAT_CSV")"
# 2) รายเคสของแฟ้มเดียว เขียนลงไฟล์ (มีข้อมูลผู้ป่วย อย่าแสดงในแชต ลบไฟล์เมื่อเสร็จ)
DB_PASSWORD='...' db-cli -g my ... -e "$(node scripts/fill_params.mjs sql/ip/cases_IPD.sql 2026-11-01 2026-11-30)" -o cases_ipd.txt
```

ผลเป็นตาราง `c_code|fdh_file|n` ค่า `found` ของ C104/C116 คือเลขบัตรประชาชน (db-cli ไม่ปิดให้เพราะชื่อคอลัมน์ไม่ใช่ `cid`) ถ้าต้องแสดงให้ปิดกลางเป็น `1234xxxxx5678`
รายงานผลให้ผู้ใช้เป็นจำนวนต่อรหัสพร้อม `detail`/`fix`/`level` จาก `references/c_codes.json` (ค้นด้วย `"<รหัส>": {` อย่าอ่านทั้งไฟล์)

## รหัสที่ตรวจ

ระดับ: **error** = ติด C แน่ ; **warn** = อาจถูกตีกลับ ; **info** = ยังไม่ยืนยันว่ากองทุนตรวจ ไม่นับเป็นติด C (แสดงแยก)
"ทางเลือก" = ต้องมีข้อมูลเสริม ไม่ส่งแล้วผลจะเพี้ยน (ดูหัวข้อถัดไป)

| รหัส | แฟ้ม | เงื่อนไขที่กฎจับ (สรุป) | ระดับ | ข้อมูลเสริม |
|---|---|---|---|---|
| C101 | PAT | ชื่อหรือนามสกุลว่าง | error | |
| C102 | PAT | วันเกิดว่างหรือเป็นวันในอนาคต | error | |
| C103 | PAT | เพศว่างหรือไม่ใช่ 1/2 (ค่าดิบ ไม่ใส่ค่า default) | error | |
| C104 | PAT | เลขบัตรประชาชนว่าง | error | |
| C116 | PAT | เลขบัตรไม่ใช่ 13 หลัก หรือ check digit ผิด | error | |
| C105 | OPD | HN ว่าง | error | |
| C151 | OPD, IPD | OP visit ซ้อนช่วง admit: UCS/WEL ห่างไม่ถึง 4 ชม., OFC/LGO ภายใน 24 ชม. ก่อน admit | info | |
| C179 | OPD | HN เดียวกันมีหลาย visit (ไม่ admit) ในวันเดียวกัน | info | |
| C902 | OPD, IPD | เสียชีวิตก่อนวันรับบริการ/วัน admit | info | |
| C998 | OPD, IPD | เลยกำหนดส่ง 31 ธ.ค. หลังสิ้นปีงบ | warn | |
| C127 | INS (op) | OFC/LGO ไม่มี PERMITNO (OFC = Approve Code EDC ล่าสุดใน `ovst_seq.edc_approve_list_text`) | error | |
| C125 | INS (ip) | OFC/LGO ไม่มีเลขอนุมัติ (`ipt_pttype.claim_code` แล้ว `auth_code`) | error | |
| C305 | INS (op) | UCS/WEL Authen ผิดพลาด (`Er…`) หรือปิดสิทธิแล้วถูกยกเลิกและไม่มีปิดใหม่ | warn | `closed_json` |
| C349 | INS (op) | UCS/WEL ไม่มี Authen เลย (ยกเว้น PP ใน `nhso_smartcard_agent` และรายที่ปิดสิทธิแล้ว) | info | `closed_json` |
| C107 | IPD | วันที่ admit ว่าง | error | |
| C109 | IPD | เวลา admit ว่างหรือไม่ใช่ HHMM | error | |
| C110 | IPD | เวลาจำหน่ายว่างหรือไม่ใช่ HHMM | error | |
| C111 | IPD | ประเภทการจำหน่ายว่างหรือไม่ใช่ 1–9 (ยอม 01–09) | error | |
| C112 | IPD | สถานภาพจำหน่ายว่างหรือไม่ใช่ 1–9 (ยอม 01–09) | error | |
| C114 | IPD | ทารกอายุ 0–27 วันไม่มีน้ำหนักแรกรับ (`ipt.bw` กรัม → กก.) | error | |
| C153 | IPD | ทารกอายุ 0–27 วัน น้ำหนัก < 0.5 หรือ > 6 กก. | error | |
| C120 | IPD | วันที่ admit ก่อนวันเกิด | error | |
| C121 | IPD | วันเวลา admit หลังวันเวลาจำหน่าย | error | |
| C201 | ODX, IDX | ไม่มีโรคหลัก (diagtype 1) | error | |
| C202 | ODX, IDX | โรคหลักมากกว่า 1 รหัส | error | |
| C206 | IDX | โรคหลักเป็น Z13, Z763 หรือ V–Y | error | |
| C232 | ODX, IDX | โรคหลักเป็น S/T แต่ไม่มีรหัสสาเหตุ V–Y | error | |
| C801 | ODX, IDX | รหัสโรคเฉพาะเพศไม่ตรงกับเพศผู้ป่วย (WHO ICD-10 Vol.2) | warn | |
| C152 | ODX | โรคหลักเดียวกันใน visit อื่นของวันเดียวกัน | info | |
| C952 | OOP, ADP (ip), DRU (ip) | ราคาหัตถการ > 99,999 (OOP) หรือเกิน 999 รายการต่อหมวด (IP) | error | |
| C171 | ADP (op) | ค่าพาหนะ S1801–S1803 แต่ไม่มีข้อมูลส่งต่อ | error | |
| C514 | ADP (op) | ค่าพาหนะ มีส่งต่อแต่ไม่มี AER หรือ UCS/WEL ส่งต่อในจังหวัดเดียวกัน | error | |
| C301 | ADP, DRU, CHT | ราคาติดลบ (ADP/DRU) หรือยอดรวมว่าง/≤ 0 (CHT) | warn | |
| C234 | ADP (op) | ทดสอบการตั้งครรภ์ 30014 แต่ไม่มีรหัสโรค Z32 | error | |
| C357 | ADP (op) | อุปกรณ์ผู้พิการ 8901/8902/8706/8707/8711 ของ UCS/WEL | warn | |
| C634 | ADP (op) | อัลตราซาวด์ฝากครรภ์ 30010 แต่ไม่มีหัตถการ 8878 | warn | |
| C756 | ADP (op) | 12003/12004 อายุไม่อยู่ใน 35–59 ปี | error | |
| C312 | ADP (ip) | ค่าห้อง (ADP TYPE 10) เกินวันนอน + 1 (หักวันลากลับบ้าน) | warn | |
| C914 | ADP | แล็บหมวด 07 ไม่ได้ TMLT | info | `lab_csv` |
| C190 | ADP | แล็บหมวด 07 ไม่อยู่ใน Lab Catalog FDH ของหน่วยบริการ | info | `cat_csv` |
| C309 | ADP | หมวด 06/07 ไม่มี `nondrugitems.nhso_adp_code` | info | |
| C303 | DRU | จำนวนยาว่างหรือ ≤ 0 แต่มียอดเงิน | warn | |
| C565 | DRU (op) | ยานอกบัญชีของ OFC/LGO ไม่มีเหตุผล EA–EF ใน `ovst_presc_ned` | warn | |
| C302 | CHA | หมวดมียอดเงินแต่ไม่มีรายการ ADP/DRU | warn | |
| C555 | CHA, CHT | ยอดหมวด CHA ไม่เท่าผลรวมรายการ หรือ CHT ไม่เท่าผลรวม CHA | warn | |

กฎกองทุน STP (บุคคลที่มีปัญหาสถานะและสิทธิ) ตรวจเฉพาะ visit/admission ที่ `pttype.hipdata_code = 'STP'` ตามรหัสตีกลับ (R) ของกองทุน ไม่ใช่รหัส C ของ สปสช. (ไม่นับใน 45):

| รหัส | แฟ้ม | เงื่อนไข | ระดับ |
|---|---|---|---|
| STP-R175 | INS | HOSPMAIN/HOSPSUB ว่าง | error |
| STP-AUTH | INS | PERMITNO ไม่ใช่ Authen Code (2 ตัวอักษร + 10 หลัก) | info |
| STP-R112 | OPD | OP ทั่วไปที่ไม่มีประเภทอุบัติเหตุ/ฉุกเฉิน (A/E/I/O) | warn |
| STP-R111 | AER | มีรับ/ส่งต่อแต่ไม่มีรหัสโรงพยาบาล | error |
| STP-R113 | AER, ORF, IRF | รหัสโรงพยาบาลรับ/ส่งต่อไม่ใช่ตัวเลข 5 หลัก | error |
| STP-R108 | ADP, DRU | จำนวน/ราคาต่อหน่วย/ราคารวมว่างหรือ ≤ 0 | error |
| STP-R188 | ADP | รหัส ADP ซ้ำในวันเดียวกัน ประเภทเดียวกัน (ไม่นับ 55999/57999) | error |
| STP-R292 | ADP | S1801 จำนวนไม่อยู่ใน 1–2 | error |
| STP-R180 | ADP | S1802 โดยไม่มี S1801 | error |
| STP-R194 | ADP | S1801 มากกว่า 1 รายการ | error |
| STP-R186 | CHT | CHT.TOTAL ไม่เท่าผลรวม CHA | error |
| STP-R191 | ODX, IDX | ไม่มีโรคหลัก | error |
| STP-R136 | ODX, IDX | H54 เป็นโรคหลัก | error |
| STP-R116 | ODX, IDX | มีรหัส S/T แต่ไม่มีสาเหตุภายนอก (DXTYPE 5) | error |

แฟ้มที่ยังไม่มีกฎ: OP: LABFU, PHDB ; IP: IOP, LVD, LABFU, PHDB (มีแค่ `rows_*`) ให้หน้าจอบอกว่า "ยังไม่มีกฎตรวจ" ไม่ใช่ "ผ่าน"
C160/C161 ปิดไว้เพราะ HOSxP ไม่มี SVCTYPE ส่วน C106, C108, C115, C117, C438, C515 ไม่อยู่ในชุดนี้ (เคยมีหรือถูกพิจารณาแล้วตัดออก) อย่าเพิ่มกลับโดยไม่ backtest

## กฎที่ต้องมีข้อมูลเสริม (ทางเลือก)

- **C914 / C190 (แล็บหมวด 07):** BKH Insight ส่ง `lab_csv`/`cat_csv` จากไฟล์ Lab Catalog ที่ดาวน์โหลดจาก FDH (คอลัมน์ `Lab Code` = icode ของ HOSxP, `TMLT Code`) รวมกับ `lab_items.tmlt_code`
  - ไม่มีไฟล์ catalog: `lab_csv` สร้างจาก HOSxP ได้ = icode ที่ `lab_items` (active) มี TMLT ไม่ว่าง **ค่าเดียว**
    `SELECT icode FROM lab_items WHERE active_status = 'Y' AND icode <> '' AND TRIM(tmlt_code) <> '' GROUP BY icode HAVING COUNT(DISTINCT TRIM(tmlt_code)) = 1`
    แล้วต่อ string ในโค้ดแอป (อย่าใช้ `GROUP_CONCAT` เพราะ MySQL ตัดที่ 1,024 ตัวอักษรโดย default) ส่วน C190 ให้ตัดทิ้งจากผล เพราะ `cat_csv = ''` จะทำให้แล็บทุกรายการติด
  - มีไฟล์ catalog: TMLT ของ icode = ค่าเดียวใน catalog ; หลายค่า = ใช้ของ `lab_items` ถ้าเป็นหนึ่งในนั้น ; ไม่อยู่ใน catalog = ของ `lab_items` ถ้ามีค่าเดียว ; นอกนั้นว่าง (ไม่เดา) `lab_csv` = icode ที่ได้ค่าไม่ว่าง, `cat_csv` = `Lab Code` ทั้งหมดที่ยังไม่หมดอายุ
  - ผลจริงที่ BKH (OP วันเดียว): ใช้ catalog C914 ขึ้น 8 เคส ใช้ `lab_items` อย่างเดียว 258 เคส จึงยังเป็นระดับ info จนกว่าจะ backtest กับ REP ของตัวเอง
- **C305 / C349 (Authen):** ใช้ `nhso_confirm_privilege`, `visit_pttype.auth_code`, `nhso_smartcard_agent` ของ HOSxP ได้เลย `closed_json` ใช้เฉพาะเมื่อปิดสิทธิผ่านระบบอื่นที่ไม่บันทึกกลับ HOSxP ไม่มีส่ง `'[]'`
  ทั้งสองรหัส สปสช. ตัดสินจากฐานของตัวเอง ฝั่งโรงพยาบาลเห็นแค่ว่าข้อมูลน่าจะไม่พอ จึงเป็น warn/info
- **Drug Catalog ของแฟ้ม DRU (C562, C573, C195, C574):** ไม่มีใน SQL เพราะต้องใช้ไฟล์ Drug Catalogue ของหน่วยบริการ ถ้าแอปนำเข้าไฟล์นั้นได้ ตรวจในโค้ดต่อแถวของ DRU (icode = HOSPDRUGCODE):
  ไม่พบรหัส = C562 ; วันที่จ่ายก่อน DATEEFFECTIVE แรกสุด = C573 ; ราคาเบิกไม่เท่า UNITPRICE ของฉบับที่ DATEEFFECTIVE ล่าสุดไม่เกินวันที่จ่าย = C195 ; PRODUCTCAT ของฉบับนั้นไม่ใช่ 1–5 = C574

## สมมติฐานเฉพาะโรงพยาบาลที่ต้องตรวจก่อนเชื่อผล

รัน `sql/preflight.sql` ก่อน แล้วตรวจค่าเหล่านี้กับฐานจริง (ผิดไป กฎจะเงียบหรือจับผิดทั้งก้อน):

- `pttype.hipdata_code` ใช้ค่า `UCS`, `WEL`, `OFC`, `LGO`, `STP` ตามมาตรฐาน สปสช. (`SELECT hipdata_code, COUNT(*) FROM pttype GROUP BY hipdata_code`)
- แยกยากับไม่ใช่ยาด้วย `income.drg_chrgitem_id` 3/4 (ไม่ใช่รหัส `income`) หมวดค่ารักษา CHA = `LPAD(COALESCE(drg_chrgitem_id, std_group, income), 2, '0')`
- รหัสเบิกของรายการไม่ใช่ยาคือ `nondrugitems.nhso_adp_code` (C309 และกฎค่าพาหนะ/PRT/USG/อุปกรณ์อ่านจากที่นี่) ยานอกบัญชีดูจาก `income = '20'` หรือ `drugitems.drugaccount` ว่าง/`-`
- `ovstdiag.icd10` เก็บหัตถการ ICD-9-CM ปนอยู่ กฎ ODX ใช้เฉพาะแถวที่ขึ้นต้นด้วยตัวอักษร
- `ipt.bw` เป็นกรัม, C514 เทียบจังหวัดจาก `opdconfig.hospitalcode` → `hospcode.chwpart`
- PERMITNO ต่อสิทธิ: UCS = `nhso_confirm_privilege.nhso_authen_code` ที่ปิดแล้ว ไม่มีใช้ `visit_pttype.auth_code` ; OFC ผู้ป่วยนอก = Approve Code ตัวล่าสุดใน `ovst_seq.edc_approve_list_text` ; OFC/LGO ผู้ป่วยใน = `ipt_pttype.claim_code` แล้ว `auth_code` ; STP = `auth_code` ; อื่น ๆ = `pttypeno` ถ้าโรงพยาบาลเก็บต่างจากนี้ C125/C127 จะผิด
- รุ่นฐานข้อมูล: ต้องมี CTE และ `JSON_TABLE` = MariaDB 10.6+ หรือ MySQL 8.0.4+ (BKH ใช้ MariaDB 10.11)
  MariaDB 10.2–10.5: แทนสองบรรทัด `sel AS (...JSON_TABLE...)`/`cl AS (...)` ด้วย `sel AS (SELECT CAST(NULL AS SIGNED) AS k FROM DUAL WHERE 1 = 0)` (และ `cl` แบบเดียวกัน) แล้วไม่ส่ง parameter สองตัวนั้น
  MySQL 8: `BINARY PERMITNO NOT REGEXP` (STP-AUTH) อาจ error เรื่อง charset ให้เปลี่ยนเป็น `PERMITNO COLLATE utf8mb4_bin NOT REGEXP` ยังไม่ได้ทดสอบบน MySQL

### `opitemrece` (สำคัญ)

`opitemrece` ของ HOSxP เป็น MyISAM: SELECT ที่นานจะล็อกทั้งตารางและบล็อกการบันทึกของ HOSxP (หรือหยุด replication ถ้าเป็น replica)
SQL ในชุดนี้ใช้ `FORCE INDEX (ix_vstdate)` (op) และ `FORCE INDEX (ix_an)` (ip) แล้ว อย่าเอาออก และอย่าเขียนกฎใหม่ที่ JOIN `opitemrece` ตามวันที่โดยไม่ผ่าน index นี้
- รัน `summary_ADP/DRU/CHA/CHT` ทีละ statement ห้ามยิงขนาน (BKH จำกัด pool ของ HIS 3 connection)
- จำกัดช่วงไม่เกิน 31 วันต่อครั้ง ช่วงยาวกว่านั้นให้วนทีละเดือน
- กรองผู้ป่วยนอกด้วย `vn IS NOT NULL AND (an IS NULL OR an = '')` เสมอ ไม่งั้นยอดผู้ป่วยในปนมา
- ถ้ามีฐาน replica ให้ชี้แอปไปที่ replica

## สร้างแอปรอบกฎชุดนี้

ขั้นที่ 0: ถามผู้ใช้ก่อนเขียนโค้ดว่าจะใช้ **Next.js** (App Router + route handler, `mysql2`) หรือ **Python Flask** (`app.py` + template เดียว, `PyMySQL`) แล้วรอคำตอบ
(ข้ามได้เมื่อผู้ใช้ระบุ stack มาแล้ว) ในรอบเดียวกันถามข้อมูลเชื่อมต่อ HOSxP ที่ขาด (host, port, user, ชื่อฐาน) รหัสผ่านให้ผู้ใช้ใส่เองใน `.env` ที่อยู่ใน `.gitignore`

หลักของแอป:

- **อ่านอย่างเดียว:** ไม่สร้าง view ตาราง หรือ stored procedure ในฐาน HOSxP ใช้ user ที่มีสิทธิ์ `SELECT` อย่างเดียว และตั้ง `SET SESSION TRANSACTION READ ONLY` ทุก connection
- คัดลอก `sql/` และ `references/` เข้าโปรเจกต์ อ่าน `manifest.json` ตอนเริ่มแอปเป็นแหล่งเดียวของรายการแฟ้ม รหัสต่อแฟ้ม และ parameter อย่าเขียนกฎซ้ำในโค้ดแอป
- ส่งค่าเป็น bind parameter เสมอ ตามลำดับใน `manifest.json` (จำนวนต้องพอดีกับ `?` ของไฟล์นั้น) ห้ามต่อ string
  - `mysql2`: `pool.query(sql, params)` ใช้ `?` ได้ตรง
  - `PyMySQL`: ใช้ `%s` จึงต้องแปลงก่อน `sql.replace('%', '%%').replace('?', '%s')` (SQL มี `%` ใน `DATE_FORMAT` และ `LIKE`)
- ชื่อแฟ้มและหมวดจาก request ต้องผ่าน whitelist จาก `manifest.json` ก่อนเลือกไฟล์ `start <= end` เป็น `YYYY-MM-DD` ไม่ผ่านตอบ 400

API สองตัวพอ (เหมือน `/api/fdh/c-check/*` ของ BKH):

| Endpoint | ทำอะไร |
|---|---|
| `GET /api/summary?type=&start=&end=` | รัน `rows_*` (ไฟล์ซ้ำกันรันครั้งเดียว) + `summary.sql` + `summary_<items>` ทีละตัว คืน `[{file, rows, cases, level}]` (`cases = null` = แฟ้มยังไม่มีกฎ, `level` = ระดับสูงสุดที่พบ) |
| `GET /api/validate?type=&file=&start=&end=` | `rows_<file>` + `summary` ของแฟ้มนั้น (กรอง `fdh_file`) + `cases_<file>` คืน `{rows, ruleCodes, summary: [{c_code, detail, fix, level, n}], cases, truncated}` |

หน้าจอ: แถบบนสลับ OP/PP กับ IP + ช่วงวันที่ (ป้าย "วันที่รับบริการ"/"วันที่จำหน่าย" ตามหมวด), left tab แฟ้มตามลำดับใน manifest พร้อม badge จำนวนเคสสีตามระดับ,
right panel สรุปต่อรหัส (รหัส, เงื่อนไข, ระดับ, จำนวน, แนวทางแก้) และรายเคส คลิกรหัสเพื่อกรอง
แยกสถานะให้ชัด: มีกฎแต่ไม่พบ = "ไม่พบจากกฎที่มี (ตรวจ N รหัส)" ; ไม่มีกฎ = "แฟ้มนี้ยังไม่มีกฎตรวจ" ; แฟ้มว่าง = "ไม่มีข้อมูล" ; query ล้ม = แสดง error ; info แสดงแยกจากติด C
ผลมี HN/AN/เลขบัตร: ปิดกลางเลขบัตรของ C104/C116 ก่อนส่งออกจาก server และให้แอปฟัง `127.0.0.1` เป็นค่าเริ่มต้น จะเปิดในเครือข่ายต้องมี login

ตรวจก่อนบอกว่าเสร็จ: เปิดแอปจริง เลือกวันที่มีข้อมูลทั้งสองหมวด แล้วเทียบ badge กับผลของ `summary*.sql` ที่รันด้วย db-cli ช่วงเดียวกัน
และหา admission ที่ admit ก่อนวันเริ่มแต่จำหน่ายในช่วง ดูว่ารายการก่อนวันเริ่มถูกตรวจด้วย ต่อฐานไม่ได้ให้บอกตรง ๆ ว่ายังไม่ได้ทดสอบกับข้อมูลจริง

## ข้อจำกัดที่ต้องบอกผู้ใช้

- กฎมี 45 จาก ~680 รหัส ไม่พบไม่ได้แปลว่าจะไม่ติด C
- รหัสที่ สปสช. ตัดสินจากฐานของตัวเอง (เช่น C999 ไม่พบสิทธิ, ความถูกต้องของ Approve/Authen Code) ตรวจจากฝั่งโรงพยาบาลไม่ได้ C305/C349 เป็นแค่สัญญาณเตือน
- กฎแล็บ (C190/C914) และ Drug Catalog ขึ้นกับไฟล์ catalog ของหน่วยบริการ ไม่มีไฟล์ = ผลไม่น่าเชื่อ
- ระดับในชุดนี้ปรับจาก REP ของ BKH โรงพยาบาลอื่นควร backtest ใหม่

## Backtest กับ REP แล้วปรับระดับ

1. ดาวน์โหลด REP e-Claim ของเดือนที่ส่งแล้ว (OP และ IP) เก็บคู่ (VN หรือ AN, รหัส C ที่ติด) จากคอลัมน์ error
2. รัน `cases_*.sql` ของเดือนเดียวกันทั้งหมด (แฟ้ม items ทีละไฟล์) เก็บคู่ (`seq` หรือ `an`, `c_code`)
3. ต่อรหัส: precision = เคสที่กฎจับและ REP ติดรหัสนั้นจริง / เคสที่กฎจับ ; recall = เคสที่กฎจับ / เคสที่ REP ติด
4. precision สูง = error ; ปานกลาง = warn ; ต่ำหรือ REP ไม่เคยติดรหัสนั้น = info หรือตัดกฎ ; recall ต่ำ = กฎยังไม่ครอบคลุม ดูเคสที่หลุดแล้วแก้เงื่อนไข
5. แก้ระดับใน `references/levels.json` (และ `c_codes.json`) ของสำเนาตัวเอง

## เพิ่มกฎใหม่

กฎหนึ่งข้อคือ `SELECT '<รหัส>' AS c_code, '<แฟ้ม>' AS fdh_file, hn, an, seq, <ค่าที่พบ>` หนึ่งก้อน ต่อกับก้อนอื่นด้วย `UNION ALL` ภายใน `( ... ) r`
อ่านจาก CTE ที่มีอยู่ (`vis`/`cs` = visit/admission, `ins`, `dx`, `a` = admission ของ IP, `it` = รายการ `opitemrece`, `cha`, `cmp`, `cht`, `stp`/`*_s` = STP) แทนการ JOIN ตารางใหม่
SQL เป็น ASCII ล้วน (HOSxP หลายแห่งเป็น tis620) ข้อความไทยอยู่ใน `c_codes.json` ห้ามมี `?` นอกจาก parameter
ทดสอบด้วยช่วงที่ REP ยืนยันว่ามีเคสติดรหัสนั้นจริง เพิ่มรหัสใน `manifest.json` (codes ของแฟ้ม) และ `levels.json`

ใน repo BKH Insight: แก้กฎที่ `src/app/api/fdh/c-check/checks.ts` (+ `files.ts` สำหรับระดับ/STP) เท่านั้น แล้วสร้างไฟล์ของ skill ใหม่

```bash
node .claude/skills/fdh-c-check/scripts/export_rules.mjs            # เขียนไฟล์ใหม่
node --test .claude/skills/fdh-c-check/scripts/export_rules.test.mjs # ล้มเมื่อไฟล์ใน skill ไม่ตรงกับกฎ
```
