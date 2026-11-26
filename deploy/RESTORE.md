# สำรองและกู้คืนฐาน insight

ไฟล์สำรองคือ `pg_dump -Fc` ของฐาน insight ที่เข้ารหัสด้วย gpg (AES256, รหัสผ่าน `BACKUP_PASSWORD`) ชื่อ `bkh-insight-YYYYMMDD-HHMMSS-<nightly|manual|premigrate>.dump.gpg` อยู่ใน `BACKUP_DIR` (ค่าเริ่มต้น `/var/backups/bkh-insight`) คู่กับ sidecar `<ไฟล์>.json` (ขนาด, SHA-256, ผู้ดาวน์โหลด) ส่วน `status.json` คือผลรอบสำรองล่าสุด และ `verify.json` คือผลทดสอบกู้คืนล่าสุด ไฟล์บน server เก็บ 5 วัน ต้องดาวน์โหลดเก็บไว้นอก server เองจาก `/admin/backup` (admin)

ฐาน `his` (HOSxP) ไม่อยู่ในระบบนี้

## ติดตั้ง (บน server ทำครั้งเดียว จาก `/var/www/bkh-insight`)

1. ตั้งรหัสผ่านใน `.env` ของ server และเก็บสำเนารหัสผ่านไว้นอก server (เช่น ตู้เซฟ/ตัวจัดการรหัสผ่านของหน่วยงาน) ไม่มีรหัสผ่านกู้คืนไม่ได้:
   ```bash
   openssl rand -base64 32   # ได้ค่าแล้วใส่ BACKUP_PASSWORD=... ใน .env (ไม่ต้องมีเครื่องหมายคำพูด)
   ```
   ถ้าเปลี่ยน `BACKUP_DIR` ใส่ใน `.env` ด้วย แล้ว `sudo systemctl restart bkh-insight` ให้แอปอ่านค่าใหม่
2. สร้างโฟลเดอร์ให้ผู้ใช้ของแอป:
   ```bash
   sudo install -d -m 700 -o bkhadmin -g bkhadmin /var/backups/bkh-insight
   ```
3. ติดตั้ง timer (สำรองทุกวัน 00:30, ทดสอบกู้คืนวันอาทิตย์ 02:00):
   ```bash
   sudo cp deploy/bkh-insight-backup*.service deploy/bkh-insight-backup*.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now bkh-insight-backup.timer bkh-insight-backup-verify.timer
   ```
4. ลองรันทันทีแล้วดูผล:
   ```bash
   sudo systemctl start bkh-insight-backup.service && journalctl -u bkh-insight-backup.service -n 20
   sudo systemctl start bkh-insight-backup-verify.service && journalctl -u bkh-insight-backup-verify.service -n 20
   systemctl list-timers 'bkh-insight-backup*'
   ```

การทดสอบกู้คืนจริงต้องให้ role ของ `INSIGHT_USER` มีสิทธิ์ CREATEDB และมี `psql` ถ้าไม่มี (สถานะตอนนี้) สคริปต์จะตรวจแค่ SHA-256 ถอดรหัส และโครงไฟล์ (`pg_restore --list`) แล้วบอกในผลว่า "ตรวจโครงไฟล์เท่านั้น ไม่ได้กู้จริง" ให้สิทธิ์ด้วย `sudo -u postgres psql -c 'ALTER ROLE <INSIGHT_USER> CREATEDB'`

`npm run db:migrate` สำรองชนิด `premigrate` ให้เองก่อนรัน migration ที่ยังไม่รัน (สำรองไม่สำเร็จ = ไม่ migrate) เครื่องที่สำรองเองไม่ได้ (เช่น Windows ของ dev) จะหยุด ให้กด "สำรองตอนนี้" ที่ `/admin/backup` ก่อนแล้วรัน `npm run db:migrate -- --no-backup`

## ถอดรหัส

ดาวน์โหลดไฟล์จาก `/admin/backup` แล้วเทียบ SHA-256 กับค่าในหน้า (ปุ่มคัดลอก) ก่อน:

