# คู่มือการใช้งาน API ดึงข้อมูลโอนเงิน สปสช. (Smart Money Transfer - SMT)

เอกสารนี้อธิบายวิธีเรียกใช้งาน REST API ของระบบ Smart Money Transfer (SMT) สำนักงานหลักประกันสุขภาพแห่งชาติ (`https://smt.nhso.go.th/smtf2/`) สำหรับดึงข้อมูลสรุปยอดโอนเงินและรายละเอียดรายงวดตามรหัสหน่วยบริการ 5 หลัก

---

## 1. API ค้นหารายการโอนเงินตามรหัสหน่วยบริการ (Summary Search)

ใช้ดึงรายการโอนเงินทั้งหมดของหน่วยบริการตามปีงบประมาณและช่วงวันที่โอนเงิน พร้อมยอดรวมสรุปท้ายตาราง

### Endpoint

```http
POST https://smt.nhso.go.th/smtf2/api/budgetreport/budgetSummaryByVendorReport/search
Content-Type: application/json
```

### Request Parameters (JSON Body)

| ฟิลด์ | ชนิดข้อมูล | คำอธิบาย | ตัวอย่างค่า |
| :--- | :--- | :--- | :--- |
| `vendorSearchConditionCode` | `string` | รูปแบบการค้นหา (`"1"` = ค้นหาตามเขต/จังหวัด, `"2"` = ค้นหาด้วยรหัสหน่วยบริการ 5 หลักโดยตรง) | `"2"` |
| `zoneId` | `string` | รหัสเขต สปสช. (ส่งค่าว่างเมื่อ `vendorSearchConditionCode` เป็น `"2"`) | `""` |
| `provinceId` | `string` | รหัสจังหวัด (ส่งค่าว่างเมื่อ `vendorSearchConditionCode` เป็น `"2"`) | `""` |
| `vendorId` | `string` | รหัสผู้ขาย 10 หลัก (ใช้เฉพาะกรณีค้นหาแบบ `"1"`, ส่งค่าว่างเมื่อใช้แบบ `"2"`) | `""` |
| `vendorId5Digit` | `string` | รหัสหน่วยบริการ/โรงพยาบาล 5 หลัก | `"11254"` |
| `budgetYear` | `string` | ปีงบประมาณ พ.ศ. 4 หลัก | `"2569"` |
| `transferStartDate` | `string` | วันที่เริ่มต้นโอนเงิน รูปแบบ `DD/MM/YYYY` (ปี พ.ศ.) | `"01/10/2568"` |
| `transferEndDate` | `string` | วันที่สิ้นสุดโอนเงิน รูปแบบ `DD/MM/YYYY` (ปี พ.ศ.) | `"30/09/2569"` |
| `budgetSource` | `string` | แหล่งงบประมาณ เช่น `"UC"`, `"LGO"` หรือส่ง `""` เพื่อดึงทั้งหมด | `""` |
| `hospType` | `string` | ประเภทสังกัดหน่วยบริการ ส่ง `""` เพื่อดึงทั้งหมด | `""` |
| `isTest` | `string` | สถานะข้อมูลทดสอบ ส่ง `""` สำหรับข้อมูลจริง | `""` |

### ตัวอย่างการเรียกใช้งาน

#### cURL

```bash
curl -X POST "https://smt.nhso.go.th/smtf2/api/budgetreport/budgetSummaryByVendorReport/search" \
  -H "Content-Type: application/json" \
  -d '{
    "vendorSearchConditionCode": "2",
    "zoneId": "",
    "provinceId": "",
    "vendorId": "",
    "vendorId5Digit": "11254",
    "budgetSource": "",
    "budgetYear": "2569",
    "transferStartDate": "01/10/2568",
    "transferEndDate": "30/09/2569",
    "hospType": "",
    "isTest": ""
  }'
```

#### TypeScript / Next.js Route Handler หรือ Server Function

