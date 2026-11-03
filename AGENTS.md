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
  - ทุกคนรวมทั้งเจ้าของ repo ต้องพัฒนาบน branch ของตัวเอง ตั้งชื่อ `{dev_name}/{module}` (หรือ `{dev_name}/{เรื่องที่แก้}`) ห้าม commit หรือ push ตรงเข้า `main`
  - ก่อนเริ่มงานให้ pull `main` ล่าสุด แล้วแตก branch จาก `main`
  - ทุกวันก่อนเริ่มเขียนโค้ด ทุกคนต้องดึง `main` ล่าสุดเข้า branch ของตัวเอง เพื่อลด conflict ตอนเปิด PR และให้เห็น shared component กับกฎใน AGENTS.md ล่าสุด:
    - `git switch main` → `git pull` → `git switch {dev_name}/{module}` → `git merge main`
    - ใช้ `merge` ห้ามใช้ `rebase` กับ branch ที่ push แล้ว เพราะต้อง force push
    - ถ้ามี conflict ให้แจ้งผู้ใช้และแก้ร่วมกัน ห้ามเลือกทิ้งฝั่งของคนอื่นเอง
    - หลัง merge ถ้า AGENTS.md เปลี่ยน ให้อ่านกฎใหม่ก่อนทำงานต่อ
  - ห้าม force push, rebase หรือ reset งานที่คนอื่น push แล้ว
  - commit และ push เฉพาะเมื่อผู้ใช้สั่ง
  - การส่งโค้ดเข้า `main` ต้องทำผ่าน Pull Request เสมอ ทุกคนรวมทั้งเจ้าของ repo แม้แต่การแก้เล็กๆ หรือแก้แค่เอกสาร:
    - push branch แล้วเปิด PR ด้วย `gh pr create --base main` หัวข้อ PR บอกว่าแก้อะไร ส่วน body ต้องมี: สรุปการเปลี่ยนแปลง, ไฟล์ที่กระทบ, วิธีทดสอบและผลทดสอบ, เรื่องที่กระทบคนอื่น (dependency, config, shared component)
    - ห้าม merge PR เอง เว้นแต่ผู้ใช้สั่ง เมื่อเปิด PR แล้วให้ส่ง link ของ PR ให้ผู้ใช้
    - ถ้ามี PR ของ branch นั้นเปิดอยู่แล้ว ให้ push commit เพิ่มเข้า PR เดิม ไม่ต้องเปิด PR ใหม่
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

### Shared component และ helper ที่มีแล้ว

อ่านรายการนี้ก่อนค้นหรือสร้าง component เอง (ขั้นแรกของกฎ "ก่อนสร้าง component ใหม่") ทุก PR ที่เพิ่ม แก้ prop หรือลบ shared component ใน `src/components/` หรือ helper ใน `src/lib/` ต้องอัปเดตรายการนี้ใน PR เดียวกัน รายการจะได้ตรงกับโค้ดจริง ตัวอย่างใช้งานจริงดูที่ `src/app/tehnplk/components-demo/`

