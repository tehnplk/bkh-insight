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
- ทุกครั้งที่เขียนหรือแก้โค้ด ต้องเปิด `impeccable` และ `ponytail` ก่อนเสมอ (Claude Code ใช้ Skill tool เรียก `impeccable` และ `ponytail:ponytail`) แล้วทำตามคำแนะนำของทั้งสอง ponytail ต้องอยู่ระดับ `full` ห้ามลดระดับเว้นแต่ผู้ใช้สั่ง ถ้า Claude Code มอบงานให้ subagent ต้องระบุใน prompt ให้เปิดทั้งสองก่อนเขียนโค้ด
- ก่อนใช้ API ของ library หรือ framework (Next.js, Auth.js, TanStack, pg ฯลฯ) ต้องค้น docs ล่าสุดด้วย Context7 ก่อน เพราะความรู้ของโมเดลอาจเก่ากว่าเวอร์ชันที่ติดตั้ง สำหรับ Next.js ให้ดู `node_modules/next/dist/docs/` ด้วย agent ที่ไม่มี Context7 ให้ใช้ docs ทางการของ library นั้นแทน

## ทำงานร่วมกันหลายคน

- ไฟล์นี้เป็นกฎกลางที่ทุก agent ต้องอ่าน เพราะผู้พัฒนาหลายคนอาจใช้ AI agent คนละตัว กฎของโปรเจกต์เขียนที่ไฟล์นี้ที่เดียว (`CLAUDE.md` และ `GEMINI.md` แค่ import ไฟล์นี้ ห้ามเขียนกฎลงในสองไฟล์นั้น) ห้ามใส่ path, ชื่อผู้ใช้ หรือการตั้งค่าเฉพาะเครื่องตัวเอง (เช่น `~/.claude/...`, `C:\Users\...`) และห้ามใส่ความชอบส่วนตัว เช่น ภาษาที่ตอบหรือสไตล์การทำงาน ให้เก็บใน config ส่วนตัว (`~/.claude/CLAUDE.md`, `CLAUDE.local.md`)
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
  - page: `src/app/(app)/{module}/{task}/page.tsx` เปิดที่ `/{module}/{task}` (route group `(app)` ไม่อยู่ใน URL แต่ให้ layout ที่มี AppShell วางนอก `(app)` จะไม่มี sidebar เหมือน `/login`)
  - API: `src/app/api/{module}/{task}/route.ts` เรียกที่ `/api/{module}/{task}`
  - `{module}` คือโมดูลหรือกลุ่มงาน (เช่น `opd`, `ipd`, `pharmacy`) `{task}` คืองานหรือรายงานในโมดูลนั้น ทั้งสองเป็นตัวพิมพ์เล็กแบบ kebab-case เช่น `opd/daily-visit`
  - ก่อนสร้างโมดูลใหม่ ให้ดูโมดูลที่มีใน `src/app/(app)/` ก่อน งานเข้ากับโมดูลเดิมได้ให้ใช้โมดูลเดิม ไม่แน่ใจว่าอยู่โมดูลไหนให้ถามผู้ใช้ ห้ามเดา
  - ห้ามแก้ไฟล์ใต้ `{module}/{task}` ที่คนอื่นทำอยู่ (ดูจาก `git log`) เว้นแต่ผู้ใช้สั่ง
  - sub-route และไฟล์เฉพาะโมดูล (component, hook, type) วางใต้โฟลเดอร์ของโมดูลนั้น ของที่ใช้ร่วมกันวางใน `src/components/` หรือ `src/lib/`
- ก่อนสร้าง component ใหม่ ต้องวิเคราะห์ shared component ที่มีอยู่ก่อนเสมอ เพื่อไม่ให้แต่ละคนสร้างของซ้ำกัน:
  - อ่านรายการ "Shared component และ helper ที่มีแล้ว" ด้านล่างก่อน แล้วค้นใน `src/components/` (import ด้วย `@/components/...`) และค้นในโค้ดด้วยชื่อ หน้าที่ หรือ prop ที่คล้ายกัน
  - มีตัวที่ใช้ได้ให้ใช้ตัวนั้น ขาดไปเล็กน้อยให้เพิ่ม prop หรือ variant ในตัวเดิมแทนการสร้างใหม่ และต้องไม่ทำให้จุดที่ใช้อยู่เดิมพัง
  - ไม่มีจริงๆ ค่อยสร้างใหม่ ใช้มากกว่าหนึ่งหน้าวางใน `src/components/` ใช้หน้าเดียววางไว้ข้างหน้านั้น
  - ในสรุปงานให้บอกว่าค้นอะไรไปแล้ว และเลือกใช้ตัวเดิม ขยายตัวเดิม หรือสร้างใหม่ เพราะอะไร
- Migration ของฐาน `insight` (PostgreSQL) เท่านั้น ห้ามใช้กับ `his`: เขียนเป็นไฟล์ SQL ที่ `db/migrations/YYYYMMDDHHMM_ชื่อสั้น.sql` (prefix เป็นเวลา สองคนจะได้ไม่ชนเลขกัน) แล้วรันด้วย `npm run db:migrate` (ข้ามไฟล์ที่รันแล้ว แต่ละไฟล์รันใน transaction เดียว):
  - ห้ามแก้ migration ที่ merge เข้า `main` แล้ว เพราะฐานที่รันไปแล้วจะไม่รันซ้ำและจะไม่ตรงกัน ให้เพิ่มไฟล์ใหม่แทน
  - PR เดียวเพิ่ม migration ได้หลายไฟล์
  - ทุก migration ต้องรันผ่านบนฐานเปล่าตั้งแต่ไฟล์แรก
- เพิ่มกฎใหม่ในไฟล์นี้ให้เขียนสั้น ระบุเหตุผล และไม่ซ้ำกับกฎเดิม

### Shared component และ helper ที่มีแล้ว