```typescript
export interface SmtSearchRequest {
  vendorId5Digit: string;
  budgetYear: string;
  transferStartDate: string; // DD/MM/YYYY (พ.ศ.)
  transferEndDate: string;   // DD/MM/YYYY (พ.ศ.)
  budgetSource?: string;
}

export async function fetchSmtBudgetSummary(params: SmtSearchRequest) {
  const res = await fetch(
    "https://smt.nhso.go.th/smtf2/api/budgetreport/budgetSummaryByVendorReport/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        vendorSearchConditionCode: "2",
        zoneId: "",
        provinceId: "",
        vendorId: "",
        vendorId5Digit: params.vendorId5Digit,
        budgetSource: params.budgetSource ?? "",
        budgetYear: params.budgetYear,
        transferStartDate: params.transferStartDate,
        transferEndDate: params.transferEndDate,
        hospType: "",
        isTest: "",
      }),
      cache: "no-store",
    }
  );

  if (!res.ok) {
    throw new Error(`SMT API error: ${res.status}`);
  }

  return res.json();
}
```

### Raw Response (`budgetSummaryByVendorReport/search`)

ตัวอย่างผลลัพธ์จริงจากการดึงข้อมูลรหัสหน่วยบริการ `11254` (โรงพยาบาลพรหมพิราม) ปีงบประมาณ `2569` (ตัดแสดงเฉพาะ 2 รายการแรกใน `datas` และ 1 รายการใน `tooltipDatas`):

