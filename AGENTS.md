## ก่อนเริ่มงาน

- ต้องมี skill [impeccable](https://github.com/pbakaus/impeccable) (ระดับโปรเจกต์หรือผู้ใช้ก็ได้) ถ้ายังไม่มีให้ติดตั้งก่อนเริ่มงาน:
  - ระดับโปรเจกต์ต้องใส่ flag ให้ครบ ไม่งั้น installer จะถามแบบ interactive ซึ่ง agent ตอบไม่ได้: `npx impeccable install --providers=<tool> --scope=project` (เช่น `--providers=claude` หรือ `--providers=codex`)
  - ติดตั้งแล้วต้อง reload agent แล้วพิมพ์ `/impeccable` (Codex ใช้ `$impeccable`) เพื่อตรวจ ถ้าใช้ไม่ได้ให้รัน `/impeccable doctor`
  - ต้อง commit ไฟล์ที่ installer สร้าง (เช่น `.claude/skills/impeccable/`) คนอื่นจะได้ไม่ต้องติดตั้งซ้ำ
- ต้องมี [ponytail](https://github.com/DietrichGebert/ponytail) ถ้ายังไม่มีให้ติดตั้งก่อนเริ่มงาน จาก `DietrichGebert/ponytail` บน GitHub เท่านั้น:
  - Claude Code: เป็น slash command ที่ agent รันเองไม่ได้ ให้บอกผู้ใช้พิมพ์ทีละบรรทัด `/plugin marketplace add DietrichGebert/ponytail` แล้ว `/plugin install ponytail@ponytail`
  - Codex: `codex plugin marketplace add DietrichGebert/ponytail` แล้ว `codex plugin add ponytail@ponytail` จากนั้นเปิด `/hooks` trust hook ทั้งสองตัว แล้วเริ่ม thread ใหม่
  - agent อื่น: ดู INSTALL.md ใน repo
  - ตรวจด้วย `/ponytail` (ถ้าโหมดปิดอยู่จะเปิดให้ ถ้าเปิดอยู่จะบอกระดับปัจจุบัน)
- ทุกครั้งที่เขียนหรือแก้โค้ด ต้องเปิด `impeccable` และ `ponytail` ก่อนเสมอ (Claude Code ใช้ Skill tool เรียก `impeccable` และ `ponytail:ponytail`) แล้วทำตามคำแนะนำของทั้งสอง ponytail ต้องอยู่ระดับ `full` ห้ามลดระดับเว้นแต่ผู้ใช้สั่ง ถ้ามอบงานให้ subagent ต้องระบุใน prompt ให้เปิดทั้งสองก่อนเขียนโค้ด

## ทำงานร่วมกันหลายคน

โปรเจกต์นี้มีผู้พัฒนาหลายคนซึ่งอาจใช้ AI agent คนละตัว ไฟล์นี้จึงเป็นกฎกลางที่ทุก agent ต้องอ่าน

- กฎของโปรเจกต์เขียนที่ไฟล์นี้ที่เดียว (`CLAUDE.md` และ `GEMINI.md` แค่ import ไฟล์นี้ ห้ามเขียนกฎลงในสองไฟล์นั้น) ห้ามใส่ path, ชื่อผู้ใช้ หรือการตั้งค่าเฉพาะเครื่องตัวเอง (เช่น `~/.claude/...`, `C:\Users\...`) และห้ามใส่ความชอบส่วนตัว เช่น ภาษาที่ตอบหรือสไตล์การทำงาน ให้เก็บใน config ส่วนตัว (`~/.claude/CLAUDE.md`, `CLAUDE.local.md`)
- ต้อง commit ไฟล์ที่ใช้ร่วมกัน: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.claude/agents/`, `.claude/skills/`, `.claude/settings.json`
- ห้าม commit `.env*` (ยกเว้น `.env.example`), `CLAUDE.local.md`, `.claude/settings.local.json`, credential และ artifact ของการทดสอบ env ตัวใหม่ให้เพิ่มชื่อตัวแปรใน `.env.example` ด้วย (ไม่ใส่ค่าจริง)
- Git:
  - ทุกคนรวมทั้งเจ้าของ repo พัฒนาบน branch ของตัวเอง ชื่อ `{dev_name}/{module}` (หรือ `{dev_name}/{เรื่องที่แก้}`) แตกจาก `main` ที่ pull ล่าสุด ห้าม commit หรือ push ตรงเข้า `main`
  - commit และ push เฉพาะเมื่อผู้ใช้สั่ง
  - ทุกวันก่อนเริ่มเขียนโค้ด ต้องดึง `main` ล่าสุดเข้า branch ตัวเอง เพื่อลด conflict ตอนเปิด PR และให้เห็น shared component กับกฎใน AGENTS.md ล่าสุด:
    - `git switch main` → `git pull` → `git switch {dev_name}/{module}` → `git merge main`
    - ใช้ `merge` ห้ามใช้ `rebase` กับ branch ที่ push แล้ว เพราะต้อง force push
    - มี conflict ให้แจ้งผู้ใช้และแก้ร่วมกัน ห้ามเลือกทิ้งฝั่งของคนอื่นเอง
    - หลัง merge ถ้า AGENTS.md เปลี่ยน ให้อ่านกฎใหม่ก่อนทำงานต่อ
  - คนเดียวทำหลายเครื่อง: งานจากเครื่องอื่นอยู่บน branch ตัวเองที่ push ไว้ ไม่ใช่บน `main` จึงต้องดึง branch ตัวเองก่อน merge `main`:
    - เริ่มงาน: `git switch main` → `git pull` → `git switch {dev_name}/{module}` → `git pull` → `git merge main`
    - ก่อนเลิกงานหรือย้ายเครื่อง: commit และ push branch ตัวเองทุกครั้ง แม้งานยังไม่เสร็จ (ข้อความขึ้นต้น `wip:`) agent push เองไม่ได้ จึงต้องเตือนผู้ใช้ให้สั่ง push
    - ตั้ง `git config --global pull.rebase false` ทุกเครื่อง ถ้าสองเครื่องมี commit ที่ยังไม่ push ชนกัน `git pull` จะ merge ให้ ห้ามแก้ด้วย force push
    - `.env` ไม่อยู่ใน git ต้องตั้งแยกทุกเครื่อง ส่วน `{dev_name}/handoff.md` ต้อง commit และ push ก่อน agent บนอีกเครื่องถึงจะอ่านได้
  - ห้าม force push, rebase หรือ reset งานที่คนอื่น push แล้ว
  - โค้ดเข้า `main` ผ่าน Pull Request เท่านั้น แม้แก้เล็กหรือแก้แค่เอกสาร:
    - push branch แล้วเปิดด้วย `gh pr create --base main` หัวข้อบอกว่าแก้อะไร body ต้องมี: สรุปการเปลี่ยนแปลง, ไฟล์ที่กระทบ, วิธีทดสอบและผลทดสอบ, เรื่องที่กระทบคนอื่น (dependency, config, shared component)
    - เปิดแล้วส่ง link ของ PR ให้ผู้ใช้ ห้าม merge PR เองเว้นแต่ผู้ใช้สั่ง
    - branch ที่มี PR เปิดอยู่แล้ว ให้ push commit เพิ่มเข้า PR เดิม ไม่เปิด PR ใหม่
- เจอการเปลี่ยนแปลงที่ตัวเองไม่ได้ทำ (ไฟล์เปลี่ยน, branch ใหม่, migration ใหม่) ให้ถือเป็นงานของคนอื่น ห้ามย้อนกลับหรือเขียนทับ ถ้าขัดกับงานที่ทำอยู่ให้แจ้งผู้ใช้
- แก้ dependency (`package.json`, lockfile) หรือ config ที่ใช้ร่วมกัน (`next.config.ts`, `tsconfig.json`, ESLint) ต้องแจ้งผู้ใช้ในสรุปงานทุกครั้ง เพราะกระทบทุกคน
- page และ API ต้องอยู่ใต้ `{module}/{task}` เสมอ จัดกลุ่มตามโมดูลของระบบ ไม่ใช่ตามคนเขียน URL จะได้สื่อความหมายกับผู้ใช้:
  - page: `src/app/{module}/{task}/page.tsx` เปิดที่ `/{module}/{task}`
  - API: `src/app/api/{module}/{task}/route.ts` เรียกที่ `/api/{module}/{task}`
  - `{module}` คือโมดูลหรือกลุ่มงาน (เช่น `opd`, `ipd`, `pharmacy`) `{task}` คืองานหรือรายงานในโมดูลนั้น ทั้งสองเป็นตัวพิมพ์เล็กแบบ kebab-case เช่น `opd/daily-visit`
  - ก่อนสร้างโมดูลใหม่ ให้ดูโมดูลที่มีใน `src/app/` ก่อน งานเข้ากับโมดูลเดิมได้ให้ใช้โมดูลเดิม ไม่แน่ใจว่าอยู่โมดูลไหนให้ถามผู้ใช้ ห้ามเดา
  - ห้ามแก้ไฟล์ใต้ `{module}/{task}` ที่คนอื่นทำอยู่ (ดูจาก `git log`) เว้นแต่ผู้ใช้สั่ง
  - sub-route และไฟล์เฉพาะโมดูล (component, hook, type) วางใต้โฟลเดอร์ของโมดูลนั้น ของที่ใช้ร่วมกันวางใน `src/components/` หรือ `src/lib/`
- ก่อนสร้าง component ใหม่ ต้องวิเคราะห์ shared component ที่มีอยู่ก่อนเสมอ เพื่อไม่ให้แต่ละคนสร้างของซ้ำกัน:
  - อ่านรายการ "Shared component และ helper ที่มีแล้ว" ด้านล่างก่อน แล้วค้นใน `src/components/` (import ด้วย `@/components/...`) และค้นในโค้ดด้วยชื่อ หน้าที่ หรือ prop ที่คล้ายกัน
  - มีตัวที่ใช้ได้ให้ใช้ตัวนั้น ขาดไปเล็กน้อยให้เพิ่ม prop หรือ variant ในตัวเดิมแทนการสร้างใหม่ และต้องไม่ทำให้จุดที่ใช้อยู่เดิมพัง
  - ไม่มีจริงๆ ค่อยสร้างใหม่ ใช้มากกว่าหนึ่งหน้าวางใน `src/components/` ใช้หน้าเดียววางไว้ข้างหน้านั้น
  - ในสรุปงานให้บอกว่าค้นอะไรไปแล้ว และเลือกใช้ตัวเดิม ขยายตัวเดิม หรือสร้างใหม่ เพราะอะไร
- เพิ่มกฎใหม่ในไฟล์นี้ให้เขียนสั้น ระบุเหตุผล และไม่ซ้ำกับกฎเดิม

### Shared component และ helper ที่มีแล้ว

ทุก PR ที่เพิ่ม แก้ prop หรือลบ shared component ใน `src/components/` หรือ helper ใน `src/lib/` ต้องอัปเดตรายการนี้ใน PR เดียวกัน ตัวอย่างใช้งานจริงดูที่ `src/app/example/components-demo/`

- `AppShell` (`@/components/app-shell/app-shell`): main layout ทุกหน้า ใช้ใน `src/app/layout.tsx` แล้ว มี sidebar ย่อได้ด้วย Ctrl/⌘+B ค้นหาเมนูด้วย Ctrl/⌘+K, topbar มี breadcrumb และปุ่มสลับธีม หน้าใหม่ไม่ต้องทำ layout เอง และไม่ต้องใส่ `<main>` ซ้ำ (AppShell มี `<main>` และ padding ให้แล้ว)
- `navItems` (`@/components/app-shell/nav-items`): ต้องเพิ่มเมนูทุกครั้งที่สร้างหน้า `{module}/{task}` หน้าเดี่ยวใช้ `{ label, href, icon }` หมวดใช้ `{ label, icon, children: [...] }` ชื่อไอคอนเลือกจาก `@/components/app-shell/icons` ถ้าไม่มีให้เพิ่ม SVG ในไฟล์นั้น
- `ThemeSwitch` (`@/components/app-shell/theme-switch`): ปุ่มสลับธีม สว่าง/มืด/ตามระบบ (อยู่ใน topbar ของ AppShell แล้ว)
- design token ใน `src/app/globals.css` ใช้ผ่าน Tailwind เช่น `bg-surface`, `bg-surface-sunken`, `bg-hover`, `border-line`, `text-muted`, `bg-accent text-accent-fg`, `bg-accent-soft text-accent-text`, `ring-ring` และ `{danger|warning|success}` (`text-*`, `bg-*-soft`, `border-*-line`) ห้ามใช้สีตายตัว (`zinc-*`, `white`, `#hex`) ทุก token มีทั้งสองธีมแล้วจึงไม่ต้องเขียน `dark:` ถ้าจำเป็นต้องใช้ `dark:` จะอิง `data-theme` ไม่ใช่ `prefers-color-scheme`
  - ขนาดตัวอักษรใน content ไม่เกิน 13px ยกเว้นหัวข้อ page/section ใช้ `text-title` (14px, semibold) ใช้เฉพาะ type scale ใน globals.css (`text-xs` 11px, `text-sm` 12px, `text-base` 13px, `text-title`; `text-lg` ขึ้นไปถูกปิดไว้) ห้ามกำหนดขนาดเอง (`text-[..px]`, `font-size`) ลำดับชั้นอื่นแยกด้วยน้ำหนักและสี
  - DataGrid ใช้ token ของตัวเอง `text-grid-head` (13px) และ `text-grid-cell` (11px) ใน globals.css เป็นค่าทดลอง ปรับที่ token ที่เดียว
  - ส่วนหัวของ page ต้องไม่ slop เพราะผู้ใช้ต้องรู้ทันทีว่าเป็นหน้าอะไรโดยไม่ต้องอ่านเพิ่ม:
    - มีแค่หัวข้อสั้นๆ (คำนามบอกว่าเป็นหน้าอะไร เช่น "ผู้ป่วยนอกรายวัน", "ยาเบิกจ่ายตามแผนก") และปุ่ม action หรือ filter ถ้ามี
    - ห้ามมีคำอธิบายใต้หัวข้อ ทั้งอธิบายข้อมูล ("แสดงรายการผู้ป่วยนอก...") และบอกวิธีใช้ ("คลิกที่แถวเพื่อดูรายละเอียด", "ค้นหาด้วยชื่อหรือ HN") ช่วงเวลาหรือแหล่งข้อมูลถ้าจำเป็นให้แสดงเป็นค่าใน filter หรือ control แทนประโยค
    - ห้ามใส่ placeholder หรือข้อความแนะนำวิธีใช้ใน input ให้ใช้ aria-label และไอคอนแทน (kbd badge คีย์ลัด เช่น `Ctrl K` ใช้ได้)
    - ห้ามคำทักทาย ("ยินดีต้อนรับ"), คำฟุ้งเฟ้อ ("ครบวงจร", "อย่างมีประสิทธิภาพ", "ข้อมูลเชิงลึก", "ทรงพลัง", "ยกระดับ", "ชาญฉลาด"), ประโยคเกริ่นที่ไม่มีข้อมูล, emoji และเครื่องหมายตกใจ
    - ตรวจ copy ของส่วนหัวหน้าใหม่ด้วย skill `impeccable` (clarify) ทุกครั้ง
- `DataGrid` (`@/components/data-grid/data-grid`): ตารางข้อมูลจาก API แบบ server-side ทั้ง sort, ค้นหา, แบ่งหน้า และปุ่มส่งออก Excel state อยู่ใน URL (`page`, `pageSize`, `sort`, `dir`, `q`) จึง refresh หรือแชร์ link ได้หน้าเดิม
  - props: `endpoint`, `columns` (สร้างด้วย `gridColumnHelper<Row>()` ประกาศนอก component), `getRowId`, `renderDetail?(row)`, `detailMode?: "modal" | "expand"`, `detailTitle?(row)` (ช่องค้นหาไม่มี placeholder ใช้ `aria-label="ค้นหา"` กับไอคอนแว่นขยาย)
  - ใช้ `useSearchParams` จึงต้องครอบด้วย `<Suspense>` และ `columns`/`renderDetail` เป็นฟังก์ชัน จึงต้องวางใน client component ของ module
- `DetailModal` (`@/components/detail-modal/detail-modal`): modal จาก `<dialog>` ของ browser ปิดด้วย Esc หรือปุ่มปิด props: `open`, `onClose`, `title`, `children`
- `parseGridQuery` (`@/lib/grid-query`): ใช้ใน route handler ที่ DataGrid เรียก สัญญา API:
  - request: `GET ?page=1&pageSize=20&sort=<col>&dir=asc|desc&q=<text>[&format=xlsx]` ค่า `pageSize` สูงสุด `MAX_PAGE_SIZE` (100) และ `sort` ต้องอยู่ใน allowlist ที่ route ส่งให้ ค่าไม่ถูกต้องตอบ 400 `{ error }`
  - response: `{ rows, total }` (`total` = จำนวนแถวทั้งหมดหลังค้นหา) ส่วน `format=xlsx` ส่งไฟล์ทุกแถวตาม `sort`/`q` ปัจจุบัน ไม่สน `page`
  - ต่อ DB: `sort` ผ่าน allowlist แล้วจึงใช้เป็นชื่อคอลัมน์ได้ ส่วน `q` ต้องส่งเป็น bind parameter เสมอ และคอลัมน์ที่ค้นหาให้ route กำหนดเอง
- `xlsxResponse` (`@/lib/xlsx`): `xlsxResponse(filename, columns, rows)` คืน `Response` ไฟล์ .xlsx (exceljs) สำหรับ `format=xlsx`
- `@/lib/db`: เชื่อมต่อฐานข้อมูล 2 ฐาน (server-only, pool แบบ lazy, env ตั้งใน `.env` ตาม `.env.example`)
  - `his`: HOSxP บน MySQL (`mysql2`) ฐาน production ของโรงพยาบาล **อ่านอย่างเดียว ห้ามเขียน his ไม่ว่ากรณีใด** ใช้ `hisQuery<T>(sql, params)` เท่านั้น ยอมแค่ statement เดียวที่ขึ้นต้นด้วย SELECT/WITH/SHOW/DESCRIBE/EXPLAIN และทุก connection ตั้ง `SET SESSION TRANSACTION READ ONLY` ห้ามสร้าง pool หรือ connection ไป his เองเพื่อเลี่ยงข้อนี้ และ DB user ของ his ต้องมีสิทธิ์ SELECT เท่านั้น
  - `insight`: ฐานของระบบเองบน PostgreSQL (`pg`) อ่านด้วย `insightQuery<T>(sql, params)` (คืน `rows`) เขียนด้วย `insightExecute(sql, params)` (คืน `{ rowCount }`) ต้องการค่าที่สร้างใหม่ (เช่น id) ให้ใช้ `insightQuery` กับ `RETURNING`
  - placeholder: his ใช้ `?` ส่วน insight ใช้ `$1, $2, …` (ไม่มีตัวแปลง `?` เป็น `$n`)
  - JOIN ข้าม his กับ insight ทำไม่ได้ เพราะอยู่คนละ engine ให้ query แยกแต่ละฐานแล้วรวมผลในโค้ด
  - `escapeLike(s)`: escape `%` `_` `\` (escape เริ่มต้นของ `LIKE` ทั้ง MySQL และ PostgreSQL) ใช้กับ `LIKE ?` (his) หรือ `LIKE $1` (insight) ส่งค่าเป็น `%${escapeLike(q)}%`
  - วันที่คืนเป็น string เวลาไทยทั้งสองฐาน (his: `dateStrings`, `+07:00` / insight: timezone `Asia/Bangkok` และ date/timestamp/timestamptz เป็น string) ตรวจการเชื่อมต่อได้ที่ `/api/example/db-health`
  - ป้องกัน SQL injection (repo นี้ไม่ใช้ Prisma หรือ ORM อื่น) การรีวิว PR ที่มี SQL ต้องตรวจข้อนี้ทุกครั้ง:
    - เขียน SQL ตรงผ่าน `@/lib/db` เท่านั้น ห้ามสร้าง connection เอง และห้ามเปิด `multipleStatements`
    - ทุกค่าที่มาจากผู้ใช้, URL, body หรือ DB อื่น ส่งเป็น bind parameter (his `?`, insight `$1, $2, …`) ห้ามต่อ string หรือใช้ template literal ใส่ค่าลงใน SQL
    - identifier (ชื่อคอลัมน์ ตาราง ทิศ sort) ส่งเป็น parameter ไม่ได้ ให้แปลงผ่าน allowlist (map ค่าที่รับมาไปเป็นชื่อจริงที่กำหนดในโค้ด) เท่านั้น เหมือน `parseGridQuery`
    - `LIKE`: escape ด้วย `escapeLike` ก่อน แล้วส่งเป็น parameter
    - `IN (...)`: his สร้าง placeholder ตามจำนวนค่า (`IN (?, ?, ?)`) ส่วน insight ใช้ `= ANY($1)` แล้วส่ง array เป็น parameter และห้ามส่ง list ว่าง
    - `LIMIT`/`OFFSET`: validate เป็นจำนวนเต็มในช่วงที่กำหนดก่อน แล้วส่งเป็น parameter

## การแบ่งงานให้ subagent

ใช้กับ Claude Code ส่วน agent อื่นที่ไม่มี `sr`/`jr` ข้ามได้

- งานที่ต้องลงมือ (แก้โค้ด, รันคำสั่ง, ตรวจฐานข้อมูล, ค้นหาในโค้ดเพื่อทำงานต่อ) ต้อง spawn subagent ที่เหมาะสมเสมอ main ไม่ลงมือเอง ส่วนการปรึกษา ถาม-ตอบ หรือวางแผน main ทำเองโดยไม่ spawn
  - `sr`: งานออกแบบ บั๊กที่ยังไม่รู้สาเหตุ refactor หลายไฟล์ และรีวิวงานของ `jr`
  - `jr`: งานที่ขอบเขตชัด งานประจำ แก้เล็ก เพิ่ม test ค้นหาในโค้ด
- งานที่แยกส่วนได้และไม่แตะไฟล์เดียวกัน ให้ spawn `sr` และ `jr` พร้อมกัน แต่ละตัวต้องได้ขอบเขตไฟล์ที่ชัดเจน
- subagent ทำเสร็จแล้ว main สรุปผลให้ผู้ใช้ รวมถึงไฟล์ที่เปลี่ยนและผลการตรวจสอบ
- ทำงาน dev เสร็จ (แก้ page หรือ API) ทุกคำสั่งของผู้ใช้ ต้องส่ง link ของ dev server ที่คลิกได้ให้ผู้ใช้ทดสอบเสมอ:
  - dev server ยังไม่รัน ให้รัน `npm run dev` แบบ background แล้วเช็คด้วย `curl` ว่าหน้านั้นตอบ 200 ก่อนส่ง link
  - ส่ง URL เต็มของหน้าที่แก้ เช่น `http://localhost:3000/{module}/{task}` (พอร์ตไม่ใช่ 3000 ให้ใช้พอร์ตจริงที่ `next dev` แสดง) ถ้าแก้ API ให้ส่ง URL ของ API และหน้าที่เรียกใช้ API นั้นด้วย
- context หรือ usage limit ใกล้เต็ม (เช่น ระบบเตือน) ให้หยุดงานที่ทำอยู่ แล้วเขียน `{dev_name}/handoff.md` ที่ root ของโปรเจกต์ทันที ด้วย skill `handoff`:
  - มีไฟล์อยู่แล้วให้อัปเดตไฟล์เดิม อย่าสร้างไฟล์ใหม่
  - ต้องมีอย่างน้อย: เป้าหมายของงาน, สิ่งที่ทำเสร็จแล้ว (ไฟล์ที่เปลี่ยน), สิ่งที่ค้างอยู่และขั้นต่อไป, การตัดสินใจและเหตุผล, คำสั่งที่ใช้ตรวจผล
  - ห้ามใส่ความลับ (รหัสผ่าน, token, ค่าใน `.env`)
  - เขียนเสร็จให้บอกผู้ใช้ว่าไฟล์อยู่ที่ไหน คนรับงานต่อจะได้อ่านก่อนเริ่ม
- artifact ที่สร้างเพื่อพิสูจน์ผล ต้องลบทุกครั้งเมื่อจบแต่ละคำสั่งของผู้ใช้ หลังรายงานผลแล้ว:
  - เช่น snapshot, screenshot, trace, video, console log ใน `.playwright-cli/`, `test-results/`, `playwright-report/`, output ของ `db-cli` (`-o`) และสคริปต์หรือไฟล์ชั่วคราวที่สร้างไว้ตรวจผล
  - ห้ามลบ test ที่ตั้งใจเก็บไว้ในโปรเจกต์ และห้ามลบไฟล์ที่ผู้ใช้ขอให้เก็บ
  - ถ้าผู้ใช้ต้องดูไฟล์นั้น (เช่น screenshot จาก annotation) ให้สรุปเนื้อหาลงในรายงานก่อนลบ
  - dev server ไม่นับเป็น artifact ให้เปิดค้างไว้ตามกฎข้อส่ง link

## การทดสอบ e2e (browser)

- ทดสอบผ่าน browser ใช้ skill `playwright-cli` เปิดด้วย Chrome แบบ headed เสมอ (ห้าม headless): `playwright-cli open --browser=chrome --headed <url>`
- ตรวจคำสั่งก่อน: `playwright-cli --version` ถ้าไม่มี ลอง `npx --no-install playwright --version` (ถ้ามีให้ใช้ `npx playwright cli` แทน) ถ้าไม่มีทั้งสองแบบให้ติดตั้งก่อน: `npm install -g @playwright/cli@latest`
- เครื่องไม่มี skill `playwright-cli` ให้อ่าน SKILL.md ที่มากับตัว CLI แทน (path อยู่ในบรรทัด `Agent skill:` ของ `playwright-cli --help` ตรงกับเวอร์ชัน CLI ที่ติดตั้ง)
- artifact ของ playwright (snapshot, screenshot, trace, report) ต้องอยู่ใน `.gitignore` เสมอ บันทึกไว้ที่ path ใหม่ให้เพิ่ม path นั้นใน `.gitignore` ด้วย
- ผู้ใช้ขอ annotate, ขอชี้จุดบนหน้าเว็บ, ให้ feedback UI/design หรือ agent ต้องถามผู้ใช้ว่าหมายถึงตรงไหน ให้เปิดโหมด annotation:
  - เปิดหน้าแบบ headed ก่อน (ถ้ายังไม่เปิด) แล้วรัน `playwright-cli show --annotate` แบบ background เพราะคำสั่งจะรอจนผู้ใช้กดส่ง ห้าม kill process ระหว่างที่ผู้ใช้ยังทำอยู่
  - บอกผู้ใช้ให้ลากกรอบ พิมพ์ comment แล้วกดส่งใน dashboard
  - ได้ผลแล้ว ให้เปิดดู screenshot ที่มีกรอบ อ่าน snapshot ของบริเวณที่ทำเครื่องหมาย แล้วสรุปให้ผู้ใช้ทีละ annotation: โน้ตของผู้ใช้ และ element ที่ตรงกัน (role, ชื่อ, ref)
  - ห้ามแก้โค้ดตาม annotation ทันที ให้สรุปให้ผู้ใช้ยืนยันก่อน เว้นแต่ผู้ใช้สั่งให้แก้ไว้แล้ว
  - ถ้ายังรันอยู่ ให้ปิดด้วย `playwright-cli show --kill`
- รายงานผลทดสอบตามที่เห็นจริงจาก snapshot หน้าเว็บ ทดสอบเสร็จให้ปิด browser ด้วย `playwright-cli close`

## Database verification (prove)

งานฐานข้อมูลต้องตรวจกับฐานจริงด้วย [db-cli](https://github.com/tehnplk/db-cli) ก่อนสรุปว่าผ่าน (รองรับทั้ง MySQL และ PostgreSQL)

### ติดตั้ง CLI

```bash
npm i -g github:tehnplk/db-cli
db-cli -v
```

บน Windows ถ้าเรียกไม่ได้ ให้ใช้ `db-cli.cmd`

### วิธีใช้

- ก่อนใช้งานให้อ่าน options ด้วย `db-cli --skill` (ตัวย่อ `-s`) และใช้พารามิเตอร์ตัวย่อ: `-g` engine, `-H` host, `-P` port, `-u` user, `-d` database, `-e` SQL, `-o` output ส่วน password ไม่ใช้ `-p` ให้ใช้ `DB_PASSWORD` แทน เพื่อไม่เปิดเผยรหัสผ่านในคำสั่ง
- ต้องระบุในรายงานทุกครั้งว่าตรวจฐานไหน และใช้ `-g` ให้ตรง engine: `his` (env `HIS_*`, MySQL `-g my`) หรือ `insight` (env `INSIGHT_*`, PostgreSQL `-g pg`)
- CLI ไม่โหลด `.env` และไม่แปลงชื่อตัวแปรให้ ต้องอ่านค่าจริงจาก `.env` ของฐานที่จะตรวจ: `HIS_HOST`, `HIS_PORT`, `HIS_USER`, `HIS_PASSWORD`, `HIS_DATABASE` (หรือ `INSIGHT_*` ชุดเดียวกัน) แล้วตั้งใน process เป็น `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` ตามลำดับ ห้ามใช้ค่า `USER` จาก environment ของระบบแทนผู้ใช้ฐานข้อมูล
- ตรวจการเชื่อมต่อและชื่อฐานข้อมูล:

```bash
# his (MySQL)
db-cli -g my -e "SELECT 1 AS connection_ok, DATABASE() AS database_name;"
# insight (PostgreSQL)
db-cli -g pg -e "SELECT 1 AS connection_ok, current_database() AS database_name;"
```

- ตรวจ schema หรือ query ที่เกี่ยวข้องกับงาน แล้วรายงาน SQL และผลตรวจจริง: his ใช้ `SHOW TABLES`, `SHOW COLUMNS FROM ...` ส่วน insight ใช้ `information_schema.tables` / `information_schema.columns` และทั้งสองใช้ `SELECT ... LIMIT ...` ได้

### ข้อห้าม

- ห้ามใช้ `db-cli` รัน `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `CREATE` และคำสั่งอื่น ๆ ที่มีผลเปลี่ยนแปลงข้อมูล
- ฐาน `his` เป็น production ห้ามรันคำสั่งเขียนทุกชนิดไม่ว่าผ่านเครื่องมือใด
