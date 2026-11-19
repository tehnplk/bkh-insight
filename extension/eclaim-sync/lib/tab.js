// ฟังก์ชันที่รันในแท็บของผู้ใช้ ส่งเป็น source (chrome.scripting.executeScript({ func }) หรือ CDP Runtime.evaluate)
// จึงต้องไม่อ้างตัวแปรนอกฟังก์ชัน และคืนค่าที่ serialize เป็น JSON ได้

// ---------- แท็บ e-Claim (fetch ด้วย session ของแท็บ ไม่อ่าน cookie) ----------

/** fetch ใน origin ของ e-Claim ; mode "text" คืน { text }, "bin" เก็บไฟล์ใน window ของแท็บแล้วคืน { size } */
export async function ecFetch(url, body, mode) {
  try {
    // a.href encode query ตาม charset ของหน้า เหมือนปุ่มดาวน์โหลดของ e-Claim
    const href = Object.assign(document.createElement("a"), { href: url }).href;
    if (new URL(href).origin !== location.origin) return { error: "ปฏิเสธ URL นอก e-Claim" };
    const init = body == null ? {} : { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body };
    const res = await fetch(href, init);
    const u = new URL(res.url);
    if (u.host !== location.host || /login|iam/i.test(u.pathname) || res.status === 401 || res.status === 403) return { expired: true };
    if (!res.ok) return { status: res.status };
    const buf = new Uint8Array(await res.arrayBuffer());
    const looksHtml = /^\s*</.test(String.fromCharCode(...buf.subarray(0, 64)));
    if (mode === "text" || looksHtml) {
      const dec = (cs) => {
        try {
          return new TextDecoder(cs).decode(buf);
        } catch {
          return new TextDecoder().decode(buf);
        }
      };
      const cs = /charset=([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1];
      let text = dec(cs ?? "utf-8");
      const meta = !cs && /<meta[^>]+charset=["']?([\w-]+)/i.exec(text)?.[1];
      if (meta && !/utf-?8/i.test(meta)) text = dec(meta);
      if (/type\s*=\s*["']?password/i.test(text)) return { expired: true };
      if (mode === "text") return { text };
    }
    window.__bkhEclaimSync = buf;
    return { size: buf.length };
  } catch (e) {
    return { error: `ติดต่อ e-Claim ไม่ได้: ${e?.message ?? e}` };
  }
}

/** ไฟล์ที่ ecFetch เก็บไว้ ช่วง [s, e) เป็น base64 */
export function readChunk(s, e) {
  const buf = window.__bkhEclaimSync;
  if (!buf) return Promise.resolve({ error: "ไม่พบไฟล์ที่ดาวน์โหลดในแท็บ e-Claim (แท็บถูกโหลดใหม่ระหว่างทำงาน)" });
  return new Promise((ok) => {
    const f = new FileReader();
    f.onload = () => ok({ b64: String(f.result).split(",")[1] ?? "" });
    f.onerror = () => ok({ error: String(f.error) });
    f.readAsDataURL(new Blob([buf.subarray(s, e)]));
  });
}

/** ลบไฟล์ที่ ecFetch เก็บไว้ */
export function releaseFile() {
  delete window.__bkhEclaimSync;
  return {};
}

/** zone/จังหวัดที่เลือกอยู่ในหน้า Statement OFC ที่เปิดค้างไว้ (ไม่มีคืน null) */
export function ofcSelect() {
  const v = (s) => document.querySelector(s)?.value || null;
  return { zone: v('select[name="zone"], #zone'), province: v('select[name="province_id"], select[name="province"], #province_id, #province') };
}

// ---------- แท็บ/หน้า BKH Insight (ใช้ session ของแอป) ----------

/** ค่า key ของทุกแถวในรายการไฟล์ที่นำเข้าแล้ว (GET ของ route นำเข้า) */
export async function appList(path, key) {
  const out = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${path}?pageSize=all&page=${page}`);
    if (!res.ok) return { status: res.status };
    const b = await res.json();
    out.push(...b.rows.map((r) => r[key]));
    if (!b.rows.length || out.length >= b.total) return { values: out };
  }
}

/** ประกอบไฟล์จาก chunk base64 แล้ว POST multipart เข้า route นำเข้า */
export async function appUpload(path, name, fields, chunks) {
  const parts = chunks.map((c) => Uint8Array.from(atob(c), (ch) => ch.charCodeAt(0)));
  const fd = new FormData();
  fd.append("file", new File(parts, name));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(path, { method: "POST", body: fd });
  return { status: res.status, body: await res.json().catch(() => null) };
}
