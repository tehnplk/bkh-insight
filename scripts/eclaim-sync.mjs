// ดึง REP และ Statement (STM) จาก e-Claim สปสช. เข้า BKH Insight แบบคำสั่ง: npm run eclaim:sync [-- options]
// ทางหลักของเจ้าหน้าที่คือปุ่ม "นำเข้าอัตโนมัติ" ที่ /fund/rep-import ผ่าน extension (extension/eclaim-sync/) ; สคริปต์นี้ใช้ขั้นตอนเดียวกัน (lib/sync.js)
// ก่อนรัน (บน Chrome ปกติของเจ้าหน้าที่ ไม่ใช่ Chrome ที่โปรแกรมเปิดเอง เพราะ ThaiD login ใน Chrome อัตโนมัติไม่ได้):
//   1. login e-Claim ด้วย ThaiD ที่ https://eclaim.nhso.go.th และ login BKH Insight ไว้ในแท็บของ Chrome เดียวกัน
//   2. เปิด chrome://inspect/#remote-debugging แล้วเปิด remote debugging (ครั้งแรก Chrome ถามอนุญาต ให้กดอนุญาต)
//   3. npm run eclaim:sync -- --dry-run  (ดูรายการก่อน) แล้ว npm run eclaim:sync
// options: --from=YYYY-MM --to=YYYY-MM (ค.ศ. ค่าเริ่มต้น ต.ค. ของปีงบนี้ถึงเดือนนี้) --dry-run --hcode= --app= --cdp=ws://... --zone= --province=
// ทำงานผ่าน fetch ในแท็บที่เปิดอยู่ (ใช้ session ของแท็บนั้น) ไม่อ่าน cookie/token ไม่เปลี่ยนหน้าหรือปิดแท็บของผู้ใช้
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as lib from "../extension/eclaim-sync/lib/sync.js";
import { appList, appUpload, ecFetch, ofcSelect, readChunk, releaseFile } from "../extension/eclaim-sync/lib/tab.js";

const { Stop } = lib;
const J = JSON.stringify;
const call = (fn, ...args) => `(${fn})(${args.map((a) => J(a)).join(", ")})`;

// ---------- Chrome DevTools Protocol ----------

async function wsUrl(override) {
  if (override) return override;
  const dirs = {
    win32: join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data"),
    darwin: join(homedir(), "Library", "Application Support", "Google", "Chrome"),
  };
  const file = join(dirs[process.platform] ?? join(homedir(), ".config", "google-chrome"), "DevToolsActivePort");
  let txt;
  try {
    txt = await readFile(file, "utf8");
  } catch {
    throw new Stop("ไม่พบ Chrome ที่เปิด remote debugging: เปิด chrome://inspect/#remote-debugging แล้วเปิด remote debugging ก่อน");
  }
  const [port, path] = txt.split(/\r?\n/);
  return `ws://127.0.0.1:${port}${path}`;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const wait = new Map();
    let id = 0;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Stop("Chrome ไม่ตอบใน 60 วินาที: กดอนุญาต remote debugging ใน Chrome แล้วรันอีกครั้ง"));
    }, 60_000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve({
        send(method, params = {}, sessionId) {
          const msg = { id: ++id, method, params, ...(sessionId && { sessionId }) };
          ws.send(J(msg));
          return new Promise((ok, no) => wait.set(msg.id, { ok, no }));
        },
        close: () => ws.close(),
      });
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      const w = wait.get(m.id);
      if (!w) return;
      wait.delete(m.id);
      if (m.error) w.no(new Error(m.error.message));
      else w.ok(m.result);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Stop("ต่อ Chrome ไม่ได้: ตรวจว่า Chrome เปิดอยู่และเปิด remote debugging แล้ว"));
    };
    ws.onclose = () => {
      for (const w of wait.values()) w.no(new Stop("Chrome ปิดการเชื่อมต่อ"));
      wait.clear();
    };
  });
}

// ---------- main ----------

const opt = lib.parseArgs(process.argv.slice(2), process.env);
if (opt.error) {
  console.error(opt.error);
  process.exit(2);
}