ทุก PR ที่เพิ่ม แก้ prop หรือลบ shared component ใน `src/components/` หรือ helper ใน `src/lib/` ต้องอัปเดตรายการนี้ใน PR เดียวกัน ตัวอย่างใช้งานจริงดูที่ `src/app/(app)/example/components-demo/`

- `AppShell` (`@/components/app-shell/app-shell`): main layout ทุกหน้า ใช้ใน `src/app/(app)/layout.tsx` แล้ว มี sidebar ย่อได้ด้วย Ctrl/⌘+B ค้นหาเมนูด้วย Ctrl/⌘+K, topbar มี breadcrumb และปุ่มสลับธีม prop `account?` (ReactNode) ปักไว้ล่างสุดของ sidebar ซึ่ง layout ใส่ `UserMenu` ไว้แล้ว: avatar ตัวอักษรแรก + ชื่อ กดแล้วเปิดเมนูขึ้นด้านบน (sidebar ย่อเหลือ avatar และเมนูเปิดออกทางขวา) มีรายการออกจากระบบ ทำด้วย native popover (`ProfileMenu`, `@/components/app-shell/profile-menu`) เมนูโปรไฟล์ของ role `admin` (UserMenu ส่ง `admin` ให้ `ProfileMenu`) มีกลุ่ม "ผู้ดูแลระบบ" เหนือออกจากระบบ ลิงก์มาจาก `adminSection` ใน `nav-items` หน้า admin จึงเข้าจากเมนูโปรไฟล์ ไม่ได้อยู่ใน sidebar หน้าใหม่ไม่ต้องทำ layout เอง และไม่ต้องใส่ `<main>` ซ้ำ (AppShell มี `<main>` และ padding ให้แล้ว)
- Auth (`@/auth`, Auth.js v5 `next-auth`): session แบบ JWT ใน cookie (ยังไม่มี DB adapter) ต้องตั้ง `AUTH_SECRET` ใน `.env` อายุ 3 วันแบบต่ออายุตามการใช้งาน (`session.maxAge` ใน `src/auth.ts` ไม่ได้ใช้งานครบ 3 วันต้อง login ใหม่)
  - การป้องกัน route อยู่ใน `src/proxy.ts` (Next 16 แทน `middleware.ts`) route ใหม่ทุกตัวต้อง login โดย default ไม่ต้องเพิ่มอะไร `matcher` ยกเว้นแค่ `/login`, `/login/sso`, `/super/login`, `/auth/callback` (redirect_uri ที่ลงทะเบียนกับ PLK Health ID ส่งต่อไป Auth.js), `/api/auth/*` และไฟล์ static ไม่มี session: page redirect ไป `/login?callbackUrl=<path>` (path ใน origin เดียวกันเท่านั้น ตรวจด้วย `safePath` จาก `@/lib/safe-path`) ส่วน `/api/*` ตอบ 401 `{ error }` ห้ามเพิ่มทางยกเว้นใน matcher โดยไม่แจ้งผู้ใช้
  - อ่าน session: `const session = await auth()` (`session?.user.name`) ใช้ได้ใน server component, route handler และ server action ใน server component อ่าน cookie ต้องอยู่ใน `<Suspense>` (cacheComponents) proxy ไม่ควรเป็นด่านเดียว (Next docs) route handler ที่อ่าน HIS และ server action ที่เขียนข้อมูลต้องเช็ค `auth()` เองซ้ำ ตอบ 401 ถ้าไม่มี (ดู `/api/example/db-health`)
  - super user: Credentials provider จาก `AUTH_ADMIN_USER`/`AUTH_ADMIN_PASSWORD` เปิดเมื่อตั้งทั้งสองตัว ลบออกจาก `.env` = ปิด login ที่ `/super/login` เท่านั้น (ไม่มีลิงก์จาก `/login` ปิดอยู่จะตอบ 404) ได้ role `admin` จาก token
  - `/login` เข้า SSO อัตโนมัติ: `/login` ที่ไม่มี `error` และ `logged_out` ถูก proxy ส่งไป `/login/sso` (route handler ที่เรียก `signIn("plkhealth")` เพราะต้องตั้ง cookie state/PKCE/nonce) แล้วไป IdP ทันที ถ้ามี `?error=` (เช่น `pending`) หรือ `?logged_out=1` จะแสดงข้อความกับปุ่ม Provider ID ให้กดเอง กัน loop และกันการ login กลับทันทีหลังออกจากระบบขณะที่ session ของ IdP ยังอยู่ ออกจากระบบ (UserMenu) ไปที่ `/login?logged_out=1`
  - SSO PLK Health ID (provider `plkhealth`, OIDC) เปิดเมื่อตั้ง `AUTH_PLKHEALTH_ISSUER`/`_ID`/`_SECRET`/`_REDIRECT_URI` ครบ IdP รับ redirect_uri ได้แค่ `{origin}/auth/callback` ที่ลงทะเบียนไว้ (ไม่ใช่ default ของ Auth.js) จึงแทนค่าทั้งตอน authorize และตอนแลก token ใน `src/auth.ts` แล้ว `src/app/auth/callback/route.ts` ส่งต่อไป `/api/auth/callback/plkhealth` sign-in แล้ว upsert ลงตาราง `users` (insight) ยังไม่ `is_approve` จะถูกส่งไป `/login?error=pending` ส่วนที่อนุมัติแล้วได้ `session.user.userId` และ `session.user.role` (super user ได้ role `admin` ไม่มีแถวใน `users`) role/การอนุมัติอ่านตอน sign-in เท่านั้น เปลี่ยนแล้วมีผลเมื่อ login ใหม่ error ของ Auth.js ไปที่ `/login?error=<type>`
  - ทุกอย่างใต้ `/admin` และ `/api/admin` เป็นของ admin (`session.user.role === "admin"`) เท่านั้น บังคับที่ `src/proxy.ts` (มี session แต่ไม่ใช่ admin: page redirect ไป `/` ส่วน API ตอบ 403 `{ error }`) และที่ `src/app/(app)/admin/layout.tsx` (redirect ไป `/`) หน้า admin ใหม่วางใต้ `src/app/(app)/admin/` ก็ได้รับการป้องกันเอง เพิ่มลิงก์ใน `adminSection` (เข้าจากเมนูโปรไฟล์ ไม่อยู่ใน sidebar) แต่ route handler ใต้ `/api/admin` ไม่มี layout ครอบ ต้องเช็ค 401/403 เองซ้ำ (ดู `/api/admin/users`)
  - role มีแค่ `user` กับ `admin` (constraint `users_role_check`) admin ตั้งหรือยกเลิก admin ให้ผู้ใช้อื่นได้ที่ `/admin/users` (เปลี่ยนของตัวเองไม่ได้) การเปลี่ยน role มีผลเมื่อผู้ใช้คนนั้น login ครั้งถัดไป เพราะ role อยู่ใน JWT
  - เพิ่ม SSO (OIDC เช่น Keycloak, Microsoft Entra, Google): push provider หนึ่งบรรทัดใน `src/auth.ts` (ดู provider `plkhealth`) ตั้ง env `AUTH_<PROVIDER>_ID`/`_SECRET`/`_ISSUER` (Auth.js อ่านเอง) ลงทะเบียน callback `{origin}/api/auth/callback/<provider-id>` ที่ IdP แล้วปรับ `/login` และ `/login/sso` ให้เลือก provider