- `AppShell` (`@/components/app-shell/app-shell`): main layout ทุกหน้า มี sidebar ย่อได้ด้วย Ctrl/⌘+B ค้นหาเมนูด้วย Ctrl/⌘+K, topbar มี breadcrumb และปุ่มสลับธีม ใช้ใน `src/app/layout.tsx` แล้ว หน้าใหม่ไม่ต้องทำ layout เอง (AppShell มี `<main>` และ padding ให้แล้ว หน้าไม่ต้องใส่ `<main>` ซ้ำ)
- `navItems` (`@/components/app-shell/nav-items`): ต้องเพิ่มเมนูทุกครั้งที่สร้างหน้า `{dev_name}/{module}` หน้าเดี่ยวใช้ `{ label, href, icon }` ส่วนหมวดใช้ `{ label, icon, children: [...] }` ชื่อไอคอนเลือกจาก `@/components/app-shell/icons` ถ้าไม่มีให้เพิ่ม SVG ในไฟล์นั้น
- `ThemeSwitch` (`@/components/app-shell/theme-switch`): ปุ่มสลับธีม สว่าง/มืด/ตามระบบ (อยู่ใน topbar ของ AppShell แล้ว)
- design token ใน `src/app/globals.css` ใช้ผ่าน Tailwind เช่น `bg-surface`, `bg-surface-sunken`, `bg-hover`, `border-line`, `text-muted`, `bg-accent text-accent-fg`, `bg-accent-soft text-accent-text`, `ring-ring` และ `{danger|warning|success}` (`text-*`, `bg-*-soft`, `border-*-line`) ห้ามใช้สีตายตัว (`zinc-*`, `white`, `#hex`) ทุก token มีทั้งสองธีมอยู่แล้วจึงไม่ต้องเขียน `dark:` ถ้าจำเป็นต้องใช้ `dark:` จะอิง `data-theme` ไม่ใช่ `prefers-color-scheme`
  - ขนาดตัวอักษรใน content ไม่เกิน 13px ยกเว้นหัวข้อ page/section ใช้ `text-title` (14px, semibold) ใช้เฉพาะ type scale ใน globals.css (`text-xs` 11px, `text-sm` 12px, `text-base` 13px, `text-title`; `text-lg` ขึ้นไปถูกปิดไว้) ห้ามกำหนดขนาดเอง (`text-[..px]`, `font-size`) ลำดับชั้นอื่นแยกด้วยน้ำหนักและสี
  - DataGrid ใช้ token ของตัวเอง `text-grid-head` (13px) และ `text-grid-cell` (11px) ใน globals.css เป็นค่าทดลอง ปรับที่ token ที่เดียว
  - ส่วนหัวของ page ต้องไม่ slop เพราะผู้ใช้ต้องรู้ทันทีว่าเป็นหน้าอะไรโดยไม่ต้องอ่านเพิ่ม:
    - มีแค่หัวข้อสั้นๆ (คำนามบอกว่าเป็นหน้าอะไร เช่น "ผู้ป่วยนอกรายวัน", "ยาเบิกจ่ายตามแผนก") และปุ่ม action หรือ filter ถ้ามี
    - ห้ามมีคำอธิบายใต้หัวข้อ ทั้งอธิบายข้อมูล ("แสดงรายการผู้ป่วยนอก...") และบอกวิธีใช้ ("คลิกที่แถวเพื่อดูรายละเอียด", "ค้นหาด้วยชื่อหรือ HN") ช่วงเวลาหรือแหล่งข้อมูลถ้าจำเป็นให้แสดงเป็นค่าใน filter หรือ control แทนประโยค
    - ห้ามใส่ placeholder หรือข้อความแนะนำวิธีใช้ใน input ให้ใช้ aria-label และไอคอนแทน (kbd badge คีย์ลัด เช่น `Ctrl K` ใช้ได้)
    - ห้ามคำทักทาย ("ยินดีต้อนรับ"), คำฟุ้งเฟ้อ ("ครบวงจร", "อย่างมีประสิทธิภาพ", "ข้อมูลเชิงลึก", "ทรงพลัง", "ยกระดับ", "ชาญฉลาด"), ประโยคเกริ่นที่ไม่มีข้อมูล, emoji และเครื่องหมายตกใจ
    - ตรวจ copy ของหัวหน้าใหม่ด้วย skill `impeccable` (clarify) ทุกครั้ง
- `DataGrid` (`@/components/data-grid/data-grid`): ตารางข้อมูลจาก API แบบ server-side ทั้ง sort, ค้นหา, แบ่งหน้า และปุ่มส่งออก Excel state อยู่ใน URL (`page`, `pageSize`, `sort`, `dir`, `q`) จึง refresh หรือแชร์ link ได้หน้าเดิม
  - props: `endpoint`, `columns` (สร้างด้วย `gridColumnHelper<Row>()` ประกาศนอก component), `getRowId`, `renderDetail?(row)`, `detailMode?: "modal" | "expand"`, `detailTitle?(row)` (ช่องค้นหาไม่มี placeholder ใช้ `aria-label="ค้นหา"` กับไอคอนแว่นขยาย)
  - ใช้ `useSearchParams` จึงต้องครอบด้วย `<Suspense>` และ `columns`/`renderDetail` เป็นฟังก์ชัน จึงต้องวางใน client component ของ module
- `DetailModal` (`@/components/detail-modal/detail-modal`): modal จาก `<dialog>` ของ browser ปิดด้วย Esc หรือปุ่มปิด props: `open`, `onClose`, `title`, `children`
- `parseGridQuery` (`@/lib/grid-query`): ใช้ใน route handler ที่ DataGrid เรียก สัญญา API:
  - request: `GET ?page=1&pageSize=20&sort=<col>&dir=asc|desc&q=<text>[&format=xlsx]` ค่า `pageSize` สูงสุด `MAX_PAGE_SIZE` (100) และ `sort` ต้องอยู่ใน allowlist ที่ route ส่งให้ ค่าไม่ถูกต้องตอบ 400 `{ error }`
  - response: `{ rows, total }` (`total` = จำนวนแถวทั้งหมดหลังค้นหา) ส่วน `format=xlsx` ส่งไฟล์ทุกแถวตาม `sort`/`q` ปัจจุบัน ไม่สน `page`
  - ต่อ DB: `sort` ผ่าน allowlist แล้วจึงใช้เป็นชื่อคอลัมน์ได้ ส่วน `q` ต้องส่งเป็น bind parameter เสมอ และคอลัมน์ที่ค้นหาให้ route กำหนดเอง