```json
{
  "datas": [
    {
      "runDt": "2026-09-30",
      "batchNo": "3584",
      "postingDate": "25690930",
      "refDocNo": "OP ANYWHERE ในจังหวัด ปี 69",
      "vndrNo": "0000011254",
      "fundName": "กองทุนผู้ป่วยนอก",
      "fundGroup": 1,
      "fundGroupDescr": "กองทุนค่าบริการทางการแพทย์",
      "fundDescr": "กองทุนผู้ป่วยนอก",
      "mouGrpCode": "69010101",
      "pmntMetd": "T",
      "bankNm": "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร",
      "pmntStts": "P",
      "amount": 9959,
      "wait": 0,
      "debt": 0,
      "bond": 0,
      "odbt": 0,
      "vat": 0,
      "total": 9959,
      "countRecord": 1,
      "maxPDate": "20260930",
      "insProgNM": "JOB_ODS_DW_ZIFEB020_D",
      "cncl": null,
      "budgetSource": "UC",
      "dispRec": null,
      "dispDownloadFile": null,
      "fileId": null,
      "fileName": null,
      "fileType": null,
      "filePath": null,
      "checkUpload": null,
      "uploadDate": null,
      "editDate": null,
      "verify": null,
      "fileSize": null,
      "userId": null,
      "downloadType": null,
      "downloadUrl": null,
      "fileComment": null,
      "linkConfigId": 0,
      "downloadType2": null,
      "downloadUrl2": null,
      "fileName2": null,
      "fileType2": null,
      "mophId": "4301020105.214",
      "mophDesc": "รายได้กองทุน  UC -OP แบบเหมาจ่าย",
      "mapData": {},
      "displayPostingDate": null,
      "downloadPAYMFileName": "3013273FDDA8C83A8BA323E115A9202C6AD3D8F7219A607D3C002606C20E293176000C188D75BA9156C09E2302D94AEA9AC8302C5A67DB9DFAA438D94B760612",
      "downloadWaitFileName": null,
      "downloadDEBTFileName": null,
      "fromSystem": null,
      "recId": null,
      "attachFileFromAllocate": null,
      "attachFileAllowcateId": null,
      "fileEformOrg": null,
      "downloadDetailLvBookNo": [],
      "hasAttachLvBookNo": false,
      "sfundCd": 1,
      "cpostingDate": "20260930",
      "cpostingYear": "2026",
      "efundDesc": "งบบริการผู้ป่วยนอกจ่ายแบบเหมาจ่ายต่อผู้มีสิทธิ",
      "efundCd": 1
    },
    {
      "runDt": "2026-09-25",
      "batchNo": "3479",
      "postingDate": "25690925",
      "refDocNo": "690100082",
      "vndrNo": "0000011254",
      "fundName": "สวัสดิการรักษาพยาบาลของพนักงานส่วนท้องถิ่น",
      "fundGroup": 8,
      "fundGroupDescr": "สวัสดิการรักษาพยาบาลของพนักงานส่วนท้องถิ่น",
      "fundDescr": "สวัสดิการรักษาพยาบาลของพนักงานส่วนท้องถิ่น",
      "mouGrpCode": "69086001",
      "pmntMetd": "N",
      "bankNm": "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร",
      "pmntStts": "P",
      "amount": 41475.5,
      "wait": 0,
      "debt": 0,
      "bond": 0,
      "odbt": 0,
      "vat": 0,
      "total": 41475.5,
      "countRecord": 2,
      "maxPDate": "20260925",
      "insProgNM": "JOB_ODS_DW_ZIFEB020_D",
      "cncl": null,
      "budgetSource": "LGO",
      "dispRec": null,
      "dispDownloadFile": null,
      "fileId": null,
      "fileName": null,
      "fileType": null,
      "filePath": null,
      "checkUpload": null,
      "uploadDate": null,
      "editDate": null,
      "verify": null,
      "fileSize": null,
      "userId": null,
      "downloadType": null,
      "downloadUrl": null,
      "fileComment": null,
      "linkConfigId": 0,
      "downloadType2": null,
      "downloadUrl2": null,
      "fileName2": null,
      "fileType2": null,
      "mophId": "1102050102.801/802",
      "mophDesc": "ลูกหนี้ค่ารักษา - เบิกจ่ายตรง อปท. OP/IP",
      "mapData": {},
      "displayPostingDate": null,
      "downloadPAYMFileName": "3013273FDDA8C83A8BA323E115A9202C6AD3D8F7219A607D4E527276463FD7E99C6D6EC83E19B5B156C09E2302D94AEA9AC8302C5A67DB9DFAA438D94B760612",
      "downloadWaitFileName": null,
      "downloadDEBTFileName": null,
      "fromSystem": null,
      "recId": null,
      "attachFileFromAllocate": null,
      "attachFileAllowcateId": null,
      "fileEformOrg": null,
      "downloadDetailLvBookNo": [],
      "hasAttachLvBookNo": false,
      "sfundCd": 60,
      "cpostingDate": "20260925",
      "cpostingYear": "2026",
      "efundDesc": "กรณีจ่ายตรงหน่วยบริการ",
      "efundCd": 1
    }
  ],
  "tooltipDatas": [
    {
      "linkConfigId": 11,
      "name": "กรณี Seamless DNAP",
      "description": "กรณี Seamless DNAP",
      "url": "http://seamlessfordmis.nhso.go.th",
      "detailUrl": "http://seamlessfordmis.nhso.go.th",
      "remark": "สอบถามข้อมูลเพิ่มเติม <br>Provider Center 02-554-0505 <br> e-mail: providercenter@nhso.go.th",
      "creationDate": "2016-12-23",
      "modifyDate": "2016-12-23",
      "linkConfigOrder": 910,
      "tooltip": "ผู้ติดเชื้อ เอชไอวี ผู้ป่วยเอดส์",
      "tooltipMap": "DNAP",
      "nhsoLinkConditions": []
    }
  ],
  "formBean": {
    "vendorSearchConditionCode": "2",
    "zoneId": "",
    "provinceId": "",
    "vendorId": "",
    "vendorId5Digit": "11254",
    "budgetYear": "2569",
    "transferStartDate": "01/10/2568",
    "transferEndDate": "30/09/2569",
    "budgetSource": "",
    "hospType": "",
    "message": null
  },
  "vendorData": {
    "orgType": "H",
    "wel2SysDtIn": null,
    "wel2SysDtOut": null,
    "nhsoZoneId": "02",
    "nhsoZoneNm": "เขต 2 พิษณุโลก",
    "prvnId": "6500",
    "prvnNm": "พิษณุโลก",
    "usedData": "Y",
    "recStrtDt": null,
    "recEndDt": null,
    "recDelFlag": null,
    "ctlId": null,
    "insTrnBtchId": null,
    "insProgNm": null,
    "updTrnBtchId": null,
    "updProgNm": null,
    "hnm": "โรงพยาบาลพรหมพิราม ",
    "htypeDecs": "0010",
    "htypeNm": "รัฐในสธ.(สังกัด สป.)",
    "hcd": "0000011254"
  },
  "sumDebt": "3,903,159.00",
  "sumOdbt": "3,911,708.58",
  "vendorName": "โรงพยาบาลพรหมพิราม ",
  "sumTotal": "62,816,419.23",
  "sumAmount": "68,690,250.10",
  "zoneName": "เขต 2 พิษณุโลก",
  "provinceName": "พิษณุโลก",
  "sumWait": "1,970,671.87",
  "sumBond": "0.00",
  "sumVat": "0.00",
  "status": "success"
}
```