let cdp;
let res;
let exitCode = 0;
try {
  cdp = await connect(await wsUrl(opt.cdp));
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pages = targetInfos.filter((t) => t.type === "page").map((t) => ({ ...t, u: URL.canParse(t.url) ? new URL(t.url) : null }));
  const ecTab = pages.find((t) => t.u?.origin === lib.ECLAIM_ORIGIN && !/login|iam/i.test(t.u.pathname));
  if (!ecTab) throw new Stop(`ไม่พบแท็บ e-Claim ที่ login แล้ว: เปิด ${lib.ECLAIM_ORIGIN} แล้ว login ThaiD ใน Chrome นี้`);
  const appOrigin = new URL(opt.app).origin;
  const appTab = pages.find((t) => t.u?.origin === appOrigin && !/^\/(super\/)?login/.test(t.u.pathname));
  if (!appTab) throw new Stop(`ไม่พบแท็บ BKH Insight ที่ login แล้ว (${appOrigin}): เปิดและ login ใน Chrome นี้ก่อน`);

  const attach = async (t) => (await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true })).sessionId;
  const [ec, app] = [await attach(ecTab), await attach(appTab)];
  const run = async (session, expression) => {
    const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const ecCall = async (k, p, mode) => {
    const q = lib.ecRequest(k, p);
    return q.error ? q : run(ec, call(ecFetch, q.url, q.body, mode));
  };

  // io ของ lib.plan/run ผ่าน CDP: e-Claim ในแท็บ e-Claim, รายการ/อัปโหลดในแท็บ BKH Insight
  const io = {
    list: async (k, p) => {
      const r = await ecCall(k, p, "text");
      return r.text == null ? r : { items: lib.PARSERS[k](r.text) };
    },
    download: (k, p) => ecCall(k, p, "bin"),
    chunk: (h, s, e) => run(ec, call(readChunk, s, e)),
    release: () => run(ec, call(releaseFile)),
    select: () => run(ec, call(ofcSelect)),
    done: (path, key) => run(app, call(appList, path, key)),
    upload: async (path, name, fields, chunks) => {
      await run(app, "window.__bkhEclaimSync = []");
      for (const c of chunks) await run(app, `window.__bkhEclaimSync.push(${J(c)})`);
      return run(app, `(${appUpload})(${J(path)}, ${J(name)}, ${J(fields)}, window.__bkhEclaimSync.splice(0))`);
    },
  };

  res = await lib.plan(opt, io);
  console.log(`ช่วง ${opt.from} ถึง ${opt.to} หน่วยบริการ ${res.hcode}${opt.dryRun ? " (dry-run ไม่ดาวน์โหลด)" : ""}`);
  if (opt.dryRun) {
    for (const t of res.todo) console.log(`  จะนำเข้า ${t.name}${t.repNo ? ` REP ${t.repNo}` : ""}${t.date ? ` ออกวันที่ ${t.date}` : ""}`);
  } else {
    await lib.run(res, io, {
      onItem: (t) => t.result.status === "imported" && console.log(`  นำเข้า ${t.name}${t.result.rows != null ? ` ${t.result.rows} แถว` : ""}`),
    });
  }
} catch (e) {
  exitCode = 1;
  console.error(e instanceof Stop ? e.message : `ผิดพลาด: ${e.message}`);
} finally {
  cdp?.close();
}

if (res) {
  console.log("\nสรุป");
  for (const [g, s] of Object.entries(res.stats)) {
    const done = opt.dryRun ? `จะนำเข้า ${s.pending}` : `นำเข้าใหม่ ${s.imported}`;
    console.log(`  ${g.padEnd(8)} พบ ${s.found}  นำเข้าไว้แล้ว ${s.already}  ${done}  ไม่สำเร็จ ${s.failed}  ข้าม ${s.skipped}`);
  }
  for (const { g, reason, n } of res.skips) console.log(`ข้าม ${g}: ${reason}${n > 1 ? ` (${n} ไฟล์)` : ""}`);
  console.log(lib.STM_UNSUPPORTED);
  if (res.stats["STM OFC"]?.found) console.log(lib.OFC_DATE_NOTE);
  for (const f of res.failures) console.log(`ไม่สำเร็จ ${f.g} ${f.what}: ${f.msg}`);
  if (res.failures.length) exitCode = 1;
}
process.exit(exitCode);