- `navItems` (`@/components/app-shell/nav-items`): ต้องเพิ่มเมนูทุกครั้งที่สร้างหน้า `{module}/{task}` หน้าเดี่ยวใช้ `{ label, href, icon }` หมวดใช้ `{ label, icon, children: [...] }` หน้าใต้ `/admin` ไม่ใส่ใน `navItems` แต่เพิ่มใน `adminSection.children` (แสดงในเมนูโปรไฟล์ของ admin และใช้ทำ breadcrumb) ชื่อไอคอนเลือกจาก `@/components/app-shell/icons` ถ้าไม่มีให้เพิ่ม SVG ในไฟล์นั้น หมวดที่มีแล้ว: "ผู้รับบริการ" (`/visit/*`) และ "กองทุน" (`/fund/*`, ไอคอน `wallet`) หน้าใหม่ในโมดูลเดิมให้เพิ่มใน `children` ของหมวดนั้น ไม่สร้างหมวดซ้ำ
- `ThemeSwitch` (`@/components/app-shell/theme-switch`): ปุ่มสลับธีม สว่าง/มืด/ตามระบบ (อยู่ใน topbar ของ AppShell แล้ว)
- design token ใน `src/app/globals.css` ใช้ผ่าน Tailwind เช่น `bg-surface`, `bg-surface-sunken`, `bg-hover`, `border-line`, `text-muted`, `bg-accent text-accent-fg`, `bg-accent-soft text-accent-text`, `ring-ring` และ `{danger|warning|success}` (`text-*`, `bg-*-soft`, `border-*-line`) ห้ามใช้สีตายตัว (`zinc-*`, `white`, `#hex`) ทุก token มีทั้งสองธีมแล้วจึงไม่ต้องเขียน `dark:` ถ้าจำเป็นต้องใช้ `dark:` จะอิง `data-theme` ไม่ใช่ `prefers-color-scheme`
  - ขนาดตัวอักษรใน content ไม่เกิน 13px ยกเว้นหัวข้อ page/section ใช้ `text-title` (14px, semibold) ใช้เฉพาะ type scale ใน globals.css (`text-xs` 11px, `text-sm` 12px, `text-base` 13px, `text-title`; `text-lg` ขึ้นไปถูกปิดไว้) ห้ามกำหนดขนาดเอง (`text-[..px]`, `font-size`) ลำดับชั้นอื่นแยกด้วยน้ำหนักและสี
  - วันที่ที่แสดงให้ผู้ใช้เป็นไทย พ.ศ. เสมอ (ทั้งโปรเจกต์ให้หน้าตาเดียวกัน): เลือกวันที่ด้วย `ThaiDatePicker` แสดงผลในตารางและข้อความด้วย `formatThaiDate` ห้ามใช้ `<input type="date">` (บังคับ พ.ศ. ไม่ได้) หรือแสดงปี ค.ศ. ส่วนค่าใน URL, API และ DB เป็น ISO ค.ศ. `YYYY-MM-DD` เหมือนเดิม
  - เงินบาทแสดงแบบเดียวกันทั้งโปรเจกต์ (ใช้ `@/lib/number-format` ห้ามจัดรูปแบบเอง) เพราะผู้ใช้เทียบตัวเลขข้ามหน้า และการเบิกจ่ายต้องเห็นค่าถึงสตางค์:
    - ตาราง (รวมแถวรวมและยอดสรุปที่อยู่ในตาราง/รายการ): ค่าเต็ม `formatBaht` 2 ตำแหน่ง ชิดขวา `tabular-nums` หน่วยอยู่ที่หัวคอลัมน์ครั้งเดียว เช่น "มูลค่า (บาท)" ไม่ใส่หน่วยในแต่ละช่อง ศูนย์แสดง `0.00` ไม่มีค่าแสดง "–" สีจาง (`text-muted`)
    - KPI/dashboard: `formatCompactBaht` (ตั้งแต่ 1 ล้าน "2.38 ล้านบาท" ต่ำกว่านั้นจำนวนเต็ม "723,036 บาท") และแสดงค่าเต็มตอน hover (`title`) เพราะตัวย่อเทียบยอดจริงไม่ได้
    - แกนกราฟ: หน่วยอยู่ในชื่อแกน (เช่น "ล้านบาท") และ tick ใช้ `formatMillions`
    - ห้ามใช้ ฿, K, M หรือ "พัน" (ผู้ใช้อ่านปนกันแล้วสับสนหลัก) ค่าติดลบใช้เครื่องหมาย − (U+2212) ไม่ใช้วงเล็บ
    - Excel (xlsx): เขียนเป็นตัวเลขจริง (ไม่ใช่ string) ตั้งรูปแบบ `#,##0.00` และหน่วยอยู่ที่หัวคอลัมน์ ผู้ใช้จะได้คำนวณต่อได้
  - DataGrid ใช้ token ของตัวเอง `text-grid-head` (13px) และ `text-grid-cell` (11px) ใน globals.css เป็นค่าทดลอง ปรับที่ token ที่เดียว
  - ส่วนหัวของ page ต้องไม่ slop เพราะผู้ใช้ต้องรู้ทันทีว่าเป็นหน้าอะไรโดยไม่ต้องอ่านเพิ่ม:
    - มีแค่หัวข้อสั้นๆ (คำนามบอกว่าเป็นหน้าอะไร เช่น "ผู้ป่วยนอกรายวัน", "ยาเบิกจ่ายตามแผนก") และปุ่ม action หรือ filter ถ้ามี
    - ห้ามมีคำอธิบายใต้หัวข้อ ทั้งอธิบายข้อมูล ("แสดงรายการผู้ป่วยนอก...") และบอกวิธีใช้ ("คลิกที่แถวเพื่อดูรายละเอียด", "ค้นหาด้วยชื่อหรือ HN") ช่วงเวลาหรือแหล่งข้อมูลถ้าจำเป็นให้แสดงเป็นค่าใน filter หรือ control แทนประโยค
    - ห้ามใส่ placeholder หรือข้อความแนะนำวิธีใช้ใน input ให้ใช้ aria-label และไอคอนแทน (kbd badge คีย์ลัด เช่น `Ctrl K` ใช้ได้)
    - ห้ามคำทักทาย ("ยินดีต้อนรับ"), คำฟุ้งเฟ้อ ("ครบวงจร", "อย่างมีประสิทธิภาพ", "ข้อมูลเชิงลึก", "ทรงพลัง", "ยกระดับ", "ชาญฉลาด"), ประโยคเกริ่นที่ไม่มีข้อมูล, emoji และเครื่องหมายตกใจ
    - ตรวจ copy ของส่วนหัวหน้าใหม่ด้วย skill `impeccable` (clarify) ทุกครั้ง
