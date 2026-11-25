# GL_HOS .accdb: schema และผลเทียบ

ข้อมูลจากไฟล์ GL_HOS_70 (ปีงบ 2570) อ่านด้วย OLE DB ACE 16.0 `Mode=Read` วันที่ 25 พ.ย. 2569 ไม่มีข้อมูลบุคคลในไฟล์นี้

ชนิดคอลัมน์ (OLE DB type): 3 = Long, 2 = Integer, 5 = Double, 6 = Currency, 7 = Date, 11 = Yes/No, 130 = Text(ความยาว)

## ตารางหลักและจำนวนแถว

| ตาราง | แถว | หน้าที่ |
|---|---|---|
| DataTbl | 713 | header ใบสำคัญ |
| DataTbl1 | 4,310 | บรรทัด Dr/Cr |
| DataTbl2 | 0 | ใบสำคัญแบบแบน (header + บรรทัด) รวมใน `UnionData` |
| BookTbl | 5 | สมุดรายวัน |
| BudgetTypeTbl | 7 | ประเภทเงิน |
| ChartOfAccounts | 928 | ผังบัญชีย่อยสุด (มีสำเนาเก่า `ChartOfAccounts - U201069` 857 แถว และ query `AddChart_master` เติมรหัสที่ขาด) |
| AccID1 | 154 | บัญชีคุม (MinorID, `##########.000`) |
| AccIDTbl | 84 | หมวดในงบ (ReportType งบแสดงฐานะ/งบผลการดำเนินงาน) |
| GF / GFAndGL / Map / NewCode | 1,159 / 996 / 1,245 / 948 | รหัส GFMIS และการจับคู่กับ GL |
| ChartOfFinance | 287 | รหัสงบการเงิน (IDX) |
| DirectTbl | 20 | ประเภทกระแสเงินสด (DiID) |
| 01105 | 2 | Red (ใช้ได้แต่ห้ามส่ง) / Black (ห้ามใช้ในหน่วยต้นทุน) |
| OrgTbl / OrgTypeTbl | 1 / 8 | หน่วยงาน (`00` = รพ. เอง แม่ข่าย) |
| SubLedTbl | 0 | บัญชีย่อยลูกหนี้/เจ้าหนี้ (ไม่ได้ใช้) |
| DebtData | 0 | (ID, Debt1, DebtAmount) ไม่ได้ใช้ |
| InterTransactionTbl | 0 | รายการระหว่างหน่วยงาน |
| tb1 | 0 | staging บรรทัด (ID, acccode1, accname1, dr1, cr1) |
| SetTbl | 1 | ตั้งค่า (มีชื่อผู้บริหาร ห้ามคัดลอก) StartDate, FDate, TDate, FYear, OrgID |
| Vertbl | 1 | เวอร์ชันโปรแกรม (มีชื่อผู้เขียน ห้ามคัดลอก) |
| Switchboard Items | 6 | เมนูหลัก |
| NoteXTbl / NoteXTblDtl | 0 | แม่แบบคำอธิบาย → สมุด/ประเภทเงิน/บัญชี |
| RatioItemTbl(1), XCodeX, XYZ, ZTbl, ZTblx, GF1, GF2 | – | ตารางช่วยรายงาน |

ความสัมพันธ์ (FK): `DataTbl1.ID → DataTbl.ID`, `DataTbl1.AccCode1 → ChartOfAccounts.AccCode`, `DataTbl.BookID → BookTbl`, `DataTbl.BudgetType → BudgetTypeTbl`, `DataTbl.ApAr → SubLedTbl.SubLedger`, `DebtData.ID → DataTbl.ID`, `ChartOfAccounts.MinorID → AccID1`, `AccID1.SubGroupID → AccIDTbl.ID`, `ChartOfAccounts.GFId → GF.GFID`, `GFAndGL.GFID → GF.GFID`

## คอลัมน์

**DataTbl** (PK ID): ID 3, DataDate 7, AccDate 7, Note 130(255), DocID 130(250), BudgetType 3, ChargeDate 7, ChargeID 130(100), BookID 3, ApAr 130(100), OrgID1 130(10), Act 2, IsClosing 130(5) Yes/No, ToBe0 130(5), RefID 130(50), NotGF3 130(5)