### คำอธิบายฟิลด์สำคัญใน Response

#### ข้อมูลระดับบนสุด (Top-level Summary)

| ฟิลด์ | ชนิดข้อมูล | คำอธิบาย |
| :--- | :--- | :--- |
| `status` | `string` | สถานะการดึงข้อมูล (`"success"`, `"NOT_LOGIN"`, `"PERSMISSION_DENIED"`) |
| `vendorName` | `string` | ชื่อหน่วยบริการ/โรงพยาบาล |
| `zoneName` | `string` | ชื่อเขต สปสช. |
| `provinceName` | `string` | ชื่อจังหวัด |
| `sumAmount` | `string` | ยอดรวมจำนวนเงินขอเบิกทั้งหมด (Format มีลูกน้ำ) |
| `sumWait` | `string` | ยอดรวมเงินชะลอจ่าย |
| `sumDebt` | `string` | ยอดรวมหักหนี้ |
| `sumBond` | `string` | ยอดรวมหักเงินประกันสัญญา |
| `sumVat` | `string` | ยอดรวมภาษีหัก ณ ที่จ่าย |
| `sumOdbt` | `string` | ยอดรวมหนี้ค้างชำระอื่น |
| `sumTotal` | `string` | ยอดรวมเงินโอนสุทธิที่เข้าบัญชีจริง |
| `vendorData` | `object` | ข้อมูลทะเบียนหน่วยบริการ (`hcd`, `hnm`, `nhsoZoneId`, `prvnId`, `htypeDecs`, `htypeNm`) |
| `datas` | `array` | รายการโอนเงินแต่ละชุด (Batch) และกองทุนย่อย |

#### ข้อมูลในแต่ละรายการ (`datas[]`)