- `DataGrid` (`@/components/data-grid/data-grid`): ตารางข้อมูลจาก API แบบ server-side ทั้ง sort, ค้นหา, แบ่งหน้า และปุ่มส่งออก Excel state อยู่ใน URL (`page`, `pageSize`, `sort`, `dir`, `q`) จึง refresh หรือแชร์ link ได้หน้าเดิม
  - props: `endpoint`, `columns` (สร้างด้วย `gridColumnHelper<Row>()` ประกาศนอก component), `getRowId`, `renderDetail?(row)`, `detailMode?: "modal" | "expand"`, `detailTitle?(row)`, `filterKeys?` (ชื่อ param อื่นใน URL ที่ส่งต่อให้ API และไฟล์ Excel เช่น `["from", "to"]` route ต้อง validate เอง ดู `/visit/opd-visit`), `toolbar?` (ReactNode เช่น ตัวเลือกวันที่ แสดงชิดซ้ายหน้าช่องค้นหาในแถวเดียวกัน และขึ้นบรรทัดใหม่เองบนจอแคบ ไม่ต้องวาง filter แยกเหนือตาราง), `params?` (`Record<string, string>` ค่าที่ส่งไป endpoint เพิ่มทั้งตอนโหลดและส่งออก Excel เมื่อค่า filter ไม่ได้อยู่ใน URL ตรงๆ ค่าว่างไม่ส่ง route ต้อง validate เอง), `filters?` (ReactNode แสดงตำแหน่งเดียวกับ `toolbar` ต่อท้าย ใช้ตัวใดตัวหนึ่งก็ได้), `liveSearch?` (ค้นหาระหว่างพิมพ์ หน่วง 300ms ไม่มีปุ่มค้นหา ข้อความสั้นกว่า 2 ตัวอักษรยังไม่ยิง request เว้นแต่กด Enter, Esc หรือลบจนว่างคือล้าง ใช้เมื่อ endpoint รับโหลดได้ เพราะยิงหนึ่ง request ต่อการหยุดพิมพ์ ดู `/visit/opd-visit`), `renderSummary?(data)` (แถบสรุประหว่าง toolbar กับตาราง รับ response ทั้งก้อน เช่นผลรวมของทุกแถวที่ตรง filter ให้ route ส่ง field เพิ่มจาก `{ rows, total }` แล้วระบุชนิดเป็น type param ตัวที่สอง `DataGrid<Row, GridPage<Row> & { summary: ... }>` ระหว่างโหลดแสดงค่าเดิมแบบจาง ดู `/visit/opd-visit`), `exportPlacement?: "toolbar" | "summary"` (ตำแหน่งปุ่มส่งออก Excel ค่าเริ่มต้น `"toolbar"` ชิดขวาแถวช่องค้นหา ส่วน `"summary"` ชิดขวาในแถบสรุป ใช้ได้เมื่อมี `renderSummary` ไม่มีจะกลับไปอยู่ toolbar ดู `/visit/opd-visit`) (ช่องค้นหาไม่มี placeholder ใช้ `aria-label="ค้นหา"` กับไอคอนแว่นขยาย ลบจนว่างคือล้างการค้นหาทันทีทั้งสองโหมด)
  - ใช้ `useSearchParams` จึงต้องครอบด้วย `<Suspense>` และ `columns`/`renderDetail`/`renderSummary` เป็นฟังก์ชัน จึงต้องวางใน client component ของ module
  - ปุ่มในแถวที่แก้ข้อมูลแล้วต้องให้ grid โหลดใหม่: ใน `cell` เรียก `info.table.options.meta?.reload()` (โหลดหน้าปัจจุบันซ้ำ) ตัวอย่างที่ `src/app/(app)/admin/users/users-grid.tsx`
