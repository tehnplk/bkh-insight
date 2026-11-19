# BKH Insight – e-Claim sync (Chrome extension)

ให้ปุ่ม **นำเข้าอัตโนมัติ** ที่หน้า `/fund/rep-import` ดึงไฟล์ REP และ Statement (STM) จาก e-Claim สปสช. เข้า BKH Insight ได้เอง
โดยใช้แท็บ e-Claim ที่เจ้าหน้าที่ login ThaiD ไว้แล้ว ไม่ต้องเปิด remote debugging และไม่ต้องรันคำสั่งบนเครื่อง

## ติดตั้ง (ครั้งแรก)

1. ที่ `/fund/rep-import` กด **นำเข้าอัตโนมัติ** แล้วกด **ดาวน์โหลด extension** (ได้ `bkh-eclaim-sync-<version>.zip` จาก `/api/fund/rep-import/extension` ต้อง login)
2. แตกไฟล์ zip ไว้ในโฟลเดอร์ถาวร เช่น `C:\bkh-insight\eclaim-sync` ห้ามลบหรือย้ายภายหลัง เพราะ Chrome โหลด extension จากโฟลเดอร์นี้ทุกครั้ง
3. เปิด Chrome ไปที่ `chrome://extensions` เปิด **โหมดนักพัฒนาซอฟต์แวร์** (Developer mode) มุมขวาบน แล้วกด **โหลดส่วนขยายที่คลายการบีบอัดแล้ว** (Load unpacked) เลือกโฟลเดอร์ที่แตกไว้ (โฟลเดอร์ที่มี `manifest.json`)
4. รีเฟรชหน้า BKH Insight ที่เปิดค้างไว้ (extension ทำงานเฉพาะหน้าที่เปิดหลังติดตั้ง)

## ใช้งาน

1. login e-Claim ด้วย ThaiD ที่ https://eclaim.nhso.go.th ไว้ในแท็บหนึ่งของ Chrome เดียวกัน
   (STM OFC: extension อ่าน zone/จังหวัดของหน่วยบริการจากหน้า Statement OFC เอง ไม่ต้องเปิดค้าง)
2. ที่ `/fund/rep-import` กด **นำเข้าอัตโนมัติ** เลือกช่วงเดือน (ค่าเริ่มต้นปีงบนี้) แล้วกด **ตรวจรายการ**
3. ดูสรุปต่อกลุ่ม (พบ / นำเข้าไว้แล้ว / รอนำเข้า / ข้าม พร้อมเหตุผล) แล้วกด **นำเข้า N ไฟล์**
4. กดยกเลิกได้ทุกเมื่อ ไฟล์ที่นำเข้าไปแล้วยังอยู่ กดนำเข้าต่อหรือตรวจรายการใหม่ได้ ไฟล์ที่นำเข้าแล้วจะถูกข้ามเสมอ (REP เทียบชื่อไฟล์ STM เทียบเลขที่เอกสาร)

ที่ดึง: REP ทุกสิทธิ (UCS/OFC/LGO/BKK/BMT เฉพาะชนิดที่ระบบอ่านได้ ชนิดอื่นแสดงว่าข้าม) STM UC และ STM OFC
STM OFC ไม่มีวันที่ออกในรายการบน e-Claim ระบบจึงใช้ "ออกรายงานวันที่" ในไฟล์ (รอยืนยันกับไฟล์จริง)

## อัปเดต

modal นำเข้าอัตโนมัติแสดงเวอร์ชันที่ติดตั้งอยู่ ถ้าเก่ากว่าเวอร์ชันของระบบจะขึ้น "มีเวอร์ชันใหม่" พร้อมปุ่มดาวน์โหลด
ดาวน์โหลด zip ใหม่ แตกไฟล์ทับโฟลเดอร์เดิม แล้วกดปุ่มโหลดใหม่ (ลูกศรวน, Reload) ของ extension ที่ `chrome://extensions` จากนั้นรีเฟรชหน้า BKH Insight

## สิทธิที่ขอและเหตุผล

- `scripting` + `host_permissions: https://eclaim.nhso.go.th/*`: รันโค้ดในแท็บ e-Claim เพื่อ fetch รายการและไฟล์ด้วย session ของแท็บนั้น
  และหาแท็บ e-Claim ด้วย `chrome.tabs.query` (สิทธิ host พอ ไม่ขอสิทธิ `tabs` ทั้งหมด)
- `content_scripts` เฉพาะ origin ของ BKH Insight (`matches` ใน `manifest.json`): ตัวกลางส่งข้อความระหว่างหน้าเว็บกับ extension