| ฟิลด์ | ชนิดข้อมูล | คำอธิบาย |
| :--- | :--- | :--- |
| `runDt` | `string` | วันที่ประมวลผล รูปแบบ `YYYY-MM-DD` (ค.ศ.) |
| `postingDate` | `string` | วันที่โอนเงิน/ผ่านรายการ รูปแบบ `YYYYMMDD` (พ.ศ.) เช่น `"25690930"` |
| `cpostingDate` | `string` | วันที่โอนเงิน รูปแบบ `YYYYMMDD` (ค.ศ.) เช่น `"20260930"` |
| `batchNo` | `string` | เลขที่ชุดการโอนเงิน (Batch Number) |
| `refDocNo` | `string` | เลขที่เอกสารอ้างอิง / งวดการจ่าย |
| `vndrNo` | `string` | รหัสหน่วยบริการ 10 หลัก (เติม `0` ด้านหน้า 5 ตัว เช่น `"0000011254"`) |
| `budgetSource` | `string` | แหล่งงบประมาณ เช่น `"UC"` (บัตรทอง), `"LGO"` (อปท.) |
| `fundGroup` | `number` | รหัสกลุ่มกองทุน |
| `fundGroupDescr` | `string` | ชื่อกลุ่มกองทุนหลัก |
| `fundName` / `fundDescr` | `string` | ชื่อกองทุนย่อย |
| `efundDesc` | `string` | รายละเอียดประเภทย่อยของกองทุน |
| `mouGrpCode` | `string` | รหัสหมวดงบประมาณตามข้อตกลง (MOU Group Code) |
| `mophId` | `string` | รหัสผังบัญชีมาตรฐาน สป.สธ. |
| `mophDesc` | `string` | ชื่อผังบัญชีมาตรฐาน สป.สธ. |
| `bankNm` | `string` | ชื่อธนาคารที่รับโอนเงิน |
| `pmntMetd` | `string` | วิธีการจ่ายเงิน (`"T"` = โอนผ่านธนาคาร, `"N"` = อื่นๆ) |
| `pmntStts` | `string` | สถานะการจ่ายเงิน (`"P"` = จ่ายแล้ว) |
| `amount` | `number` | จำนวนเงินก่อนหักรายการ |
| `wait` | `number` | จำนวนเงินชะลอจ่าย |
| `debt` | `number` | จำนวนเงินหักหนี้ |
| `bond` | `number` | จำนวนเงินหักหลักประกันสัญญา |
| `vat` | `number` | จำนวนเงินหักภาษี |
| `odbt` | `number` | จำนวนเงินหนี้ค้างชำระ |
| `total` | `number` | จำนวนเงินโอนสุทธิ |
| `countRecord` | `number` | จำนวนรายการย่อยภายในงวดนั้น |

---

## 2. API ดึงรายละเอียดรายงวด (Batch Summary Detail)

ใช้ดึงรายละเอียดเชิงลึกของรายการโอนเงินแต่ละ Batch (รวมถึงเลขที่บัญชีธนาคาร `BANK_ACCT_NO` และคำอธิบายติดต่อผู้รับผิดชอบงบ `fileComment`)

### Endpoint

```http
POST https://smt.nhso.go.th/smtf2/api/budgetreport/budgetSummaryByVendorReportDetail
Content-Type: application/json
```

### Request Parameters (JSON Body)

| ฟิลด์ | ชนิดข้อมูล | คำอธิบาย | ตัวอย่างค่า |
| :--- | :--- | :--- | :--- |
| `fiscalYear` | `string` | ปีงบประมาณ พ.ศ. 4 หลัก | `"2569"` |
| `vendorId` | `string` | รหัสหน่วยบริการ 10 หลัก (จากฟิลด์ `vndrNo` ใน Summary) | `"0000011254"` |
| `postingDate` | `string` | วันที่โอนเงิน รูปแบบ `YYYYMMDD` (พ.ศ.) | `"25690930"` |
| `batchNo` | `string` | เลขที่ Batch ที่ต้องการดูรายละเอียด | `"3584"` |
| `offset` | `number` | ลำดับเริ่มต้นสำหรับการแบ่งหน้า (เริ่มที่ `0`) | `0` |
| `count` | `number` | จำนวนรายการต่อหน้าที่ต้องการดึง | `50` |
| `isTest` | `string` | ส่ง `""` สำหรับข้อมูลจริง | `""` |

### ตัวอย่างการเรียกใช้งาน (cURL)

```bash
curl -X POST "https://smt.nhso.go.th/smtf2/api/budgetreport/budgetSummaryByVendorReportDetail" \
  -H "Content-Type: application/json" \
  -d '{
    "fiscalYear": "2569",
    "vendorId": "0000011254",
    "postingDate": "25690930",
    "batchNo": "3584",
    "offset": 0,
    "count": 50,
    "isTest": ""
  }'
```