- `StackedBarChart` (`@/components/stacked-bar-chart/stacked-bar-chart`): กราฟแท่งซ้อนหรือแท่งเรียงกลุ่มด้วย chart.js (client) กว้างตาม container แท่งเยอะเกินจอเลื่อนแนวนอน legend เป็น HTML, tooltip รวมทุก series + ยอดรวม และปุ่มเปิดตารางข้อมูล (canvas อ่านด้วย screen reader ไม่ได้) สีอ่านจาก token ตอนวาดและวาดใหม่เมื่อสลับธีม props: `label` (aria-label/caption), `categoryHeader`, `categories: { key, label, title }[]` (`label` แกน x, `title` หัว tooltip/แถวตาราง), `series: { key, label, color, short?, note? }[]` (ล่างขึ้นบน หรือซ้ายไปขวาเมื่อไม่ซ้อน, `color` เป็น token เช่น `"var(--chart-1)"`), `values[category][series]`, `format(n)`, `integer?`, `hrefFor?(c, s)` (คลิก segment และ link ในตาราง), `stacked?` (ค่าเริ่มต้น `true` ส่ง `false` = แท่งแยกแต่ละ series วางเรียงกันในแต่ละ category แกน y อิงค่าสูงสุดรายแท่ง และความกว้างขั้นต่ำต่อ category เพิ่มตามจำนวน series), `height?` (ความสูงพื้นที่กราฟ px ค่าเริ่มต้น 260) ฟังก์ชันเป็น prop จึงต้องเรียกจาก client component ดูหน้าแรก `/?tab=trend`
  - สีของกราฟ: token `--chart-1` ถึง `--chart-7` (categorical ผ่านการตรวจ CVD ตามลำดับ ใช้ตามลำดับ ห้ามวนสี) และ `--chart-other` (สีกลางของ "อื่นๆ") ผูกสีกับ entity ไม่ใช่อันดับ กรองแล้วสีต้องไม่เปลี่ยน