- `xlsxResponse` (`@/lib/xlsx`): `xlsxResponse(filename, columns, rows)` คืน `Response` ไฟล์ .xlsx (exceljs) สำหรับ `format=xlsx`
- `@/lib/db`: เชื่อมต่อฐานข้อมูล 2 ฐานด้วย `mysql2` (server-only, pool แบบ lazy, env ตั้งใน `.env` ตาม `.env.example`)
  - `his`: ฐาน HIS ของโรงพยาบาล (production) **อ่านอย่างเดียว ห้ามเขียน his ไม่ว่ากรณีใด** ใช้ `hisQuery<T>(sql, params)` เท่านั้น ยอมแค่ statement เดียวที่ขึ้นต้นด้วย SELECT/WITH/SHOW/DESCRIBE/EXPLAIN และทุก connection ตั้ง `SET SESSION TRANSACTION READ ONLY` ห้ามสร้าง pool หรือ connection ไป his เองเพื่อเลี่ยงข้อนี้ และ DB user ของ his ต้องมีสิทธิ์ SELECT เท่านั้น
  - `insight`: ฐานของระบบเอง อ่านด้วย `insightQuery<T>(sql, params)` เขียนด้วย `insightExecute(sql, params)` (คืน `ResultSetHeader`)
  - `escapeLike(s)`: escape `%` `_` `\` สำหรับ `LIKE ?` ส่งค่าเป็น `%${escapeLike(q)}%`
  - วันที่คืนเป็น string เวลาไทย (`dateStrings`, `+07:00`) ตรวจการเชื่อมต่อได้ที่ `/api/tehnplk/db-health`
  - ป้องกัน SQL injection (repo นี้ไม่ใช้ Prisma หรือ ORM อื่น) การรีวิว PR ที่มี SQL ต้องตรวจข้อนี้ทุกครั้ง:
    - เขียน SQL ตรงผ่าน `@/lib/db` เท่านั้น ห้ามสร้าง connection เอง และห้ามเปิด `multipleStatements`
    - ทุกค่าที่มาจากผู้ใช้, URL, body หรือ DB อื่น ส่งเป็น bind parameter (`?`) ห้ามต่อ string หรือใช้ template literal ใส่ค่าลงใน SQL
    - identifier (ชื่อคอลัมน์ ตาราง ทิศ sort) ส่งเป็น parameter ไม่ได้ ให้แปลงผ่าน allowlist (map ค่าที่รับมาไปเป็นชื่อจริงที่กำหนดในโค้ด) เท่านั้น เหมือน `parseGridQuery`
    - `LIKE`: escape ด้วย `escapeLike` ก่อน แล้วส่งเป็น parameter
    - `IN (...)`: สร้าง placeholder ตามจำนวนค่า (`IN (?, ?, ?)`) และห้ามส่ง list ว่าง
    - `LIMIT`/`OFFSET`: validate เป็นจำนวนเต็มในช่วงที่กำหนดก่อน แล้วส่งเป็น parameter

## การแบ่งงานให้ subagent

กฎส่วนนี้ใช้กับ Claude Code ส่วน agent อื่นที่ไม่มี `sr`/`jr` ให้ข้ามได้


- งานที่ต้องลงมือ (แก้โค้ด, รันคำสั่ง, ตรวจฐานข้อมูล, ค้นหาในโค้ดเพื่อทำงานต่อ) ให้ spawn subagent ที่เหมาะสมเสมอ main ไม่ลงมือเอง
  - `sr`: งานออกแบบ บั๊กที่ยังไม่รู้สาเหตุ refactor หลายไฟล์ และรีวิวงานของ `jr`
  - `jr`: งานที่ขอบเขตชัด งานประจำ แก้เล็ก เพิ่ม test ค้นหาในโค้ด
- งานที่แยกส่วนได้และไม่แตะไฟล์เดียวกัน ให้ spawn `sr` และ `jr` พร้อมกัน แต่ละตัวต้องได้ขอบเขตไฟล์ที่ชัดเจน
- ถ้าเป็นแค่การปรึกษา ถาม-ตอบ หรือวางแผน main ทำเองโดยไม่ spawn
- เมื่อ subagent ทำเสร็จ main สรุปผลให้ผู้ใช้ รวมถึงไฟล์ที่เปลี่ยนและผลการตรวจสอบ
- เมื่อทำงาน dev เสร็จ (แก้ page หรือ API) ทุกคำสั่งของผู้ใช้ ต้องส่ง link ของ dev server ที่คลิกได้ให้ผู้ใช้ทดสอบเสมอ:
  - ถ้า dev server ยังไม่รัน ให้รัน `npm run dev` แบบ background แล้วเช็คด้วย `curl` ว่าหน้านั้นตอบ 200 ก่อนส่ง link
  - ส่ง URL เต็มของหน้าที่แก้ เช่น `http://localhost:3000/{dev_name}/{module}` ถ้าแก้ API ให้ส่ง URL ของ API และหน้าที่เรียกใช้ API นั้นด้วย
  - ถ้าพอร์ตไม่ใช่ 3000 ให้ใช้พอร์ตจริงที่ `next dev` แสดง