**DataTbl1** (ไม่มี PK): ID 3, AccCode1 130(20), Dr 6, Cr 6, InterTransac 11, RefID1 130(50), RefDate 7, RunID1 3, RunID2 3

**DataTbl2**: คอลัมน์ของ DataTbl + AccCode1, Dr, Cr, InterTransac, RefID2, RefDate2

**ChartOfAccounts** (PK AccCode): AccCode 130(20), AccName 130(255), MinorID 130(20), DailyMoney 11, ActivityType 130(30) (เช่น "3.กิจกรรมดำเนินงาน", "6.เงินสดและรายการเทียบเท่า"), DiID 130(2), InterAcc 11, 0110ID 130(15), GFId 130(25), IDX 130(15), Itemid 130(30), UseOrNot 130(5), NotUseDate 7, YearX 130(5) ปีที่เพิ่มรหัส, AccCode14 130(14), ZBank 130(10), Trading 130(30) รหัสคู่ค้า, NotGF1 130(3), SubLedgerReport 130(3), MyBudget 130(3), TradingOri 130(255)

**BookTbl**: BookID 3, Book 130(50), BK 130(3) — 1 เงินรับ ร., 2 เงินจ่าย จ., 3 ขาย ข., 4 ซื้อ ซ., 5 ทั่วไป ท.

**BudgetTypeTbl**: BudgetTypeID 3, BudgetType 130(30), NotGF2 130(3), MyBudget1 130(3) — 1 งบประมาณ (NotGF2 Yes), 4 เงินบำรุง, 9 ประกันสังคม, 10 สวัสดิการ, 11 อื่นๆ, 12 บัญชี๕, 13 บัญชี๗

## Saved query ที่เกี่ยวข้อง

- `UnionData` = DataTbl ⋈ DataTbl1 ∪ DataTbl2 ; `N0000` = UnionData + ผังบัญชี + สมุด + หน่วยงาน (Amount1 = `getnet1(MinorID, Dr, Cr)` ใน VBA) ฐานของงบทดลองทุกตัว
- งบทดลอง: `TB` → `TB01` → `งบทดลองเบื้องต้น` (ยกมา/งวดนี้/สุทธิ Dr-Cr ต่อบัญชีย่อยต่อหน่วยงาน) ; `TBAllIndividual`, `TBThisIndividual`, `Sheet1` (ส่งออกหน่วย 00) ; `งบหน่วยงานส่งออก` (รหัสบัญชี, ชื่อบัญชี, ยอดยกมา, เดบิต, เครดิต, ยอดยกไป)
- GFMIS: `GF1N0000` (ไม่นับ ToBe0, งบประมาณ, NotGF3), `GF2*`, `GF31x`, `CheckGF*` ตรวจบัญชีที่ไม่ควรส่ง
- นำเข้าบรรทัด: `AppImportData` (ImportData.Code/Dr/Cr), `qryForAddData1` (TB1), `AppNoteX` (บรรทัดว่างจากแม่แบบคำอธิบาย) ; ลบบรรทัด 0/0: `DelDataTbl100`
- ส่งออกไป mdb ภายนอก (รวมเครือข่าย): `AppChart`, `AppOrg1/2`, `AppSub1/2`
- ปิดบัญชี/ยกยอด: `qryForClose`, `qryForCloseBS`, `qrySubLedger5/6` (ยกยอดเจ้าหนี้ + ปรับกำไรสะสม 3102010101.101), `Qry_Restart` (ลบ DataTbl ทั้งหมด)
- ตรวจ: `NCheckDrCr` (ใบไม่สมดุล), `CheckAPAR1/2`, `NcheckCash*`

## ข้อมูลในไฟล์ (ณ 25 พ.ย. 2569)