- `@/lib/thai-date`: `formatThaiDate(iso, "short" | "long")` คืน `4 พ.ย. 2569` (ค่าเริ่มต้น) หรือ `4 พฤศจิกายน 2569` รับ datetime ที่ขึ้นต้นด้วยวันที่ได้ ค่าว่าง/ผิดรูปแบบคืน `""`, `todayIso()` วันนี้ตามเวลาไทยเป็น ISO, `parseIsoDate`, `THAI_MONTHS`, `THAI_MONTHS_SHORT`
- `DateRangeFilter` (`@/components/date-range-filter/date-range-filter`): ช่วงวันที่ `ThaiDatePicker` สองตัว ("ตั้งแต่", "ถึง") + select ช่วงสำเร็จรูป (วันนี้ / 7 วันล่าสุด / 30 วันล่าสุด / เดือนนี้) เขียน URL `start`/`end` (ISO ค.ศ.) ด้วย `router.replace` และล้าง `page` ยาวได้ไม่เกิน `MAX_RANGE_DAYS` (30 วันรวมวันแรกและวันสุดท้าย export จากไฟล์เดียวกัน แก้ที่เดียว) เพราะ query ช่วงยาวบน `opitemrece` ล็อกตารางของ HOSxP ค่าเริ่มต้น (ไม่มี `start`/`end`) คือวันนี้ถึงวันนี้ เวลาไทย ตรงกับ preset "วันนี้" ซึ่งเป็นตัวแรก preset ที่ช่วงตรงกับ URL จะแสดงเป็นตัวที่เลือก ไม่ตรงกับตัวไหนแสดง "กำหนดเอง" เลือก start แล้วช่วงผิด/ยาวเกินจะเลื่อน end ตาม (ไม่เกินวันนี้) เลือก end จะเลื่อน start ตาม อ่านค่าด้วย `useDateRange()` คืน `{ start, end }` ที่ปรับแล้ว (ค่าใน URL ที่ผิดหรือยาวเกินถูกตัดฝั่ง client API จึงไม่ได้ช่วงผิด แต่ route ยังต้อง validate เอง) ทั้งคู่ใช้ `useSearchParams` จึงต้องครอบด้วย `<Suspense>` ส่ง `{ start, end }` ต่อเป็น `params` ของ DataGrid ได้เลย ตัวอย่าง `/fund/opd-fund`
- `@/lib/number-format`: `formatBaht(n)` เงิน 2 ตำแหน่งไม่มีหน่วย (`1,234,567.50`, ติดลบ `−1,234.00`), `formatCount(n)` จำนวนนับ (`12,345`), `formatCompactBaht(n)` สำหรับ KPI (`2.38 ล้านบาท` เมื่อ ≥ 1 ล้าน ไม่งั้น `723,036 บาท`), `formatMillions(n)` tick แกนกราฟหน่วยล้านบาท (`1.5`, `0.25`) ใช้ตามกฎการแสดงเงินด้านบน
- `AuthCard`, `AuthNotice` (`@/components/auth-card/auth-card`): กรอบหน้า login นอก AppShell (โลโก้ + การ์ด + หัวข้อ) ใช้ที่ `/login` และ `/super/login` props `title`, `children` ส่วน `AuthNotice` เป็นข้อความหนึ่งบรรทัด `tone: "danger" | "warning" | "success"` (`id?` ใช้กับ `aria-describedby`)
- `safePath` (`@/lib/safe-path`): คืน path ใน origin เดียวกัน (`/x` ไม่ใช่ `//host` หรือ `/\host`) ไม่งั้นคืน `/` ใช้กับ `callbackUrl`/`redirectTo` ทุกที่ กัน open redirect
- `DetailModal` (`@/components/detail-modal/detail-modal`): modal จาก `<dialog>` ของ browser ปิดด้วย Esc หรือปุ่มปิด props: `open`, `onClose`, `title`, `children`, `size?: "default" | "wide"` (ค่าเริ่มต้นกว้าง 40rem, `"wide"` เกือบเต็มจอและสูงคงที่ เนื้อหาเลื่อนข้างใน สำหรับ modal ที่มีตาราง ซ้อน modal ได้ เช่น DataGrid ใน modal ใช้ `detailMode="modal"` เปิดอีกชั้นทับ Esc/ปุ่มปิดปิดเฉพาะชั้นบนสุด และอย่ามี DataGrid อีกตัวในหน้าหลังเพราะใช้ state ใน URL ร่วมกัน ดู `/fund/opd-fund`)
- `ThaiDatePicker` (`@/components/thai-date-picker/thai-date-picker`): เลือกวันที่แบบ พ.ศ. (แสดง "4 พ.ย. 2569") แทน `<input type="date">` ที่บังคับ พ.ศ. ไม่ได้ มีปุ่มวันก่อน/ถัดไป และปฏิทินใน native popover ใช้คีย์บอร์ดได้ props: `label` (แสดงหน้าปุ่มและเป็นชื่อสำหรับ screen reader), `value`/`onChange` เป็น ISO ค.ศ. `YYYY-MM-DD` (URL/API ใช้ ค.ศ. แปลงแค่ตอนแสดง), `min?`/`max?` (ช่วงที่เลือกได้ เช่น max = วันนี้), `stepper?` (ค่าเริ่มต้น `true` แสดงปุ่มวันก่อน/ถัดไป ใส่ `false` เมื่อใช้สองตัวเป็นช่วงวันที่ "ตั้งแต่"/"ถึง" โดยตัว "ถึง" ใส่ `min` = วันเริ่ม ดู `/visit/opd-visit`) และ `formatThaiDate(iso, long?)` สำหรับแสดงวันที่ พ.ศ. ที่อื่น
- `MultiSelect` (`@/components/multi-select/multi-select`): เลือกหลายค่าแบบ checkbox แบ่งกลุ่มใน native popover มีช่องค้นหา (aria-label ไม่มี placeholder), checkbox ระดับกลุ่มเลือกทั้งกลุ่ม (ค้นหาอยู่ = เฉพาะที่เห็น), ปุ่มล้าง และลูกศรขึ้น/ลงเลื่อนในรายการ ติ๊กในรายการเป็นร่าง แล้วเรียก `onChange` ครั้งเดียวตอนปิด (กันยิง query ทุกครั้งที่ติ๊ก) ส่วนปุ่ม × ข้างปุ่มล้างทันที props: `label`, `groups: { value, label, options: { value, label, hint? }[] }[]` (`hint` เช่น รหัส แสดงจางและค้นหาได้), `value: string[]`, `onChange(values)` (เรียงตามลำดับ options), `allLabel?` (ข้อความเมื่อไม่ได้เลือก ค่าเริ่มต้น "ทั้งหมด") ดูหน้าแรก `/` (กรองหลายสิทธิ `?pttype=89,77`)
- `Clock` (`@/components/clock/clock`): นาฬิกาเวลาไทย พ.ศ. เดินทุกวินาที ("พ. 4 พ.ย. 2569 14:05:32" วันที่สีจาง เวลาตัวหนา tabular-nums) ใน `<time dateTime>` พร้อม aria-label วันเวลาเต็ม ไม่ใช่ live region วางขวาของหัวข้อ page ได้เลยเพราะเป็น client component ที่ render เฉพาะฝั่ง client (server คืน null จึงไม่ต้องครอบ Suspense) props: `className?` ดู `/visit/opd-visit`
- `parseGridQuery` (`@/lib/grid-query`): ใช้ใน route handler ที่ DataGrid เรียก สัญญา API:
  - request: `GET ?page=1&pageSize=20&sort=<col>&dir=asc|desc&q=<text>[&format=xlsx]` ค่า `pageSize` สูงสุด `MAX_PAGE_SIZE` (100) และ `sort` ต้องอยู่ใน allowlist ที่ route ส่งให้ ค่าไม่ถูกต้องตอบ 400 `{ error }`
  - response: `{ rows, total }` (`total` = จำนวนแถวทั้งหมดหลังค้นหา) ส่วน `format=xlsx` ส่งไฟล์ทุกแถวตาม `sort`/`q` ปัจจุบัน ไม่สน `page`
  - ต่อ DB: `sort` ผ่าน allowlist แล้วจึงใช้เป็นชื่อคอลัมน์ได้ ส่วน `q` ต้องส่งเป็น bind parameter เสมอ และคอลัมน์ที่ค้นหาให้ route กำหนดเอง
