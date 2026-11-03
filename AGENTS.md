## ก่อนเริ่มงาน

- ตรวจว่า agent ที่ใช้มี skill [impeccable](https://github.com/pbakaus/impeccable) แล้ว (ระดับโปรเจกต์หรือระดับผู้ใช้ก็ได้) ถ้ายังไม่มี ให้ติดตั้งก่อนเริ่มงาน
  - ติดตั้งระดับโปรเจกต์ ให้ระบุ flag ให้ครบ เพราะถ้าไม่ระบุ installer จะถามแบบ interactive ซึ่ง agent ตอบไม่ได้: `npx impeccable install --providers=<tool> --scope=project` เช่น `--providers=claude` หรือ `--providers=codex`
  - ติดตั้งเสร็จแล้วต้อง reload agent แล้วพิมพ์ `/impeccable` (Codex ใช้ `$impeccable`) เพื่อตรวจว่าใช้ได้ ถ้าใช้ไม่ได้ให้รัน `/impeccable doctor`
  - ไฟล์ที่ installer สร้าง (เช่น `.claude/skills/impeccable/`) ต้อง commit ด้วย คนอื่นจะได้ไม่ต้องติดตั้งซ้ำ
- ตรวจว่ามี [ponytail](https://github.com/DietrichGebert/ponytail) แล้ว ถ้ายังไม่มี ให้ติดตั้งก่อนเริ่มงาน ติดตั้งจาก `DietrichGebert/ponytail` บน GitHub เท่านั้น
  - Claude Code: เป็น slash command ซึ่ง agent รันเองไม่ได้ ให้บอกผู้ใช้พิมพ์ทีละบรรทัด `/plugin marketplace add DietrichGebert/ponytail` แล้ว `/plugin install ponytail@ponytail`
  - Codex: `codex plugin marketplace add DietrichGebert/ponytail` แล้ว `codex plugin add ponytail@ponytail` จากนั้นเปิด `/hooks` trust hook ทั้งสองตัว แล้วเริ่ม thread ใหม่
  - agent อื่น: ดู INSTALL.md ใน repo
  - ตรวจว่าใช้ได้ด้วย `/ponytail` ถ้าโหมดปิดอยู่ คำสั่งนี้จะเปิดให้ ถ้าเปิดอยู่แล้วจะบอกระดับปัจจุบัน
- ทุกครั้งที่เขียนหรือแก้โค้ด ให้เปิดใช้ทั้ง `impeccable` และ `ponytail` ก่อนเสมอ (Claude Code ใช้ Skill tool เรียก `impeccable` และ `ponytail:ponytail`) และทำตามคำแนะนำของทั้งสอง ponytail ต้องอยู่ระดับ `full` ห้ามลดระดับเว้นแต่ผู้ใช้สั่ง
  - ถ้ามอบงานให้ subagent ต้องระบุใน prompt ว่าให้เปิด `impeccable` และ `ponytail` ก่อนเขียนโค้ด

## ทำงานร่วมกันหลายคน

โปรเจกต์นี้มีผู้พัฒนาหลายคน และแต่ละคนอาจใช้ AI agent คนละตัว ไฟล์นี้จึงเป็นกฎกลางที่ทุก agent ต้องอ่าน (`CLAUDE.md` แค่ import ไฟล์นี้)

- กฎของโปรเจกต์เขียนไว้ที่ไฟล์นี้ที่เดียว ห้ามใส่ path, ชื่อผู้ใช้ หรือการตั้งค่าที่มีเฉพาะในเครื่องตัวเอง (เช่น `~/.claude/...`, `C:\Users\...`)
- ความชอบส่วนตัว เช่น ภาษาที่ตอบหรือสไตล์การทำงาน ให้เก็บใน config ส่วนตัว (`~/.claude/CLAUDE.md`, `CLAUDE.local.md`) ห้ามใส่ในไฟล์นี้
- ไฟล์ที่ต้องใช้ร่วมกันต้อง commit: `AGENTS.md`, `CLAUDE.md`, `.claude/agents/`, `.claude/skills/`, `.claude/settings.json`
- ห้าม commit `.env*` (ยกเว้น `.env.example`), `CLAUDE.local.md`, `.claude/settings.local.json`, credential และ artifact ของการทดสอบ ถ้าต้องเพิ่ม env ตัวใหม่ ให้เพิ่มชื่อตัวแปรใน `.env.example` ด้วย (ไม่ใส่ค่าจริง)
- Git:
  - ทำงานบน branch ของตัวเอง ห้าม commit หรือ push ตรงเข้า `main`
  - ก่อนเริ่มงานให้ pull ล่าสุด
  - ห้าม force push, rebase หรือ reset งานที่คนอื่น push แล้ว
  - commit และ push เฉพาะเมื่อผู้ใช้สั่ง
- ถ้าเจอการเปลี่ยนแปลงที่ตัวเองไม่ได้ทำ (ไฟล์เปลี่ยน, branch ใหม่, migration ใหม่) ให้ถือว่าเป็นงานของคนอื่น ห้ามย้อนกลับหรือเขียนทับ ถ้าขัดกับงานที่ทำอยู่ ให้แจ้งผู้ใช้
- ถ้าจะแก้ dependency (`package.json`, lockfile) หรือ config ที่ใช้ร่วมกัน (`next.config.ts`, `tsconfig.json`, ESLint) ให้แจ้งผู้ใช้ในสรุปงานทุกครั้ง เพราะกระทบทุกคน
- page และ API ต้องวางใต้ path `{dev_name}/{module}` เสมอ แต่ละคนจะได้แก้แต่โฟลเดอร์ของตัวเองและไม่ชนกัน:
  - page: `src/app/{dev_name}/{module}/page.tsx` เปิดที่ URL `/{dev_name}/{module}`
  - API: `src/app/api/{dev_name}/{module}/route.ts` เรียกที่ `/api/{dev_name}/{module}`
  - `{dev_name}` คือชื่อของผู้พัฒนาที่เป็นเจ้าของงาน `{module}` คือชื่อโมดูล ทั้งสองต้องเป็นตัวพิมพ์เล็กแบบ kebab-case เช่น `somchai/patient-visit`
  - ถ้าไม่รู้ว่า `{dev_name}` คืออะไร ให้ถามผู้ใช้ ห้ามเดา และห้ามสร้างหรือแก้ไฟล์ใต้ `{dev_name}` ของคนอื่น เว้นแต่ผู้ใช้สั่ง
  - sub-route และไฟล์ที่ใช้เฉพาะโมดูล (component, hook, type) ให้วางไว้ใต้โฟลเดอร์ของโมดูลนั้น ของที่ใช้ร่วมกันให้วางใน `src/components/` หรือ `src/lib/`
- ก่อนสร้าง component ใหม่ ต้องวิเคราะห์ shared component ที่มีอยู่ก่อนเสมอ เพื่อไม่ให้แต่ละคนสร้างของซ้ำกัน:
  - ค้นใน `src/components/` (shared component เก็บที่นี่ import ด้วย `@/components/...`) และค้นในโค้ดด้วยชื่อ หน้าที่ หรือ prop ที่คล้ายกัน
  - มีตัวที่ใช้ได้ ให้ใช้ตัวนั้น ถ้าขาดไปเล็กน้อย ให้เพิ่ม prop หรือ variant ในตัวเดิมแทนการสร้างใหม่ และต้องไม่ทำให้จุดที่ใช้อยู่เดิมพัง
  - ไม่มีจริงๆ ค่อยสร้างใหม่ ถ้าใช้ได้มากกว่าหนึ่งหน้า ให้วางใน `src/components/` ถ้าใช้หน้าเดียว ให้วางไว้ข้างหน้านั้น
  - ในสรุปงาน ให้บอกว่าค้นหาอะไรไปแล้ว และเลือกใช้ตัวเดิม ขยายตัวเดิม หรือสร้างใหม่ เพราะอะไร
- เมื่อเพิ่มกฎใหม่ในไฟล์นี้ ให้เขียนสั้น ระบุเหตุผล และไม่ซ้ำกับกฎเดิม

## การแบ่งงานให้ subagent

กฎส่วนนี้ใช้กับ Claude Code ส่วน agent อื่นที่ไม่มี `sr`/`jr` ให้ข้ามได้


- งานที่ต้องลงมือ (แก้โค้ด, รันคำสั่ง, ตรวจฐานข้อมูล, ค้นหาในโค้ดเพื่อทำงานต่อ) ให้ spawn subagent ที่เหมาะสมเสมอ main ไม่ลงมือเอง
  - `sr`: งานออกแบบ บั๊กที่ยังไม่รู้สาเหตุ refactor หลายไฟล์ และรีวิวงานของ `jr`
  - `jr`: งานที่ขอบเขตชัด งานประจำ แก้เล็ก เพิ่ม test ค้นหาในโค้ด
- งานที่แยกส่วนได้และไม่แตะไฟล์เดียวกัน ให้ spawn `sr` และ `jr` พร้อมกัน แต่ละตัวต้องได้ขอบเขตไฟล์ที่ชัดเจน
- ถ้าเป็นแค่การปรึกษา ถาม-ตอบ หรือวางแผน main ทำเองโดยไม่ spawn
- เมื่อ subagent ทำเสร็จ main สรุปผลให้ผู้ใช้ รวมถึงไฟล์ที่เปลี่ยนและผลการตรวจสอบ

## การทดสอบ e2e (browser)

- การทดสอบผ่าน browser ให้ใช้ skill `playwright-cli` เปิดด้วย Chrome แบบ headed เสมอ (ห้าม headless): `playwright-cli open --browser=chrome --headed <url>`
- ตรวจก่อนว่ามีคำสั่งให้ใช้หรือไม่: `playwright-cli --version` ถ้าไม่มี ลอง `npx --no-install playwright --version` (ถ้ามีให้ใช้ `npx playwright cli` แทน)
- ถ้าไม่มีทั้งสองแบบ ให้ติดตั้งก่อน: `npm install -g @playwright/cli@latest`
- ถ้าเครื่องไม่มี skill `playwright-cli` ให้อ่าน SKILL.md ที่มากับตัว CLI แทน โดยดู path ได้จากบรรทัด `Agent skill:` ใน `playwright-cli --help` ฉบับนี้ตรงกับเวอร์ชัน CLI ที่ติดตั้ง
- artifact ของ playwright (snapshot, screenshot, trace, report) ต้องอยู่ใน `.gitignore` เสมอ ถ้าบันทึกไฟล์ไว้ที่ path ใหม่ ให้เพิ่ม path นั้นใน `.gitignore` ด้วย
- ถ้าผู้ใช้ขอ annotate, ขอชี้จุดบนหน้าเว็บ, ให้ feedback UI/design หรือ agent ต้องถามผู้ใช้ว่าหมายถึงตรงไหน ให้เปิดโหมด annotation:
  - เปิดหน้าแบบ headed ก่อน (ถ้ายังไม่เปิด) แล้วรัน `playwright-cli show --annotate` แบบ background เพราะคำสั่งจะรอจนผู้ใช้ลากกรอบ พิมพ์ comment และกดส่ง ห้าม kill process ระหว่างที่ผู้ใช้ยังทำอยู่
  - บอกผู้ใช้ว่าให้ลากกรอบ พิมพ์ comment แล้วกดส่งใน dashboard
  - เมื่อได้ผล ให้เปิดดู screenshot ที่มีกรอบ อ่าน snapshot ของบริเวณที่ทำเครื่องหมาย แล้วสรุปให้ผู้ใช้ทีละ annotation: โน้ตของผู้ใช้ และ element ที่ตรงกัน (role, ชื่อ, ref)
  - ห้ามแก้โค้ดตาม annotation ทันที ให้สรุปให้ผู้ใช้ยืนยันก่อน เว้นแต่ผู้ใช้สั่งให้แก้ไว้แล้ว
  - ถ้ายังรันอยู่ ให้ปิดด้วย `playwright-cli show --kill`
- รายงานผลทดสอบตามที่เห็นจริงจาก snapshot หน้าเว็บ เมื่อทดสอบเสร็จให้ปิด browser ด้วย `playwright-cli close`

## Database verification (prove)

งานฐานข้อมูลต้องตรวจสอบกับ MySQL จริงด้วย [db-cli](https://github.com/tehnplk/db-cli) ก่อนสรุปว่าผ่าน

### ติดตั้ง CLI

```bash
npm i -g github:tehnplk/db-cli
db-cli -v
```

บน Windows หากเรียกไม่ได้ ให้ใช้ `db-cli.cmd`

### วิธีใช้

- ก่อนใช้งานให้อ่าน options ด้วย `db-cli --skill` (ตัวย่อ `-s`) และใช้พารามิเตอร์ตัวย่อในคำสั่ง: `-g` engine, `-H` host, `-P` port, `-u` user, `-d` database, `-e` SQL, `-o` output ส่วน `-p` password ให้ใช้ `DB_PASSWORD` แทนเพื่อไม่เปิดเผยรหัสผ่านในคำสั่ง
- อ่านค่าจริงจาก `.env`: `HOST`, `PORT`, `USER`, `PASSWORD`, `DATABASE` แล้วตั้งใน process เป็น `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` ตามลำดับ
- CLI ไม่ได้โหลด `.env` หรือแปลงชื่อตัวแปรเหล่านี้ให้อัตโนมัติ ห้ามใช้ค่า `USER` จาก environment ของระบบแทนผู้ใช้ฐานข้อมูล
- ตรวจการเชื่อมต่อและชื่อฐานข้อมูล:

```bash
db-cli -g my -e "SELECT 1 AS connection_ok, DATABASE() AS database_name;"
```

- ตรวจ schema หรือ query ที่เกี่ยวข้องกับงานด้วย `SHOW TABLES`, `SHOW COLUMNS FROM ...` หรือ `SELECT ... LIMIT ...` แล้วรายงาน SQL และผลตรวจจริง

### ข้อห้าม

- ห้ามใช้ `db-cli` รัน `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `CREATE` และคำสั่งอื่น ๆ ที่มีผลเปลี่ยนแปลงข้อมูล
