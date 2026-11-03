# bkh-insight

เว็บแอป insight ของโรงพยาบาล อ่านข้อมูลจาก HOSxP (MySQL, อ่านอย่างเดียว) และเก็บข้อมูลของระบบเองใน PostgreSQL สร้างด้วย Next.js

## ติดตั้ง

```bash
git clone https://github.com/tehnplk/bkh-insight.git
cd bkh-insight
npm install
cp .env.example .env   # แล้วกรอกค่า HIS_*, INSIGHT_* และ AUTH_*
npm run db:migrate
npm run dev
```

เปิด http://localhost:3000

- `HIS_*` คือ HOSxP ใช้ DB user ที่มีสิทธิ์ SELECT เท่านั้น
- `INSIGHT_*` คือ PostgreSQL ของระบบเอง
- migration อยู่ที่ `db/migrations/` ใช้กับ `insight` เท่านั้น

## กฎการพัฒนา

โครงสร้าง, shared component, การใช้ฐานข้อมูล, git และ PR อยู่ที่ [AGENTS.md](AGENTS.md)