- `xlsxResponse` (`@/lib/xlsx`): `xlsxResponse(filename, columns, rows)` คืน `Response` ไฟล์ .xlsx (exceljs) สำหรับ `format=xlsx` คอลัมน์เป็น `XlsxColumn<T> = { key, header, width?, type?: "money" | "count" }`: `"money"` แปลงเป็นตัวเลขรูปแบบ `#,##0.00` (หน่วยใส่ใน header เช่น "มูลค่า (บาท)"), `"count"` เป็นตัวเลข `#,##0` ไม่ใส่ `type` = ค่าตามเดิม (string เป็นข้อความ HN จึงไม่เสียเลขศูนย์นำหน้า วันที่คงเป็น `YYYY-MM-DD`) ค่าว่าง/null/ไม่ใช่ตัวเลขในคอลัมน์ money/count เป็นช่องว่าง ตัวอย่างใช้ที่ fund visits (amount) และ components-demo (อายุ)
- `@/lib/db`: เชื่อมต่อฐานข้อมูล 2 ฐาน (server-only, pool แบบ lazy, env ตั้งใน `.env` ตาม `.env.example`)
  - `his`: HOSxP บน MySQL (`mysql2`) ฐาน production ของโรงพยาบาล **อ่านอย่างเดียว ห้ามรันคำสั่งเขียนทุกชนิดไม่ว่ากรณีใดหรือผ่านเครื่องมือใด** ใช้ `hisQuery<T>(sql, params)` เท่านั้น ยอมแค่ statement เดียวที่ขึ้นต้นด้วย SELECT/WITH/SHOW/DESCRIBE/EXPLAIN และทุก connection ตั้ง `SET SESSION TRANSACTION READ ONLY` กับ `SET NAMES utf8mb4` (server มี `init_connect` บังคับ tis620 ทำให้ค้นด้วยภาษาไทยไม่เจอ) ห้ามสร้าง pool หรือ connection ไป his เองเพื่อเลี่ยงข้อนี้ และ DB user ของ his ต้องมีสิทธิ์ SELECT เท่านั้น
    - `opitemrece` เป็น MyISAM: SELECT ที่นานจะล็อกตารางและบล็อกการบันทึกของ HOSxP ทั้งโรงพยาบาล query ตามช่วงวันที่ต้องใช้ `FORCE INDEX (ix_vstdate)` และห้าม JOIN `pttype` เพื่อกรอง `hipdata_code` (ให้แปลงเป็น `pttype IN (...)` ในโค้ดก่อน) ใช้กับ `db-cli` ด้วย
    - แถว OPD ใน `opitemrece` คือ `vn IS NOT NULL` (แถว IPD มี `an` และ `vn` เป็น NULL) ต้องกรองเสมอ ไม่งั้นยอดผู้ป่วยในปนมา
    - ชื่อกองทุน (`pttype.hipdata_code`) มาจาก `nhso_inscl_code.inscl_name` (ตาราง `hipdata` เป็นข้อมูลบุคคล ไม่ใช่ชื่อกองทุน) ชื่อรายการค่าใช้จ่ายมาจาก `s_drugitems`
    - รวม `ovst` กับ `opitemrece`: สรุป `opitemrece` ใน derived table ด้วย `FORCE INDEX (ix_vstdate)` ก่อน แล้วค่อย JOIN `ovst` ด้วย `vn` ห้าม JOIN สองตารางตรงๆ เพราะ FORCE INDEX ทำให้ใช้ `ix_vn` ไม่ได้ และถ้าเริ่มจาก `ovst` จะสแกน `opitemrece` ซ้ำทุกแถว (ล็อกนาน)
    - แผนกหลักของ visit คือ `ovst.main_dep` ชื่อแผนกอยู่ที่ `kskdepartment.department`
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

กฎส่วนนี้ใช้กับ Claude Code เท่านั้น agent อื่น (Codex, Gemini CLI ฯลฯ) ห้าม spawn subagent ให้ทำงานเองทั้งหมด แต่ยังต้องทำตามข้อส่ง link dev server, handoff และลบ artifact ในส่วนนี้

- งานที่ต้องลงมือ (แก้โค้ด, รันคำสั่ง, ตรวจฐานข้อมูล, ค้นหาในโค้ดเพื่อทำงานต่อ) ต้อง spawn subagent ที่เหมาะสมเสมอ main ไม่ลงมือเอง ส่วนการปรึกษา ถาม-ตอบ หรือวางแผน main ทำเองโดยไม่ spawn
  - `sr`: งานออกแบบ บั๊กที่ยังไม่รู้สาเหตุ refactor หลายไฟล์ และรีวิวงานของ `jr`
  - `jr`: งานที่ขอบเขตชัด งานประจำ แก้เล็ก เพิ่ม test ค้นหาในโค้ด
  - `prove-query`: พิสูจน์ว่า SQL ถูกต้องและเหมาะสม (ถูกต้อง เร็วพอ ปลอดภัย ดึงเท่าที่ใช้) กับฐานจริง (his/insight) ผ่าน `db-cli --skill` เท่านั้น อ่านอย่างเดียว ไม่แก้ไฟล์ ส่งผลเป็นบล็อกกลับให้ main
  - ข้อยกเว้น: `commit`, `push`, เปิด PR และ `merge` main รันเองหลังผู้ใช้สั่ง ไม่ส่งให้ subagent subagent แก้และตรวจผลเท่านั้น เพราะ subagent ไม่ทำตามคำสั่งที่ agent อื่นส่งต่อมา (ถูกต้องแล้ว เพราะคำสั่ง git ต้องมาจากผู้ใช้)
- งานที่แยกส่วนได้และไม่แตะไฟล์เดียวกัน ให้ spawn `sr` และ `jr` พร้อมกัน แต่ละตัวต้องได้ขอบเขตไฟล์ที่ชัดเจน
- งานที่มี SQL ใหม่หรือแก้ SQL ให้ main เรียก `prove-query` ก่อน แล้วคัดลอกบล็อกผลที่ `สถานะ: ผ่าน` ไปใส่ prompt ของ `jr`/`sr` ที่เขียนโค้ด เพราะ subagent ส่งผลได้แค่กลับหา main และ SQL ที่ใส่ในโค้ดต้องผ่านฐานจริงก่อน ถ้า `ไม่ผ่าน` main แก้ปัญหาตามที่ขอแล้วเรียกซ้ำ
- subagent ทำเสร็จแล้ว main สรุปผลให้ผู้ใช้ รวมถึงไฟล์ที่เปลี่ยนและผลการตรวจสอบ
- ทำงาน dev เสร็จ (แก้ page หรือ API) ทุกคำสั่งของผู้ใช้ ต้องส่ง link ของ dev server ที่คลิกได้ให้ผู้ใช้ทดสอบเสมอ:
  - dev server ยังไม่รัน ให้รัน `npm run dev` แบบ background แล้วเช็คด้วย `curl` ว่าหน้านั้นตอบ 200 ก่อนส่ง link
  - ส่ง URL เต็มของหน้าที่แก้ เช่น `http://localhost:3000/{module}/{task}` ถ้าแก้ API ให้ส่ง URL ของ API และหน้าที่เรียกใช้ API นั้นด้วย ทุก link ต้องเป็น `http://localhost:3000/...`
  - dev server รันที่ port 3000 เสมอ และรันได้ตัวเดียว (รวมถึงตอนทำงานใน worktree) ห้ามปล่อยให้ Next ย้ายไปพอร์ตอื่น เพราะ link ที่ส่งผู้ใช้จะผิด ถ้า 3000 ถูกจองอยู่ ให้หา process แล้ว kill ก่อน แล้วค่อยรัน `npm run dev`:
    - Windows (Git Bash): `netstat -ano | findstr :3000` หา PID แล้ว `taskkill //PID <pid> //F`
    - macOS/Linux: `lsof -ti :3000 | xargs kill`