```bash
sha256sum bkh-insight-20261126-003001-nightly.dump.gpg
gpg -d -o insight.dump bkh-insight-20261126-003001-nightly.dump.gpg   # ถามรหัสผ่าน BACKUP_PASSWORD ของวันที่สำรอง
pg_restore --list insight.dump | head                                  # ตรวจว่าเป็น archive ที่อ่านได้
```

`insight.dump` ไม่เข้ารหัสแล้วและมีข้อมูลทั้งฐาน ลบทิ้ง (`shred -u insight.dump`) ทันทีที่กู้เสร็จ

## กู้ทั้งฐาน

หยุดแอปก่อน ไม่ให้มีการเขียนระหว่างกู้ และสำรองสภาพปัจจุบันไว้อีกชุดก่อนทับ (`bash scripts/backup-db.sh manual`) ถ้าฐานยังเปิดได้:

```bash
sudo systemctl stop bkh-insight bkh-insight-ar-sync.timer bkh-insight-backup.timer
pg_restore --clean --if-exists --no-owner --no-acl -h <INSIGHT_HOST> -U <INSIGHT_USER> -d <INSIGHT_DATABASE> insight.dump
sudo systemctl start bkh-insight bkh-insight-ar-sync.timer bkh-insight-backup.timer
```

ฐานหายทั้งฐาน: สร้างใหม่ก่อน `sudo -u postgres createdb -O <INSIGHT_USER> <INSIGHT_DATABASE>` แล้วรันคำสั่งเดิม (ไม่ต้องใช้ `--clean`)

รหัสผ่านฐานให้ใส่ด้วย `PGPASSWORD=... ` นำหน้าหรือพิมพ์เมื่อถาม ไม่ใส่ใน argument

## กู้บางตาราง

กู้ลงฐานชั่วคราวแล้วคัดเฉพาะที่ต้องการ ปลอดภัยกว่ากู้ทับตารางในฐานจริงตรงๆ:

```bash
sudo -u postgres createdb -O <INSIGHT_USER> insight_restore
pg_restore --no-owner --no-acl -h <INSIGHT_HOST> -U <INSIGHT_USER> -d insight_restore -t ar_ledger insight.dump
# เทียบ/คัดข้อมูลจาก insight_restore แล้วค่อยนำเข้าฐานจริง จากนั้น
sudo -u postgres dropdb insight_restore
```

`-t <ตาราง>` ใส่ซ้ำได้หลายตาราง (กู้โครงและข้อมูลของตารางนั้น ไม่รวม index/trigger ที่ต้องกู้แยกด้วย `-I`/`-T` ถ้าต้องการ) ตาราง `ar_ledger` มี trigger `ar_ledger_period_guard` กันแก้แถวในงวดที่ปิดแล้ว การนำข้อมูลเข้าฐานจริงต้องคิดเรื่องนี้ด้วย

## ตรวจหลังกู้

```bash
npm run db:migrate   # "Nothing to apply" = ไฟล์ใหม่กว่า migration ล่าสุด ไม่งั้นจะสำรองแล้วรันส่วนที่ขาด
```

login แล้วเปิด `/api/example/db-health` ต้องเชื่อมต่อได้ทั้งสองฐาน นับแถวตารางหลักเทียบกับตัวเลขในการ์ด "ทดสอบกู้คืนล่าสุด" ที่ `/admin/backup` เช่น `SELECT count(*) FROM ar_ledger;` (`stm_row`, `rep_row`, `users`) เปิด `/fund/ar-ledger` ดูยอดคงเหลือ และ `/admin/ar-periods` ดูว่างวดที่ปิดตรงกับที่ควรเป็น

## เปลี่ยนรหัสผ่าน

แก้ `BACKUP_PASSWORD` ใน `.env` แล้ว `sudo systemctl restart bkh-insight` ไฟล์ที่สร้างหลังจากนั้นใช้รหัสใหม่ ไฟล์เก่า (รวมที่ดาวน์โหลดเก็บไว้แล้ว) ยังต้องใช้รหัสเดิมเสมอ จึงต้องเก็บรหัสเดิมไว้จนกว่าไฟล์ที่ใช้รหัสนั้นจะหมดความจำเป็น จดวันที่เปลี่ยนไว้คู่กับรหัสผ่านเพื่อรู้ว่าไฟล์ไหนใช้รหัสไหน