extension ไม่อ่าน cookie หรือ token ไม่เปลี่ยนหน้าหรือปิดแท็บของผู้ใช้ ไม่โหลดโค้ดจากภายนอก
URL ของ e-Claim สร้างในตัว extension จากค่าที่ตรวจรูปแบบแล้ว (`ecRequest`/`checkMessage` ใน `lib/sync.js`) หน้าเว็บสั่งยิง URL อื่นไม่ได้
หน้าเว็บได้แค่ฟิลด์ที่ต้องใช้ของรายการ (ไม่ได้ HTML ทั้งหน้า) การอัปโหลดเข้า BKH Insight ทำโดยหน้าเว็บด้วย session ของผู้ใช้เอง

## เพิ่ม origin ของ BKH Insight (IT)

แก้ `content_scripts[0].matches` ใน `manifest.json` ที่เดียว (เช่น `"https://insight.example.local/*"`) แล้วเพิ่ม `version`
service worker อ่านรายการ origin จากที่นี่เอง จากนั้นให้ผู้ใช้กดโหลด extension ใหม่ ตอนนี้มี `http://localhost:3000/*` (dev) และ `https://10.10.10.159/*` (production)

## แก้ปัญหา

| อาการ | ทำอย่างไร |
|---|---|
| กดแล้วขึ้นวิธีติดตั้งทั้งที่ติดตั้งแล้ว | รีเฟรชหน้า BKH Insight หรือ origin ของหน้าไม่อยู่ใน `matches` |
| ไม่พบแท็บ e-Claim | เปิด https://eclaim.nhso.go.th และ login ThaiD ใน Chrome (profile) เดียวกัน |
| e-Claim หมดอายุ | login ThaiD ในแท็บ e-Claim ใหม่แล้วกดตรวจรายการอีกครั้ง |
| ทำงานในแท็บ e-Claim ไม่ได้ | คลิกแท็บ e-Claim ให้แสดงอยู่ (Chrome อาจพักแท็บที่ไม่ได้ใช้) แล้วลองใหม่ |
| ติดต่อ extension ไม่ได้ | extension ถูกโหลดใหม่หรืออัปเดต ให้รีเฟรชหน้า BKH Insight |
| STM OFC ข้าม "ไม่รู้ zone/จังหวัด" | ตรวจว่าเปิดเมนู Statement OFC ใน e-Claim ได้ (บัญชีมีสิทธิ) คำสั่ง `eclaim:sync` ใส่ `--zone= --province=` ได้ |
| STM UC ไม่สำเร็จ "ไม่พบวันที่ออก Statement" | หน้าของ e-Claim เปลี่ยน ข้อความแสดงหัวตารางที่พบ แจ้งผู้ดูแลแก้ `parseUcStmList` ใน `lib/sync.js` |
| ไม่สำเร็จ "รูปแบบปุ่มดาวน์โหลดไม่ตรงที่คาด" | หน้าของ e-Claim เปลี่ยน แจ้งผู้ดูแลแก้ตัวอ่านใน `lib/sync.js` |

## สำหรับผู้พัฒนา

- `manifest.json` MV3, `sw.js` service worker (module), `content.js` ตัวกลางบนหน้าแอป
- `lib/sync.js` ขั้นตอนทั้งหมด (สร้าง URL, ตัวอ่านรายการ, plan/run) และ `lib/tab.js` ฟังก์ชันที่รันในแท็บ ใช้ร่วมกับหน้า `/fund/rep-import`
  (`eclaim-bridge.ts`, `auto-import.tsx`) และ `scripts/eclaim-sync.mjs` (`npm run eclaim:sync` ทางเลือกผ่าน CDP) แก้ที่เดียว
- `package.json` ในโฟลเดอร์นี้มีไว้ให้ Node อ่าน `.js` เป็น ES module (Chrome ไม่ใช้)
- zip ที่ให้ดาวน์โหลด: `GET /api/fund/rep-import/extension` สร้างจากโฟลเดอร์นี้ทุกครั้งที่ขอ (`src/app/api/fund/rep-import/extension/zip.ts` ไม่รวม `*.test.js` และ `package.json`)
  อาศัยว่า server รัน `next start` จากโฟลเดอร์ repo (ไม่ใช้ `output: "standalone"`) โฟลเดอร์นี้จึงอัปเดตตาม `git pull`
- แก้ไฟล์ใดในโฟลเดอร์นี้ต้องเพิ่ม `version` ใน `manifest.json` ทุกครั้ง: เป็นชื่อไฟล์ zip และหน้าเว็บ (ฝังตอน build) ใช้เทียบกับเวอร์ชันที่ติดตั้งเพื่อเตือนให้อัปเดต
- test: `node --test extension/eclaim-sync/lib/` (ใช้ io ปลอม ไม่ติดต่อ e-Claim)
- protocol หน้าเว็บ → content script: `window.postMessage({ source: "bkh-eclaim-page", id, msg })` ตอบ `{ source: "bkh-eclaim-ext", id, res }`
  `msg.op`: `ping` (คืน `version`), `list`, `download`, `chunk`, `release`, `select` ผล `{ expired } | { status } | { fatal } | { error }` หรือข้อมูล