- context หรือ usage limit ใกล้เต็ม (เช่น ระบบเตือน) ให้หยุดงานที่ทำอยู่ แล้วเขียน `{dev_name}/handoff.md` ที่ root ของโปรเจกต์ทันที (ไม่ต้องพึ่ง skill ใด เขียนด้วยตัวเอง):
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

ใน Claude Code งาน prove ให้ส่ง `prove-query` ทำ agent อื่นที่ไม่มี subagent ทำตามวิธีด้านล่างเอง

### ติดตั้ง CLI

```bash
npm i -g github:tehnplk/db-cli
db-cli -v
```

บน Windows ถ้าเรียกไม่ได้ ให้ใช้ `db-cli.cmd`

### วิธีใช้

- ต้องระบุในรายงานทุกครั้งว่าตรวจฐานไหน และใช้ `-g` ให้ตรง engine: `his` (env `HIS_*`, MySQL `-g my`) หรือ `insight` (env `INSIGHT_*`, PostgreSQL `-g pg`)
- CLI ไม่โหลด `.env` และไม่แปลงชื่อตัวแปรให้ (ไม่ระบุ `-H` จะต่อ `localhost`) ต้องอ่านค่าจริงจาก `.env` ของฐานที่จะตรวจ แล้วส่งผ่าน flag ตัวย่อ `-H` host, `-P` port, `-u` user, `-d` database, `-e` SQL (ผลลงไฟล์ใช้ `-o`) ส่วน password ไม่ใช้ `-p` (รหัสผ่านจะโผล่ในคำสั่ง) ให้นำหน้าคำสั่งด้วย `DB_PASSWORD='...'` ในบรรทัดเดียวกัน (ใส่ `'...'` เสมอเพราะรหัสผ่านมีอักขระพิเศษได้) ห้ามใช้ค่า `USER` จาก environment ของระบบแทนผู้ใช้ฐานข้อมูล
- รูปแบบเรียกใช้ (แทน `<...>` ด้วยค่าจาก `.env` ตามชื่อตัวแปร) ตรวจการเชื่อมต่อและชื่อฐานข้อมูล:

```bash
# his (MySQL): HIS_HOST HIS_PORT HIS_USER HIS_PASSWORD HIS_DATABASE
DB_PASSWORD='<HIS_PASSWORD>' db-cli -g my -H <HIS_HOST> -P <HIS_PORT> -u <HIS_USER> -d <HIS_DATABASE> -e "SELECT 1 AS connection_ok, DATABASE() AS database_name;"
# insight (PostgreSQL): INSIGHT_HOST INSIGHT_PORT INSIGHT_USER INSIGHT_PASSWORD INSIGHT_DATABASE
DB_PASSWORD='<INSIGHT_PASSWORD>' db-cli -g pg -H <INSIGHT_HOST> -P <INSIGHT_PORT> -u <INSIGHT_USER> -d <INSIGHT_DATABASE> -e "SELECT 1 AS connection_ok, current_database() AS database_name;"
```

- ผลสำเร็จเป็นตาราง `col|col` คั่นด้วย `|` ส่วน error ขึ้น `error|<ข้อความ>` (เช่น `connect ETIMEDOUT` = เครื่องนี้ต่อ host ไม่ถึง ให้เช็คเครือข่ายหรือ VPN ก่อน ไม่ใช่ flag ผิด) ใช้ `-e` ได้ครั้งเดียวต่อคำสั่ง db-cli เป็น read-only โดย default (ไม่ใส่ `-w` ห้ามใส่เองตามข้อห้ามด้านล่าง) และจะปิดค่าคอลัมน์ส่วนบุคคล (`*cid`, `*lname`, `*tel` ฯลฯ) เป็น MD5 กับปฏิเสธ `SELECT *` บน `patient`/`person` ให้ระบุคอลัมน์
- ตรวจ schema หรือ query ที่เกี่ยวข้องกับงาน แล้วรายงาน SQL และผลตรวจจริง: his ใช้ `SHOW TABLES`, `SHOW COLUMNS FROM ...` ส่วน insight ใช้ `information_schema.tables` / `information_schema.columns` และทั้งสองใช้ `SELECT ... LIMIT ...` ได้

### ข้อห้าม

- ห้ามเขียน script หรือโค้ดชั่วคราว (เช่น ไฟล์ `.js`/`.ts`/`.py`, `node -e`, `tsx`, เรียก `@/lib/db` นอกแอป) เพื่อดูหรือ query ข้อมูลในฐาน ต้องการ proof ของ query ให้ใช้ `db-cli` เท่านั้น เพราะ script เลี่ยงข้อห้ามคำสั่งเขียนได้ และ SQL กับผลจริงต้องรายงานจากคำสั่งที่ตรวจซ้ำได้
- ห้ามใช้ `db-cli` รัน `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `CREATE` และคำสั่งอื่น ๆ ที่มีผลเปลี่ยนแปลงข้อมูล (ฐาน `his` ดูข้อห้ามเขียนใน `@/lib/db` ด้านบน)