### Raw Response (`budgetSummaryByVendorReportDetail`)

```json
{
  "vendorData": {
    "orgType": "H",
    "wel2SysDtIn": null,
    "wel2SysDtOut": null,
    "nhsoZoneId": "02",
    "nhsoZoneNm": "เขต 2 พิษณุโลก",
    "prvnId": "6500",
    "prvnNm": "พิษณุโลก",
    "usedData": "Y",
    "recStrtDt": null,
    "recEndDt": null,
    "recDelFlag": null,
    "ctlId": null,
    "insTrnBtchId": null,
    "insProgNm": null,
    "updTrnBtchId": null,
    "updProgNm": null,
    "hnm": "โรงพยาบาลพรหมพิราม ",
    "htypeDecs": "0010",
    "htypeNm": "รัฐในสธ.(สังกัด สป.)",
    "hcd": "0000011254"
  },
  "zoneName": "เขต 2 พิษณุโลก",
  "provinceName": "พิษณุโลก",
  "vendorName": "โรงพยาบาลพรหมพิราม ",
  "batchNo": "3584",
  "displayDate": "04 พฤศจิกายน 2569",
  "displayTime": "04:58",
  "datas": [
    {
      "runDt": "2026-09-30",
      "batchNo": "3584",
      "postingDate": "25690930",
      "refDocNo": "OP ANYWHERE ในจังหวัด ปี 69",
      "vndrNo": null,
      "fundName": "กองทุนผู้ป่วยนอก",
      "fundGroup": 1,
      "fundGroupDescr": "กองทุนค่าบริการทางการแพทย์",
      "fundDescr": "กองทุนผู้ป่วยนอก",
      "mouGrpCode": "69010101",
      "pmntMetd": "T",
      "bankNm": "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร",
      "pmntStts": "P",
      "amount": 9959,
      "wait": 0,
      "debt": 0,
      "bond": 0,
      "odbt": 0,
      "vat": 0,
      "total": 9959,
      "countRecord": null,
      "maxPDate": null,
      "insProgNM": null,
      "cncl": null,
      "budgetSource": null,
      "dispRec": null,
      "dispDownloadFile": null,
      "fileId": null,
      "fileName": null,
      "fileType": "html",
      "filePath": null,
      "checkUpload": null,
      "uploadDate": null,
      "editDate": null,
      "verify": null,
      "fileSize": null,
      "userId": null,
      "downloadType": "2",
      "downloadUrl": "",
      "fileComment": "สอบถามข้อมูลเพิ่มเติมได้ที่ <br>นางสาวมาลิสา พิมสอน 0811064494<br>หรือสอบถามเพิ่มเติม Provider Center E-Claim 02-5540505 Call Center E-Claim 1330 กด 5 กด 1",
      "linkConfigId": 5,
      "downloadType2": null,
      "downloadUrl2": null,
      "fileName2": null,
      "fileType2": null,
      "mophId": "4301020105.214",
      "mophDesc": "รายได้กองทุน  UC -OP แบบเหมาจ่าย",
      "mapData": {
        "FILE_SIZE": null,
        "FILE_NAME2": null,
        "S_FUND_CD": 1,
        "VAT": 0,
        "USER_ID": null,
        "VNDR_NO": "0000011254",
        "DEBT": 0,
        "FILE_NAME": null,
        "FUND_NO": "01-01-01",
        "POSTING_DATE": 25690930,
        "AMOUNT": 9959,
        "GYEAR": "2569",
        "BANK_NM": "ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร",
        "BANK_ACCT_NO": "019272530624",
        "PMNT_STTS": "P",
        "REF_DOC_NO_LEN": 27,
        "RUN_DT": "2026-09-29T17:00:00.000+0000",
        "UPLOAD_DATE": null,
        "ZONE_ID": "02",
        "MOPH_DESC": "รายได้กองทุน  UC -OP แบบเหมาจ่าย",
        "REF_DOC_NO_PREFIX_2_CHAR": "OP",
        "E_FUND_DESC": "งบบริการผู้ป่วยนอกจ่ายแบบเหมาจ่ายต่อผู้มีสิทธิ",
        "PMNT_METD": "T",
        "C_POSTING_DATE": "20260930",
        "ODBT": 0,
        "FUND_GROUP_DESCR": "กองทุนค่าบริการทางการแพทย์",
        "VERIFY": null,
        "DOWNLOAD_TYPE2": null,
        "E_FUND_CD": 1,
        "BTCH_NO": "3584",
        "FILE_TYPE2": null,
        "DOWNLOAD_URL": null,
        "FUND_GROUP": "01",
        "EDIT_DATE": null,
        "PROVINCE_ID": "6500",
        "BOND": 0,
        "WAIT": 0,
        "TOTAL": 9959,
        "POSTING_DATE_YEAR": "69,68",
        "REF_DOC_NO": "OP ANYWHERE ในจังหวัด ปี 69",
        "FUND_DESCR": "กองทุนผู้ป่วยนอก",
        "FILE_ID": null,
        "MOU_GRPCODE": "69010101",
        "FILE_PATH": null,
        "BOOK_NO": " ",
        "DOWNLOAD_TYPE": null,
        "FILE_COMMENT": null,
        "MOPH_ID": "4301020105.214",
        "FILE_TYPE": null,
        "DOWNLOAD_URL2": null
      },
      "displayPostingDate": null,
      "downloadPAYMFileName": null,
      "downloadWaitFileName": null,
      "downloadDEBTFileName": null,
      "fromSystem": "IMP-HOSPITAL",
      "recId": 73075,
      "attachFileFromAllocate": null,
      "attachFileAllowcateId": null,
      "fileEformOrg": null,
      "downloadDetailLvBookNo": [],
      "hasAttachLvBookNo": false,
      "sfundCd": 1,
      "cpostingDate": "20260930",
      "cpostingYear": null,
      "efundDesc": "งบบริการผู้ป่วยนอกจ่ายแบบเหมาจ่ายต่อผู้มีสิทธิ",
      "efundCd": 1
    }
  ],
  "tooltipDatas": [],
  "sumAmount": "9,959.00",
  "sumWait": "0.00",
  "sumDebt": "0.00",
  "sumBond": "0.00",
  "sumOdbt": "0.00",
  "sumVat": "0.00",
  "sumTotal": "9,959.00",
  "displayFileDownload2": false,
  "count": 1,
  "status": null,
  "htypeDesc": "0010"
}
```

---

## 3. API ดึงรายชื่อหน่วยบริการทั้งหมด (Master Vendor Option)

ใช้ดึงรายการรหัสหน่วยบริการ 5 หลัก ชื่อหน่วยบริการ เขต และจังหวัดทั้งหมดในระบบ SMT

### Endpoint

```http
POST https://smt.nhso.go.th/smtf2/api/option/vendor-for-budget
Content-Type: application/json
```

### Request Body

```json
{}
```

### Raw Response (`option/vendor-for-budget`)

```json
[
  {
    "vendorId": "01401",
    "provinceName": "โรงพยาบาลส่งเสริมสุขภาพตำบลบ้านหัวงิ้ว",
    "zoneId": "04",
    "provinceId": "1500",
    "province": "อ่างทอง"
  },
  {
    "vendorId": "11254",
    "provinceName": "โรงพยาบาลพรหมพิราม ",
    "zoneId": "02",
    "provinceId": "6500",
    "province": "พิษณุโลก"
  }
]
```

> หมายเหตุ: ใน API ชุดนี้ สปสช. ใช้ชื่อฟิลด์ `provinceName` แทนชื่อหน่วยบริการ และใช้ฟิลด์ `province` แทนชื่อจังหวัด