- เมื่อ context หรือ usage limit ใกล้เต็ม (เช่น ระบบเตือนว่า context ใกล้เต็ม หรือใกล้ถึง limit การใช้งาน) ให้หยุดงานที่ทำอยู่ แล้วเขียน `{dev_name}/handoff.md` ที่ root ของโปรเจกต์ทันที ด้วย skill `handoff`:
  - ถ้ามีไฟล์อยู่แล้ว ให้อัปเดตไฟล์เดิม อย่าสร้างไฟล์ใหม่
  - ต้องมีอย่างน้อย: เป้าหมายของงาน, สิ่งที่ทำเสร็จแล้ว (ไฟล์ที่เปลี่ยน), สิ่งที่ค้างอยู่และขั้นต่อไป, การตัดสินใจและเหตุผล, คำสั่งที่ใช้ตรวจผล
  - ห้ามใส่ความลับ (รหัสผ่าน, token, ค่าใน `.env`)
  - เขียนเสร็จแล้วให้บอกผู้ใช้ว่าไฟล์อยู่ที่ไหน คนที่รับงานต่อจะได้อ่านไฟล์นี้ก่อนเริ่ม
- artifact ที่สร้างขึ้นเพื่อพิสูจน์ผล ต้องลบทิ้งทุกครั้งเมื่อจบแต่ละคำสั่งของผู้ใช้ หลังรายงานผลแล้ว:
  - เช่น snapshot, screenshot, trace, video, console log ใน `.playwright-cli/`, `test-results/`, `playwright-report/`, output ของ `db-cli` (`-o`) และสคริปต์หรือไฟล์ชั่วคราวที่สร้างไว้ตรวจผล
  - ห้ามลบ test ที่ตั้งใจเก็บไว้ในโปรเจกต์ และห้ามลบไฟล์ที่ผู้ใช้ขอให้เก็บ
  - ถ้าผู้ใช้ต้องดูไฟล์นั้น (เช่น screenshot จาก annotation) ให้สรุปเนื้อหาลงในรายงานก่อนลบ
  - dev server ไม่นับเป็น artifact ให้เปิดค้างไว้ตามกฎข้อส่ง link

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
- โปรเจกต์มี 2 ฐาน ต้องระบุในรายงานทุกครั้งว่าตรวจฐานไหน: `his` (env `HIS_*`, อ่านอย่างเดียว) หรือ `insight` (env `INSIGHT_*`)
- อ่านค่าจริงจาก `.env` ของฐานที่จะตรวจ: `HIS_HOST`, `HIS_PORT`, `HIS_USER`, `HIS_PASSWORD`, `HIS_DATABASE` (หรือ `INSIGHT_*` ชุดเดียวกัน) แล้วตั้งใน process เป็น `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` ตามลำดับ
- CLI ไม่ได้โหลด `.env` หรือแปลงชื่อตัวแปรเหล่านี้ให้อัตโนมัติ ห้ามใช้ค่า `USER` จาก environment ของระบบแทนผู้ใช้ฐานข้อมูล
- ตรวจการเชื่อมต่อและชื่อฐานข้อมูล:

```bash
db-cli -g my -e "SELECT 1 AS connection_ok, DATABASE() AS database_name;"
```

- ตรวจ schema หรือ query ที่เกี่ยวข้องกับงานด้วย `SHOW TABLES`, `SHOW COLUMNS FROM ...` หรือ `SELECT ... LIMIT ...` แล้วรายงาน SQL และผลตรวจจริง

### ข้อห้าม

- ห้ามใช้ `db-cli` รัน `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `CREATE` และคำสั่งอื่น ๆ ที่มีผลเปลี่ยนแปลงข้อมูล
- ฐาน `his` เป็น production ห้ามรันคำสั่งเขียนทุกชนิดไม่ว่าผ่านเครื่องมือใด
