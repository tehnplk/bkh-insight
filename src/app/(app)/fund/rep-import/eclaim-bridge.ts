// คุยกับ extension "BKH Insight – e-Claim sync" (extension/eclaim-sync/) ผ่าน content script ของหน้านี้ด้วย window.postMessage
// งานฝั่ง e-Claim ทำใน extension (แท็บ e-Claim ที่ผู้ใช้ login) ส่วนรายการที่นำเข้าแล้วและการอัปโหลดใช้ session ของหน้านี้เอง
import { appList, appUpload } from "../../../../../extension/eclaim-sync/lib/tab.js";

type Res = Record<string, unknown> | null;
let seq = 0;

/** ส่งข้อความถึง extension แล้วรอคำตอบ ; ไม่ตอบในเวลา (ไม่มี extension) คืน null */
function extCall(msg: object, timeoutMs: number): Promise<Res> {
  return new Promise((resolve) => {
    const id = ++seq;
    const finish = (r: Res) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(r);
    };
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (e.source === window && e.origin === location.origin && d?.source === "bkh-eclaim-ext" && d.id === id) finish(d.res ?? null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "bkh-eclaim-page", id, msg }, location.origin);
  });
}

/** เวอร์ชันของ extension ที่ติดตั้งในเบราว์เซอร์นี้ หรือ null */
export async function detectExtension(): Promise<string | null> {
  const r = await extCall({ op: "ping" }, 1000);
  return typeof r?.version === "string" ? r.version : null;
}

// ดาวน์โหลดไฟล์ใหญ่จาก e-Claim อาจนาน จึงรอได้ 2 นาทีต่อคำขอ
const ask = async (msg: object) => (await extCall(msg, 120_000)) ?? { fatal: "extension ไม่ตอบภายใน 2 นาที: รีเฟรชหน้านี้แล้วลองอีกครั้ง" };
type Handle = { tabId: number };

/** io ของ plan/run (extension/eclaim-sync/lib/sync.js) ฝั่งหน้าเว็บ */
export const pageIo = {
  list: (kind: string, p: object) => ask({ op: "list", kind, p }),
  download: (kind: string, p: object) => ask({ op: "download", kind, p }),
  chunk: (h: Handle, start: number, end: number) => ask({ op: "chunk", tabId: h.tabId, start, end }),
  release: (h: Handle) => ask({ op: "release", tabId: h.tabId }),
  select: () => ask({ op: "select" }),
  done: appList,
  upload: appUpload,
};
