// service worker: รับคำขอจาก content.js บนหน้า BKH Insight แล้วทำงานในแท็บ e-Claim ที่ผู้ใช้ login ไว้
// ด้วย chrome.scripting.executeScript (fetch ด้วย session ของแท็บนั้น ไม่อ่าน cookie ไม่เปลี่ยนหน้าหรือปิดแท็บ)
// URL ของ e-Claim สร้างจาก ecRequest เท่านั้น หน้าเว็บส่งได้แค่ชนิดคำขอกับค่าที่ผ่านการตรวจ (checkMessage)
import { ECLAIM_ORIGIN, PARSERS, checkMessage } from "./lib/sync.js";
import { ecFetch, ofcSelect, readChunk, releaseFile } from "./lib/tab.js";

// origin ของแอป = matches ของ content script ใน manifest.json (รายการเดียว แก้ที่นั่นที่เดียว)
const APP_ORIGINS = chrome.runtime.getManifest().content_scripts.flatMap((c) => c.matches).map((m) => new URL(m.replace(/\*$/, "")).origin);
const NO_TAB = `ไม่พบแท็บ e-Claim: เปิด ${ECLAIM_ORIGIN} แล้ว login ThaiD ใน Chrome นี้ก่อน`;
const isEclaim = (url) => typeof url === "string" && url.startsWith(`${ECLAIM_ORIGIN}/`);
const isLogin = (url) => /login|iam/i.test(new URL(url).pathname);

/** แท็บ e-Claim ที่ login แล้ว (tabId ระบุ = ต้องเป็นแท็บ e-Claim ตัวนั้น) ; "login" = มีแต่แท็บหน้า login */
async function eclaimTab(tabId) {
  if (tabId != null) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    return isEclaim(t?.url) ? t : null;
  }
  // host_permissions ของ e-Claim พอให้กรองด้วย url ได้ ไม่ต้องขอสิทธิ "tabs"
  const tabs = await chrome.tabs.query({ url: `${ECLAIM_ORIGIN}/*` });
  return tabs.find((t) => isEclaim(t.url) && !isLogin(t.url)) ?? (tabs.length ? "login" : null);
}

async function inject(tabId, func, args = []) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return r?.result ?? { error: "แท็บ e-Claim ไม่ตอบ" };
  } catch (e) {
    return { error: `ทำงานในแท็บ e-Claim ไม่ได้: ${e?.message ?? e} (คลิกแท็บ e-Claim ให้แสดงอยู่แล้วลองอีกครั้ง)` };
  }
}

async function handle(raw) {
  const m = checkMessage(raw);
  if (m.error) return m;
  if (m.op === "ping") return { version: chrome.runtime.getManifest().version };
  const tab = await eclaimTab(m.tabId);
  if (tab === "login") return { expired: true };
  if (!tab) return { fatal: m.tabId != null ? "แท็บ e-Claim ถูกปิดหรือเปลี่ยนหน้าระหว่างทำงาน" : NO_TAB };
  switch (m.op) {
    case "list": {
      const r = await inject(tab.id, ecFetch, [m.req.url, m.req.body, "text"]);
      // parse ที่นี่ หน้าเว็บได้แค่ฟิลด์ที่ต้องใช้ ไม่ได้ HTML ทั้งหน้า (เช่น ชื่อผู้ดาวน์โหลด)
      return r.text == null ? r : { items: PARSERS[m.kind](r.text) };
    }
    case "download": {
      const r = await inject(tab.id, ecFetch, [m.req.url, m.req.body, "bin"]);
      return r.size == null ? r : { size: r.size, tabId: tab.id };
    }
    case "chunk":
      return inject(tab.id, readChunk, [m.start, m.end]);
    case "release":
      return inject(tab.id, releaseFile);
    case "select":
      return inject(tab.id, ofcSelect);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !APP_ORIGINS.includes(sender.origin)) return false;
  handle(msg).then(reply, (e) => reply({ error: String(e?.message ?? e) }));
  return true; // ตอบแบบ async (ใช้ได้ทุกเวอร์ชันของ Chrome)
});