- AccDate 30 ก.ย. 2569–6 พ.ย. 2569 ; ใบต่อเดือน×สมุด: ก.ย. ท. 2 (ยกมา) ; ต.ค. ร. 67, จ. 251, ข. 31, ซ. 34, ท. 206 ; พ.ย. ร. 26, จ. 56, ท. 40
- ประเภทเงิน: เงินบำรุง 696 ใบ, งบประมาณ 17 ใบ ; หน่วยงาน 00 ทุกใบ ; ApAr/RefID/ChargeID ว่างทุกใบ
- RefID1 มีค่า: สมุด ร. 456/956 บรรทัด, จ. 695/1,365, ข. 0/1,031, ซ. 6/140, ท. 219/818
- ใบไม่สมดุล 4 ใบ (กำลังคีย์หรือพิมพ์ผิด) ; ไม่มีบรรทัดที่รหัสไม่อยู่ในผัง

## สมุดขาย ต.ค. 2569 (ตั้งหนี้รายวัน) เทียบ ar_ledger

GL = ผลรวม Dr ลูกหนี้ใน BookID 3 ; เรา = `ar_ledger` entry_date ต.ค. 2569 source rcpt_debt/ipt ผลรวม set+adjust+reverse(+diff) ตรวจด้วย db-cli insight

| บัญชี | GL Dr ลูกหนี้ | เรา (charge) | เรา diff | หมายเหตุ |
|---|---|---|---|---|
| 1102050101.201 | 14,010,040.16 | 14,089,585.06 | – | ต่าง −79,544.90 |
| .202 | 4,994,441.70 | 4,671,907.69 | – | GL แยก .217 15,000 |
| .203 (GL .20301) | 40,512.75 (รายได้ 70,127.75) | 69,035.75 | −28,548.00 | สุทธิเรา 40,487.75 |
| .209 | 80,567.00 | 79,340.00 | – | |
| .216 | 191,661.75 | 183,899.75 | – | |
| .301 | 357,916.95 (รายได้ 795,370.90) | 792,343.65 | −433,803.60 | |
| .302 | 77,972.87 (รายได้ 124,819.20) | 109,604.70 | −49,322.08 | |
| .307 | 127,300.82 | 126,037.82 | – | |
| .308 | 5,905.75 | 5,905.75 | – | ตรง |
| .401 | 1,312,162.77 | 1,312,162.77 | – | ตรง |
| .402 | 284,567.74 | 193,505.43 | – | |
| .501 | 26,737.00 | 25,102.00 | – | |
| .701 | 2,343.00 | 2,343.00 | – | ตรง |
| 1102050102.106 / .107 | 38,778.00 / 52,172.00 | 3,368.00 / 0 | – | ชำระเงิน |
| 1102050102.108 / .110 | 1,024.92 / 1,426.60 | เท่ากัน | – | ตรง |
| 1102050102.201 | 9,852.00 (รายได้ 17,695.00) | 19,565.00 | −9,013.00 | |
| 1102050102.602 / .603 | 116,675.20 / 49,833.30 | 124,059.20 / 50,901.30 | – | |
| 1102050102.801 / .802 / .803 | 273,481.10 / 22,885.90 / 34,090.87 | 273,481.10 / 3,750.50 / 34,090.87 | – | .801 .803 ตรง |

วันเดียว (5 ต.ค. 2569, GL ใบสมุดขายวันนั้น): ทุกบัญชีตรงถึงสตางค์ยกเว้น .201 (GL 542,173.52 / เรา 560,421.52), .209 (6,157 / 6,107), .301 ส่วนต่าง (9,680.14 / 9,680.13), .202 (250,414.23 + .217 500 = เรา 250,914.23)

ปรับปรุงสิ้นเดือน ต.ค. (BookID 5 ใบเดียว): Cr .201 14,010,040.16 = Dr .214 7,228,191.00 + Dr .229 6,781,849.16 ; Cr .209 80,567 = Dr .217 ; Cr .701 2,343 = Dr 4301020106.711 ; Cr .501 26,737 = Dr 2103010103.502 ; ของเรายังไม่มีชุด capitation เดือน ต.ค. ; `ar_transfer` ต.ค. .214 7,224,700 .217 2,162,300 (GL .214 รวม 3,491 ที่เราลง 3102010102.201)
